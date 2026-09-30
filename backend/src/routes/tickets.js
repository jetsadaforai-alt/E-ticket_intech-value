const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const prisma = require('../services/prismaClient');
const { requireAuth } = require('../middleware/auth');
const { issueToken } = require('../services/qrToken');
const { userHoldsTicketForEvent, claimAvailableTicket } = require('../services/ticketRules');
const { discountRange } = require('../services/productRules');

const router = asyncRouter();           // mounted at /v1/tickets
const shareClaimRouter = asyncRouter(); // mounted at /v1/share
// POST /v1/events/:id/register lives in routes/events.js instead — it's event-scoped,
// same reasoning as why event-creation lives in routes/shops.js (see events.js top comment).

const SHARE_TTL_HOURS = 24;

// GET /v1/tickets/me
router.get('/me', requireAuth, async (req, res) => {
  const tickets = await prisma.ticket.findMany({
    where: { currentHolderUserId: req.userId },
    include: {
      batch: {
        include: {
          event: {
            include: { shop: true, images: { orderBy: { sortOrder: 'asc' }, take: 1 }, products: true },
          },
        },
      },
    },
    orderBy: { issuedAt: 'desc' },
  });

  return res.json(
    tickets.map((t) => {
      const range = discountRange(t.batch.event.products, t.batch.discountValueBaht);
      return {
        id: t.id,
        code: t.code,
        status: t.status,
        event_title: t.batch.event.title,
        shop_name: t.batch.event.shop.name,
        shop_logo_url: t.batch.event.shop.logoUrl,
        discount_value_baht: t.batch.discountValueBaht,
        discount_min_baht: range.min,
        discount_max_baht: range.max,
        issued_at: t.issuedAt,
        thumbnail_url: t.batch.event.images[0]?.imageUrl ?? null,
      };
    })
  );
});

// GET /v1/tickets/me/shares — tickets this user has shared out (sent), newest first
router.get('/me/shares', requireAuth, async (req, res) => {
  const shares = await prisma.shareRecord.findMany({
    where: { fromUserId: req.userId },
    include: {
      ticket: { include: { batch: { include: { event: true } } } },
      claimedBy: { select: { name: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return res.json(
    shares.map((s) => ({
      ticket_id: s.ticketId,
      event_title: s.ticket.batch.event.title,
      shared_at: s.createdAt,
      claimed_by_name: s.claimedBy ? s.claimedBy.name : null,
      claimed_at: s.claimedAt,
      status: s.claimedByUserId ? 'claimed' : s.expiresAt < new Date() ? 'expired' : 'pending',
    }))
  );
});

// GET /v1/tickets/me/claims — tickets this user received via someone else's share, newest first
router.get('/me/claims', requireAuth, async (req, res) => {
  const claims = await prisma.shareRecord.findMany({
    where: { claimedByUserId: req.userId, claimedAt: { not: null } },
    include: {
      ticket: { include: { batch: { include: { event: true } } } },
      fromUser: { select: { name: true } },
    },
    orderBy: { claimedAt: 'desc' },
  });

  return res.json(
    claims.map((s) => ({
      ticket_id: s.ticketId,
      event_title: s.ticket.batch.event.title,
      shared_by_name: s.fromUser.name,
      claimed_at: s.claimedAt,
    }))
  );
});

// GET /v1/tickets/:id — holder-only detail. Doubles as the redemption receipt:
// once status is REDEEMED the `redemption` block carries the discount actually
// granted at scan time (not the batch's current rate, which the shop can edit later).
router.get('/:id', requireAuth, async (req, res) => {
  const ticket = await prisma.ticket.findUnique({
    where: { id: req.params.id },
    include: {
      batch: {
        include: {
          event: {
            include: {
              shop: true,
              images: { orderBy: { sortOrder: 'asc' }, take: 1 },
              products: {
                include: { product: { select: { id: true, name: true, priceBaht: true, imageUrl: true, status: true } } },
              },
            },
          },
        },
      },
      redemption: { include: { staff: { select: { name: true } } } },
    },
  });
  if (!ticket || ticket.currentHolderUserId !== req.userId) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  // Whoever most recently claimed this specific ticket into this holder's hands —
  // null if the holder registered directly rather than receiving it via share.
  const receivedShare = await prisma.shareRecord.findFirst({
    where: { ticketId: ticket.id, claimedByUserId: req.userId },
    include: { fromUser: { select: { name: true } } },
    orderBy: { claimedAt: 'desc' },
  });

  const range = discountRange(ticket.batch.event.products, ticket.batch.discountValueBaht);
  return res.json({
    id: ticket.id,
    code: ticket.code,
    status: ticket.status,
    event_id: ticket.batch.eventId,
    event_title: ticket.batch.event.title,
    shop_id: ticket.batch.event.shopId, // lets the holder open a chat with the shop
    shop_name: ticket.batch.event.shop.name,
    shop_address: ticket.batch.event.shop.address,
    shop_logo_url: ticket.batch.event.shop.logoUrl,
    discount_value_baht: ticket.batch.discountValueBaht,
    discount_min_baht: range.min,
    discount_max_baht: range.max,
    thumbnail_url: ticket.batch.event.images[0]?.imageUrl ?? null,
    // What this ticket is actually good for. Empty = the whole shop, no restriction.
    products: ticket.batch.event.products.map((ep) => ({
      id: ep.product.id,
      name: ep.product.name,
      price_baht: ep.product.priceBaht,
      image_url: ep.product.imageUrl,
      // Archived-but-still-linked products stay in this list on purpose (see products.js)
      // — status rides along so the app can show a "หมด" badge instead of pretending the
      // item is still available.
      status: ep.product.status,
      discount_value_baht: Number(ep.discountValueBaht),
    })),
    issued_at: ticket.issuedAt,
    event_end_time: ticket.batch.event.endTime,
    shared_by_name: receivedShare ? receivedShare.fromUser.name : null,
    redemption: ticket.redemption
      ? {
          discount_value_baht: ticket.redemption.discountValueBaht,
          redeemed_at: ticket.redemption.redeemedAt,
          staff_name: ticket.redemption.staff.name,
        }
      : null,
  });
});

// GET /v1/tickets/:id/qr-token
router.get('/:id/qr-token', requireAuth, async (req, res) => {
  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket || ticket.currentHolderUserId !== req.userId) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  if (ticket.status !== 'ISSUED') {
    return res.status(409).json({ error: 'TICKET_NOT_REDEEMABLE', status: ticket.status });
  }

  const { token, expiresInSeconds } = await issueToken(ticket.id);
  return res.json({ token, expires_in_seconds: expiresInSeconds });
});

// POST /v1/tickets/:id/share
router.post('/:id/share', requireAuth, async (req, res) => {
  const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
  if (!ticket || ticket.currentHolderUserId !== req.userId) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  if (ticket.status !== 'ISSUED') {
    return res.status(409).json({ error: 'TICKET_NOT_SHAREABLE', status: ticket.status });
  }

  const share = await prisma.shareRecord.create({
    data: {
      ticketId: ticket.id,
      fromUserId: req.userId,
      shareToken: crypto.randomBytes(12).toString('hex'),
      expiresAt: new Date(Date.now() + SHARE_TTL_HOURS * 60 * 60 * 1000),
    },
  });

  return res.status(201).json({ share_token: share.shareToken, expires_at: share.expiresAt });
});

// POST /v1/share/:token/claim
shareClaimRouter.post('/:token/claim', requireAuth, async (req, res) => {
  const { token } = req.params;

  try {
    const result = await prisma.$transaction(async (tx) => {
      const share = await tx.shareRecord.findUnique({ where: { shareToken: token }, include: { ticket: true } });
      if (!share) throw Object.assign(new Error('INVALID_LINK'), { code: 'INVALID_LINK' });
      if (share.claimedByUserId) throw Object.assign(new Error('ALREADY_CLAIMED'), { code: 'ALREADY_CLAIMED' });
      if (share.expiresAt < new Date()) throw Object.assign(new Error('LINK_EXPIRED'), { code: 'LINK_EXPIRED' });
      if (share.ticket.status !== 'ISSUED' || share.ticket.currentHolderUserId !== share.fromUserId) {
        // ticket moved on (e.g. already redeemed, or sender re-shared and someone else claimed a stale link)
        throw Object.assign(new Error('LINK_EXPIRED'), { code: 'LINK_EXPIRED' });
      }
      if (share.fromUserId === req.userId) {
        throw Object.assign(new Error('CANNOT_CLAIM_OWN_SHARE'), { code: 'CANNOT_CLAIM_OWN_SHARE' });
      }

      const eventId = await tx.ticket
        .findUnique({ where: { id: share.ticketId }, include: { batch: true } })
        .then((t) => t.batch.eventId);

      if (await userHoldsTicketForEvent(tx, req.userId, eventId)) {
        throw Object.assign(new Error('ALREADY_HAS_TICKET'), { code: 'ALREADY_HAS_TICKET' });
      }

      const ticket = await tx.ticket.update({
        where: { id: share.ticketId },
        data: { currentHolderUserId: req.userId }, // ownership transfers; status stays ISSUED
      });

      await tx.shareRecord.update({
        where: { id: share.id },
        data: { claimedByUserId: req.userId, claimedAt: new Date() },
      });

      await tx.notification.create({
        data: { userId: share.fromUserId, type: 'ticket_shared', payload: { ticketId: ticket.id } },
      });
      await tx.notification.create({
        data: { userId: req.userId, type: 'ticket_received', payload: { ticketId: ticket.id } },
      });

      return ticket;
    });

    return res.json(result);
  } catch (err) {
    const knownErrors = ['INVALID_LINK', 'ALREADY_CLAIMED', 'LINK_EXPIRED', 'CANNOT_CLAIM_OWN_SHARE', 'ALREADY_HAS_TICKET'];
    if (knownErrors.includes(err.code)) {
      return res.status(409).json({ error: err.code });
    }
    console.error(err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

module.exports = router;
module.exports.shareClaimRouter = shareClaimRouter;
