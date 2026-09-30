const prisma = require('./prismaClient');

const MAX_COMMENT = 500;

/**
 * Rules for reviewing an event.
 *
 * Both helpers return a ready-to-send error body, or null when the input is usable —
 * same contract as productRules.js, so routes stay `if (problem) return res.status(n).json(problem)`.
 */

/**
 * A rating is required and must be a whole 1..5; the comment is optional because giving
 * stars alone is a legitimate review.
 */
function validateReviewInput({ rating, comment }) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: 'INVALID_RATING', message: 'ให้คะแนนเป็นจำนวนเต็ม 1-5 ดาว' };
  }
  if (comment !== undefined && comment !== null) {
    if (typeof comment !== 'string') return { error: 'INVALID_COMMENT' };
    if (comment.length > MAX_COMMENT) return { error: 'COMMENT_TOO_LONG', max: MAX_COMMENT };
  }
  return null;
}

/**
 * Only someone who actually used the discount may review it — holding an unused ticket
 * says nothing about whether the promotion was any good.
 *
 * The consumer is `Ticket.currentHolderUserId`, NOT `Redemption.staffId` — the latter is
 * the staff member who scanned the QR. A REDEEMED ticket can no longer be shared
 * (routes/tickets.js requires ISSUED to share), so the holder recorded at redemption
 * time stays the holder afterwards and is a stable identity to check against.
 */
async function userMayReviewEvent(userId, eventId, { db = prisma } = {}) {
  const used = await db.ticket.findFirst({
    where: { currentHolderUserId: userId, status: 'REDEEMED', batch: { eventId } },
    select: { id: true },
  });
  if (used) return null;
  return {
    error: 'NOT_ELIGIBLE',
    message: 'ต้องใช้สิทธิ์ส่วนลดของ Event นี้ก่อน จึงจะรีวิวได้',
  };
}

module.exports = { validateReviewInput, userMayReviewEvent, MAX_COMMENT };
