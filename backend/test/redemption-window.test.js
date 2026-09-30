const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { DateTime } = require('luxon');
const { isWithinRedemptionWindow } = require('../src/services/redemptionWindow');
const { startServer, stopServer, wipeDatabase, api, loginAsUser, createApprovedShopWithEvent } = require('./helpers');

// Unit tests against the pure evaluation function — deterministic (fixed `now`),
// no HTTP/DB involved, so they can't be flaky based on what day it happens to be
// when the suite runs.

test('no window row at all means unrestricted', () => {
  const result = isWithinRedemptionWindow(null, DateTime.fromISO('2026-08-13T12:00', { zone: 'Asia/Bangkok' })); // a Thursday
  assert.equal(result.allowed, true);
});

test('blocks a day not in the slot list', () => {
  const window = { validFrom: null, validUntil: null, slots: [{ dayOfWeek: 'MON', startTime: '00:00', endTime: '23:59' }] };
  const thursday = DateTime.fromISO('2026-08-13T12:00', { zone: 'Asia/Bangkok' });
  const result = isWithinRedemptionWindow(window, thursday);
  assert.equal(result.allowed, false);
  assert.equal(result.reason, 'OUTSIDE_REDEMPTION_WINDOW');
});

test('allows a day that IS in the slot list, within the time range', () => {
  const window = { validFrom: null, validUntil: null, slots: [{ dayOfWeek: 'THU', startTime: '10:00', endTime: '14:00' }] };
  const thursdayNoon = DateTime.fromISO('2026-08-13T12:00', { zone: 'Asia/Bangkok' });
  const result = isWithinRedemptionWindow(window, thursdayNoon);
  assert.equal(result.allowed, true);
});

test('blocks a time outside the slot range on an otherwise-allowed day', () => {
  const window = { validFrom: null, validUntil: null, slots: [{ dayOfWeek: 'THU', startTime: '10:00', endTime: '14:00' }] };
  const thursdayEvening = DateTime.fromISO('2026-08-13T20:00', { zone: 'Asia/Bangkok' });
  const result = isWithinRedemptionWindow(window, thursdayEvening);
  assert.equal(result.allowed, false);
});

test('no slots but a date range set — restricts by date only, any time of day', () => {
  const window = {
    validFrom: new Date('2026-08-01T00:00:00Z'),
    validUntil: new Date('2026-08-31T00:00:00Z'),
    slots: [],
  };
  const withinRange = DateTime.fromISO('2026-08-13T03:00', { zone: 'Asia/Bangkok' });
  const outsideRange = DateTime.fromISO('2026-09-01T12:00', { zone: 'Asia/Bangkok' });
  assert.equal(isWithinRedemptionWindow(window, withinRange).allowed, true);
  assert.equal(isWithinRedemptionWindow(window, outsideRange).allowed, false);
});

test('date range AND slots both set — both conditions must hold (AND, not OR)', () => {
  const window = {
    validFrom: new Date('2026-08-01T00:00:00Z'),
    validUntil: new Date('2026-08-31T00:00:00Z'),
    slots: [{ dayOfWeek: 'THU', startTime: '10:00', endTime: '14:00' }],
  };
  // right day/time, but outside the date range (September)
  const wrongMonth = DateTime.fromISO('2026-09-03T12:00', { zone: 'Asia/Bangkok' }); // a Thursday
  assert.equal(isWithinRedemptionWindow(window, wrongMonth).allowed, false);

  // right date range, but wrong day of week
  const wrongDay = DateTime.fromISO('2026-08-14T12:00', { zone: 'Asia/Bangkok' }); // a Friday
  assert.equal(isWithinRedemptionWindow(window, wrongDay).allowed, false);

  // both conditions satisfied
  const both = DateTime.fromISO('2026-08-13T12:00', { zone: 'Asia/Bangkok' }); // Thursday, within range
  assert.equal(isWithinRedemptionWindow(window, both).allowed, true);
});

// --- Integration test: the same rule enforced end-to-end through /v1/staff/scan ---

let baseUrl;
before(async () => {
  baseUrl = await startServer();
});
after(stopServer);
beforeEach(wipeDatabase);

test('the scan endpoint actually rejects a redemption outside the configured window', async () => {
  const { eventId, owner } = await createApprovedShopWithEvent(baseUrl, { qty: 2 });
  const buyer = await loginAsUser(baseUrl, '0844444444');

  // Pick "today" and "not today" in Asia/Bangkok so this test is correct regardless
  // of what day it actually runs on.
  const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  const today = DAY_CODES[DateTime.now().setZone('Asia/Bangkok').weekday % 7];
  const notToday = DAY_CODES[(DateTime.now().setZone('Asia/Bangkok').weekday % 7 === 0 ? 1 : 0)];

  await api(baseUrl, `/v1/events/${eventId}/redemption-window`, {
    method: 'PUT',
    token: owner.token,
    body: { slots: [{ day_of_week: notToday, start_time: '00:00', end_time: '23:59' }] },
  });

  const ticket1 = await api(baseUrl, `/v1/events/${eventId}/register`, { method: 'POST', token: buyer.token });
  const qr1 = await api(baseUrl, `/v1/tickets/${ticket1.data.id}/qr-token`, { token: buyer.token });
  const blocked = await api(baseUrl, '/v1/staff/scan', { method: 'POST', token: owner.token, body: { token: qr1.data.token } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.error, 'OUTSIDE_REDEMPTION_WINDOW');

  // Re-open the window to include today, and confirm it now succeeds.
  await api(baseUrl, `/v1/events/${eventId}/redemption-window`, {
    method: 'PUT',
    token: owner.token,
    body: { slots: [{ day_of_week: today, start_time: '00:00', end_time: '23:59' }] },
  });
  const qr1b = await api(baseUrl, `/v1/tickets/${ticket1.data.id}/qr-token`, { token: buyer.token });
  const allowed = await api(baseUrl, '/v1/staff/scan', { method: 'POST', token: owner.token, body: { token: qr1b.data.token } });
  assert.equal(allowed.status, 200);
});

// ── Setting conditions in the same request that creates/updates the event ──
//
// The app used to POST the event then PUT the window, which meant a failed second call
// left a live event with no conditions on it and the vendor pressing several save
// buttons. These pin the all-or-nothing behaviour that replaced it.

test('an event can be created with its conditions in one request', async () => {
  const { owner, shopId } = await createApprovedShopWithEvent(baseUrl);

  const res = await api(baseUrl, `/v1/shops/${shopId}/events`, {
    method: 'POST',
    token: owner.token,
    body: {
      title: 'มีเงื่อนไขตั้งแต่แรก',
      category: 'food_drink',
      start_time: new Date(Date.now() - 60_000).toISOString(),
      end_time: new Date(Date.now() + 3_600_000).toISOString(),
      total_qty: 2,
      discount_value_baht: 15,
      redemption_window: { slots: [{ day_of_week: 'MON', start_time: '09:00', end_time: '17:00' }] },
    },
  });
  assert.equal(res.status, 201);

  const detail = await api(baseUrl, `/v1/events/${res.data.id}`);
  assert.equal(detail.data.redemptionWindow.slots.length, 1);
  assert.equal(detail.data.redemptionWindow.slots[0].dayOfWeek, 'MON');
});

// The decisive one: if the conditions are bad the event must not exist at all, rather
// than being created and then left unconfigured.
test('bad conditions abort the whole creation', async () => {
  const { owner, shopId } = await createApprovedShopWithEvent(baseUrl);
  const before = await api(baseUrl, `/v1/shops/${shopId}/events`, { token: owner.token });

  const res = await api(baseUrl, `/v1/shops/${shopId}/events`, {
    method: 'POST',
    token: owner.token,
    body: {
      title: 'ควรไม่ถูกสร้าง',
      category: 'food_drink',
      start_time: new Date(Date.now() - 60_000).toISOString(),
      end_time: new Date(Date.now() + 3_600_000).toISOString(),
      total_qty: 2,
      discount_value_baht: 15,
      redemption_window: { slots: [{ day_of_week: 'FUNDAY', start_time: '09:00', end_time: '17:00' }] },
    },
  });

  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'INVALID_DAY_OF_WEEK');
  const after = await api(baseUrl, `/v1/shops/${shopId}/events`, { token: owner.token });
  assert.equal(after.data.length, before.data.length, 'no event may be left behind');
});

test('one PATCH can change the event, its products and its conditions together', async () => {
  const { owner, shopId, eventId } = await createApprovedShopWithEvent(baseUrl);
  const product = await api(baseUrl, `/v1/shops/${shopId}/products`, {
    method: 'POST', token: owner.token, body: { name: 'ชาเย็น', price_baht: 45 },
  });

  const res = await api(baseUrl, `/v1/events/${eventId}`, {
    method: 'PATCH',
    token: owner.token,
    body: {
      title: 'ชื่อใหม่',
      product_ids: [product.data.id],
      redemption_window: { slots: [{ day_of_week: 'FRI', start_time: '12:00', end_time: '20:00' }] },
    },
  });
  assert.equal(res.status, 200);

  const detail = await api(baseUrl, `/v1/events/${eventId}`);
  assert.equal(detail.data.title, 'ชื่อใหม่');
  assert.equal(detail.data.products.length, 1);
  assert.equal(detail.data.redemptionWindow.slots[0].dayOfWeek, 'FRI');
});

// Validation runs before the transaction opens, so a bad window can't leave a renamed
// event behind — the same partial-write problem, just moved.
test('a bad window in a PATCH leaves the rest of the event untouched', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl);

  const res = await api(baseUrl, `/v1/events/${eventId}`, {
    method: 'PATCH',
    token: owner.token,
    body: {
      title: 'ไม่ควรถูกบันทึก',
      redemption_window: { slots: [{ day_of_week: 'MON', start_time: '9:00', end_time: '17:00' }] },
    },
  });

  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'INVALID_SLOT_TIME_RANGE', 'times must be zero-padded HH:mm');
  const detail = await api(baseUrl, `/v1/events/${eventId}`);
  assert.notEqual(detail.data.title, 'ไม่ควรถูกบันทึก');
});

// Was only ever caught on the client, so the API happily stored a backwards range.
test('the server rejects a window that ends before it starts', async () => {
  const { owner, eventId } = await createApprovedShopWithEvent(baseUrl);

  const res = await api(baseUrl, `/v1/events/${eventId}/redemption-window`, {
    method: 'PUT',
    token: owner.token,
    body: { valid_from: '2026-08-20', valid_until: '2026-08-10' },
  });

  assert.equal(res.status, 400);
  assert.equal(res.data.error, 'VALID_UNTIL_BEFORE_VALID_FROM');
});
