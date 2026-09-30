const { DateTime } = require('luxon');

const DAY_MAP = { 1: 'MON', 2: 'TUE', 3: 'WED', 4: 'THU', 5: 'FRI', 6: 'SAT', 7: 'SUN' };

// allowed = dateRangeOK AND slotOK, evaluated in Asia/Bangkok regardless of server TZ
// (easy to get wrong: forgetting an explicit zone when reading a Date/Time column from Postgres).
function isWithinRedemptionWindow(window, nowBkk) {
  if (!window) return { allowed: true }; // no row = unrestricted

  const now = nowBkk || DateTime.now().setZone('Asia/Bangkok');

  if (window.validFrom) {
    const validFromDate = DateTime.fromJSDate(window.validFrom, { zone: 'utc' }).toISODate();
    if (now.toISODate() < validFromDate) return { allowed: false, reason: 'OUTSIDE_REDEMPTION_WINDOW' };
  }
  if (window.validUntil) {
    const validUntilDate = DateTime.fromJSDate(window.validUntil, { zone: 'utc' }).toISODate();
    if (now.toISODate() > validUntilDate) return { allowed: false, reason: 'OUTSIDE_REDEMPTION_WINDOW' };
  }

  if (window.slots && window.slots.length > 0) {
    const nowDay = DAY_MAP[now.weekday];
    const nowTime = now.toFormat('HH:mm');
    const slotOK = window.slots.some(
      (s) => s.dayOfWeek === nowDay && nowTime >= s.startTime && nowTime <= s.endTime
    );
    if (!slotOK) return { allowed: false, reason: 'OUTSIDE_REDEMPTION_WINDOW' };
  }

  return { allowed: true };
}

const DAYS = new Set(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Checks a redemption-window payload before it is written.
 *
 * Returns a ready-to-send error body, or null when the payload is usable — same
 * contract as productRules.js, so the route stays a one-line guard.
 *
 * `eventEndsAt` is passed in rather than read here because create and update learn it
 * from different places: on create it is the value being written in the same request,
 * on update it may be the row's existing end time or a new one from the same PATCH.
 */
function validateRedemptionWindow(body, eventEndsAt) {
  if (body === undefined || body === null) return null;
  if (typeof body !== 'object' || Array.isArray(body)) return { error: 'INVALID_REDEMPTION_WINDOW' };

  const { valid_from: validFrom, valid_until: validUntil, slots } = body;
  const from = validFrom ? new Date(validFrom) : null;
  const until = validUntil ? new Date(validUntil) : null;

  if (from && Number.isNaN(from.getTime())) return { error: 'INVALID_REDEMPTION_WINDOW' };
  if (until && Number.isNaN(until.getTime())) return { error: 'INVALID_REDEMPTION_WINDOW' };
  // Was only ever checked on the client, so the API would happily store a backwards range.
  if (from && until && until < from) return { error: 'VALID_UNTIL_BEFORE_VALID_FROM' };
  if (until && eventEndsAt && until > eventEndsAt) return { error: 'VALID_UNTIL_AFTER_EVENT_END' };

  if (slots !== undefined && !Array.isArray(slots)) return { error: 'INVALID_REDEMPTION_WINDOW' };
  for (const s of slots || []) {
    if (!s || !DAYS.has(s.day_of_week)) return { error: 'INVALID_DAY_OF_WEEK' };
    // The old route compared raw strings, so '9:00' or 'abc' would pass and then sort
    // wrongly at redemption time. Times are compared lexicographically downstream,
    // which is only correct for zero-padded HH:mm.
    if (!HHMM.test(s.start_time || '') || !HHMM.test(s.end_time || '')) {
      return { error: 'INVALID_SLOT_TIME_RANGE' };
    }
    if (s.end_time <= s.start_time) return { error: 'INVALID_SLOT_TIME_RANGE' };
  }

  return null;
}

/**
 * Replaces an event's redemption window wholesale. Takes `tx` first so it can join the
 * caller's transaction — which is the point: create and update now write the event and
 * its window together, instead of leaving a window of time where the event exists
 * unconfigured.
 *
 * An empty payload clears the window, which is what "no restriction" means.
 */
async function writeRedemptionWindow(tx, eventId, body) {
  const from = body?.valid_from ? new Date(body.valid_from) : null;
  const until = body?.valid_until ? new Date(body.valid_until) : null;
  const slots = Array.isArray(body?.slots) ? body.slots : [];

  await tx.eventRedemptionWindow.deleteMany({ where: { eventId } }); // cascades to slots

  if (!from && !until && slots.length === 0) return;

  await tx.eventRedemptionWindow.create({
    data: {
      eventId,
      validFrom: from,
      validUntil: until,
      slots: {
        create: slots.map((s) => ({ dayOfWeek: s.day_of_week, startTime: s.start_time, endTime: s.end_time })),
      },
    },
  });
}

module.exports = { isWithinRedemptionWindow, validateRedemptionWindow, writeRedemptionWindow, DAYS };
