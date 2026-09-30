const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/services/prismaClient');
const { sweepExpiredEvents } = require('../src/services/eventExpiry');
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

async function shopOn(packageCode) {
  const phone = `08${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const owner = await loginAsUser(baseUrl, phone);

  const vendorRes = await api(baseUrl, '/v1/vendors', {
    method: 'POST',
    token: owner.token,
    body: { name: 'Expiry Test Co' },
  });
  const vendorId = vendorRes.data.id;
  await prisma.vendorVerification.update({ where: { vendorId }, data: { status: 'approved' } });
  await prisma.vendor.update({ where: { id: vendorId }, data: { verificationStatus: 'approved' } });
  await grantQuota(vendorId, packageCode);

  const shopRes = await api(baseUrl, '/v1/shops', {
    method: 'POST',
    token: owner.token,
    body: { name: 'Expiry Shop', address: '3 Test Rd' },
  });

  return { owner, vendorId, shopId: shopRes.data.id };
}

async function createEvent(shopId, token, qty, endsInMs) {
  const res = await api(baseUrl, `/v1/shops/${shopId}/events`, {
    method: 'POST',
    token,
    body: {
      title: 'Expiring Event',
      category: 'food_drink',
      start_time: new Date(Date.now() - 120_000).toISOString(),
      end_time: new Date(Date.now() + endsInMs).toISOString(),
      total_qty: qty,
      discount_value_baht: 20,
    },
  });
  assert.equal(res.status, 201);
  return res.data.id;
}

test('an event past its end time is retired and its unsold tickets come back', async () => {
  const { owner, vendorId, shopId } = await shopOn('copper');
  const eventId = await createEvent(shopId, owner.token, 10, 60_000);

  const customer = await loginAsUser(baseUrl, '0899999101');
  await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: customer.token });

  // Nothing is due yet, so a sweep now must be a no-op.
  assert.deepEqual(await sweepExpiredEvents(), { expired: 0, ticketsReturned: 0 });

  // Move the end time into the past rather than waiting a minute for it.
  await prisma.event.update({ where: { id: eventId }, data: { endTime: new Date(Date.now() - 1000) } });

  const result = await sweepExpiredEvents();
  assert.equal(result.expired, 1);
  assert.equal(result.ticketsReturned, 9, 'the one issued ticket is spent for good');

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  assert.equal(event.status, 'expired');

  const quota = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(quota.ticketBalance, 30 - 10 + 9);
  assert.equal(
    quota.eventBalance,
    2,
    'running out of time is not a refund of the slot — only an explicit cancel returns that'
  );
});

test('sweeping twice returns the tickets only once', async () => {
  const { owner, vendorId, shopId } = await shopOn('copper');
  const eventId = await createEvent(shopId, owner.token, 10, 60_000);
  await prisma.event.update({ where: { id: eventId }, data: { endTime: new Date(Date.now() - 1000) } });

  await sweepExpiredEvents();
  const afterFirst = await prisma.vendorQuota.findUnique({ where: { vendorId } });

  const second = await sweepExpiredEvents();
  assert.deepEqual(second, { expired: 0, ticketsReturned: 0 }, 'nothing left to do');

  const afterSecond = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(afterSecond.ticketBalance, afterFirst.ticketBalance);
  assert.equal(afterSecond.eventBalance, afterFirst.eventBalance);

  const ledger = await prisma.quotaLedger.findMany({ where: { vendorId, reason: 'event_expired' } });
  assert.equal(ledger.length, 1);
});

test('an already-cancelled event is left alone by the sweep', async () => {
  // Both paths refund, so whichever runs first must lock the other out — otherwise a
  // cancel followed by expiry would pay twice.
  const { owner, vendorId, shopId } = await shopOn('copper');
  const eventId = await createEvent(shopId, owner.token, 10, 60_000);

  await api(baseUrl, `/v1/events/${eventId}/cancel`, { method: 'POST', token: owner.token });
  const afterCancel = await prisma.vendorQuota.findUnique({ where: { vendorId } });

  await prisma.event.update({ where: { id: eventId }, data: { endTime: new Date(Date.now() - 1000) } });
  assert.deepEqual(await sweepExpiredEvents(), { expired: 0, ticketsReturned: 0 });

  const afterSweep = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(afterSweep.ticketBalance, afterCancel.ticketBalance);
  assert.equal(afterSweep.eventBalance, afterCancel.eventBalance);
});
