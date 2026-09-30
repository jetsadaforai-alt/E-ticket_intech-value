const { consumeForNewEvent } = require('./quota');
const { writeRedemptionWindow } = require('./redemptionWindow');

// Matches HomeScreen's CATEGORY_CHIPS (mobile/src/screens/HomeScreen.tsx), minus "All Events"
// which is a client-side "no filter" option, not a real category. Shared here (rather than
// declared separately in shops.js and events.js) so the create and relaunch endpoints can
// never drift onto two different category lists.
const EVENT_CATEGORIES = ['food_drink', 'music', 'workshops'];

// Every unit of quota becomes a real Ticket row up front, all AVAILABLE
// ("ยืนยัน → ตั๋วทุกใบเกิดสถานะ AVAILABLE ทันที").
// Registration later atomically claims one of these rows rather than creating tickets on demand.
//
// Spending quota happens inside this same transaction: if ticket creation fails the
// vendor must not be charged for an event that doesn't exist, and if quota runs out
// no half-built event may be left behind.
//
// Extracted out of POST /v1/shops/:shopId/events so POST /v1/events/:id/relaunch can reuse
// the exact same validation-order-independent core (the caller still does all validation —
// title/category/time-range/qty/discount/productIds/redemptionWindow — before calling this,
// same as before the extraction) instead of the two endpoints drifting apart over time.
//
// `images`, if given, is copied verbatim (imageUrl + sortOrder only) — used by relaunch to
// carry a source event's pictures over without touching any file on disk. The original
// create endpoint never passes this, so its behavior/response shape is unchanged.
//
// `productDiscounts`/`fallbackDiscount` only matter when `linkedProductIds` is non-empty
// (a product-scoped event) — the caller has already validated them (validateProductDiscounts/
// validateFallbackDiscount) by this point. A whole-shop event (empty linkedProductIds) never
// reads either: `batchDiscount` falls back to the plain `discount` param, unchanged from
// before this feature existed.
async function createEventForShop(prisma, {
  shopId, vendorId, title, description, category, startTime, endTime,
  qty, discount, linkedProductIds, productDiscounts, fallbackDiscount, redemptionWindow, images,
}) {
  const isProductScoped = linkedProductIds.length > 0;
  const batchDiscount = isProductScoped ? fallbackDiscount : discount;

  return prisma.$transaction(async (tx) => {
    const created = await tx.event.create({
      data: {
        shopId,
        title,
        description,
        category,
        startTime,
        endTime,
        ticketBatch: {
          create: {
            totalQty: qty,
            remainingCount: qty,
            discountValueBaht: batchDiscount,
            // Only ever set for a product-scoped event — see the field's own schema comment
            // for why the plain discountValueBaht column above is also set to this same
            // value in that case (backward-compat for code that hasn't been updated to read
            // this new field yet).
            fallbackDiscountValueBaht: isProductScoped ? fallbackDiscount : null,
          },
        },
        products: {
          create: linkedProductIds.map((productId) => ({
            productId,
            discountValueBaht: isProductScoped ? productDiscounts[productId] : 0,
          })),
        },
        ...(images && images.length
          ? { images: { create: images.map((img, i) => ({ imageUrl: img.imageUrl, sortOrder: img.sortOrder ?? i })) } }
          : {}),
      },
      include: { ticketBatch: true, products: { include: { product: true } }, images: true },
    });

    const { ticketCap } = await consumeForNewEvent(tx, {
      vendorId,
      eventId: created.id,
      ticketQty: qty,
    });
    // Store the ceiling that applied at creation, so later price/tier changes can't
    // move it retroactively. Ticket top-ups for this event raise this number.
    await tx.event.update({ where: { id: created.id }, data: { ticketCap } });

    const codePrefix = created.id.slice(0, 8);
    await tx.ticket.createMany({
      data: Array.from({ length: qty }, (_, i) => ({
        batchId: created.ticketBatch.id,
        code: `${codePrefix}-${String(i + 1).padStart(6, '0')}`,
        status: 'AVAILABLE',
      })),
    });

    if (redemptionWindow !== undefined && redemptionWindow !== null) {
      await writeRedemptionWindow(tx, created.id, redemptionWindow);
    }

    return { ...created, ticketCap };
  });
}

// Maps the quota/creation errors thrown by createEventForShop onto the HTTP response,
// shared so the two callers (create, relaunch) answer with identical wording. Returns
// true once it has sent a response; false means the caller should rethrow (unexpected
// error, let asyncRouter's error handler deal with it).
function respondToEventCreationError(res, err) {
  if (err.code === 'EXCEEDS_TICKET_CAP') {
    res.status(400).json({
      error: 'EXCEEDS_TICKET_CAP',
      ticket_cap: err.ticketCap,
      requested: err.requested,
      message: `แพ็กเกจปัจจุบันจำกัด ${err.ticketCap} ใบต่อ 1 Event`,
    });
    return true;
  }
  if (err.code === 'INSUFFICIENT_QUOTA') {
    res.status(409).json({
      error: 'INSUFFICIENT_QUOTA',
      needed: err.needed,
      available: err.available,
      message: `โควตาไม่พอ (เหลือตั๋ว ${err.available.tickets} ใบ, Event ${err.available.events} ครั้ง)`,
    });
    return true;
  }
  if (err.code === 'NO_QUOTA') {
    res.status(409).json({ error: 'NO_QUOTA', message: 'ร้านยังไม่ได้รับอนุมัติ' });
    return true;
  }
  return false;
}

module.exports = { createEventForShop, respondToEventCreationError, EVENT_CATEGORIES };
