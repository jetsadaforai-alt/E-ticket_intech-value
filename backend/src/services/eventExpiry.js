const prisma = require('./prismaClient');
const { refundForEndedEvent, REASON } = require('./quota');

/**
 * Retires events whose end time has passed and returns their unused tickets.
 *
 * Nothing in the system used to set Event.status = 'expired' at all — the value was
 * declared in the schema and counted on the SuperAdmin dashboard, but no code path
 * ever wrote it, the same way Ticket.status still lists an unreachable RESERVED. That
 * was harmless until quota arrived: the rule that unused tickets come back when an
 * event ends needs something to decide an event *has* ended.
 *
 * Deliberately a plain interval rather than a cron dependency — this runs as a single
 * instance, and one fewer package is one fewer thing to explain.
 */

const SWEEP_INTERVAL_MS = 5 * 60_000;
const BATCH_SIZE = 100;

/**
 * One pass. Each event is settled in its own transaction so a single bad row cannot
 * hold up the rest, and re-running is harmless — the status update is conditional and
 * the ledger's UNIQUE (reason, ref_id) refuses a second refund either way.
 */
async function sweepExpiredEvents(now = new Date()) {
  const due = await prisma.event.findMany({
    where: { status: 'active', endTime: { lt: now } },
    select: { id: true, shop: { select: { vendorId: true } } },
    take: BATCH_SIZE,
  });

  let expired = 0;
  let ticketsReturned = 0;

  for (const event of due) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        // Conditional: if a concurrent sweep or a manual cancel got here first this
        // touches nothing, and we must not refund on top of what they already did.
        const claimed = await tx.event.updateMany({
          where: { id: event.id, status: 'active' },
          data: { status: 'expired' },
        });
        if (claimed.count === 0) return null;

        // Counted while the tickets are still AVAILABLE — the flip below is what makes
        // them CANCELLED, so this has to come first (mirrors POST /:id/cancel exactly).
        const refund = await refundForEndedEvent(tx, {
          vendorId: event.shop.vendorId,
          eventId: event.id,
          reason: REASON.EVENT_EXPIRED,
        });

        // Without this, a ticket nobody claimed stays AVAILABLE forever even though its
        // quota was already credited back to the vendor — leaving it claimable would let
        // someone register for it later and hand out a ticket the vendor already got
        // their quota back for, effectively for free.
        await tx.ticket.updateMany({
          where: { batch: { eventId: event.id }, status: 'AVAILABLE' },
          data: { status: 'CANCELLED' },
        });

        return refund;
      });

      if (result) {
        expired += 1;
        ticketsReturned += result.ticketsReturned;
      }
    } catch (err) {
      // One event failing must not stop the sweep; the next pass retries it.
      console.error(`[event-expiry] failed to settle event ${event.id}:`, err.message);
    }
  }

  if (expired > 0) {
    console.log(`[event-expiry] expired ${expired} event(s), returned ${ticketsReturned} ticket(s)`);
  }
  return { expired, ticketsReturned };
}

function startEventExpiryJob() {
  const run = () => {
    sweepExpiredEvents().catch((err) => console.error('[event-expiry] sweep failed:', err.message));
  };
  run(); // catch up on anything that expired while the server was down
  const timer = setInterval(run, SWEEP_INTERVAL_MS);
  timer.unref(); // never hold the process open on this alone (tests exit cleanly)
  return timer;
}

module.exports = { sweepExpiredEvents, startEventExpiryJob, SWEEP_INTERVAL_MS };
