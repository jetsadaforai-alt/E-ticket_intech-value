const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/services/prismaClient');
const {
  startServer,
  stopServer,
  wipeDatabase,
  api,
  loginAsUser,
  createApprovedShopWithEvent,
} = require('./helpers');

let baseUrl;

before(async () => {
  baseUrl = await startServer();
});
after(stopServer);
beforeEach(wipeDatabase);

function buy(token, body) {
  return api(baseUrl, '/v1/vendors/me/purchases', { method: 'POST', token, body });
}

function confirmPayment(providerRef, status = 'succeeded') {
  return api(baseUrl, '/v1/payments/webhook', { method: 'POST', body: { provider_ref: providerRef, status } });
}

// Test fixtures seed the wallet directly (helpers.grantQuota) without ledger rows, so the
// absolute `balance == SUM(ticketDelta)` invariant doesn't hold from a seeded start.
// Comparing movements does, and that is what these tests are actually about.
async function ticketLedgerSum(vendorId) {
  const agg = await prisma.quotaLedger.aggregate({ where: { vendorId }, _sum: { ticketDelta: true } });
  return agg._sum.ticketDelta ?? 0;
}

/** Buys every ticket in the event so the batch is genuinely sold out. */
async function drainEvent(eventId, count) {
  for (let i = 0; i < count; i += 1) {
    const buyer = await loginAsUser(baseUrl, `08${String(10_000_000 + i)}`);
    const res = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token });
    assert.equal(res.status, 201, `buyer ${i} should get a ticket`);
  }
}

// The bug this file exists for: the vendor paid for tickets aimed at one event, the
// event's ceiling went up, and nothing else did — so the event stayed sold out and the
// money bought nothing claimable.
test('a ticket top-up aimed at an event makes that event claimable again', async () => {
  const { owner, shopId, eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 2, packageCode: 'gold' });

  await drainEvent(eventId, 2);
  const soldOutBuyer = await loginAsUser(baseUrl, '0899999901');
  const soldOut = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: soldOutBuyer.token });
  assert.equal(soldOut.status, 409);
  assert.equal(soldOut.data.error, 'SOLD_OUT');

  const order = await buy(owner.token, { type: 'ticket_topup', quantity: 1, target_event_id: eventId });
  assert.equal(order.status, 201);

  // Still sold out while the payment is only pending — quota moves at the webhook.
  const stillSoldOut = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: soldOutBuyer.token });
  assert.equal(stillSoldOut.status, 409);

  const paid = await confirmPayment(order.data.payment.provider_ref);
  assert.equal(paid.status, 200);

  const nowClaimable = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: soldOutBuyer.token });
  assert.equal(nowClaimable.status, 201, 'the top-up must produce a ticket someone can actually take');

  const shop = await api(baseUrl, `/v1/shops/${shopId}`, { token: owner.token });
  assert.equal(shop.status, 200);
});

test('the top-up mints real ticket rows and raises the batch, not just the ceiling', async () => {
  const { owner, vendorId, eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 3, packageCode: 'gold' });

  const gold = await prisma.package.findUnique({ where: { code: 'gold' } });
  const bundle = gold.ticketPerEvent; // a ticket top-up is sold one tier-bundle at a time
  const beforeEvent = await prisma.event.findUnique({ where: { id: eventId }, include: { ticketBatch: true } });
  const beforeQuota = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  const beforeLedger = await ticketLedgerSum(vendorId);

  const order = await buy(owner.token, { type: 'ticket_topup', quantity: 1, target_event_id: eventId });
  await confirmPayment(order.data.payment.provider_ref);

  const afterEvent = await prisma.event.findUnique({ where: { id: eventId }, include: { ticketBatch: true } });
  assert.equal(afterEvent.ticketBatch.totalQty, beforeEvent.ticketBatch.totalQty + bundle);
  assert.equal(afterEvent.ticketBatch.remainingCount, beforeEvent.ticketBatch.remainingCount + bundle);
  assert.equal(afterEvent.ticketCap, beforeEvent.ticketCap + bundle, 'ceiling must rise with the stock');

  const ticketCount = await prisma.ticket.count({ where: { batchId: afterEvent.ticketBatch.id } });
  assert.equal(ticketCount, 3 + bundle, 'real Ticket rows exist, not just a bigger number');

  // Bought and placed in one go: the pool is credited then spent straight back out, so
  // the vendor does not also get to keep the tickets in their general balance.
  const afterQuota = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(afterQuota.ticketBalance, beforeQuota.ticketBalance, 'net pool change must be zero');

  // Every movement is ledgered: the purchase credit and the spend into the event cancel
  // out, and the ledger says so too (quota.js invariant).
  const afterLedger = await ticketLedgerSum(vendorId);
  assert.equal(
    afterLedger - beforeLedger,
    afterQuota.ticketBalance - beforeQuota.ticketBalance,
    'ledger movement must match balance movement'
  );
  assert.equal(afterLedger - beforeLedger, 0);
});

test('a replayed webhook does not mint a second batch of tickets', async () => {
  const { owner, vendorId, eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 2, packageCode: 'silver' });

  const order = await buy(owner.token, { type: 'ticket_topup', quantity: 1, target_event_id: eventId });
  const ref = order.data.payment.provider_ref;

  await confirmPayment(ref);
  const afterFirst = await prisma.event.findUnique({ where: { id: eventId }, include: { ticketBatch: true } });
  const countAfterFirst = await prisma.ticket.count({ where: { batchId: afterFirst.ticketBatch.id } });
  const quotaAfterFirst = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  const ledgerAfterFirst = await ticketLedgerSum(vendorId);

  await confirmPayment(ref);
  await confirmPayment(ref);

  const afterReplays = await prisma.event.findUnique({ where: { id: eventId }, include: { ticketBatch: true } });
  const countAfterReplays = await prisma.ticket.count({ where: { batchId: afterReplays.ticketBatch.id } });

  assert.equal(countAfterReplays, countAfterFirst, 'replays must not create more tickets');
  assert.equal(afterReplays.ticketBatch.remainingCount, afterFirst.ticketBatch.remainingCount);
  assert.equal(afterReplays.ticketCap, afterFirst.ticketCap);

  const quotaAfterReplays = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(quotaAfterReplays.ticketBalance, quotaAfterFirst.ticketBalance, 'balance must not move on replay');
  assert.equal(await ticketLedgerSum(vendorId), ledgerAfterFirst, 'no extra ledger rows on replay');
});

// The event is checked when the vendor pays, but the webhook lands later — by then the
// event may be gone. The money is already taken, so the tickets have to land somewhere.
test('if the event is cancelled before the webhook, the tickets fall back to the general pool', async () => {
  const { owner, vendorId, eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 2, packageCode: 'gold' });

  const order = await buy(owner.token, { type: 'ticket_topup', quantity: 1, target_event_id: eventId });

  const cancelled = await api(baseUrl, `/v1/events/${eventId}/cancel`, { method: 'POST', token: owner.token });
  assert.equal(cancelled.status, 200);

  const quotaBefore = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  const paid = await confirmPayment(order.data.payment.provider_ref);
  assert.equal(paid.status, 200, 'payment must still settle — the vendor was charged');

  const gold = await prisma.package.findUnique({ where: { code: 'gold' } });
  const quotaAfter = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(
    quotaAfter.ticketBalance,
    quotaBefore.ticketBalance + gold.ticketPerEvent,
    'tickets stay in the pool instead of vanishing into a dead event'
  );

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { ticketBatch: true } });
  const ticketCount = await prisma.ticket.count({ where: { batchId: event.ticketBatch.id } });
  assert.equal(ticketCount, 2, 'no tickets minted into the cancelled event');
});

test('a plain ticket top-up with no target event only credits the pool', async () => {
  const { owner, vendorId, eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 2, packageCode: 'gold' });

  const before = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  const order = await buy(owner.token, { type: 'ticket_topup', quantity: 1 });
  await confirmPayment(order.data.payment.provider_ref);

  const gold = await prisma.package.findUnique({ where: { code: 'gold' } });
  const after = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(after.ticketBalance, before.ticketBalance + gold.ticketPerEvent);

  const event = await prisma.event.findUnique({ where: { id: eventId }, include: { ticketBatch: true } });
  assert.equal(event.ticketBatch.totalQty, 2, 'an untargeted top-up must not touch any event');
});
