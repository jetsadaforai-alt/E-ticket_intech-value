const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  startServer,
  stopServer,
  wipeDatabase,
  api,
  loginAsUser,
  createAdmin,
} = require('./helpers');

let baseUrl;

before(async () => {
  baseUrl = await startServer();
});
after(stopServer);
beforeEach(wipeDatabase);

async function rejectVendor(baseUrl, vendorId, adminToken) {
  return api(baseUrl, `/v1/admin/vendors/${vendorId}/decision`, {
    method: 'POST',
    token: adminToken,
    body: { decision: 'rejected', reason: 'test rejection' },
  });
}

test('appeal is blocked past the 5-appeal cap, and cannot be bypassed by concurrent submission at the boundary', async () => {
  const owner = await loginAsUser(baseUrl, '0811111111');
  const admin = await createAdmin();

  const vendorRes = await api(baseUrl, '/v1/vendors', { method: 'POST', token: owner.token, body: { name: 'Appeal Test Co' } });
  const vendorId = vendorRes.data.id;

  const { loginAsAdmin } = require('./helpers');
  const adminToken = await loginAsAdmin(baseUrl, admin.username, admin.password);

  // Drive appealCount from 0 to 4 sequentially: reject, appeal, reject, appeal...
  for (let i = 0; i < 4; i += 1) {
    await rejectVendor(baseUrl, vendorId, adminToken);
    const appealRes = await api(baseUrl, `/v1/vendors/${vendorId}/appeal`, {
      method: 'POST',
      token: owner.token,
      body: { reason: `appeal #${i + 1}` },
    });
    assert.equal(appealRes.status, 200, `appeal #${i + 1} should succeed`);
    assert.equal(appealRes.data.appealCount, i + 1);
  }

  // Now at appealCount=4, status=pending. Reject one more time to put it back
  // at the boundary (rejected, count=4) where the race would have mattered.
  await rejectVendor(baseUrl, vendorId, adminToken);

  // Fire 3 concurrent appeal attempts right at the boundary. With the atomic
  // conditional update, exactly one may succeed (bringing count to 5); with the
  // old read-check-write bug, more than one could succeed and count could exceed 5.
  const results = await Promise.all(
    [1, 2, 3].map((n) =>
      api(baseUrl, `/v1/vendors/${vendorId}/appeal`, {
        method: 'POST',
        token: owner.token,
        body: { reason: `concurrent appeal #${n}` },
      })
    )
  );

  const succeeded = results.filter((r) => r.status === 200);
  assert.equal(succeeded.length, 1, 'exactly one concurrent appeal at the boundary should succeed');

  const final = await api(baseUrl, `/v1/vendors/${vendorId}/appeal`, {
    method: 'POST',
    token: owner.token,
    body: { reason: 'should be blocked' },
  });
  // Either APPEAL_LIMIT_REACHED (count already 5) if status somehow stayed
  // rejected, or NOT_REJECTED (status flipped to pending by the winner) — both
  // are correct rejections; what must never happen is a 200.
  assert.notEqual(final.status, 200);

  const dbState = await require('../src/services/prismaClient').vendorVerification.findUnique({ where: { vendorId } });
  assert.equal(dbState.appealCount, 5, 'appealCount must never exceed the cap, even under concurrent requests');
});
