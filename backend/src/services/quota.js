const prisma = require('./prismaClient');

/**
 * Quota accounting for the Pay-per-Event model (docs/HANDOVER.md "แพ็กเกจและโควตา").
 *
 * A vendor holds two balances — a pool of tickets and a number of events they may
 * still create — plus a per-event ceiling that comes from their package. The pool and
 * the ceiling are independent: Copper's 30 tickets cannot all go into one event,
 * because that event still caps at 10.
 *
 * Every balance change goes through here so that two invariants hold:
 *
 *  1. Balances never go negative, even under concurrent requests. The same lesson the
 *     appeal-cap bug taught applies: a read-then-check-then-
 *     write is not safe under Postgres Read Committed even inside a transaction, so
 *     spending is a single conditional UPDATE and we look at how many rows it touched.
 *  2. Nothing is ever credited twice. `quota_ledgers` has a UNIQUE (reason, ref_id),
 *     and the ledger row is written *before* the balance moves — so a duplicate refund
 *     hits the constraint and rolls the whole transaction back.
 */

const FREE_PACKAGE_CODE = 'free';

const REASON = {
  PURCHASE: 'purchase',
  EVENT_CREATED: 'event_created',
  EVENT_CANCELLED: 'event_cancelled',
  EVENT_EXPIRED: 'event_expired',
  EVENT_TOPUP: 'event_topup',
  ADMIN_ADJUST: 'admin_adjust',
};

function quotaError(code, extra = {}) {
  return Object.assign(new Error(code), { code, ...extra });
}

/**
 * Gives a vendor their starting Free package. Called when a vendor is approved;
 * safe to call again (existing rows are left alone).
 */
async function ensureVendorQuota(db, vendorId) {
  const existing = await db.vendorQuota.findUnique({ where: { vendorId } });
  if (existing) return existing;

  const free = await db.package.findUnique({ where: { code: FREE_PACKAGE_CODE } });
  if (!free) throw quotaError('FREE_PACKAGE_MISSING'); // seed has not run

  return db.vendorQuota.create({
    data: {
      vendorId,
      currentPackageId: free.id,
      ticketBalance: free.eventQuota * free.ticketPerEvent,
      eventBalance: free.eventQuota,
    },
  });
}

/** Current balances plus the package that determines caps and top-up prices. */
async function getVendorQuota(vendorId, db = prisma) {
  return db.vendorQuota.findUnique({
    where: { vendorId },
    include: { currentPackage: true },
  });
}

/**
 * Adds quota and records why. Ledger first, on purpose — the UNIQUE (reason, ref_id)
 * is what makes a replayed payment webhook or a double cancel harmless.
 */
async function creditQuota(tx, { vendorId, ticketDelta = 0, eventDelta = 0, reason, refId = null }) {
  await tx.quotaLedger.create({ data: { vendorId, ticketDelta, eventDelta, reason, refId } });

  return tx.vendorQuota.update({
    where: { vendorId },
    data: {
      ticketBalance: { increment: ticketDelta },
      eventBalance: { increment: eventDelta },
    },
  });
}

/**
 * Spends one event credit and `ticketQty` tickets for a new event.
 *
 * Returns the ceiling that applies to this event, which the caller must store on
 * Event.ticketCap — reading it back off the package later would let a SuperAdmin price
 * edit or a tier upgrade silently move an existing event's limit.
 *
 * Throws INSUFFICIENT_QUOTA (with what is actually available) or EXCEEDS_TICKET_CAP.
 */
async function consumeForNewEvent(tx, { vendorId, eventId, ticketQty }) {
  const quota = await getVendorQuota(vendorId, tx);
  if (!quota) throw quotaError('NO_QUOTA');

  const cap = quota.currentPackage.ticketPerEvent;
  if (ticketQty > cap) {
    throw quotaError('EXCEEDS_TICKET_CAP', { ticketCap: cap, requested: ticketQty });
  }

  // Single conditional UPDATE: the WHERE clause is the check, so two concurrent
  // requests cannot both pass it. `affected` tells us whether we won.
  const affected = await tx.$executeRaw`
    UPDATE vendor_quotas
       SET ticket_balance = ticket_balance - ${ticketQty},
           event_balance  = event_balance - 1,
           updated_at     = NOW()
     WHERE vendor_id      = ${vendorId}
       AND ticket_balance >= ${ticketQty}
       AND event_balance  >= 1
  `;

  if (affected === 0) {
    throw quotaError('INSUFFICIENT_QUOTA', {
      needed: { tickets: ticketQty, events: 1 },
      available: { tickets: quota.ticketBalance, events: quota.eventBalance },
    });
  }

  await tx.quotaLedger.create({
    data: {
      vendorId,
      ticketDelta: -ticketQty,
      eventDelta: -1,
      reason: REASON.EVENT_CREATED,
      refId: eventId,
    },
  });

  return { ticketCap: cap };
}

/**
 * Puts tickets bought for one specific event INTO that event.
 *
 * A ticket top-up aimed at an event used to only raise `Event.ticketCap`. But the cap is
 * a ceiling, not stock: what a customer can actually claim is a `Ticket` row plus
 * `TicketBatch.remainingCount`, and those were only ever written when the event was
 * created. So the vendor paid, the ceiling moved, and the event stayed SOLD_OUT — money
 * in, nothing out. This mints the rows for real.
 *
 * The tickets are spent back out of the pool that `creditQuota` just filled: buying and
 * placing are one intention here, and leaving the credit in the pool as well would hand
 * the vendor the same tickets twice. Net pool change is zero, and because both halves are
 * ledgered the `ticketBalance == SUM(ticketDelta)` invariant still holds.
 *
 * Safe to replay: the ledger's UNIQUE (reason, ref_id) on (event_topup, purchaseId) makes
 * a repeated webhook roll the whole transaction back instead of minting a second batch.
 */
async function applyTicketTopupToEvent(tx, { vendorId, eventId, purchaseId, ticketQty }) {
  // The purchase route checked this was active when the vendor paid, but the webhook can
  // arrive much later — the event may have been cancelled or expired since. Don't push
  // tickets into a dead event; the credit stays in the general pool, which is still
  // something the vendor can use. Never fail here: the money has already been taken.
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { status: true, ticketBatch: { select: { id: true } } },
  });
  if (!event || event.status !== 'active' || !event.ticketBatch) {
    return { applied: false, ticketsAdded: 0 };
  }

  await tx.quotaLedger.create({
    data: { vendorId, ticketDelta: -ticketQty, eventDelta: 0, reason: REASON.EVENT_TOPUP, refId: purchaseId },
  });
  await tx.vendorQuota.update({
    where: { vendorId },
    data: { ticketBalance: { decrement: ticketQty } },
  });

  // Raise the ceiling too, so the event is allowed to hold what it now has.
  await tx.event.update({
    where: { id: eventId },
    data: { ticketCap: { increment: ticketQty } },
  });
  await tx.ticketBatch.update({
    where: { id: event.ticketBatch.id },
    data: {
      totalQty: { increment: ticketQty },
      remainingCount: { increment: ticketQty },
    },
  });

  // Continue the code sequence the event started with (shops.js, event creation) rather
  // than restarting at 1 — `Ticket.code` is UNIQUE, so a collision would abort the
  // transaction rather than corrupt anything, but there is no reason to court one.
  const existing = await tx.ticket.count({ where: { batchId: event.ticketBatch.id } });
  const codePrefix = eventId.slice(0, 8);
  await tx.ticket.createMany({
    data: Array.from({ length: ticketQty }, (_, i) => ({
      batchId: event.ticketBatch.id,
      code: `${codePrefix}-${String(existing + i + 1).padStart(6, '0')}`,
      status: 'AVAILABLE',
    })),
  });

  return { applied: true, ticketsAdded: ticketQty };
}

/**
 * Returns unused quota when an event ends — both the tickets and the event credit,
 * regardless of whether it ended by explicit cancel or by the automatic end-time sweep.
 *
 * Only tickets still sitting AVAILABLE come back — ones already handed out are spent
 * whatever happens next.
 *
 * The event credit used to come back only on an explicit cancel (an event that simply
 * ran its course was treated as having "used" its slot) — but POST /events/:id/relaunch
 * needs a free event-slot to run, and that rule meant relaunch silently didn't work for
 * the common case of a vendor who just let a promotion's end_time pass instead of
 * cancelling it by hand, which is most of them (BA review, 2026-09-16). Unifying this
 * doesn't open a new way to cycle event-slots: POST /events/:id/cancel already lets a
 * vendor reclaim a slot instantly, with no cooldown and no limit on how many times — the
 * automatic-expiry path here just catches up to what manual cancellation already allowed.
 *
 * Safe to call twice: the second call hits the ledger's UNIQUE (reason, ref_id).
 */
async function refundForEndedEvent(tx, { vendorId, eventId, reason }) {
  const unusedTickets = await tx.ticket.count({
    where: { batch: { eventId }, status: 'AVAILABLE' },
  });
  const eventDelta = 1;

  await creditQuota(tx, {
    vendorId,
    ticketDelta: unusedTickets,
    eventDelta,
    reason,
    refId: eventId,
  });

  return { ticketsReturned: unusedTickets, eventsReturned: eventDelta };
}

/** True when the ledger already recorded this (reason, event) pair. */
async function alreadySettled(db, { reason, eventId }) {
  const row = await db.quotaLedger.findUnique({
    where: { reason_refId: { reason, refId: eventId } },
  });
  return row !== null;
}

/**
 * Works out what a purchase grants, from the package as it is priced *right now*.
 * The caller snapshots the result onto the Purchase row — receipts must not move when
 * a SuperAdmin edits prices later.
 */
function describePurchase(pkg, { type, quantity = 1 }) {
  switch (type) {
    case 'package':
      return {
        unitPrice: pkg.priceBaht,
        quantity: 1,
        amount: pkg.priceBaht,
        ticketQuotaAdded: pkg.eventQuota * pkg.ticketPerEvent,
        eventQuotaAdded: pkg.eventQuota,
      };
    case 'event_topup':
      // One extra event slot arrives with a full ticket allowance for that tier —
      // buying an empty slot you then have to fill separately would be two payments
      // for one intention.
      return {
        unitPrice: pkg.eventTopupPrice,
        quantity,
        amount: Number(pkg.eventTopupPrice) * quantity,
        ticketQuotaAdded: pkg.ticketPerEvent * quantity,
        eventQuotaAdded: quantity,
      };
    case 'ticket_topup':
      // Sold in bundles the size of the tier's per-event allowance, so the numbers
      // stay round and no charge is smaller than the cheapest tier's bundle.
      return {
        unitPrice: pkg.ticketTopupPrice,
        quantity,
        amount: Number(pkg.ticketTopupPrice) * quantity,
        ticketQuotaAdded: pkg.ticketPerEvent * quantity,
        eventQuotaAdded: 0,
      };
    default:
      throw quotaError('INVALID_PURCHASE_TYPE');
  }
}

module.exports = {
  FREE_PACKAGE_CODE,
  REASON,
  ensureVendorQuota,
  getVendorQuota,
  creditQuota,
  consumeForNewEvent,
  applyTicketTopupToEvent,
  refundForEndedEvent,
  alreadySettled,
  describePurchase,
  quotaError,
};
