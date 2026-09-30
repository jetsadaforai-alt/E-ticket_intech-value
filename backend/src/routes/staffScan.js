const { asyncRouter } = require('../lib/asyncRouter');
const { DateTime } = require('luxon');
const prisma = require('../services/prismaClient');
const { requireAuth } = require('../middleware/auth');
const { resolveToken } = require('../services/qrToken');
const { isActiveShopMember, isVendorSuspendedForShop } = require('../services/shopAuth');
const { isWithinRedemptionWindow } = require('../services/redemptionWindow');

const router = asyncRouter(); // mounted at /v1/staff

// POST /v1/staff/scan — { token }
router.post('/scan', requireAuth, async (req, res) => {
  const { token } = req.body || {};
  if (typeof token !== 'string' || !token) {
    return res.status(400).json({ error: 'INVALID_TOKEN' });
  }

  const ticketId = await resolveToken(token);
  if (!ticketId) {
    return res.status(400).json({ error: 'QR_EXPIRED' });
  }

  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: {
      batch: {
        include: {
          event: {
            include: {
              shop: true,
              redemptionWindow: { include: { slots: true } },
              products: { include: { product: { select: { id: true, name: true, priceBaht: true, status: true } } } },
            },
          },
        },
      },
    },
  });
  if (!ticket) return res.status(404).json({ error: 'TICKET_NOT_FOUND' });

  const { shop } = ticket.batch.event;
  const allowed = await isActiveShopMember(req.userId, shop.id);
  if (!allowed) {
    // Same belt-and-braces reasoning as the EVENT_BANNED check below: a suspended
    // vendor's events already got banned (which alone would block this scan), but a
    // shop can be suspended between that ban and this exact request, so check directly.
    if (await isVendorSuspendedForShop(shop.id)) return res.status(409).json({ error: 'SHOP_SUSPENDED' });
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  if (ticket.status !== 'ISSUED') {
    // Covers already-REDEEMED (double scan), CANCELLED (event was cancelled), EXPIRED.
    return res.status(409).json({ error: 'TICKET_NOT_REDEEMABLE', status: ticket.status });
  }

  const event = ticket.batch.event;
  // A banned event must honour nothing, whatever state an individual ticket is in.
  // Banning already cancels every outstanding ticket, so this is belt-and-braces — but
  // it is the one status where letting a stray ticket through would defeat the point.
  // Vendor-cancelled events are deliberately NOT checked here: that flow leaves tickets
  // already handed out redeemable on purpose.
  if (event.status === 'banned') {
    return res.status(409).json({ error: 'EVENT_BANNED' });
  }
  if (new Date() > event.endTime) {
    return res.status(409).json({ error: 'EVENT_ENDED' });
  }

  const windowCheck = isWithinRedemptionWindow(event.redemptionWindow);
  if (!windowCheck.allowed) {
    return res.status(409).json({ error: windowCheck.reason });
  }

  // A product-scoped event can't know the final discount yet — that depends on which
  // linked product the customer chose, and staff haven't confirmed that (PATCH
  // /v1/staff/redemptions/:id/product) at scan time. Writing the fallback amount here is
  // a safe placeholder: every product-scoped event is guaranteed to have one (validated at
  // creation), and confirming a product later overwrites it with that product's own rate.
  // A whole-shop event has nothing to wait on — its one flat rate is final immediately,
  // exactly as before this feature existed.
  const isProductScoped = event.products.length > 0;
  const initialDiscount = isProductScoped
    ? ticket.batch.fallbackDiscountValueBaht
    : ticket.batch.discountValueBaht;

  // Marking the ticket REDEEMED and writing its Redemption row commit or roll back
  // together: a ticket spent with no Redemption behind it would cost the customer their
  // discount while vanishing from the shop's dashboard and compare figures.
  // Atomic ISSUED -> REDEEMED transition — updateMany with a status guard means a
  // concurrent second scan of the same ticket (e.g. two staff phones at once)
  // gets count=0 and is correctly rejected, never double-redeemed.
  const redemption = await prisma.$transaction(async (tx) => {
    const claimed = await tx.ticket.updateMany({
      where: { id: ticket.id, status: 'ISSUED' },
      data: { status: 'REDEEMED' },
    });
    if (claimed.count === 0) return null;

    return tx.redemption.create({
      data: {
        ticketId: ticket.id,
        staffId: req.userId,
        discountValueBaht: initialDiscount,
      },
    });
  });
  if (!redemption) {
    return res.status(409).json({ error: 'TICKET_NOT_REDEEMABLE', status: 'REDEEMED' });
  }

  return res.json({
    result: 'success',
    redemption_id: redemption.id,
    // Lets the app deep-link straight to this shop's product management (e.g. from an
    // "out of stock" tap) without guessing which shop, since a staff account can belong
    // to more than one.
    shop_id: shop.id,
    // null (not the placeholder) for a product-scoped event — showing the fallback amount
    // here would look like a final number when it's really just a stand-in. discount_pending
    // tells the app to wait for the confirm step instead of rendering a number that might
    // still change.
    discount_value_baht: isProductScoped ? null : redemption.discountValueBaht,
    discount_pending: isProductScoped,
    event_title: event.title,
    // The staff member is standing at the counter deciding what to discount, so the
    // scan result has to say which items this ticket covers. Empty = the whole shop.
    // id/status ride along so the app can offer a confirm-product step next (PATCH
    // /v1/staff/redemptions/:id/product) and flag any already-archived ("หมด") product.
    // discount_value_baht per product lets staff see what each choice is worth before
    // picking one.
    products: event.products.map((ep) => ({
      id: ep.product.id,
      name: ep.product.name,
      price_baht: ep.product.priceBaht,
      status: ep.product.status,
      discount_value_baht: ep.discountValueBaht,
    })),
    redeemed_at: redemption.redeemedAt,
  });
});

// PATCH /v1/staff/redemptions/:id/product — { product_id } | { unavailable: true }
//
// Separate follow-up request rather than folded into /scan: this app has no real
// inventory tracking (Product has no stock count), so only a staff member at the
// counter can say what the customer actually walked away with, or that nothing on
// the list was physically available. That confirmation must never gate or delay the
// scan itself — the ticket is already REDEEMED by the time this fires — so it's its
// own idempotent call: retriable, correctable, and never race-guarded against a
// concurrent scan (there isn't one — the ticket is already spent).
router.patch('/redemptions/:id/product', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { product_id: productId, unavailable } = req.body || {};

  const hasProductId = typeof productId === 'string' && productId.length > 0;
  const hasUnavailable = unavailable === true;
  if (hasProductId === hasUnavailable) {
    // Neither given, or both given — exactly one must be true so a staff member can
    // never silently send productId: null and erase a previous confirmation by accident.
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }

  const redemption = await prisma.redemption.findUnique({
    where: { id },
    include: { ticket: { include: { batch: { include: { event: { include: { products: true } } } } } } },
  });
  if (!redemption) return res.status(404).json({ error: 'NOT_FOUND' });

  // Only the staff member who scanned this ticket may confirm/correct its product —
  // matches the ownership model of everything else in this file (isActiveShopMember
  // was already checked once, at scan time; this is a follow-up on that same action).
  if (redemption.staffId !== req.userId) return res.status(403).json({ error: 'FORBIDDEN' });

  // This is the moment the real discount is known — /scan could only write a
  // placeholder (the vendor's fallback) because it didn't yet know which product the
  // customer picked. A whole-shop event never reaches here with hasProductId (there are
  // no event.products to pick from), so this path only ever runs for a product-scoped one.
  let finalDiscount;
  if (hasProductId) {
    const matchedEventProduct = redemption.ticket.batch.event.products.find(
      (ep) => ep.productId === productId
    );
    if (!matchedEventProduct) {
      return res.status(400).json({ error: 'PRODUCT_NOT_IN_EVENT' });
    }
    finalDiscount = Number(matchedEventProduct.discountValueBaht);
  } else {
    finalDiscount = Number(redemption.ticket.batch.fallbackDiscountValueBaht);
  }

  const updated = await prisma.redemption.update({
    where: { id },
    data: hasProductId
      ? { productId, productUnavailable: false, discountValueBaht: finalDiscount }
      : { productId: null, productUnavailable: true, discountValueBaht: finalDiscount },
  });

  return res.json({
    id: updated.id,
    product_id: updated.productId,
    product_unavailable: updated.productUnavailable,
    discount_value_baht: updated.discountValueBaht,
  });
});

// GET /v1/staff/redemptions/today
router.get('/redemptions/today', requireAuth, async (req, res) => {
  const startOfDay = DateTime.now().setZone('Asia/Bangkok').startOf('day').toUTC().toJSDate();
  const endOfDay = DateTime.now().setZone('Asia/Bangkok').endOf('day').toUTC().toJSDate();

  const redemptions = await prisma.redemption.findMany({
    where: { staffId: req.userId, redeemedAt: { gte: startOfDay, lte: endOfDay } },
    include: {
      ticket: { include: { batch: { include: { event: true } } } },
      product: { select: { name: true } },
    },
    orderBy: { redeemedAt: 'desc' },
  });

  return res.json(
    redemptions.map((r) => ({
      id: r.id,
      event_title: r.ticket.batch.event.title,
      discount_value_baht: r.discountValueBaht,
      redeemed_at: r.redeemedAt,
      // Lets staff see what they confirmed (or flagged out of stock) for each customer
      // today. product_id/product_name both null with product_unavailable false means
      // "not confirmed yet" — see Redemption.productUnavailable in schema.prisma for why
      // that's kept distinct from a real out-of-stock signal.
      product_id: r.productId,
      product_name: r.product?.name ?? null,
      product_unavailable: r.productUnavailable,
    }))
  );
});

module.exports = router;
