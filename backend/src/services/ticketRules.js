// "1 ticket per user per event", enforced regardless
// of whether the ticket came from self-registration or a claimed share link.
async function userHoldsTicketForEvent(tx, userId, eventId) {
  const existing = await tx.ticket.findFirst({
    where: {
      currentHolderUserId: userId,
      batch: { eventId },
      status: { in: ['ISSUED', 'REDEEMED'] },
    },
  });
  return Boolean(existing);
}

// Atomically claims one AVAILABLE ticket from a batch and assigns it to userId.
// FOR UPDATE SKIP LOCKED lets concurrent claimants each grab a different row
// instead of blocking on (or double-claiming) the same one.
async function claimAvailableTicket(tx, batchId, userId) {
  const decremented = await tx.ticketBatch.updateMany({
    where: { id: batchId, remainingCount: { gt: 0 } },
    data: { remainingCount: { decrement: 1 } },
  });
  if (decremented.count === 0) {
    const err = new Error('SOLD_OUT');
    err.code = 'SOLD_OUT';
    throw err;
  }

  // ids are Prisma `String @default(uuid())`, which maps to a plain `text` column
  // (not native Postgres `uuid`) — no ::uuid cast here, both sides are text.
  const rows = await tx.$queryRaw`
    SELECT id FROM tickets
    WHERE batch_id = ${batchId} AND status = 'AVAILABLE'
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  `;
  if (!rows[0]) {
    // Shouldn't happen if remaining_count and ticket rows stay in sync, but don't
    // leave the counter decremented if it does.
    const err = new Error('SOLD_OUT');
    err.code = 'SOLD_OUT';
    throw err;
  }

  return tx.ticket.update({
    where: { id: rows[0].id },
    data: { status: 'ISSUED', currentHolderUserId: userId, issuedAt: new Date() },
  });
}

module.exports = { userHoldsTicketForEvent, claimAvailableTicket };
