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

test('a ticket can only be redeemed once, even under concurrent scans of the same QR token', async () => {
  const { eventId, owner } = await createApprovedShopWithEvent(baseUrl, { qty: 1 });
  const buyer = await loginAsUser(baseUrl, '0833333333');

  const ticket = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token });
  const qr = await api(baseUrl, `/v1/tickets/${ticket.data.id}/qr-token`, { token: buyer.token });

  // owner was granted the shop's "manager" role at shop creation (routes/shops.js),
  // so they're a valid scanner for this test without needing a separate staff invite.
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      api(baseUrl, '/v1/staff/scan', { method: 'POST', token: owner.token, body: { token: qr.data.token } })
    )
  );

  const succeeded = results.filter((r) => r.status === 200 && r.data.result === 'success');
  const rejected = results.filter((r) => r.status === 409 && r.data.error === 'TICKET_NOT_REDEEMABLE');
  assert.equal(succeeded.length, 1, 'exactly one concurrent scan of the same ticket should succeed');
  assert.equal(rejected.length, 4);

  const prisma = require('../src/services/prismaClient');
  const redemptionCount = await prisma.redemption.count({ where: { ticketId: ticket.data.id } });
  assert.equal(redemptionCount, 1, 'exactly one Redemption row must exist — no duplicate redemption records');

  const finalTicket = await prisma.ticket.findUnique({ where: { id: ticket.data.id } });
  assert.equal(finalTicket.status, 'REDEEMED');
});

test('a non-staff user cannot scan tickets for a shop they have no role in', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 1 });
  const buyer = await loginAsUser(baseUrl, '0833333334');
  const outsider = await loginAsUser(baseUrl, '0833333335');

  const ticket = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token });
  const qr = await api(baseUrl, `/v1/tickets/${ticket.data.id}/qr-token`, { token: buyer.token });

  const scanResult = await api(baseUrl, '/v1/staff/scan', { method: 'POST', token: outsider.token, body: { token: qr.data.token } });
  assert.equal(scanResult.status, 403);
});

test('an unknown/expired QR token is rejected', async () => {
  const { owner } = await createApprovedShopWithEvent(baseUrl, { qty: 1 });
  const scanResult = await api(baseUrl, '/v1/staff/scan', {
    method: 'POST',
    token: owner.token,
    body: { token: 'this-token-does-not-exist' },
  });
  assert.equal(scanResult.status, 400);
  assert.equal(scanResult.data.error, 'QR_EXPIRED');
});
