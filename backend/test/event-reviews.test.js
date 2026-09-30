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

/**
 * Takes a fresh user all the way through to a redeemed ticket, which is the only state
 * that earns the right to review. There's no helper for this — the point of the feature
 * is that the whole chain really happened, so the test walks it for real.
 */
async function redeemAsNewUser(baseUrl, eventId, ownerToken, phone) {
  const buyer = await loginAsUser(baseUrl, phone);
  const ticket = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token });
  assert.equal(ticket.status, 201);
  const qr = await api(baseUrl, `/v1/tickets/${ticket.data.id}/qr-token`, { token: buyer.token });
  const scan = await api(baseUrl, '/v1/staff/scan', {
    method: 'POST',
    token: ownerToken,
    body: { token: qr.data.token },
  });
  assert.equal(scan.status, 200);
  return buyer;
}

const postReview = (eventId, token, body) =>
  api(baseUrl, `/v1/events/${eventId}/reviews`, { method: 'POST', token, body });

// The headline rule: a review is a statement about a discount you actually used.
// Someone who never got a ticket has nothing to report on.
test('a user who never took a ticket cannot review', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl);
  const stranger = await loginAsUser(baseUrl, '0855550100');

  const res = await postReview(eventId, stranger.token, { rating: 5 });

  assert.equal(res.status, 403);
  assert.equal(res.data.error, 'NOT_ELIGIBLE');
});

// The decisive case for the rule. Holding a ticket is not the same as having used it —
// if merely registering were enough, anyone could review a promotion sight unseen.
test('holding an unredeemed ticket is not enough to review', async () => {
  const { eventId } = await createApprovedShopWithEvent(baseUrl);
  const buyer = await loginAsUser(baseUrl, '0855550101');
  const ticket = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token });
  assert.equal(ticket.status, 201);

  const res = await postReview(eventId, buyer.token, { rating: 4 });

  assert.equal(res.status, 403);
  assert.equal(res.data.error, 'NOT_ELIGIBLE');
});

test('a user who redeemed can review, and it shows up in the summary', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl);
  const buyer = await redeemAsNewUser(baseUrl, eventId, owner.token, '0855550102');

  const res = await postReview(eventId, buyer.token, { rating: 5, comment: 'คุ้มมาก' });
  assert.equal(res.status, 201);
  assert.equal(res.data.rating, 5);

  const list = await api(baseUrl, `/v1/events/${eventId}/reviews`);
  assert.equal(list.data.summary.count, 1);
  assert.equal(list.data.summary.average, 5);
  assert.equal(list.data.summary.distribution['5'], 1);
});

test('rating must be a whole number from 1 to 5', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl);
  const buyer = await redeemAsNewUser(baseUrl, eventId, owner.token, '0855550103');

  for (const rating of [0, 6, 2.5, '5', null, undefined]) {
    const res = await postReview(eventId, buyer.token, { rating });
    assert.equal(res.status, 400, `rating=${rating} should be rejected`);
    assert.equal(res.data.error, 'INVALID_RATING');
  }
});

test('a comment longer than the cap is rejected', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl);
  const buyer = await redeemAsNewUser(baseUrl, eventId, owner.token, '0855550104');

  const res = await postReview(eventId, buyer.token, { rating: 4, comment: 'ก'.repeat(501) });

  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'COMMENT_TOO_LONG');
});

// Reviewing twice edits the existing review rather than stacking a second one —
// otherwise one enthusiastic customer could drown out everyone else's rating.
test('reviewing again updates the same row instead of adding another', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl);
  const buyer = await redeemAsNewUser(baseUrl, eventId, owner.token, '0855550105');

  await postReview(eventId, buyer.token, { rating: 2, comment: 'เฉย ๆ' });
  const second = await postReview(eventId, buyer.token, { rating: 5, comment: 'กลับมากินอีก ดีขึ้นมาก' });
  assert.equal(second.status, 201);

  const rows = await prisma.eventReview.count({ where: { eventId } });
  assert.equal(rows, 1);

  const list = await api(baseUrl, `/v1/events/${eventId}/reviews`);
  assert.equal(list.data.summary.count, 1);
  assert.equal(list.data.summary.average, 5);
});

test('the average is computed across every reviewer', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 5 });

  const a = await redeemAsNewUser(baseUrl, eventId, owner.token, '0855550106');
  const b = await redeemAsNewUser(baseUrl, eventId, owner.token, '0855550107');
  await postReview(eventId, a.token, { rating: 5 });
  await postReview(eventId, b.token, { rating: 2 });

  const list = await api(baseUrl, `/v1/events/${eventId}/reviews`);
  assert.equal(list.data.summary.count, 2);
  assert.equal(list.data.summary.average, 3.5);
  assert.equal(list.data.shop_summary.count, 2);
});

test('a guest can read reviews but is told they cannot write one', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl);
  const buyer = await redeemAsNewUser(baseUrl, eventId, owner.token, '0855550108');
  await postReview(eventId, buyer.token, { rating: 4, comment: 'ดี' });

  const list = await api(baseUrl, `/v1/events/${eventId}/reviews`); // no token
  assert.equal(list.status, 200);
  assert.equal(list.data.can_review, false);
  assert.equal(list.data.my_review, null);
  assert.equal(list.data.reviews.length, 1);
});

// This endpoint is public, and accounts created on first OTP verify carry the phone
// number as their name — publishing it verbatim would leak customers' phone numbers.
test('a reviewer name that is really a phone number is masked', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl);
  const buyer = await redeemAsNewUser(baseUrl, eventId, owner.token, '0855550109');
  await postReview(eventId, buyer.token, { rating: 5 });

  const list = await api(baseUrl, `/v1/events/${eventId}/reviews`);
  const name = list.data.reviews[0].user_name;

  assert.ok(!name.includes('0855550109'), `expected the phone to be masked, got ${name}`);
  assert.match(name, /^085xxxx109$/);
});

test('my own review comes back separately from everyone else\'s', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl, { qty: 5 });
  const me = await redeemAsNewUser(baseUrl, eventId, owner.token, '0855550110');
  const other = await redeemAsNewUser(baseUrl, eventId, owner.token, '0855550111');
  await postReview(eventId, me.token, { rating: 3, comment: 'ของฉัน' });
  await postReview(eventId, other.token, { rating: 5, comment: 'ของคนอื่น' });

  const list = await api(baseUrl, `/v1/events/${eventId}/reviews`, { token: me.token });

  assert.equal(list.data.my_review.comment, 'ของฉัน');
  assert.equal(list.data.can_review, true);
  assert.equal(list.data.reviews.length, 1);
  assert.equal(list.data.reviews[0].comment, 'ของคนอื่น');
  assert.equal(list.data.summary.count, 2); // ค่าเฉลี่ยยังนับรวมของเราด้วย
});

test('a user can delete their own review', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl);
  const buyer = await redeemAsNewUser(baseUrl, eventId, owner.token, '0855550112');
  await postReview(eventId, buyer.token, { rating: 1 });

  const del = await api(baseUrl, `/v1/events/${eventId}/reviews/me`, { method: 'DELETE', token: buyer.token });
  assert.equal(del.status, 204);

  const list = await api(baseUrl, `/v1/events/${eventId}/reviews`);
  assert.equal(list.data.summary.count, 0);
  assert.equal(list.data.summary.average, null);
});

test('the event list carries a rating summary for the cards', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl);
  const buyer = await redeemAsNewUser(baseUrl, eventId, owner.token, '0855550113');
  await postReview(eventId, buyer.token, { rating: 4 });

  const list = await api(baseUrl, '/v1/events');
  const row = list.data.find((e) => e.id === eventId);

  assert.equal(row.rating_average, 4);
  assert.equal(row.rating_count, 1);
});

test('reviewing a nonexistent event is a 404, not a 403', async () => {
  const stranger = await loginAsUser(baseUrl, '0855550114');
  const res = await postReview('11111111-1111-1111-1111-111111111111', stranger.token, { rating: 5 });
  assert.equal(res.status, 404);
});
