const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const prisma = require('../services/prismaClient');
const { requireAuth } = require('../middleware/auth');
const { isShopManagerOrOwner, isActiveShopMember, isVendorSuspendedForShop } = require('../services/shopAuth');
const { validateProductIds, validateProductDiscounts, validateFallbackDiscount } = require('../services/productRules');
const { validateRedemptionWindow } = require('../services/redemptionWindow');
const { createEventForShop, respondToEventCreationError, EVENT_CATEGORIES } = require('../services/eventCreation');

const router = asyncRouter();
// invitationsRouter is mounted at /v1/staff (different prefix from `router`,
// which is mounted at /v1/shops) — must stay a separate router, not paths on `router`.
const invitationsRouter = asyncRouter();

const PHONE_RE = /^0\d{9}$/;

const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const ALLOWED_LOGO_MIME = new Set(['image/jpeg', 'image/png']);
const LOGO_UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'shops');
const uploadLogo = multer({
  storage: multer.memoryStorage(), // validate before anything reaches disk, same as product/avatar images
  limits: { fileSize: MAX_LOGO_BYTES, files: 1 },
});

// POST /v1/shops — { name, address }
router.post('/', requireAuth, async (req, res) => {
  const { name, address } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || typeof address !== 'string' || !address.trim()) {
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }

  const ownership = await prisma.vendorOwnership.findFirst({
    where: { userId: req.userId },
    include: { vendor: { include: { shop: true } } },
  });
  if (!ownership) return res.status(403).json({ error: 'NOT_A_VENDOR_OWNER' });
  if (ownership.vendor.verificationStatus !== 'approved') {
    return res.status(403).json({ error: 'VENDOR_NOT_APPROVED' });
  }
  if (ownership.vendor.shop) {
    return res.status(409).json({ error: 'SHOP_ALREADY_EXISTS' }); // 1 vendor : 1 shop
  }

  const shop = await prisma.shop.create({
    data: {
      vendorId: ownership.vendorId,
      name: name.trim(),
      address: address.trim(),
      // Owner is granted the "manager" role on their own shop at creation time —
      // no separate invite-manager flow.
      staffAssignments: {
        create: { userId: req.userId, role: 'manager', status: 'active', invitedBy: req.userId },
      },
    },
  });

  return res.status(201).json(shop);
});

// GET /v1/shops/:id — manager/owner dashboard summary, computed live from the DB
// (event counts by status, tickets issued/redeemed, cumulative discount actually
// handed out via Redemption.discountValueBaht — not TicketBatch's flat rate, since
// that can change across edits while past redemptions keep their recorded value).
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const allowed = await isShopManagerOrOwner(req.userId, id);
  if (!allowed) {
    // A distinct code here matters: the mobile Shop Dashboard uses this specific
    // response to decide whether to bounce the vendor to a "your shop is suspended"
    // screen instead of silently falling back to customer mode.
    if (await isVendorSuspendedForShop(id)) return res.status(403).json({ error: 'VENDOR_SUSPENDED' });
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const shop = await prisma.shop.findUnique({ where: { id } });
  if (!shop) return res.status(404).json({ error: 'NOT_FOUND' });

  const [eventGroups, ticketsIssued, ticketsRedeemed, discountAgg] = await Promise.all([
    prisma.event.groupBy({ by: ['status'], where: { shopId: id }, _count: true }),
    prisma.ticket.count({ where: { batch: { event: { shopId: id } }, status: { in: ['ISSUED', 'REDEEMED'] } } }),
    prisma.ticket.count({ where: { batch: { event: { shopId: id } }, status: 'REDEEMED' } }),
    prisma.redemption.aggregate({
      where: { ticket: { batch: { event: { shopId: id } } } },
      _sum: { discountValueBaht: true },
    }),
  ]);

  const eventCounts = Object.fromEntries(eventGroups.map((g) => [g.status, g._count]));

  return res.json({
    id: shop.id,
    name: shop.name,
    address: shop.address,
    logo_url: shop.logoUrl,
    vendor_id: shop.vendorId,
    summary: {
      events_active: eventCounts.active ?? 0,
      events_total: Object.values(eventCounts).reduce((a, b) => a + b, 0),
      tickets_issued: ticketsIssued,
      tickets_redeemed: ticketsRedeemed,
      total_discount_baht: Number(discountAgg._sum.discountValueBaht ?? 0),
    },
  });
});

// PATCH /v1/shops/:id — { name?, address? }
router.patch('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const allowed = await isShopManagerOrOwner(req.userId, id);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const { name, address } = req.body || {};
  const data = {};
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'INVALID_NAME' });
    data.name = name.trim();
  }
  if (address !== undefined) {
    if (typeof address !== 'string' || !address.trim()) return res.status(400).json({ error: 'INVALID_ADDRESS' });
    data.address = address.trim();
  }
  if (Object.keys(data).length === 0) return res.status(400).json({ error: 'INVALID_INPUT' });

  const shop = await prisma.shop.update({ where: { id }, data });
  return res.json(shop);
});

// POST /v1/shops/:id/logo — multipart, single file, replaces whatever was there
// (same pattern as POST /v1/products/:id/image and POST /v1/me/avatar)
router.post('/:id/logo', requireAuth, uploadLogo.single('image'), async (req, res) => {
  const { id } = req.params;
  const allowed = await isShopManagerOrOwner(req.userId, id);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const file = req.file;
  if (!file) return res.status(400).json({ error: 'NO_FILE' });
  if (!ALLOWED_LOGO_MIME.has(file.mimetype)) return res.status(400).json({ error: 'INVALID_FILE_TYPE' });
  if (file.size > MAX_LOGO_BYTES) return res.status(400).json({ error: 'FILE_TOO_LARGE' });

  const shop = await prisma.shop.findUnique({ where: { id }, select: { logoUrl: true } });
  if (!shop) return res.status(404).json({ error: 'NOT_FOUND' });

  const shopDir = path.join(LOGO_UPLOAD_ROOT, id);
  fs.mkdirSync(shopDir, { recursive: true });

  const ext = file.mimetype === 'image/png' ? '.png' : '.jpg';
  const filename = `${crypto.randomUUID()}${ext}`; // never the client's filename
  const absolutePath = path.join(shopDir, filename);
  fs.writeFileSync(absolutePath, file.buffer);

  const previous = shop.logoUrl;
  try {
    const updated = await prisma.shop.update({
      where: { id },
      data: { logoUrl: `/uploads/shops/${id}/${filename}` },
    });
    // Only now is the old file unreachable — drop it after the row points elsewhere.
    if (previous) {
      fs.unlink(path.join(__dirname, '..', '..', previous.replace(/^\//, '')), () => {});
    }
    return res.status(201).json(updated);
  } catch (err) {
    fs.unlink(absolutePath, () => {}); // put the disk back; the row never moved
    throw err; // asyncRouter hands this to the error handler in app.js
  }
});

// POST /v1/shops/:id/staff/invite — { phone }
router.post('/:id/staff/invite', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { phone } = req.body || {};
  if (!PHONE_RE.test(phone || '')) return res.status(400).json({ error: 'INVALID_PHONE' });

  const allowed = await isShopManagerOrOwner(req.userId, id);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  // Staff must already have an account — inviting no longer creates a placeholder
  // user for an unknown number (registration is required before anyone can log in).
  const invitee = await prisma.user.findUnique({ where: { phone } });
  if (!invitee) {
    return res.status(404).json({
      error: 'NOT_REGISTERED',
      message: 'เบอร์นี้ยังไม่ได้สมัครใช้งานแอป ให้พนักงานสมัครสมาชิกก่อนแล้วค่อยเชิญ',
    });
  }

  const existing = await prisma.shopStaffAssignment.findFirst({
    where: { userId: invitee.id, shopId: id, status: { in: ['active', 'invited'] } },
  });
  if (existing) return res.status(409).json({ error: 'ALREADY_INVITED_OR_ACTIVE' });

  const assignment = await prisma.shopStaffAssignment.create({
    data: { userId: invitee.id, shopId: id, role: 'staff', status: 'invited', invitedBy: req.userId },
  });

  await prisma.notification.create({
    data: { userId: invitee.id, type: 'invite_staff', payload: { shopId: id, assignmentId: assignment.id } },
  });

  return res.status(201).json(assignment);
});

// DELETE /v1/shops/:id/staff/:assignmentId — revoke a staff member
// Only `staff` rows can be removed: an owner's auto-created `manager` row is what
// grants them shop access at all (see POST /v1/shops), so allowing it here would
// let a shop lock itself out permanently.
router.delete('/:id/staff/:assignmentId', requireAuth, async (req, res) => {
  const { id, assignmentId } = req.params;

  const allowed = await isShopManagerOrOwner(req.userId, id);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const assignment = await prisma.shopStaffAssignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || assignment.shopId !== id) return res.status(404).json({ error: 'NOT_FOUND' });
  if (assignment.role !== 'staff') return res.status(400).json({ error: 'CANNOT_REMOVE_MANAGER' });
  if (assignment.status === 'removed') return res.status(409).json({ error: 'ALREADY_REMOVED' });

  const updated = await prisma.shopStaffAssignment.update({
    where: { id: assignmentId },
    data: { status: 'removed' },
  });

  // GET /v1/me only returns active assignments, so the removed user's staff mode
  // fails its next validation pass and drops back to customer on its own.
  return res.json(updated);
});

// GET /v1/shops/:id/events — shop-side view: ALL statuses (unlike public GET
// /v1/events, which only shows active events across every shop)
//
// Any active member may read this, staff included: ShopEventsScreen is a staff-mode
// destination (read-only — the tap opens ShopEventView, not the edit form) and staff need
// to know what is running to answer customers at the counter. Gating it on
// manager/owner meant every staff member got a 403 and an empty list.
router.get('/:id/events', requireAuth, async (req, res) => {
  const { id } = req.params;
  const allowed = await isActiveShopMember(req.userId, id);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const events = await prisma.event.findMany({
    where: { shopId: id },
    include: {
      ticketBatch: true,
      images: { orderBy: { sortOrder: 'asc' }, take: 1 },
      products: { include: { product: { select: { id: true, name: true } } } },
      // Lets ShopEventsScreen say "เปิดใหม่แล้ว" and name the successor instead of showing
      // a "เปิดใหม่" button that would spawn a second, disconnected copy.
      relaunchedTo: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
  // discount_value_baht rides along per product so the substitute-prompt flow
  // (ShopProductsScreen) can prefill "same discount as the item that just went out of
  // stock" without a second round-trip to fetch it.
  return res.json(
    events.map((e) => ({
      ...e,
      products: e.products.map((ep) => ({ ...ep.product, discount_value_baht: Number(ep.discountValueBaht) })),
    }))
  );
});

// GET /v1/shops/:id/staff — manager/owner view of current + invited staff
router.get('/:id/staff', requireAuth, async (req, res) => {
  const { id } = req.params;
  const allowed = await isShopManagerOrOwner(req.userId, id);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const staff = await prisma.shopStaffAssignment.findMany({
    where: { shopId: id, status: { in: ['active', 'invited'] } },
    include: { user: { select: { id: true, name: true, phone: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return res.json(staff);
});

// POST /v1/shops/:shopId/events
// { title, description?, category, start_time, end_time, total_qty, discount_value_baht, product_ids? }
router.post('/:shopId/events', requireAuth, async (req, res) => {
  const { shopId } = req.params;
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

  const allowed = await isShopManagerOrOwner(req.userId, shopId);
  if (!allowed) {
    if (await isVendorSuspendedForShop(shopId)) return res.status(403).json({ error: 'VENDOR_SUSPENDED' });
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

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

  // Whole-shop (empty product_ids) still validates the one plain discount_value_baht field
  // exactly as before this feature existed. A product-scoped event instead validates a
  // per-product discount map plus the one fallback amount for the "product unavailable"
  // case — discount_value_baht is not read at all in that branch.
  const linkedProductIds = Array.isArray(productIds) ? [...new Set(productIds)] : [];
  const discount = Number(discount_value_baht);
  if (linkedProductIds.length === 0) {
    if (!Number.isFinite(discount) || discount < 0) return res.status(400).json({ error: 'INVALID_DISCOUNT' });
  } else {
    const discountsProblem = validateProductDiscounts(productDiscounts, linkedProductIds);
    if (discountsProblem) return res.status(400).json(discountsProblem);
    const fallbackProblem = validateFallbackDiscount(fallbackDiscount, linkedProductIds);
    if (fallbackProblem) return res.status(400).json(fallbackProblem);
  }

  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { vendorId: true } });
  if (!shop) return res.status(404).json({ error: 'SHOP_NOT_FOUND' });

  // Checked out here rather than inside the transaction on purpose: a bad product id must
  // bounce before any quota is spent, otherwise a typo costs the vendor an event credit.
  // Omitting product_ids entirely is normal — that event discounts the whole shop.
  const productProblem = await validateProductIds(productIds, shopId);
  if (productProblem) return res.status(400).json(productProblem);

  // Same reasoning as products: reject a bad window before any quota is spent. Taking it
  // inline is what lets the app create an event and its conditions in one request —
  // previously the app had to POST then PUT, and a failed PUT left an event live with no
  // conditions on it.
  const windowProblem = validateRedemptionWindow(redemptionWindow, endTime);
  if (windowProblem) return res.status(400).json(windowProblem);

  // Quota + ticket-minting logic lives in createEventForShop (services/eventCreation.js),
  // shared with POST /v1/events/:id/relaunch — see that file for why validation stays here
  // (any errors must bounce before quota is spent) while the transaction itself is shared.
  try {
    const event = await createEventForShop(prisma, {
      shopId,
      vendorId: shop.vendorId,
      title: title.trim(),
      description: typeof description === 'string' ? description : null,
      category,
      startTime,
      endTime,
      qty,
      discount,
      linkedProductIds,
      productDiscounts,
      fallbackDiscount: Number(fallbackDiscount),
      redemptionWindow,
    });

    return res.status(201).json(event);
  } catch (err) {
    if (respondToEventCreationError(res, err)) return undefined;
    throw err; // asyncRouter forwards anything unexpected to the error handler
  }
});

// GET /v1/shops/:id/events/compare — manager/owner only. A per-event breakdown meant for
// comparing promotions against each other (which one actually got redeemed, which
// products moved) — separate from GET /v1/shops/:id's shop-wide summary and from
// GET /v1/shops/:id/events' management list, so neither of those gets heavier for a
// question they're not answering.
router.get('/:id/events/compare', requireAuth, async (req, res) => {
  const { id: shopId } = req.params;
  const allowed = await isShopManagerOrOwner(req.userId, shopId);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const shop = await prisma.shop.findUnique({ where: { id: shopId }, select: { id: true } });
  if (!shop) return res.status(404).json({ error: 'NOT_FOUND' });

  const events = await prisma.event.findMany({
    where: { shopId },
    include: {
      ticketBatch: { select: { id: true } },
      products: { select: { productId: true } },
      productSubstitutions: {
        include: {
          outOfStockProduct: { select: { name: true } },
          substituteProduct: { select: { name: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  // One event list is rarely more than a few dozen rows even for an active shop, so a
  // handful of small queries per event stays cheap and keeps each number easy to verify
  // independently — a single cross-event groupBy can't express "per event" here anyway,
  // since Redemption has no eventId column of its own to group by (only ticketId).
  const rows = await Promise.all(
    events.map(async (event) => {
      const batchId = event.ticketBatch?.id;
      const hasProducts = event.products.length > 0;

      const [ticketsIssued, ticketsRedeemed, discountAgg, productGroups, outOfStockCount, unspecifiedCount] =
        await Promise.all([
          batchId ? prisma.ticket.count({ where: { batchId, status: { in: ['ISSUED', 'REDEEMED'] } } }) : 0,
          batchId ? prisma.ticket.count({ where: { batchId, status: 'REDEEMED' } }) : 0,
          batchId
            ? prisma.redemption.aggregate({ where: { ticket: { batchId } }, _sum: { discountValueBaht: true } })
            : null,
          // productId: null is excluded here on purpose — that bucket is "unspecified",
          // counted separately below, not a product anyone can be shown as having chosen.
          batchId
            ? prisma.redemption.groupBy({
                by: ['productId'],
                where: { ticket: { batchId }, productUnavailable: false, productId: { not: null } },
                _count: true,
              })
            : [],
          batchId ? prisma.redemption.count({ where: { ticket: { batchId }, productUnavailable: true } }) : 0,
          // Only meaningful when this event actually links products — for a whole-shop
          // event, every redemption has productId null by design, and that is not
          // "missing data", so it must not be counted as unspecified.
          batchId && hasProducts
            ? prisma.redemption.count({ where: { ticket: { batchId }, productUnavailable: false, productId: null } })
            : 0,
        ]);

      const productIds = productGroups.map((g) => g.productId).filter((pid) => pid !== null);
      const products =
        productIds.length > 0
          ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true } })
          : [];
      const nameById = new Map(products.map((p) => [p.id, p.name]));

      return {
        id: event.id,
        title: event.title,
        status: event.status,
        start_time: event.startTime,
        end_time: event.endTime,
        tickets_issued: ticketsIssued,
        tickets_redeemed: ticketsRedeemed,
        discount_paid_baht: Number(discountAgg?._sum.discountValueBaht ?? 0),
        product_breakdown: productGroups
          .map((g) => ({
            product_id: g.productId,
            product_name: nameById.get(g.productId) ?? '',
            redeemed_count: g._count,
          }))
          .sort((a, b) => b.redeemed_count - a.redeemed_count),
        out_of_stock_count: outOfStockCount,
        unspecified_count: unspecifiedCount,
        substitutions: event.productSubstitutions.map((s) => ({
          out_of_stock_product_name: s.outOfStockProduct.name,
          substitute_product_name: s.substituteProduct.name,
          created_at: s.createdAt,
        })),
      };
    })
  );

  // Highest redeemed first by default — this view exists to answer "which promo worked",
  // so the best performer should be the first thing the vendor sees.
  rows.sort((a, b) => b.tickets_redeemed - a.tickets_redeemed);

  return res.json(rows);
});

// POST /v1/staff/invitations/:id/accept
invitationsRouter.post('/invitations/:id/accept', requireAuth, async (req, res) => {
  const { id } = req.params;
  const assignment = await prisma.shopStaffAssignment.findUnique({ where: { id } });
  if (!assignment || assignment.userId !== req.userId) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  if (assignment.status !== 'invited') {
    return res.status(409).json({ error: 'NOT_INVITED' });
  }

  const updated = await prisma.shopStaffAssignment.update({ where: { id }, data: { status: 'active' } });
  return res.json(updated);
});

// POST /v1/staff/invitations/:id/reject
// Mirrors /accept exactly, but parks the row at 'rejected' instead of 'active'. That value
// is deliberately outside the ['active','invited'] set used by both the invite duplicate
// guard and the staff list, so the shop can re-invite the same person afterwards and the
// declined row never shows up as staff.
invitationsRouter.post('/invitations/:id/reject', requireAuth, async (req, res) => {
  const { id } = req.params;
  const assignment = await prisma.shopStaffAssignment.findUnique({ where: { id } });
  if (!assignment || assignment.userId !== req.userId) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  if (assignment.status !== 'invited') {
    return res.status(409).json({ error: 'NOT_INVITED' });
  }

  const updated = await prisma.shopStaffAssignment.update({ where: { id }, data: { status: 'rejected' } });
  return res.json(updated);
});

module.exports = router;
module.exports.invitationsRouter = invitationsRouter;
