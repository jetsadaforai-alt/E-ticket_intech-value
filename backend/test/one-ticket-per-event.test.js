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

let baseUrl;

before(async () => {
  baseUrl = await startServer();
});
after(stopServer);
beforeEach(wipeDatabase);

test('a user cannot register twice for the same event', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 5 });
  const buyer = await loginAsUser(baseUrl, '0822222222');

  const first = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token });
  assert.equal(first.status, 201);

  const second = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token });
  assert.equal(second.status, 409);
  assert.equal(second.data.error, 'ALREADY_HAS_TICKET');
});

test('a user who already registered cannot also claim a shared ticket for the same event', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 5 });
  const sharer = await loginAsUser(baseUrl, '0822222223');
  const claimer = await loginAsUser(baseUrl, '0822222224');

  const sharerTicket = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: sharer.token });
  const share = await api(baseUrl, `/v1/tickets/${sharerTicket.data.id}/share`, { method: 'POST', token: sharer.token });

  // claimer registers for the SAME event on their own first
  const claimerOwnTicket = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: claimer.token });
  assert.equal(claimerOwnTicket.status, 201);

  // now claimer tries to also claim the shared ticket for the same event — must be blocked
  const claimResult = await api(baseUrl, `/v1/share/${share.data.share_token}/claim`, { method: 'POST', token: claimer.token });
  assert.equal(claimResult.status, 409);
  assert.equal(claimResult.data.error, 'ALREADY_HAS_TICKET');
});

test('concurrent registration attempts by the SAME user for the same event only ever succeed once', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 10 }); // plenty of stock — isolates the per-user rule from sold-out behavior
  const buyer = await loginAsUser(baseUrl, '0822222225');

  const results = await Promise.all(
    Array.from({ length: 5 }, () => api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token }))
  );

  const succeeded = results.filter((r) => r.status === 201);
  assert.equal(succeeded.length, 1, 'exactly one concurrent registration by the same user should succeed');

  const prisma = require('../src/services/prismaClient');
  const heldCount = await prisma.ticket.count({ where: { currentHolderUserId: buyer.userId } });
  assert.equal(heldCount, 1, 'the user must end up holding exactly one ticket, not more');
});

test('registration is blocked once the batch is sold out, and never oversells', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 3 });
  const buyers = await Promise.all(
    ['0822222226', '0822222227', '0822222228', '0822222229', '0822222230'].map((phone) => loginAsUser(baseUrl, phone))
  );

  const results = await Promise.all(
    buyers.map((buyer) => api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token }))
  );

  const succeeded = results.filter((r) => r.status === 201);
  const soldOut = results.filter((r) => r.status === 409 && r.data.error === 'SOLD_OUT');
  assert.equal(succeeded.length, 3, 'exactly the batch quantity should succeed');
  assert.equal(soldOut.length, 2, 'the rest should be rejected as sold out');

  const prisma = require('../src/services/prismaClient');
  const issuedCount = await prisma.ticket.count({ where: { batch: { eventId }, status: 'ISSUED' } });
  assert.equal(issuedCount, 3, 'never more tickets issued than the batch quantity, even under concurrent requests');
});
