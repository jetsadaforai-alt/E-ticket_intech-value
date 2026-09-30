const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  startServer,
  stopServer,
  wipeDatabase,
  api,
  loginAsUser,
  createApprovedShopWithEvent,
} = require('./helpers');
const prisma = require('../src/services/prismaClient');

let baseUrl;

before(async () => {
  baseUrl = await startServer();
});
after(stopServer);
beforeEach(wipeDatabase);

// Drives the real OTP flow: request (dev-OTP returns the code outside production),
// then verify with the same purpose.
async function otpFlow(phone, purpose) {
  const requested = await api(baseUrl, '/v1/auth/otp/request', { method: 'POST', body: { phone, purpose } });
  if (requested.status !== 200) return { requested };
  const verified = await api(baseUrl, '/v1/auth/otp/verify', {
    method: 'POST',
    body: { phone, code: requested.data.devCode, purpose },
  });
  return { requested, verified };
}

test('logging in with a phone that never registered is refused and creates no account', async () => {
  const { requested } = await otpFlow('0844444401', 'login');
  assert.equal(requested.status, 404);
  assert.equal(requested.data.error, 'NOT_REGISTERED');
  assert.equal(await prisma.user.count({ where: { phone: '0844444401' } }), 0);
});

test('registering creates the account, after which logging in works', async () => {
  const reg = await otpFlow('0844444402', 'register');
  assert.equal(reg.verified.status, 200);
  assert.equal(reg.verified.data.isNewUser, true);

  const login = await otpFlow('0844444402', 'login');
  assert.equal(login.verified.status, 200);
  assert.equal(login.verified.data.isNewUser, false);
  assert.equal(login.verified.data.user.id, reg.verified.data.user.id);
});

test('registering a phone that already has an account is refused', async () => {
  await loginAsUser(baseUrl, '0844444403');
  const { requested } = await otpFlow('0844444403', 'register');
  assert.equal(requested.status, 409);
  assert.equal(requested.data.error, 'ALREADY_REGISTERED');
});

test('verify re-checks the purpose: login verify for an unknown phone creates nothing', async () => {
  // Obtain a valid code through a register request, then try to use it as a login.
  const requested = await api(baseUrl, '/v1/auth/otp/request', {
    method: 'POST',
    body: { phone: '0844444404', purpose: 'register' },
  });
  assert.equal(requested.status, 200);
  const verified = await api(baseUrl, '/v1/auth/otp/verify', {
    method: 'POST',
    body: { phone: '0844444404', code: requested.data.devCode, purpose: 'login' },
  });
  assert.equal(verified.status, 404);
  assert.equal(verified.data.error, 'NOT_REGISTERED');
  assert.equal(await prisma.user.count({ where: { phone: '0844444404' } }), 0);
});

test('a missing or unknown purpose is rejected on both OTP calls', async () => {
  const noPurpose = await api(baseUrl, '/v1/auth/otp/request', { method: 'POST', body: { phone: '0844444405' } });
  assert.equal(noPurpose.status, 400);
  assert.equal(noPurpose.data.error, 'INVALID_PURPOSE');

  const badPurpose = await api(baseUrl, '/v1/auth/otp/verify', {
    method: 'POST',
    body: { phone: '0844444405', code: '123456', purpose: 'signup' },
  });
  assert.equal(badPurpose.status, 400);
  assert.equal(badPurpose.data.error, 'INVALID_PURPOSE');
});

test('inviting a phone with no account is refused and creates neither user nor invitation', async () => {
  const { shopId, owner } = await createApprovedShopWithEvent(baseUrl);
  const res = await api(baseUrl, `/v1/shops/${shopId}/staff/invite`, {
    method: 'POST',
    token: owner.token,
    body: { phone: '0844444406' },
  });
  assert.equal(res.status, 404);
  assert.equal(res.data.error, 'NOT_REGISTERED');
  assert.equal(await prisma.user.count({ where: { phone: '0844444406' } }), 0);
  assert.equal(await prisma.shopStaffAssignment.count({ where: { shopId } }), 1); // just the owner's own
});
