// Shared test setup. Follows a "wipe DB, build fixtures per test" pattern (tests create
// all their own data, never relying on seed data) rather than depending on whatever's
// left over from manual testing during development.
//
// IMPORTANT: run tests with `--test-concurrency=1` (see package.json's "test"
// script). Node's test runner runs test FILES in parallel by default, and every
// file here calls the destructive wipeDatabase() against the same Postgres/Redis —
// running files concurrently makes them stomp on each other's data and can hang for
// minutes on lock contention.
require('dotenv').config();

// Redirect to the dedicated test database BEFORE anything opens a connection.
// dotenv above has already populated process.env from .env; overwriting the value
// here is what keeps wipeDatabase() away from the dev data (see ./databaseUrl.js).
// `npm test`'s pretest hook creates and migrates it.
const { testDatabaseUrl } = require('./databaseUrl');
process.env.DATABASE_URL = testDatabaseUrl();

const { PACKAGES } = require('../prisma/packageCatalog');
const app = require('../src/app');
const prisma = require('../src/services/prismaClient');
const { getRedis } = require('../src/services/redisClient');
const { signToken } = require('../src/services/jwt');

let server;
let baseUrl;

async function startServer() {
  if (server) return baseUrl;
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  const { port } = server.address();
  baseUrl = `http://localhost:${port}`;
  return baseUrl;
}

async function stopServer() {
  if (server) {
    // server.close() alone only stops accepting NEW connections and waits for
    // existing ones to finish — but fetch()'s keep-alive pooling can leave a
    // socket to localhost open indefinitely, so close() never calls back and
    // the test file hangs forever. Force-close active sockets too.
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    server = null;
  }
  // Also release the DB/Redis connections this test file opened, so the
  // per-file test process can exit instead of hanging on an open pool.
  await prisma.$disconnect();
  const redis = await getRedis();
  await redis.quit();
}

// Deletes rows in dependency order (children before parents) so FK constraints
// don't block the wipe. Redis is flushed too — OTP/QR-token state must not leak
// between test files.
async function wipeDatabase() {
  await prisma.payment.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.quotaLedger.deleteMany();
  await prisma.vendorQuota.deleteMany();
  await prisma.chatMessage.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.supportMessage.deleteMany();
  await prisma.supportTicket.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.shareRecord.deleteMany();
  await prisma.eventReview.deleteMany();
  await prisma.redemption.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.ticketBatch.deleteMany();
  await prisma.eventRedemptionSlot.deleteMany();
  await prisma.eventRedemptionWindow.deleteMany();
  await prisma.eventImage.deleteMany();
  await prisma.eventProduct.deleteMany();
  await prisma.event.deleteMany();
  await prisma.product.deleteMany();
  await prisma.shopStaffAssignment.deleteMany();
  await prisma.shop.deleteMany();
  await prisma.vendorVerification.deleteMany();
  await prisma.vendorOwnership.deleteMany();
  await prisma.vendor.deleteMany();
  await prisma.user.deleteMany();
  await prisma.adminAccount.deleteMany();
  await prisma.package.deleteMany();

  // Packages are reference data, not test fixtures — put them back immediately so
  // every test starts from the same catalogue the seed script installs.
  await seedPackages();

  const redis = await getRedis();
  await redis.flushDb();
}

async function seedPackages() {
  await prisma.package.createMany({ data: PACKAGES, skipDuplicates: true });
}

/**
 * Puts a vendor on a given package with a full balance, bypassing the payment flow.
 * Tests that care about *how* quota is acquired should drive the purchase endpoints
 * instead; this is for the majority that just need enough quota to get to the point.
 */
async function grantQuota(vendorId, packageCode = 'gold') {
  const pkg = await prisma.package.findUnique({ where: { code: packageCode } });
  await prisma.vendorQuota.upsert({
    where: { vendorId },
    update: {
      currentPackageId: pkg.id,
      ticketBalance: pkg.eventQuota * pkg.ticketPerEvent,
      eventBalance: pkg.eventQuota,
    },
    create: {
      vendorId,
      currentPackageId: pkg.id,
      ticketBalance: pkg.eventQuota * pkg.ticketPerEvent,
      eventBalance: pkg.eventQuota,
    },
  });
  return pkg;
}

async function api(baseUrl, path, opts = {}) {
  const { method = 'GET', body, token } = opts;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  return { status: res.status, data };
}

// Signs a JWT directly instead of driving the OTP request/verify round-trip, exactly
// like scripts/seedDemoData.js's ensureUser()/signToken() does — the OTP routes have
// their own tests (auth-registration.test.js). Everything downstream of login (roles,
// quota, shop ownership) still goes through the real endpoints; only the login step
// itself is bypassed.
async function loginAsUser(baseUrl, phone) {
  let user = await prisma.user.findUnique({ where: { phone } });
  if (!user) user = await prisma.user.create({ data: { phone, name: phone } });
  return { token: signToken(user.id), userId: user.id };
}

async function createAdmin(role = 'admin') {
  const bcrypt = require('bcryptjs');
  const username = `test-admin-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const phone = `08${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const passwordHash = await bcrypt.hash('TestPassword123!', 10);
  const admin = await prisma.adminAccount.create({ data: { username, passwordHash, phone, role } });
  return { ...admin, password: 'TestPassword123!' };
}

async function loginAsAdmin(baseUrl, username, password) {
  const reqRes = await api(baseUrl, '/v1/admin/auth/login', { method: 'POST', body: { username, password } });
  const verifyRes = await api(baseUrl, '/v1/admin/auth/otp/verify', {
    method: 'POST',
    body: { username, code: reqRes.data.devCode },
  });
  return verifyRes.data.access_token;
}

// Builds an approved vendor + shop + one active event with `qty` AVAILABLE
// tickets, owned/managed by a freshly-logged-in user. Returns everything a test
// typically needs so individual test files don't repeat this boilerplate.
async function createApprovedShopWithEvent(baseUrl, { qty = 5, discount = 20, packageCode = 'gold' } = {}) {
  const phone = `08${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
  const owner = await loginAsUser(baseUrl, phone);

  const vendorRes = await api(baseUrl, '/v1/vendors', { method: 'POST', token: owner.token, body: { name: 'Test Vendor' } });
  const vendorId = vendorRes.data.id;
  await prisma.vendorVerification.update({ where: { vendorId }, data: { status: 'approved' } });
  await prisma.vendor.update({ where: { id: vendorId }, data: { verificationStatus: 'approved' } });
  // Approval through the real admin endpoint would create this; approving directly in
  // the DB skips that, and creating an event now costs quota. Gold by default so tests
  // about other rules aren't tripped by Free's 5-ticket ceiling.
  await grantQuota(vendorId, packageCode);

  const shopRes = await api(baseUrl, '/v1/shops', {
    method: 'POST',
    token: owner.token,
    body: { name: 'Test Shop', address: '123 Test St' },
  });
  const shopId = shopRes.data.id;

  const eventRes = await api(baseUrl, `/v1/shops/${shopId}/events`, {
    method: 'POST',
    token: owner.token,
    body: {
      title: 'Test Event',
      category: 'food_drink',
      start_time: new Date(Date.now() - 60_000).toISOString(),
      end_time: new Date(Date.now() + 3600_000).toISOString(),
      total_qty: qty,
      discount_value_baht: discount,
    },
  });

  return { owner, vendorId, shopId, eventId: eventRes.data.id };
}

module.exports = {
  startServer,
  stopServer,
  wipeDatabase,
  seedPackages,
  grantQuota,
  api,
  loginAsUser,
  createAdmin,
  loginAsAdmin,
  createApprovedShopWithEvent,
};
