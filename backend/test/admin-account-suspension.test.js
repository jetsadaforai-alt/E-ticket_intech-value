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

const suspendUser = (userId, token, reason = 'พฤติกรรมไม่เหมาะสม') =>
  api(baseUrl, `/v1/admin/users/${userId}/suspend`, { method: 'POST', token, body: { reason } });
const unsuspendUser = (userId, token) =>
  api(baseUrl, `/v1/admin/users/${userId}/unsuspend`, { method: 'POST', token });

const suspendVendor = (vendorId, token, reason = 'ละเมิดเงื่อนไขแพลตฟอร์ม') =>
  api(baseUrl, `/v1/admin/vendors/${vendorId}/suspend`, { method: 'POST', token, body: { reason } });
const unsuspendVendor = (vendorId, token) =>
  api(baseUrl, `/v1/admin/vendors/${vendorId}/unsuspend`, { method: 'POST', token });

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

// ── User suspension ─────────────────────────────────────────────

test('a regular user cannot reach the admin user endpoints', async () => {
  const buyer = await loginAsUser(baseUrl, '0855553001');
  const res = await suspendUser(buyer.userId, buyer.token);
  assert.equal(res.status, 401); // a user JWT is not an admin JWT
});

test('a plain admin can suspend a user, not just a superadmin', async () => {
  const buyer = await loginAsUser(baseUrl, '0855553002');
  const res = await suspendUser(buyer.userId, await adminToken('admin'));
  assert.equal(res.status, 200);
  assert.equal(res.data.status, 'suspended');
});

test('a suspension without a reason is rejected', async () => {
  const buyer = await loginAsUser(baseUrl, '0855553003');
  const res = await api(baseUrl, `/v1/admin/users/${buyer.userId}/suspend`, {
    method: 'POST',
    token: await adminToken(),
    body: { reason: '   ' },
  });
  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'REASON_REQUIRED');
});

// VendorVerification has a reviewedBy column that no code ever writes, which cost the
// project its "who approved this" history (admin-event-ban.test.js). Don't repeat it here.
test('the suspension records who did it, when, and why', async () => {
  const buyer = await loginAsUser(baseUrl, '0855553004');
  const admin = await createAdmin('admin');
  const token = await loginAsAdmin(baseUrl, admin.username, admin.password);

  await suspendUser(buyer.userId, token, 'สแปมในแชท');

  const user = await prisma.user.findUnique({ where: { id: buyer.userId } });
  assert.equal(user.status, 'suspended');
  assert.equal(user.suspendedReason, 'สแปมในแชท');
  assert.equal(user.suspendedByAdminId, admin.id);
  assert.ok(user.suspendedAt instanceof Date);
});

test('tickets the user is holding are cancelled, but not returned to the pool', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 5 });
  const { buyer } = await takeTicket(eventId, '0855553005');

  const before = await prisma.ticketBatch.findUnique({ where: { eventId } });

  const res = await suspendUser(buyer.userId, await adminToken());
  assert.equal(res.status, 200);
  assert.equal(res.data.tickets_cancelled, 1);

  const ticket = await prisma.ticket.findFirst({ where: { batch: { eventId }, currentHolderUserId: buyer.userId } });
  assert.equal(ticket.status, 'CANCELLED');

  // remainingCount is untouched — the ticket does not go back into the shop's pool.
  const after = await prisma.ticketBatch.findUnique({ where: { eventId } });
  assert.equal(after.remainingCount, before.remainingCount);
});

test('an already-redeemed ticket is left untouched', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 3 });
  const { buyer } = await takeTicket(eventId, '0855553006', { redeem: true, ownerToken: owner.token });

  await suspendUser(buyer.userId, await adminToken());

  const ticket = await prisma.ticket.findFirst({ where: { currentHolderUserId: buyer.userId } });
  assert.equal(ticket.status, 'REDEEMED');
});

test('the same pre-suspension token stops working immediately, without re-login', async () => {
  const buyer = await loginAsUser(baseUrl, '0855553007');
  await suspendUser(buyer.userId, await adminToken());

  // Same token minted before the suspension — requireAuth reads status from the DB on
  // every request, not from the JWT, so this must fail on the very next call.
  const res = await api(baseUrl, '/v1/tickets/me', { token: buyer.token });
  assert.equal(res.status, 403);
  assert.equal(res.data.error, 'ACCOUNT_SUSPENDED');
});

test('/v1/me and support tickets stay reachable while suspended', async () => {
  const buyer = await loginAsUser(baseUrl, '0855553008');
  await suspendUser(buyer.userId, await adminToken(), 'ทำผิดกติกาการแชร์ตั๋ว');

  const me = await api(baseUrl, '/v1/me', { token: buyer.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.status, 'suspended');
  assert.equal(me.data.suspended_reason, 'ทำผิดกติกาการแชร์ตั๋ว');

  const raised = await api(baseUrl, '/v1/support-tickets', {
    method: 'POST',
    token: buyer.token,
    body: { category: 'other', message: 'อยากอุทธรณ์การระงับบัญชี' },
  });
  assert.equal(raised.status, 201);
});

test('suspending twice is a conflict, not a second round of cancellations', async () => {
  const buyer = await loginAsUser(baseUrl, '0855553009');
  const token = await adminToken();

  assert.equal((await suspendUser(buyer.userId, token)).status, 200);
  const second = await suspendUser(buyer.userId, token);

  assert.equal(second.status, 409);
  assert.equal(second.data.error, 'NOT_ACTIVE');
});

test('unsuspending restores access but not the cancelled tickets', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 5 });
  const { buyer } = await takeTicket(eventId, '0855553010');
  const token = await adminToken();

  await suspendUser(buyer.userId, token);
  const restore = await unsuspendUser(buyer.userId, token);
  assert.equal(restore.status, 200);
  assert.equal(restore.data.status, 'active');

  const me = await api(baseUrl, '/v1/me', { token: buyer.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.status, 'active');

  const ticket = await prisma.ticket.findFirst({ where: { currentHolderUserId: buyer.userId } });
  assert.equal(ticket.status, 'CANCELLED', 'unsuspend does not bring the ticket back');
});

test('unsuspending an account that is not suspended is a conflict', async () => {
  const buyer = await loginAsUser(baseUrl, '0855553011');
  const res = await unsuspendUser(buyer.userId, await adminToken());
  assert.equal(res.status, 409);
  assert.equal(res.data.error, 'NOT_SUSPENDED');
});

// ── Vendor suspension ───────────────────────────────────────────

test('suspending a vendor bans every event the shop currently has live', async () => {
  const { eventId, vendorId } = await createApprovedShopWithEvent(baseUrl, { qty: 4 });

  const res = await suspendVendor(vendorId, await adminToken());
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(res.data.events_banned, 1);

  const event = await prisma.event.findUnique({ where: { id: eventId } });
  assert.equal(event.status, 'banned');
});

test('a suspended vendor\'s AVAILABLE and ISSUED tickets are all cancelled', async () => {
  const { eventId, vendorId } = await createApprovedShopWithEvent(baseUrl, { qty: 5 });
  await takeTicket(eventId, '0855553020');

  const res = await suspendVendor(vendorId, await adminToken());
  assert.equal(res.status, 200);
  assert.equal(res.data.tickets_cancelled, 5);

  const counts = await prisma.ticket.groupBy({ by: ['status'], where: { batch: { eventId } }, _count: true });
  const byStatus = Object.fromEntries(counts.map((c) => [c.status, c._count]));
  assert.equal(byStatus.ISSUED, undefined);
  assert.equal(byStatus.CANCELLED, 5);
});

test('suspending a vendor refunds no quota and writes no ledger entry', async () => {
  const { vendorId } = await createApprovedShopWithEvent(baseUrl, { qty: 4 });
  const before = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  const ledgerBefore = await prisma.quotaLedger.count({ where: { vendorId } });

  await suspendVendor(vendorId, await adminToken());

  const after = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(after.ticketBalance, before.ticketBalance);
  assert.equal(after.eventBalance, before.eventBalance);
  assert.equal(await prisma.quotaLedger.count({ where: { vendorId } }), ledgerBefore);
});

test('a suspended vendor cannot create a new event', async () => {
  const { owner, shopId, vendorId } = await createApprovedShopWithEvent(baseUrl);
  await suspendVendor(vendorId, await adminToken());

  const res = await api(baseUrl, `/v1/shops/${shopId}/events`, {
    method: 'POST',
    token: owner.token,
    body: {
      title: 'Another Event',
      category: 'food_drink',
      start_time: new Date(Date.now() - 60_000).toISOString(),
      end_time: new Date(Date.now() + 3600_000).toISOString(),
      total_qty: 1,
      discount_value_baht: 10,
    },
  });
  assert.equal(res.status, 403);
  assert.equal(res.data.error, 'VENDOR_SUSPENDED');
});

test('a suspended vendor cannot buy more quota', async () => {
  const { owner, vendorId } = await createApprovedShopWithEvent(baseUrl, { packageCode: 'free' });
  await suspendVendor(vendorId, await adminToken());

  const res = await api(baseUrl, '/v1/vendors/me/purchases', {
    method: 'POST',
    token: owner.token,
    body: { type: 'package', package_id: (await prisma.package.findUnique({ where: { code: 'copper' } })).id },
  });
  assert.equal(res.status, 403);
  assert.equal(res.data.error, 'VENDOR_SUSPENDED');
});

test('staff at a suspended shop can no longer scan', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 3 });
  const buyer = await loginAsUser(baseUrl, '0855553021');
  const ticket = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token });
  const qr = await api(baseUrl, `/v1/tickets/${ticket.data.id}/qr-token`, { token: buyer.token });

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { shop: { select: { vendorId: true } } } });
  await suspendVendor(event.shop.vendorId, await adminToken());

  const scan = await api(baseUrl, '/v1/staff/scan', {
    method: 'POST',
    token: owner.token,
    body: { token: qr.data.token },
  });
  assert.equal(scan.status, 409);
  assert.equal(scan.data.error, 'SHOP_SUSPENDED');
});

test('the shop owner can still log in while the vendor is suspended', async () => {
  const { owner, vendorId } = await createApprovedShopWithEvent(baseUrl);
  await suspendVendor(vendorId, await adminToken());

  // Suspending a vendor does not touch User.status — the account-level lockout is a
  // separate axis (see /v1/admin/users). The owner is only locked out of shop-scoped
  // actions, not out of the app entirely.
  const me = await api(baseUrl, '/v1/me', { token: owner.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.status, 'active');
});

test('suspending a vendor twice is a conflict', async () => {
  const { vendorId } = await createApprovedShopWithEvent(baseUrl);
  const token = await adminToken();

  assert.equal((await suspendVendor(vendorId, token)).status, 200);
  const second = await suspendVendor(vendorId, token);
  assert.equal(second.status, 409);
  assert.equal(second.data.error, 'NOT_ACTIVE');
});

test('unsuspending a vendor restores shop access but not the banned events', async () => {
  const { owner, shopId, vendorId, eventId } = await createApprovedShopWithEvent(baseUrl);
  const token = await adminToken();

  await suspendVendor(vendorId, token);
  const restore = await unsuspendVendor(vendorId, token);
  assert.equal(restore.status, 200);
  assert.equal(restore.data.status, 'active');

  // Shop access is back...
  const shop = await api(baseUrl, `/v1/shops/${shopId}`, { token: owner.token });
  assert.equal(shop.status, 200);

  // ...but the event that was banned during the suspension is not un-banned.
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  assert.equal(event.status, 'banned');
});

test('unsuspending a vendor that is not suspended is a conflict', async () => {
  const { vendorId } = await createApprovedShopWithEvent(baseUrl);
  const res = await unsuspendVendor(vendorId, await adminToken());
  assert.equal(res.status, 409);
  assert.equal(res.data.error, 'NOT_SUSPENDED');
});
