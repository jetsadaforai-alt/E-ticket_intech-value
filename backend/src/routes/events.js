const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const prisma = require('../services/prismaClient');
const { requireAuth, attachCallerIfPresent } = require('../middleware/auth');
const { requireAdminAuth } = require('../middleware/adminAuth');
const { isShopManagerOrOwner } = require('../services/shopAuth');
const { userHoldsTicketForEvent, claimAvailableTicket } = require('../services/ticketRules');
const { refundForEndedEvent, REASON } = require('../services/quota');
const { validateRedemptionWindow, writeRedemptionWindow } = require('../services/redemptionWindow');
const { validateProductIds, validateProductDiscounts, validateFallbackDiscount, discountRange } = require('../services/productRules');
const { banEvent } = require('../services/moderation');
const { createEventForShop, respondToEventCreationError, EVENT_CATEGORIES } = require('../services/eventCreation');

const router = asyncRouter();       // mounted at /v1/events
const publicRouter = asyncRouter(); // mounted at /v1/events — GET routes, no auth
const adminRouter = asyncRouter();  // mounted at /v1/admin/events
// Moderating a tenant's content is day-to-day Admin work, like the vendor approval
// queue — not platform configuration. So requireAdminAuth, which both admin and
// super_admin satisfy, rather than requireSuperAdmin.
adminRouter.use(requireAdminAuth);
// Event creation (POST /v1/shops/:shopId/events) lives in routes/shops.js instead —
// it's shop-scoped, so it belongs under the /v1/shops prefix, not here.

const MAX_IMAGES_PER_EVENT = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'events');

const upload = multer({
  storage: multer.memoryStorage(), // buffer everything first — validate before any disk write (all-or-nothing)
  limits: { fileSize: MAX_IMAGE_BYTES, files: MAX_IMAGES_PER_EVENT },
});

// POST /v1/events/:id/register
router.post('/:id/register', requireAuth, async (req, res) => {
  const { id: eventId } = req.params;

  try {
    const ticket = await prisma.$transaction(async (tx) => {
      const event = await tx.event.findUnique({ where: { id: eventId }, include: { ticketBatch: true } });
      if (!event || event.status !== 'active') {
        throw Object.assign(new Error('EVENT_NOT_AVAILABLE'), { code: 'EVENT_NOT_AVAILABLE' });
      }
      if (new Date() > event.endTime) {
        throw Object.assign(new Error('EVENT_ENDED'), { code: 'EVENT_ENDED' });
      }
      if (await userHoldsTicketForEvent(tx, req.userId, eventId)) {
        throw Object.assign(new Error('ALREADY_HAS_TICKET'), { code: 'ALREADY_HAS_TICKET' });
      }
      return claimAvailableTicket(tx, event.ticketBatch.id, req.userId);
    });

    return res.status(201).json(ticket);
  } catch (err) {
    if (err.code === 'EVENT_NOT_AVAILABLE') return res.status(404).json({ error: 'EVENT_NOT_AVAILABLE' });
    if (err.code === 'EVENT_ENDED') return res.status(409).json({ error: 'EVENT_ENDED' });
    if (err.code === 'ALREADY_HAS_TICKET') {
      return res.status(409).json({ error: 'ALREADY_HAS_TICKET', message: 'คุณมีตั๋วของ event นี้อยู่แล้ว' });
    }
    if (err.code === 'SOLD_OUT') return res.status(409).json({ error: 'SOLD_OUT' });
    console.error(err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// PATCH /v1/events/:id — { title?, description?, start_time?, end_time?, product_ids?, redemption_window? }
//
// Products and the redemption window are accepted here so one "save" on the manage
// screen is one request. They used to need their own calls, which meant the vendor
// pressed three separate save buttons and a failure part-way left the event half-updated.
router.patch('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const event = await prisma.event.findUnique({
    where: { id },
    include: { products: { select: { productId: true } } },
  });
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  const allowed = await isShopManagerOrOwner(req.userId, event.shopId);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  // An event the platform took down must not stay editable — otherwise a vendor can
  // rename a banned event and the reason an admin recorded no longer describes it.
  // Cancelled and expired events are closed for the same reason: nothing about them
  // should still be moving.
  if (event.status !== 'active') return res.status(409).json({ error: 'NOT_ACTIVE' });

  const {
    title, description, start_time, end_time,
    product_ids: productIds,
    redemption_window: redemptionWindow,
  } = req.body || {};

  const data = {};
  if (typeof title === 'string' && title.trim()) data.title = title.trim();
  if (typeof description === 'string') {
    if (description.length > 2000) return res.status(400).json({ error: 'DESCRIPTION_TOO_LONG' });
    data.description = description;
  }
  if (start_time) data.startTime = new Date(start_time);
  if (end_time) data.endTime = new Date(end_time);
  if (data.startTime && data.endTime && data.endTime <= data.startTime) {
    return res.status(400).json({ error: 'INVALID_TIME_RANGE' });
  }

  // Everything is validated before the transaction opens, so a bad window can't leave
  // the title already saved — the failure mode this endpoint exists to remove.
  const productProblem = await validateProductIds(productIds, event.shopId, {
    alreadyLinkedIds: event.products.map((p) => p.productId),
  });
  if (productProblem) return res.status(400).json(productProblem);

  // The window is bounded by the event's end time — the new one if this same request
  // moves it, otherwise the stored one.
  const endsAt = data.endTime ?? event.endTime;
  const windowProblem = validateRedemptionWindow(redemptionWindow, endsAt);
  if (windowProblem) return res.status(400).json(windowProblem);

  const updated = await prisma.$transaction(async (tx) => {
    const row = Object.keys(data).length > 0
      ? await tx.event.update({ where: { id }, data })
      : event;

    if (productIds !== undefined && productIds !== null) {
      await tx.eventProduct.deleteMany({ where: { eventId: id } });
      if (productIds.length > 0) {
        await tx.eventProduct.createMany({
          data: [...new Set(productIds)].map((productId) => ({ eventId: id, productId })),
        });
      }
    }

    if (redemptionWindow !== undefined && redemptionWindow !== null) {
      await writeRedemptionWindow(tx, id, redemptionWindow);
    }

    return row;
  });

  return res.json(updated);
});

// POST /v1/events/:id/cancel
router.post('/:id/cancel', requireAuth, async (req, res) => {
  const { id } = req.params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  const allowed = await isShopManagerOrOwner(req.userId, event.shopId);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const shop = await prisma.shop.findUnique({ where: { id: event.shopId }, select: { vendorId: true } });

  // Cancelling an event only pulls back tickets that were never issued — anything
  // already ISSUED/REDEEMED stays exactly as it is.
  const refund = await prisma.$transaction(async (tx) => {
    // Conditional, so a double-click or a concurrent expiry sweep can't refund twice.
    const claimed = await tx.event.updateMany({
      where: { id, status: 'active' },
      data: { status: 'cancelled' },
    });
    if (claimed.count === 0) return null;

    // Counted while the tickets are still AVAILABLE — the flip below is what makes
    // them CANCELLED, so this has to come first.
    const result = await refundForEndedEvent(tx, {
      vendorId: shop.vendorId,
      eventId: id,
      reason: REASON.EVENT_CANCELLED,
    });

    await tx.ticket.updateMany({
      where: { batch: { eventId: id }, status: 'AVAILABLE' },
      data: { status: 'CANCELLED' },
    });

    return result;
  });

  if (!refund) return res.status(409).json({ error: 'NOT_ACTIVE', message: 'Event นี้ถูกยกเลิกหรือหมดอายุไปแล้ว' });

  const updated = await prisma.event.findUnique({ where: { id }, include: { ticketBatch: true } });
  return res.json({ ...updated, quota_returned: { tickets: refund.ticketsReturned, events: refund.eventsReturned } });
});

// POST /v1/events/:id/relaunch — { title, description?, category, start_time, end_time,
// total_qty, discount_value_baht, product_ids?, redemption_window? }
//
// Recreates a finished event's promotion as a brand-new event, so a vendor who wants to
// run the same offer again doesn't have to refill the whole creation wizard from scratch.
// Deliberately a full create-shaped body rather than a partial patch: start/end time can
// never be copied forward (the old ones already passed) and total_qty must be re-entered
// too, bounded by whatever quota the vendor actually has back after the source event ended
// (the mobile app pre-fills a sensible default here, but the vendor can still edit it) —
// so the safest contract is "this is a new event, tell me everything", identical to
// POST /v1/shops/:shopId/events. Everything else (title/description/category/products/
// redemption window) the mobile app pre-fills from the source event via GET /v1/events/:id
// and lets the vendor edit before submitting, same as a fresh creation.
router.post('/:id/relaunch', requireAuth, async (req, res) => {
  const { id: sourceEventId } = req.params;
  const sourceEvent = await prisma.event.findUnique({
    where: { id: sourceEventId },
    include: {
      images: { orderBy: { sortOrder: 'asc' } },
      products: true,
      ticketBatch: { select: { discountValueBaht: true, fallbackDiscountValueBaht: true } },
    },
  });
  if (!sourceEvent) return res.status(404).json({ error: 'NOT_FOUND' });

  const allowed = await isShopManagerOrOwner(req.userId, sourceEvent.shopId);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  // Only an event that has actually ended has quota to relaunch with — an active event
  // is edited via PATCH instead, and a banned event's slot was lost to moderation, not
  // freed up for reuse (mirrors the reasoning in the admin ban handler above).
  if (sourceEvent.status !== 'expired' && sourceEvent.status !== 'cancelled') {
    return res.status(409).json({ error: 'NOT_ENDED', message: 'Event นี้ยังไม่จบ ยังรีเซ็ตไม่ได้' });
  }
  // A source can only spawn one successor — otherwise re-tapping "เปิดใหม่" (e.g. after
  // the app already navigated away once) would keep minting disconnected copies of the
  // same promotion, each invisibly forking the vendor's history of it.
  if (sourceEvent.relaunchedToEventId) {
    return res.status(409).json({
      error: 'ALREADY_RELAUNCHED',
      relaunched_to_event_id: sourceEvent.relaunchedToEventId,
      message: 'Event นี้ถูกเปิดใหม่ไปแล้ว',
    });
  }

  const {
    title,
    description,
    category,
    start_time,
    end_time,
    total_qty,
    discount_value_baht,
    product_ids: productIds,
    product_discounts: productDiscounts,
    fallback_discount_value_baht: fallbackDiscount,
    redemption_window: redemptionWindow,
  } = req.body || {};

  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'INVALID_TITLE' });
  if (typeof description === 'string' && description.length > 2000) {
    return res.status(400).json({ error: 'DESCRIPTION_TOO_LONG' });
  }
  if (!EVENT_CATEGORIES.includes(category)) return res.status(400).json({ error: 'INVALID_CATEGORY' });
  const startTime = new Date(start_time);
  const endTime = new Date(end_time);
  if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime()) || endTime <= startTime) {
    return res.status(400).json({ error: 'INVALID_TIME_RANGE' });
  }
  const qty = Number(total_qty);
  if (!Number.isInteger(qty) || qty <= 0 || qty > 10000) return res.status(400).json({ error: 'INVALID_QTY' });

  const linkedProductIds = Array.isArray(productIds) ? [...new Set(productIds)] : [];
  const discount = Number(discount_value_baht);

  // Per-product discounts + the fallback default from the source event's own amounts when
  // the request doesn't resupply them — relaunch is meant to carry these over automatically,
  // same as title/products/redemption window, while still letting the vendor override any
  // of it in the same request. A product newly added to product_ids that the source event
  // never had (no default to fall back on) must have its discount supplied explicitly, same
  // requirement as create.
  let effectiveProductDiscounts = productDiscounts;
  let effectiveFallback = fallbackDiscount;
  if (linkedProductIds.length > 0) {
    if (effectiveProductDiscounts === undefined) {
      effectiveProductDiscounts = Object.fromEntries(
        sourceEvent.products.map((ep) => [ep.productId, Number(ep.discountValueBaht)])
      );
    }
    if (effectiveFallback === undefined) {
      effectiveFallback = Number(
        sourceEvent.ticketBatch?.fallbackDiscountValueBaht ?? sourceEvent.ticketBatch?.discountValueBaht
      );
    }
    const discountsProblem = validateProductDiscounts(effectiveProductDiscounts, linkedProductIds);
    if (discountsProblem) return res.status(400).json(discountsProblem);
    const fallbackProblem = validateFallbackDiscount(effectiveFallback, linkedProductIds);
    if (fallbackProblem) return res.status(400).json(fallbackProblem);
  } else {
    if (!Number.isFinite(discount) || discount < 0) return res.status(400).json({ error: 'INVALID_DISCOUNT' });
  }

  const shop = await prisma.shop.findUnique({ where: { id: sourceEvent.shopId }, select: { vendorId: true } });
  if (!shop) return res.status(404).json({ error: 'SHOP_NOT_FOUND' });

  // Same reasoning as the create endpoint: a bad product id or window must bounce before
  // any quota is spent.
  const productProblem = await validateProductIds(productIds, sourceEvent.shopId);
  if (productProblem) return res.status(400).json(productProblem);

  const windowProblem = validateRedemptionWindow(redemptionWindow, endTime);
  if (windowProblem) return res.status(400).json(windowProblem);

  try {
    const event = await createEventForShop(prisma, {
      shopId: sourceEvent.shopId,
      vendorId: shop.vendorId,
      title: title.trim(),
      description: typeof description === 'string' ? description : null,
      category,
      startTime,
      endTime,
      qty,
      discount,
      linkedProductIds,
      productDiscounts: effectiveProductDiscounts,
      fallbackDiscount: Number(effectiveFallback),
      redemptionWindow,
      // Copies the DB rows only (imageUrl + sortOrder) — the files on disk are shared
      // as-is, so relaunching never re-uploads a single picture.
      images: sourceEvent.images.map((img) => ({ imageUrl: img.imageUrl, sortOrder: img.sortOrder })),
    });

    // Best-effort marker, not part of the transaction above: the new event already exists
    // and is usable either way, and this is a single update-by-id on a row just proven to
    // exist — the only realistic failure is the process dying between the two statements,
    // which is no worse than the "เปิดใหม่" button just becoming tappable again.
    await prisma.event.update({ where: { id: sourceEventId }, data: { relaunchedToEventId: event.id } });

    return res.status(201).json(event);
  } catch (err) {
    if (respondToEventCreationError(res, err)) return undefined;
    throw err; // asyncRouter forwards anything unexpected to the error handler
  }
});

// GET /v1/events — public list (guest ok) — ?category= filters by food_drink | music | workshops
publicRouter.get('/', async (req, res) => {
  const { category } = req.query;
  const events = await prisma.event.findMany({
    where: { status: 'active', ...(category ? { category: String(category) } : {}) },
    include: {
      shop: true,
      images: { orderBy: { sortOrder: 'asc' }, take: 1 },
      ticketBatch: true,
      products: { include: { product: { select: { name: true } } } },
    },
    orderBy: { createdAt: 'desc' },
  });

  // One grouped query for every listed event rather than an aggregate per card —
  // otherwise the feed costs N extra round-trips as the number of events grows.
  const ratings = await prisma.eventReview.groupBy({
    by: ['eventId'],
    where: { eventId: { in: events.map((e) => e.id) } },
    _avg: { rating: true },
    _count: { _all: true },
  });
  const ratingByEvent = new Map(ratings.map((r) => [r.eventId, r]));

  return res.json(
    events.map((e) => ({
      id: e.id,
      title: e.title,
      category: e.category,
      rating_average: ratingByEvent.has(e.id)
        ? Math.round(ratingByEvent.get(e.id)._avg.rating * 10) / 10
        : null,
      rating_count: ratingByEvent.get(e.id)?._count._all ?? 0,
      shop_name: e.shop.name,
      shop_logo_url: e.shop.logoUrl,
      thumbnail_url: e.images[0]?.imageUrl ?? null,
      discount_value_baht: e.ticketBatch?.discountValueBaht ?? null,
      // min===max for a whole-shop event or a product-scoped one whose products all
      // discount the same — the card badge only adds "สูงสุด" when they actually differ.
      discount_min_baht: discountRange(e.products, e.ticketBatch?.discountValueBaht ?? 0).min,
      discount_max_baht: discountRange(e.products, e.ticketBatch?.discountValueBaht ?? 0).max,
      remaining_count: e.ticketBatch?.remainingCount ?? 0,
      sold_out: (e.ticketBatch?.remainingCount ?? 0) <= 0,
      // จำนวนตั๋วที่ถูกกดรับไปแล้ว — ใช้เลือก event เด่น "แนะนำวันนี้" ฝั่ง Home (ยอดนิยมจริง
      // ไม่ใช่แค่ event ที่สร้างล่าสุด)
      claimed_count: (e.ticketBatch?.totalQty ?? 0) - (e.ticketBatch?.remainingCount ?? 0),
      end_time: e.endTime,
      // Names only in the list — the card just needs to say "ลดเฉพาะ X, Y".
      // Empty array = no restriction, the discount covers the whole shop.
      product_names: e.products.map((ep) => ep.product.name),
    }))
  );
});

// GET /v1/events/:id — public detail (guest ok)
publicRouter.get('/:id', attachCallerIfPresent, async (req, res) => {
  const event = await prisma.event.findUnique({
    where: { id: req.params.id },
    include: {
      shop: true,
      images: { orderBy: { sortOrder: 'asc' } },
      redemptionWindow: { include: { slots: true } },
      ticketBatch: true,
      // Archived products stay included on purpose: this event still discounts them, and
      // hiding them here would make an existing ticket look like it covered nothing.
      products: { include: { product: true } },
    },
  });
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  const rating = await prisma.eventReview.aggregate({
    where: { eventId: event.id },
    _avg: { rating: true },
    _count: { _all: true },
  });

  // req.userId is only set when attachCallerIfPresent verified a real, active user —
  // guests (and expired/garbage tokens, which fall through as guests) always get false.
  const alreadyClaimed = req.userId ? await userHoldsTicketForEvent(prisma, req.userId, event.id) : false;

  // Flatten the join rows away — clients want a product list, not EventProduct wrappers.
  // discount_value_baht rides along per product so the detail screen can show each
  // item's own post-discount price instead of one flat number for the whole event.
  const range = discountRange(event.products, event.ticketBatch?.discountValueBaht ?? 0);
  return res.json({
    ...event,
    products: event.products.map((ep) => ({ ...ep.product, discount_value_baht: Number(ep.discountValueBaht) })),
    discount_min_baht: range.min,
    discount_max_baht: range.max,
    // Summary only — the full list lives at /v1/events/:id/reviews so the detail
    // payload doesn't grow with every review written.
    ratingAverage: rating._count._all === 0 ? null : Math.round(rating._avg.rating * 10) / 10,
    ratingCount: rating._count._all,
    already_claimed: alreadyClaimed,
  });
});

// POST /v1/events/:id/images — multipart, up to 5 files, all-or-nothing
router.post('/:id/images', requireAuth, upload.array('images', MAX_IMAGES_PER_EVENT), async (req, res) => {
  const { id } = req.params;
  const event = await prisma.event.findUnique({ where: { id }, include: { images: true } });
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  const allowed = await isShopManagerOrOwner(req.userId, event.shopId);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'NO_FILES' });

  // All-or-nothing validation before touching disk.
  if (event.images.length + files.length > MAX_IMAGES_PER_EVENT) {
    return res.status(400).json({ error: 'TOO_MANY_IMAGES', max: MAX_IMAGES_PER_EVENT });
  }
  for (const f of files) {
    if (!ALLOWED_MIME.has(f.mimetype)) {
      return res.status(400).json({ error: 'INVALID_FILE_TYPE', file: f.originalname });
    }
    if (f.size > MAX_IMAGE_BYTES) {
      return res.status(400).json({ error: 'FILE_TOO_LARGE', file: f.originalname });
    }
  }

  const eventDir = path.join(UPLOAD_ROOT, id);
  fs.mkdirSync(eventDir, { recursive: true });

  // Every file hits the disk first, then all rows go in as one statement. The previous
  // version interleaved write/insert per file, so a failure on image 3 left images 1-2
  // behind on disk *and* in the DB — contradicting the all-or-nothing rule, which until
  // now only covered the validation pass.
  const nextSortOrder = event.images.length;
  const written = [];
  try {
    files.forEach((f, i) => {
      const ext = f.mimetype === 'image/png' ? '.png' : '.jpg';
      const filename = `${crypto.randomUUID()}${ext}`;
      const absolutePath = path.join(eventDir, filename);
      fs.writeFileSync(absolutePath, f.buffer); // sanitized filename, never req-controlled
      written.push({
        absolutePath,
        row: { eventId: id, imageUrl: `/uploads/events/${id}/${filename}`, sortOrder: nextSortOrder + i },
      });
    });

    const created = await prisma.eventImage.createManyAndReturn({ data: written.map((w) => w.row) });
    return res.status(201).json(created);
  } catch (err) {
    // Put the disk back where the DB is — the failed statement wrote no rows.
    for (const w of written) {
      fs.unlink(w.absolutePath, () => {}); // best-effort; a stray file beats a stray row
    }
    throw err; // asyncRouter forwards this to the error handler in app.js
  }
});

// DELETE /v1/events/:id/images/:imageId
router.delete('/:id/images/:imageId', requireAuth, async (req, res) => {
  const { id, imageId } = req.params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  const allowed = await isShopManagerOrOwner(req.userId, event.shopId);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const image = await prisma.eventImage.findUnique({ where: { id: imageId } });
  if (!image || image.eventId !== id) return res.status(404).json({ error: 'IMAGE_NOT_FOUND' });

  await prisma.eventImage.delete({ where: { id: imageId } });
  const filePath = path.join(__dirname, '..', '..', image.imageUrl.replace(/^\//, ''));
  fs.unlink(filePath, () => {}); // best-effort — DB record is the source of truth

  return res.status(204).send();
});

// PUT /v1/events/:id/redemption-window — { valid_from?, valid_until?, slots?: [{day_of_week, start_time, end_time}] }
router.put('/:id/redemption-window', requireAuth, async (req, res) => {
  const { id } = req.params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  const allowed = await isShopManagerOrOwner(req.userId, event.shopId);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const problem = validateRedemptionWindow(req.body || {}, event.endTime);
  if (problem) return res.status(400).json(problem);

  await prisma.$transaction((tx) => writeRedemptionWindow(tx, id, req.body || {}));

  const result = await prisma.eventRedemptionWindow.findUnique({ where: { eventId: id }, include: { slots: true } });
  return res.json(result ?? { eventId: id, cleared: true });
});

// ── Admin moderation ───────────────────────────────────────────
//
// Banning is deliberately harsher than the vendor's own cancel:
//  - it cancels ISSUED tickets too, not just unclaimed ones, so a discount the platform
//    has judged inappropriate stops being honoured immediately
//  - it refunds nothing, where cancelling returns the event credit and unused tickets
//  - it is permanent, because tickets taken out of customers' hands can't be handed back
// These are a third case alongside the documented cancel/expire
// rules, not a change to either of them.

// GET /v1/admin/events — ?status= filter · the list an admin scans through
adminRouter.get('/', async (req, res) => {
  const { status } = req.query;
  const events = await prisma.event.findMany({
    where: status ? { status: String(status) } : {},
    include: {
      shop: { select: { name: true } },
      ticketBatch: { select: { totalQty: true, remainingCount: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return res.json(
    events.map((e) => ({
      id: e.id,
      title: e.title,
      shop_name: e.shop.name,
      status: e.status,
      start_time: e.startTime,
      end_time: e.endTime,
      total_qty: e.ticketBatch?.totalQty ?? 0,
      remaining_count: e.ticketBatch?.remainingCount ?? 0,
      created_at: e.createdAt,
      banned_at: e.bannedAt,
    }))
  );
});

// GET /v1/admin/events/:id — everything needed to judge whether the event is acceptable
adminRouter.get('/:id', async (req, res) => {
  const event = await prisma.event.findUnique({
    where: { id: req.params.id },
    include: {
      shop: { select: { id: true, name: true, address: true } },
      images: { orderBy: { sortOrder: 'asc' } },
      redemptionWindow: { include: { slots: true } },
      ticketBatch: true,
      products: { include: { product: { select: { name: true, priceBaht: true } } } },
      bannedByAdmin: { select: { username: true } },
    },
  });
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  const [ticketGroups, reviewAgg] = await Promise.all([
    prisma.ticket.groupBy({ by: ['status'], where: { batch: { eventId: event.id } }, _count: true }),
    prisma.eventReview.aggregate({ where: { eventId: event.id }, _avg: { rating: true }, _count: { _all: true } }),
  ]);

  return res.json({
    id: event.id,
    title: event.title,
    description: event.description,
    status: event.status,
    start_time: event.startTime,
    end_time: event.endTime,
    created_at: event.createdAt,
    shop: { id: event.shop.id, name: event.shop.name, address: event.shop.address },
    image_urls: event.images.map((i) => i.imageUrl),
    products: event.products.map((ep) => ({ name: ep.product.name, price_baht: ep.product.priceBaht })),
    discount_value_baht: event.ticketBatch?.discountValueBaht ?? null,
    total_qty: event.ticketBatch?.totalQty ?? 0,
    remaining_count: event.ticketBatch?.remainingCount ?? 0,
    tickets: Object.fromEntries(ticketGroups.map((g) => [g.status, g._count])),
    redemption_window: event.redemptionWindow,
    rating_average: reviewAgg._count._all === 0 ? null : Math.round(reviewAgg._avg.rating * 10) / 10,
    rating_count: reviewAgg._count._all,
    banned_at: event.bannedAt,
    banned_reason: event.bannedReason,
    banned_by: event.bannedByAdmin?.username ?? null,
  });
});

// POST /v1/admin/events/:id/ban — { reason } · permanent
adminRouter.post('/:id/ban', async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  if (typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'REASON_REQUIRED' });
  }

  const exists = await prisma.event.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'NOT_FOUND' });

  // No quota is returned. The vendor's own cancel refunds because they chose to stop;
  // here they lost the slot through misconduct.
  const result = await prisma.$transaction((tx) =>
    banEvent(tx, { eventId: id, reason: reason.trim(), adminId: req.adminId })
  );

  if (!result) return res.status(409).json({ error: 'NOT_ACTIVE' });
  return res.json({
    id,
    status: 'banned',
    tickets_cancelled: result.ticketsCancelled,
    holders_notified: result.holdersNotified,
  });
});

module.exports = router;
module.exports.publicRouter = publicRouter;
module.exports.adminRouter = adminRouter;
