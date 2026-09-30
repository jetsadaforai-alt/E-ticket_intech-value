const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const prisma = require('../src/services/prismaClient');
const {
  startServer,
  stopServer,
  wipeDatabase,
  api,
  loginAsUser,
  createApprovedShopWithEvent,
} = require('./helpers');

let baseUrl;

before(async () => {
  baseUrl = await startServer();
});
after(stopServer);
beforeEach(wipeDatabase);

function createProduct(shopId, token, name, priceBaht = 100) {
  return api(baseUrl, `/v1/shops/${shopId}/products`, {
    method: 'POST',
    token,
    body: { name, price_baht: priceBaht },
  });
}

function createEvent(shopId, token, body = {}) {
  return api(baseUrl, `/v1/shops/${shopId}/events`, {
    method: 'POST',
    token,
    body: {
      title: 'Product Event',
      category: 'food_drink',
      start_time: new Date(Date.now() - 60_000).toISOString(),
      end_time: new Date(Date.now() + 3_600_000).toISOString(),
      total_qty: 2,
      discount_value_baht: 20,
      ...body,
    },
  });
}

// The headline rule: products are optional. Every event that existed before this feature
// has no products, and that has to keep meaning "the discount covers the whole shop".
test('an event with no products is valid and reports an empty product list', async () => {
  const { owner, shopId } = await createApprovedShopWithEvent(baseUrl);

  const created = await createEvent(shopId, owner.token);
  assert.equal(created.status, 201);

  const detail = await api(baseUrl, `/v1/events/${created.data.id}`);
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.data.products, []);
});

test('an event can be created with products attached in one request', async () => {
  const { owner, shopId } = await createApprovedShopWithEvent(baseUrl);
  const coffee = await createProduct(shopId, owner.token, 'กาแฟ', 60);
  const cake = await createProduct(shopId, owner.token, 'เค้ก', 90);
  assert.equal(coffee.status, 201);

  const created = await createEvent(shopId, owner.token, {
    product_ids: [coffee.data.id, cake.data.id],
  });
  assert.equal(created.status, 201);

  const detail = await api(baseUrl, `/v1/events/${created.data.id}`);
  const names = detail.data.products.map((p) => p.name).sort();
  assert.deepEqual(names, ['กาแฟ', 'เค้ก']);
});

test('a product from another shop cannot be attached', async () => {
  const shopA = await createApprovedShopWithEvent(baseUrl);
  const shopB = await createApprovedShopWithEvent(baseUrl);

  const otherProduct = await createProduct(shopB.shopId, shopB.owner.token, 'ของร้านอื่น', 50);

  const created = await createEvent(shopA.shopId, shopA.owner.token, {
    product_ids: [otherProduct.data.id],
  });
  assert.equal(created.status, 400);
  assert.equal(created.data.error, 'PRODUCT_NOT_FOUND');
});

test('an archived product cannot be attached to a new event', async () => {
  const { owner, shopId } = await createApprovedShopWithEvent(baseUrl);
  const retired = await createProduct(shopId, owner.token, 'เมนูเลิกขาย', 40);

  const archived = await api(baseUrl, `/v1/products/${retired.data.id}`, { method: 'DELETE', token: owner.token });
  assert.equal(archived.status, 200);
  assert.equal(archived.data.status, 'archived');

  const created = await createEvent(shopId, owner.token, { product_ids: [retired.data.id] });
  assert.equal(created.status, 400);
  assert.equal(created.data.error, 'PRODUCT_ARCHIVED');
});

// A bad id must bounce before the transaction, or a typo silently costs an event credit.
test('a rejected product list does not consume any quota', async () => {
  const { owner, shopId, vendorId } = await createApprovedShopWithEvent(baseUrl);
  const before = await prisma.vendorQuota.findUnique({ where: { vendorId } });

  const created = await createEvent(shopId, owner.token, {
    product_ids: ['00000000-0000-0000-0000-000000000000'],
  });
  assert.equal(created.status, 400);

  const after = await prisma.vendorQuota.findUnique({ where: { vendorId } });
  assert.equal(after.ticketBalance, before.ticketBalance, 'a bad product id must not cost tickets');
  assert.equal(after.eventBalance, before.eventBalance, 'a bad product id must not cost an event credit');
});

test('PUT replaces the whole product set, and an empty array clears it', async () => {
  const { owner, shopId } = await createApprovedShopWithEvent(baseUrl);
  const a = await createProduct(shopId, owner.token, 'A', 10);
  const b = await createProduct(shopId, owner.token, 'B', 20);
  const c = await createProduct(shopId, owner.token, 'C', 30);

  const created = await createEvent(shopId, owner.token, { product_ids: [a.data.id, b.data.id] });
  const eventId = created.data.id;

  const replaced = await api(baseUrl, `/v1/events/${eventId}/products`, {
    method: 'PUT',
    token: owner.token,
    body: { product_ids: [c.data.id] },
  });
  assert.equal(replaced.status, 200);
  assert.deepEqual(replaced.data.map((p) => p.name), ['C']);

  const cleared = await api(baseUrl, `/v1/events/${eventId}/products`, {
    method: 'PUT',
    token: owner.token,
    body: { product_ids: [] },
  });
  assert.equal(cleared.status, 200);
  assert.deepEqual(cleared.data, [], 'clearing the list returns the event to shop-wide');

  const detail = await api(baseUrl, `/v1/events/${eventId}`);
  assert.deepEqual(detail.data.products, []);
});

// The whole reason archiving replaces deletion: a hard delete would cascade the link away
// and silently widen this event from "just the coffee" to "everything in the shop".
test('archiving a product keeps it on the events that already discount it', async () => {
  const { owner, shopId } = await createApprovedShopWithEvent(baseUrl);
  const coffee = await createProduct(shopId, owner.token, 'กาแฟ', 60);

  const created = await createEvent(shopId, owner.token, { product_ids: [coffee.data.id] });
  const eventId = created.data.id;

  await api(baseUrl, `/v1/products/${coffee.data.id}`, { method: 'DELETE', token: owner.token });

  const detail = await api(baseUrl, `/v1/events/${eventId}`);
  assert.equal(detail.data.products.length, 1, 'the link must survive archiving');
  assert.equal(detail.data.products[0].name, 'กาแฟ');
  assert.equal(detail.data.products[0].status, 'archived');

  // ...but it disappears from the picker the shop uses to build the next event.
  const active = await api(baseUrl, `/v1/shops/${shopId}/products`, { token: owner.token });
  assert.equal(active.data.length, 0);

  const all = await api(baseUrl, `/v1/shops/${shopId}/products?include_archived=1`, { token: owner.token });
  assert.equal(all.data.length, 1);
});

test('the scan result tells staff which products the discount applies to', async () => {
  const { owner, shopId } = await createApprovedShopWithEvent(baseUrl);
  const coffee = await createProduct(shopId, owner.token, 'กาแฟเย็น', 60);

  const created = await createEvent(shopId, owner.token, { product_ids: [coffee.data.id] });
  const eventId = created.data.id;

  const buyer = await loginAsUser(baseUrl, '0855550001');
  const ticket = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token });
  assert.equal(ticket.status, 201);

  const qr = await api(baseUrl, `/v1/tickets/${ticket.data.id}/qr-token`, { token: buyer.token });
  const scan = await api(baseUrl, '/v1/staff/scan', {
    method: 'POST',
    token: owner.token,
    body: { token: qr.data.token },
  });
  assert.equal(scan.status, 200);
  assert.deepEqual(scan.data.products.map((p) => p.name), ['กาแฟเย็น']);
});

test('the ticket detail shows the holder what their ticket covers', async () => {
  const { owner, shopId } = await createApprovedShopWithEvent(baseUrl);
  const cake = await createProduct(shopId, owner.token, 'เค้กช็อกโกแลต', 120);

  const created = await createEvent(shopId, owner.token, { product_ids: [cake.data.id] });
  const buyer = await loginAsUser(baseUrl, '0855550002');
  const ticket = await api(baseUrl, `/v1/events/${created.data.id}/register`, { method: 'POST', token: buyer.token });

  const detail = await api(baseUrl, `/v1/tickets/${ticket.data.id}`, { token: buyer.token });
  assert.equal(detail.status, 200);
  assert.deepEqual(detail.data.products.map((p) => p.name), ['เค้กช็อกโกแลต']);
  // The app renders a thumbnail from this, so the key has to be present even with no photo.
  assert.ok('image_url' in detail.data.products[0]);
  assert.equal(detail.data.products[0].image_url, null);
});

test('only a manager or owner can create or archive products', async () => {
  const { shopId } = await createApprovedShopWithEvent(baseUrl);
  const stranger = await loginAsUser(baseUrl, '0855550003');

  const created = await createProduct(shopId, stranger.token, 'แอบเพิ่ม', 10);
  assert.equal(created.status, 403);
});

test('product input is validated', async () => {
  const { owner, shopId } = await createApprovedShopWithEvent(baseUrl);

  const noName = await api(baseUrl, `/v1/shops/${shopId}/products`, {
    method: 'POST',
    token: owner.token,
    body: { name: '   ', price_baht: 10 },
  });
  assert.equal(noName.status, 400);
  assert.equal(noName.data.error, 'INVALID_NAME');

  const badPrice = await api(baseUrl, `/v1/shops/${shopId}/products`, {
    method: 'POST',
    token: owner.token,
    body: { name: 'ของ', price_baht: -5 },
  });
  assert.equal(badPrice.status, 400);
  assert.equal(badPrice.data.error, 'INVALID_PRICE');
});
