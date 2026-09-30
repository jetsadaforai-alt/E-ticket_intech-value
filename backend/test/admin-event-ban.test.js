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

async function adminToken(role = 'admin') {
  const a = await createAdmin(role);
  return loginAsAdmin(baseUrl, a.username, a.password);
}

const ban = (eventId, token, reason = 'เนื้อหาไม่เหมาะสม') =>
  api(baseUrl, `/v1/admin/events/${eventId}/ban`, { method: 'POST', token, body: { reason } });

/** Gives `phone` a ticket for the event, and redeems it when asked. */
async function takeTicket(eventId, phone, { redeem = false, ownerToken } = {}) {
  const buyer = await loginAsUser(baseUrl, phone);
  const ticket = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token });
  assert.equal(ticket.status, 201);
  if (redeem) {
    const qr = await api(baseUrl, `/v1/tickets/${ticket.data.id}/qr-token`, { token: buyer.token });
    const scan = await api(baseUrl, '/v1/staff/scan', { method: 'POST', token: ownerToken, body: { token: qr.data.token } });
    assert.equal(scan.status, 200);
  }
  return { buyer, ticketId: ticket.data.id };
}

test('a shop owner cannot reach the admin ban endpoint', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl);
  const res = await ban(eventId, owner.token);
  assert.equal(res.status, 401); // a user JWT is not an admin JWT
});

// Moderating content is Admin work, not a SuperAdmin-only power — the split in this
// codebase reserves SuperAdmin for pricing, admin accounts and platform metrics.
test('a plain admin can ban, not just a superadmin', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl);
  const res = await ban(eventId, await adminToken('admin'));
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'banned');
});

test('a ban without a reason is rejected', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl);
  const res = await api(baseUrl, `/v1/admin/events/${eventId}/ban`, {
    method: 'POST',
    token: await adminToken(),
    body: { reason: '   ' },
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'REASON_REQUIRED');
});

// VendorVerification has a reviewedBy column that no code ever writes, which cost the
// project its "who approved this" history. Don't repeat it here.
test('the ban records who did it, when, and why', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl);
  const admin = await createAdmin('admin');
  const token = await loginAsAdmin(baseUrl, admin.username, admin.password);

  await ban(eventId, token, 'รูปภาพไม่เหมาะสม');

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  assert.equal(event.status, 'banned');
  assert.equal(event.bannedReason, 'รูปภาพไม่เหมาะสม');
  assert.equal(event.bannedByAdminId, admin.id);
  assert.ok(event.bannedAt instanceof Date);
});

// The decisive difference from a vendor's own cancel, which leaves ISSUED tickets alone
// so holders keep what they were given. A banned discount must stop being honoured.
test('tickets already in customers hands are cancelled', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 5 });
  await takeTicket(eventId, '0855552001');
  await takeTicket(eventId, '0855552002');

  const res = await ban(eventId, await adminToken());
  assert.equal(res.status, 200);

  const counts = await prisma.ticket.groupBy({
    by: ['status'],
    where: { batch: { eventId } },
    _count: true,
  });
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  assert.equal(byStatus.ISSUED, undefined, 'no ticket may be left issued');
  assert.equal(byStatus.CANCELLED, 5, 'both issued and unclaimed tickets are cancelled');
  assert.equal(res.data.tickets_cancelled, 5);
  assert.equal(owner.token.length > 0, true);
});

// Those visits really happened. Rewriting them would falsify the redemption history and
// the shop's own reporting.
test('already-redeemed tickets are left untouched', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 3 });
  await takeTicket(eventId, '0855552003', { redeem: true, ownerToken: owner.token });

  await ban(eventId, await adminToken());

  const redeemed = await prisma.ticket.count({ where: { batch: { eventId }, status: 'REDEEMED' } });
  assert.equal(redeemed, 1);
});

// A ban is a penalty. The vendor's own cancel returns the event credit and unused
// tickets; losing the slot through misconduct returns nothing.
test('banning refunds no quota and writes no ledger entry', async () => {
  const { vendorId, eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 4 });
  const before = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  const ledgerBefore = await prisma.quotaLedger.count({ where: { vendorId } });

  await ban(eventId, await adminToken());

  const after = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(after.ticketBalance, before.ticketBalance);
  assert.equal(after.eventBalance, before.eventBalance);
  assert.equal(await prisma.quotaLedger.count({ where: { vendorId } }), ledgerBefore);
});

test('the vendor and every ticket holder are notified', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 5 });
  const { buyer } = await takeTicket(eventId, '0855552004');

  await ban(eventId, await adminToken(), 'ผิดเงื่อนไขการใช้งาน');

  const holderNote = await prisma.notification.findFirst({
    where: { userId: buyer.userId, type: 'event_banned' },
  });
  assert.ok(holderNote, 'the holder should be told their ticket is dead');
  assert.equal(holderNote.payload.reason, 'ผิดเงื่อนไขการใช้งาน');

  const ownerNote = await prisma.notification.findFirst({
    where: { userId: owner.userId, type: 'event_banned' },
  });
  assert.ok(ownerNote, 'the vendor should be told why');
});

test('banning twice is a conflict, not a second round of cancellations', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl);
  const token = await adminToken();

  assert.equal((await ban(eventId, token)).status, 200);
  const second = await ban(eventId, token);

  assert.equal(second.status, 409);
  assert.equal(second.data.error, 'NOT_ACTIVE');
});

test('an event the vendor already cancelled cannot be banned', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl);
  await api(baseUrl, `/v1/events/${eventId}/cancel`, { method: 'POST', token: owner.token });

  const res = await ban(eventId, await adminToken());

  assert.equal(res.status, 409);
  assert.equal(res.data.error, 'NOT_ACTIVE');
});

// The whole point: the discount stops working at the counter. Before this feature a
// ticket for a dead event still scanned through, because staffScan only ever looked at
// the ticket's own status.
test('a banned event\'s ticket no longer scans', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 3 });
  const buyer = await loginAsUser(baseUrl, '0855552005');
  const ticket = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token });
  const qr = await api(baseUrl, `/v1/tickets/${ticket.data.id}/qr-token`, { token: buyer.token });

  await ban(eventId, await adminToken());

  const scan = await api(baseUrl, '/v1/staff/scan', {
    method: 'POST',
    token: owner.token,
    body: { token: qr.data.token },
  });
  assert.notEqual(scan.status, 200);
});

test('a banned event drops out of the public feed', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl);
  const res = await ban(eventId, await adminToken());
  assert.equal(res.status, 200, JSON.stringify(res.data));

  const list = await api(baseUrl, '/v1/events');
  assert.equal(list.data.find((e) => e.id === eventId), undefined);
});

test('the admin list and detail expose what is needed to judge an event', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl);
  const token = await adminToken();

  const list = await api(baseUrl, '/v1/admin/events?status=active', { token });
  assert.equal(list.status, 200);
  const row = list.data.find((e) => e.id === eventId);
  assert.ok(row.shop_name, 'the list must say whose event it is');

  const detail = await api(baseUrl, `/v1/admin/events/${eventId}`, { token });
  assert.equal(detail.status, 200);
  assert.ok(Array.isArray(detail.data.image_urls), 'images are how you judge appropriateness');
  assert.equal(detail.data.status, 'active');
  assert.equal(detail.data.banned_reason, null);
});

test('a banned event can no longer be edited by its shop', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl);
  const res = await ban(eventId, await adminToken());
  assert.equal(res.status, 200, JSON.stringify(res.data));

  // Without this the vendor could rename a banned event, and the reason the admin
  // recorded would stop describing the thing it was recorded against.
  const edit = await api(baseUrl, `/v1/events/${eventId}`, {
    method: 'PATCH',
    token: owner.token,
    body: { title: 'ชื่อใหม่หลังโดนแบน' },
  });
  assert.equal(edit.status, 409);
  assert.equal(edit.data.error, 'NOT_ACTIVE');

  const after = await prisma.event.findUnique({ where: { id: eventId }, select: { title: true } });
  assert.notEqual(after.title, 'ชื่อใหม่หลังโดนแบน');
});
