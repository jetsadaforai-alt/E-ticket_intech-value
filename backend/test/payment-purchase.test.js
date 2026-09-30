const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/services/prismaClient');
const {
  startServer,
  stopServer,
  wipeDatabase,
  grantQuota,
  api,
  loginAsUser,
} = require('./helpers');

let baseUrl;

before(async () => {
  baseUrl = await startServer();
});
after(stopServer);
beforeEach(wipeDatabase);

async function approvedVendor(packageCode = 'free') {
  const phone = `08${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const owner = await loginAsUser(baseUrl, phone);

  const vendorRes = await api(baseUrl, '/v1/vendors', {
    method: 'POST',
    token: owner.token,
    body: { name: 'Payment Test Co' },
  });
  const vendorId = vendorRes.data.id;
  await prisma.vendorVerification.update({ where: { vendorId }, data: { status: 'approved' } });
  await prisma.vendor.update({ where: { id: vendorId }, data: { verificationStatus: 'approved' } });
  await grantQuota(vendorId, packageCode);

  return { owner, vendorId };
}

function buy(token, body) {
  return api(baseUrl, '/v1/vendors/me/purchases', { method: 'POST', token, body });
}

function confirmPayment(providerRef, status = 'succeeded') {
  return api(baseUrl, '/v1/payments/webhook', {
    method: 'POST',
    body: { provider_ref: providerRef, status },
  });
}

test('buying a package grants nothing until the gateway confirms', async () => {
  // An abandoned checkout must never hand out quota — the webhook is the only place
  // balances move.
  const { owner, vendorId } = await approvedVendor('free');
  const copper = await prisma.package.findUnique({ where: { code: 'copper' } });

  const order = await buy(owner.token, { type: 'package', package_id: copper.id });
  assert.equal(order.status, 201);
  assert.equal(order.data.purchase.status, 'pending');

  const beforePay = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(beforePay.ticketBalance, 5, 'still on Free while the payment is pending');
  assert.equal(beforePay.eventBalance, 1);

  const paid = await confirmPayment(order.data.payment.provider_ref);
  assert.equal(paid.status, 200);

  const afterPay = await prisma.vendorQuota.findUnique({
    where: { vendorId },
    include: { currentPackage: true },
  });
  assert.equal(afterPay.currentPackage.code, 'copper');
  assert.equal(afterPay.ticketBalance, 35, 'Copper adds 30 on top of the 5 already held — balances carry over');
  assert.equal(afterPay.eventBalance, 4);
});

test('a replayed webhook grants quota exactly once', async () => {
  // Real gateways retry callbacks; three deliveries of the same charge must not pay out
  // three times.
  const { owner, vendorId } = await approvedVendor('free');
  const gold = await prisma.package.findUnique({ where: { code: 'gold' } });

  const order = await buy(owner.token, { type: 'package', package_id: gold.id });
  const ref = order.data.payment.provider_ref;

  const responses = [];
  for (let i = 0; i < 3; i += 1) responses.push(await confirmPayment(ref));
  assert.ok(responses.every((r) => r.status === 200), 'retries are acknowledged, not errored');
  assert.equal(responses[1].data.already_applied, true);
  assert.equal(responses[2].data.already_applied, true);

  const quota = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(quota.ticketBalance, 5 + 800, 'granted once, not three times');
  assert.equal(quota.eventBalance, 1 + 8);

  const ledger = await prisma.quotaLedger.findMany({ where: { vendorId, reason: 'purchase' } });
  assert.equal(ledger.length, 1, 'one ledger row per purchase, guaranteed by the unique constraint');
});

test('packages are upgrade-only, so a cheaper bundle cannot be used to undercut top-up prices', async () => {
  const { owner } = await approvedVendor('gold');
  const copper = await prisma.package.findUnique({ where: { code: 'copper' } });
  const gold = await prisma.package.findUnique({ where: { code: 'gold' } });

  const downgrade = await buy(owner.token, { type: 'package', package_id: copper.id });
  assert.equal(downgrade.status, 409);
  assert.equal(downgrade.data.error, 'DOWNGRADE_NOT_ALLOWED');

  const sameTier = await buy(owner.token, { type: 'package', package_id: gold.id });
  assert.equal(sameTier.status, 409, 're-buying the current tier is the same loophole');
});

test('Free cannot top up — it has to upgrade first', async () => {
  const { owner } = await approvedVendor('free');

  const topup = await buy(owner.token, { type: 'event_topup', quantity: 1 });
  assert.equal(topup.status, 409);
  assert.equal(topup.data.error, 'TOPUP_NOT_AVAILABLE');
});

test('an event top-up brings its tier ticket allowance with it', async () => {
  const { owner, vendorId } = await approvedVendor('silver');

  const order = await buy(owner.token, { type: 'event_topup', quantity: 2 });
  assert.equal(order.status, 201);
  assert.equal(order.data.purchase.amount_baht, 90, '45฿ × 2');
  assert.equal(order.data.purchase.events_added, 2);
  assert.equal(order.data.purchase.tickets_added, 100, 'Silver allows 50 per event');

  await confirmPayment(order.data.payment.provider_ref);

  const quota = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(quota.eventBalance, 5 + 2);
  assert.equal(quota.ticketBalance, 250 + 100);
});

test('a ticket top-up aimed at one event raises that event\'s ceiling', async () => {
  const { owner, vendorId } = await approvedVendor('copper');

  const shopRes = await api(baseUrl, '/v1/shops', {
    method: 'POST',
    token: owner.token,
    body: { name: 'Topup Shop', address: '2 Test Rd' },
  });
  const eventRes = await api(baseUrl, `/v1/shops/${shopRes.data.id}/events`, {
    method: 'POST',
    token: owner.token,
    body: {
      title: 'Capped Event',
      category: 'food_drink',
      start_time: new Date(Date.now() - 60_000).toISOString(),
      end_time: new Date(Date.now() + 3_600_000).toISOString(),
      total_qty: 10,
      discount_value_baht: 20,
    },
  });
  assert.equal(eventRes.data.ticketCap, 10);

  const order = await buy(owner.token, {
    type: 'ticket_topup',
    quantity: 1,
    target_event_id: eventRes.data.id,
  });
  assert.equal(order.status, 201);
  assert.equal(order.data.purchase.amount_baht, 10);
  await confirmPayment(order.data.payment.provider_ref);

  const event = await prisma.event.findUnique({
    where: { id: eventRes.data.id },
    include: { ticketBatch: true },
  });
  assert.equal(event.ticketCap, 20, 'the ceiling rises so the event may hold what it now has');

  // The tickets are actually put into the event, not just allowed. Raising the cap alone
  // left the event sold out after payment — see test/ticket-topup-event.test.js.
  assert.equal(event.ticketBatch.totalQty, 20);
  assert.equal(event.ticketBatch.remainingCount, 20);
  assert.equal(await prisma.ticket.count({ where: { batchId: event.ticketBatch.id } }), 20);

  // 30 from Copper, 10 spent creating the event, then the top-up credits 10 and spends
  // the same 10 straight into that event — so the pool is unchanged by the top-up.
  const quota = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(quota.ticketBalance, 20);
});

test('a failed payment leaves the quota untouched', async () => {
  const { owner, vendorId } = await approvedVendor('free');
  const copper = await prisma.package.findUnique({ where: { code: 'copper' } });

  const order = await buy(owner.token, { type: 'package', package_id: copper.id });
  const failed = await confirmPayment(order.data.payment.provider_ref, 'failed');
  assert.equal(failed.status, 200);

  const quota = await prisma.vendorQuota.findUnique({
    where: { vendorId },
    include: { currentPackage: true },
  });
  assert.equal(quota.currentPackage.code, 'free');
  assert.equal(quota.ticketBalance, 5);

  const purchase = await prisma.purchase.findUnique({ where: { id: order.data.purchase.id } });
  assert.equal(purchase.status, 'failed');
});

test('editing package prices does not rewrite receipts already issued', async () => {
  // Purchase snapshots its price precisely so a SuperAdmin price change cannot
  // retroactively alter what someone was charged.
  const { owner } = await approvedVendor('free');
  const copper = await prisma.package.findUnique({ where: { code: 'copper' } });

  const order = await buy(owner.token, { type: 'package', package_id: copper.id });
  assert.equal(order.data.purchase.amount_baht, 59);

  await prisma.package.update({ where: { id: copper.id }, data: { priceBaht: 999 } });

  const history = await api(baseUrl, '/v1/vendors/me/purchases', { token: owner.token });
  assert.equal(history.data[0].amount_baht, 59, 'the old receipt still says 59฿');
  assert.equal(history.data[0].unit_price_baht, 59);
});
