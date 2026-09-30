const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/services/prismaClient');
const {
  startServer,
  stopServer,
  wipeDatabase,
  api,
  loginAsUser,
  createAdmin,
  loginAsAdmin,
  createApprovedShopWithEvent,
} = require('./helpers');

let baseUrl;

before(async () => {
  baseUrl = await startServer();
});
after(stopServer);
beforeEach(wipeDatabase);

const dashboard = (token) => api(baseUrl, '/v1/superadmin/dashboard', { token });

async function superAdminToken() {
  const sa = await createAdmin('super_admin');
  return loginAsAdmin(baseUrl, sa.username, sa.password);
}

/** A purchase row in whatever state we need, without going through the payment flow. */
async function seedPurchase(vendorId, { type = 'package', amount, status, code = 'copper' }) {
  const pkg = await prisma.package.findUnique({ where: { code } });
  return prisma.purchase.create({
    data: {
      vendorId,
      type,
      packageId: pkg.id,
      packageCodeSnapshot: code,
      unitPriceSnapshot: amount,
      amountBaht: amount,
      status,
      paidAt: status === 'paid' ? new Date() : null,
    },
  });
}

test('a plain admin cannot open the dashboard', async () => {
  const admin = await createAdmin('admin');
  const token = await loginAsAdmin(baseUrl, admin.username, admin.password);

  const res = await dashboard(token);

  assert.equal(res.status, 403);
  assert.equal(res.data.error, 'SUPER_ADMIN_ONLY');
});

// The one that actually matters. A Purchase row exists from the moment checkout starts,
// long before any money arrives — and abandoned ones are never cleaned up. Summing
// without the status filter would report money the platform never received.
test('revenue counts only purchases the gateway confirmed', async () => {
  const { vendorId } = await createApprovedShopWithEvent(baseUrl);
  await seedPurchase(vendorId, { amount: 100, status: 'paid' });
  await seedPurchase(vendorId, { amount: 999, status: 'pending' });
  await seedPurchase(vendorId, { amount: 555, status: 'failed' });

  const res = await dashboard(await superAdminToken());

  assert.equal(res.status, 200);
  assert.equal(res.data.revenue.total, 100);
  assert.equal(res.data.revenue.order_count, 1);
});

test('revenue is broken down by purchase type and by tier', async () => {
  const { vendorId } = await createApprovedShopWithEvent(baseUrl);
  await seedPurchase(vendorId, { type: 'package', amount: 59, status: 'paid', code: 'copper' });
  await seedPurchase(vendorId, { type: 'event_topup', amount: 25, status: 'paid', code: 'copper' });
  await seedPurchase(vendorId, { type: 'ticket_topup', amount: 10, status: 'paid', code: 'silver' });

  const { data } = await dashboard(await superAdminToken());

  const byType = Object.fromEntries(data.revenue.by_type.map((r) => [r.type, r.amount]));
  assert.deepEqual(byType, { package: 59, event_topup: 25, ticket_topup: 10 });

  const byTier = Object.fromEntries(data.revenue.by_tier.map((r) => [r.package_code, r.amount]));
  assert.deepEqual(byTier, { copper: 84, silver: 10 });
  assert.equal(data.revenue.total, 94);
});

test('outstanding quota matches the sum of vendor balances', async () => {
  const { vendorId } = await createApprovedShopWithEvent(baseUrl);
  const quota = await prisma.vendorQuota.findUnique({ where: { vendorId } });

  const { data } = await dashboard(await superAdminToken());

  assert.equal(data.quota.outstanding_tickets, quota.ticketBalance);
  assert.equal(data.quota.outstanding_events, quota.eventBalance);
});

test('the quota ledger is summarised by reason', async () => {
  await createApprovedShopWithEvent(baseUrl); // creating the event writes an event_created row

  const { data } = await dashboard(await superAdminToken());

  const created = data.quota.ledger.find((r) => r.reason === 'event_created');
  assert.ok(created, 'expected an event_created ledger entry');
  assert.ok(created.ticket_delta < 0, 'creating an event should consume tickets');
});

// Value delivered is read off Redemption, not TicketBatch: a shop can edit the batch's
// discount later, but what was already honoured must not move retroactively.
test('redeemed discount value reflects actual redemptions', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl, { discount: 30 });
  const buyer = await loginAsUser(baseUrl, '0855551001');
  const ticket = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token });
  const qr = await api(baseUrl, `/v1/tickets/${ticket.data.id}/qr-token`, { token: buyer.token });
  await api(baseUrl, '/v1/staff/scan', { method: 'POST', token: owner.token, body: { token: qr.data.token } });

  const { data } = await dashboard(await superAdminToken());

  assert.equal(data.value.discount_redeemed, 30);
  assert.equal(data.value.tickets_redeemed, 1);
  assert.equal(data.value.tickets_issued, 1);
});

test('vendors are counted per package tier', async () => {
  await createApprovedShopWithEvent(baseUrl, { packageCode: 'gold' });

  const { data } = await dashboard(await superAdminToken());

  const gold = data.packages.find((p) => p.code === 'gold');
  assert.equal(gold.vendor_count, 1);
  assert.equal(data.unknown_package_vendors, 0);
});

test('the trend series covers 30 continuous days including quiet ones', async () => {
  const { vendorId } = await createApprovedShopWithEvent(baseUrl);
  await seedPurchase(vendorId, { amount: 59, status: 'paid' });

  const { data } = await dashboard(await superAdminToken());

  assert.equal(data.trends.revenue.length, 30);
  assert.equal(data.trends.redemptions.length, 30);
  // Today is the last bucket and carries the sale we just made.
  assert.equal(data.trends.revenue.at(-1).value, 59);
  // Gaps are filled rather than omitted, so the chart's x-axis stays even.
  assert.equal(data.trends.revenue[0].value, 0);
});

// An empty platform is the state a fresh deployment starts in — averages must not blow up
// on a division by zero and nothing may come back as NaN.
test('the dashboard answers on a completely empty database', async () => {
  const { status, data } = await dashboard(await superAdminToken());

  assert.equal(status, 200);
  assert.equal(data.revenue.total, 0);
  assert.equal(data.revenue.average_order, 0);
  assert.equal(data.quota.outstanding_tickets, 0);
  assert.equal(data.value.discount_redeemed, 0);
  assert.equal(data.reviews.average, null);
  assert.equal(data.reviews.count, 0);
  assert.equal(data.trends.revenue.length, 30);
});

// EXPIRED is never written by any code path, so a bucket for it would sit at zero forever
// and read as a broken metric. RESERVED stays: it is a deliberately reserved value.
test('the ticket breakdown drops the dead EXPIRED bucket but keeps RESERVED', async () => {
  await createApprovedShopWithEvent(baseUrl);

  const { data } = await dashboard(await superAdminToken());

  assert.equal(data.tickets.EXPIRED, undefined);
  assert.equal(data.tickets.RESERVED, 0);
  assert.ok(data.tickets.AVAILABLE > 0);
});

// The trend buckets are Bangkok days, but Prisma stores DateTime as a naive UTC
// timestamp. Between 17:00 and 24:00 UTC the two calendars disagree, and a sale made
// just after midnight in Bangkok used to fall into the previous day's bucket — which
// meant "today's revenue" read 0 for the first seven hours of every Thai business day.
// Pinned to an explicit instant so it fails regardless of when the suite happens to run.
test('a sale just after midnight in Bangkok lands in today\'s bucket, not yesterday\'s', async () => {
  const { DateTime } = require('luxon');
  const { vendorId } = await createApprovedShopWithEvent(baseUrl);

  const justAfterMidnight = DateTime.now().setZone('Asia/Bangkok').startOf('day').plus({ minutes: 30 });
  const purchase = await seedPurchase(vendorId, { amount: 77, status: 'paid' });
  await prisma.purchase.update({
    where: { id: purchase.id },
    data: { paidAt: justAfterMidnight.toUTC().toJSDate() },
  });

  const { data } = await dashboard(await superAdminToken());

  const today = justAfterMidnight.toFormat('yyyy-MM-dd');
  assert.equal(data.trends.revenue.at(-1).day, today);
  assert.equal(data.trends.revenue.at(-1).value, 77);
});
