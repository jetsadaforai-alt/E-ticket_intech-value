// Shared logic behind every "admin takes something down" action.
//
// Banning a single event (POST /v1/admin/events/:id/ban) and banning every event a shop
// has (the event-side effect of POST /v1/admin/vendors/:id/suspend) are the same
// transaction shape, so it lives here once instead of being copied — this is the same
// refactor that pulled redemption-window logic out of routes/events.js and into
// services/redemptionWindow.js. cancelTicketsHeldBy is the equivalent move for
// suspending a *user*: pulling back whatever they're currently holding.
//
// Every function takes `tx` first (a Prisma transaction client) so callers compose them
// inside their own $transaction instead of this module opening one itself — same
// convention as services/redemptionWindow.js and services/ticketRules.js.

/**
 * Bans one event: flips it to 'banned' (no-op if it isn't currently 'active'), cancels
 * every AVAILABLE and ISSUED ticket under it (REDEEMED is untouched — that already
 * happened), and notifies the shop's owners plus everyone who was holding an ISSUED
 * ticket. Grants no quota back.
 *
 * `notifyOwners` defaults to true for the single-event ban endpoint. A shop-wide sweep
 * (banEventsForShop) passes false, because the owner already gets one combined
 * 'vendor_suspended' notification instead of one 'event_banned' per event they own.
 *
 * Returns `null` if the event wasn't active — the single-event route turns that into
 * 409 NOT_ACTIVE; banEventsForShop just skips it and moves on.
 */
async function banEvent(tx, { eventId, reason, adminId, notifyOwners = true }) {
  const event = await tx.event.findUnique({
    where: { id: eventId },
    select: { id: true, title: true, shop: { select: { vendorId: true } } },
  });
  if (!event) return null;

  // Captured before the tickets are cancelled — afterwards there is no way to tell who
  // was holding one.
  const holders = await tx.ticket.findMany({
    where: { batch: { eventId }, status: 'ISSUED' },
    select: { currentHolderUserId: true },
  });

  // Conditional, so a double submit or a race with the expiry sweeper is a no-op rather
  // than a second round of cancellations.
  const claimed = await tx.event.updateMany({
    where: { id: eventId, status: 'active' },
    data: { status: 'banned', bannedAt: new Date(), bannedReason: reason, bannedByAdminId: adminId },
  });
  if (claimed.count === 0) return null;

  // ISSUED as well as AVAILABLE — this is the whole point of a ban. REDEEMED is left
  // alone: those visits already happened and rewriting them would falsify history.
  const cancelled = await tx.ticket.updateMany({
    where: { batch: { eventId }, status: { in: ['AVAILABLE', 'ISSUED'] } },
    data: { status: 'CANCELLED' },
  });

  const recipients = [...holders.map((h) => h.currentHolderUserId).filter(Boolean)];
  if (notifyOwners) {
    const owners = await tx.vendorOwnership.findMany({
      where: { vendorId: event.shop.vendorId },
      select: { userId: true },
    });
    recipients.push(...owners.map((o) => o.userId));
  }
  if (recipients.length > 0) {
    const payload = { eventId, eventTitle: event.title, reason };
    await tx.notification.createMany({
      data: [...new Set(recipients)].map((userId) => ({ userId, type: 'event_banned', payload })),
    });
  }

  return { ticketsCancelled: cancelled.count, holdersNotified: holders.length };
}

/**
 * Bans every currently-active event belonging to a shop — the event-side effect of
 * suspending a vendor. Each event keeps its own bannedReason/bannedByAdminId so
 * GET /v1/admin/events/:id still explains itself on its own, without a join back to the
 * vendor suspension record.
 */
async function banEventsForShop(tx, { shopId, reason, adminId }) {
  const events = await tx.event.findMany({ where: { shopId, status: 'active' }, select: { id: true } });
  let ticketsCancelled = 0;
  for (const { id: eventId } of events) {
    // notifyOwners: false — the caller sends one 'vendor_suspended' notification to the
    // owners instead of one 'event_banned' per event they happen to own.
    const result = await banEvent(tx, { eventId, reason, adminId, notifyOwners: false });
    if (result) ticketsCancelled += result.ticketsCancelled;
  }
  return { eventsBanned: events.length, ticketsCancelled };
}

/**
 * Cancels every ticket a user currently holds that hasn't been used yet — the ticket-side
 * effect of suspending a user account. Nothing is returned to the shop's pool
 * (remainingCount is untouched) — the ticket becomes CANCELLED and stays that way even
 * after the account is unsuspended, the same permanence an event ban leaves behind.
 */
async function cancelTicketsHeldBy(tx, userId) {
  const result = await tx.ticket.updateMany({
    where: { currentHolderUserId: userId, status: { in: ['AVAILABLE', 'ISSUED'] } },
    data: { status: 'CANCELLED' },
  });
  return { ticketsCancelled: result.count };
}

module.exports = { banEvent, banEventsForShop, cancelTicketsHeldBy };
