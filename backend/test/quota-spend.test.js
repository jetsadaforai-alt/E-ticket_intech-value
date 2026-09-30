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

/** Approved vendor + shop, on the given package, ready to create events. */
async function approvedShop(packageCode) {
  const phone = `08${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const owner = await loginAsUser(baseUrl, phone);

  const vendorRes = await api(baseUrl, '/v1/vendors', {
    method: 'POST',
    token: owner.token,
    body: { name: 'Quota Test Co' },
  });
  const vendorId = vendorRes.data.id;
  await prisma.vendorVerification.update({ where: { vendorId }, data: { status: 'approved' } });
  await prisma.vendor.update({ where: { id: vendorId }, data: { verificationStatus: 'approved' } });
  const pkg = await grantQuota(vendorId, packageCode);

  const shopRes = await api(baseUrl, '/v1/shops', {
    method: 'POST',
    token: owner.token,
    body: { name: 'Quota Test Shop', address: '1 Test Rd' },
  });

  return { owner, vendorId, shopId: shopRes.data.id, pkg };
}

function createEvent(shopId, token, qty) {
  return api(baseUrl, `/v1/shops/${shopId}/events`, {
    method: 'POST',
    token,
    body: {
      title: 'Quota Event',
      category: 'food_drink',
      start_time: new Date(Date.now() - 60_000).toISOString(),
      end_time: new Date(Date.now() + 3_600_000).toISOString(),
      total_qty: qty,
      discount_value_baht: 20,
    },
  });
}

test('the per-event ceiling is enforced even when the ticket pool is nowhere near empty', async () => {
  // This is the heart of the Pay-per-Event model: Copper buys 30 tickets in total, but
  // no single event may hold more than 10 of them.
  const { owner, shopId, vendorId } = await approvedShop('copper');

  const before = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(before.ticketBalance, 30, 'Copper grants 3 events × 10 tickets');
  assert.equal(before.eventBalance, 3);

  const overCap = await createEvent(shopId, owner.token, 11);
  assert.equal(overCap.status, 400);
  assert.equal(overCap.data.error, 'EXCEEDS_TICKET_CAP');
  assert.equal(overCap.data.ticket_cap, 10);

  const after = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(after.ticketBalance, 30, 'a rejected request must not spend anything');
  assert.equal(after.eventBalance, 3);

  const atCap = await createEvent(shopId, owner.token, 10);
  assert.equal(atCap.status, 201, 'exactly at the ceiling is allowed');
  assert.equal(atCap.data.ticketCap, 10, 'the ceiling is snapshotted onto the event');
});

test('creating an event spends one event credit plus its tickets, and running out blocks the next one', async () => {
  const { owner, shopId, vendorId } = await approvedShop('free'); // 1 event × 5 tickets

  const first = await createEvent(shopId, owner.token, 5);
  assert.equal(first.status, 201);

  const spent = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(spent.ticketBalance, 0);
  assert.equal(spent.eventBalance, 0);

  const second = await createEvent(shopId, owner.token, 1);
  assert.equal(second.status, 409);
  assert.equal(second.data.error, 'INSUFFICIENT_QUOTA');
});

test('concurrent event creation cannot overspend the quota', async () => {
  // Free has room for exactly one event. Three requests at once must not produce
  // three events or drive either balance below zero — the same class of bug the
  // appeal cap had before it became a single conditional UPDATE.
  const { owner, shopId, vendorId } = await approvedShop('free');

  const results = await Promise.all([1, 2, 3].map(() => createEvent(shopId, owner.token, 5)));
  const created = results.filter((r) => r.status === 201);
  assert.equal(created.length, 1, 'exactly one concurrent creation may win');

  const quota = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(quota.ticketBalance, 0);
  assert.equal(quota.eventBalance, 0);
  assert.ok(quota.ticketBalance >= 0 && quota.eventBalance >= 0, 'balances must never go negative');

  assert.equal(await prisma.event.count(), 1, 'no half-built events left behind');
});

test('cancelling returns the event credit and unsold tickets, and cannot be claimed twice', async () => {
  const { owner, shopId, vendorId } = await approvedShop('copper');

  const created = await createEvent(shopId, owner.token, 10);
  const eventId = created.data.id;

  // One ticket goes out, so only nine are still unsold.
  const customer = await loginAsUser(baseUrl, '0899999001');
  const reg = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: customer.token });
  assert.equal(reg.status, 201);

  const cancelled = await api(baseUrl, `/v1/events/${eventId}/cancel`, { method: 'POST', token: owner.token });
  assert.equal(cancelled.status, 200);
  assert.deepEqual(cancelled.data.quota_returned, { tickets: 9, events: 1 });

  const quota = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(quota.ticketBalance, 29, '30 − 10 spent + 9 returned; the issued ticket is gone for good');
  assert.equal(quota.eventBalance, 3, 'the event credit comes back on an explicit cancel');

  const again = await api(baseUrl, `/v1/events/${eventId}/cancel`, { method: 'POST', token: owner.token });
  assert.equal(again.status, 409, 'a second cancel must not refund again');

  const unchanged = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(unchanged.ticketBalance, 29);
  assert.equal(unchanged.eventBalance, 3);
});

test('the ledger always reconciles with the stored balances', async () => {
  // VendorQuota is a running total; QuotaLedger is the history it must agree with.
  // If these ever diverge, some code path moved a balance without recording why.
  const { owner, shopId, vendorId } = await approvedShop('copper');

  const a = await createEvent(shopId, owner.token, 10);
  const b = await createEvent(shopId, owner.token, 4);
  assert.equal(a.status, 201);
  assert.equal(b.status, 201);
  await api(baseUrl, `/v1/events/${a.data.id}/cancel`, { method: 'POST', token: owner.token });

  const quota = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  const entries = await prisma.quotaLedger.findMany({ where: { vendorId } });

  const sum = (key) => entries.reduce((total, row) => total + row[key], 0);
  // The opening balance isn't a ledger entry (grantQuota seeds it directly), so the
  // ledger accounts for the movement away from it.
  const opening = { tickets: 30, events: 3 };

  assert.equal(quota.ticketBalance, opening.tickets + sum('ticketDelta'));
  assert.equal(quota.eventBalance, opening.events + sum('eventDelta'));
});
