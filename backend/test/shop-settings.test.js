const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, stopServer, wipeDatabase, api, loginAsUser, createApprovedShopWithEvent } = require('./helpers');

let baseUrl;

before(async () => {
  baseUrl = await startServer();
});
after(stopServer);
beforeEach(wipeDatabase);

test('the owner can rename their shop and change its address', async () => {
  const { owner, shopId } = await createApprovedShopWithEvent(baseUrl);

  const updated = await api(baseUrl, `/v1/shops/${shopId}`, {
    method: 'PATCH',
    token: owner.token,
    body: { name: 'ร้านใหม่', address: '456 ถนนใหม่' },
  });
  assert.equal(updated.status, 200);
  assert.equal(updated.data.name, 'ร้านใหม่');
  assert.equal(updated.data.address, '456 ถนนใหม่');

  const fetched = await api(baseUrl, `/v1/shops/${shopId}`, { token: owner.token });
  assert.equal(fetched.data.name, 'ร้านใหม่');
  assert.equal(fetched.data.address, '456 ถนนใหม่');
});

test('either field can be updated on its own, leaving the other unchanged', async () => {
  const { owner, shopId } = await createApprovedShopWithEvent(baseUrl);

  const renamed = await api(baseUrl, `/v1/shops/${shopId}`, {
    method: 'PATCH',
    token: owner.token,
    body: { name: 'ชื่อเดียว' },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.data.name, 'ชื่อเดียว');
  assert.equal(renamed.data.address, '123 Test St', 'address from createApprovedShopWithEvent must survive');
});

test('a stranger cannot edit someone else shop', async () => {
  const { shopId } = await createApprovedShopWithEvent(baseUrl);
  const stranger = await loginAsUser(baseUrl, '0855550010');

  const res = await api(baseUrl, `/v1/shops/${shopId}`, {
    method: 'PATCH',
    token: stranger.token,
    body: { name: 'แอบเปลี่ยน' },
  });
  assert.equal(res.status, 403);
});

test('blank name/address and an empty body are all rejected', async () => {
  const { owner, shopId } = await createApprovedShopWithEvent(baseUrl);

  const blankName = await api(baseUrl, `/v1/shops/${shopId}`, {
    method: 'PATCH',
    token: owner.token,
    body: { name: '   ' },
  });
  assert.equal(blankName.status, 400);
  assert.equal(blankName.data.error, 'INVALID_NAME');

  const blankAddress = await api(baseUrl, `/v1/shops/${shopId}`, {
    method: 'PATCH',
    token: owner.token,
    body: { address: '' },
  });
  assert.equal(blankAddress.status, 400);
  assert.equal(blankAddress.data.error, 'INVALID_ADDRESS');

  const empty = await api(baseUrl, `/v1/shops/${shopId}`, {
    method: 'PATCH',
    token: owner.token,
    body: {},
  });
  assert.equal(empty.status, 400);
  assert.equal(empty.data.error, 'INVALID_INPUT');
});
