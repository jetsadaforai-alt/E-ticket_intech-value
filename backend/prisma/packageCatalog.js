/**
 * The four Pay-per-Event packages, shared by the seed script and the test helpers so
 * the two can never drift apart.
 *
 * A package grants a pool of tickets (eventQuota × ticketPerEvent), that many events,
 * and a per-event ceiling of ticketPerEvent. The pool and the ceiling are separate
 * limits: Copper's 30 tickets cannot all go into one event, because that event still
 * caps at 10.
 *
 * Top-up prices come from splitting each package price into an event-slot part (~12฿,
 * the same at every tier) and a per-ticket part (Copper 0.77 / Silver 0.56 / Gold 0.32฿),
 * then adding ~25% — buying piecemeal has to cost more than buying the bundle, or the
 * tier ladder has no pull. See docs/HANDOVER.md "แพ็กเกจและโควตา".
 *
 * Free deliberately cannot top up: running out is what prompts an upgrade.
 */
const PACKAGES = [
  {
    code: 'free',
    name: 'Free',
    tier: 0,
    priceBaht: 0,
    eventQuota: 1,
    ticketPerEvent: 5,
    eventTopupPrice: 0,
    ticketTopupPrice: 0,
    topupEnabled: false,
    sortOrder: 0,
  },
  {
    code: 'copper',
    name: 'Copper',
    tier: 1,
    priceBaht: 59,
    eventQuota: 3,
    ticketPerEvent: 10,
    eventTopupPrice: 25, // 1 event + 10 tickets
    ticketTopupPrice: 10, // 10 tickets
    topupEnabled: true,
    sortOrder: 1,
  },
  {
    code: 'silver',
    name: 'Silver',
    tier: 2,
    priceBaht: 199,
    eventQuota: 5,
    ticketPerEvent: 50,
    eventTopupPrice: 45, // 1 event + 50 tickets
    ticketTopupPrice: 35, // 50 tickets
    topupEnabled: true,
    sortOrder: 2,
  },
  {
    code: 'gold',
    name: 'Gold',
    tier: 3,
    priceBaht: 350,
    eventQuota: 8,
    ticketPerEvent: 100,
    eventTopupPrice: 50, // 1 event + 100 tickets
    ticketTopupPrice: 40, // 100 tickets
    topupEnabled: true,
    sortOrder: 3,
  },
];

module.exports = { PACKAGES };
