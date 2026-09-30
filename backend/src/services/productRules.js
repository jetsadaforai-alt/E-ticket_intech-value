const prisma = require('./prismaClient');

/**
 * Checks a set of product ids before they're linked to an event.
 *
 * Two rules, both of which have to hold or the link is meaningless:
 *  - the product belongs to the same shop as the event (no discounting someone else's menu)
 *  - the product is still `active` (an archived item has been retired from the menu, so
 *    pointing a *new* discount at it would advertise something the shop no longer sells)
 *
 * `alreadyLinkedIds` exempts the second rule for products the event already discounts.
 * The rule is "you may not add a retired item", not "you may not keep what you have" —
 * without this, opening an event that happens to include an archived product and pressing
 * save would fail with an error the shop has no way to act on.
 *
 * An empty or absent list is valid and means "no product restriction" — the event
 * discounts the whole shop, which is what every event did before products existed.
 *
 * Returns a ready-to-send error body, or null when the set is usable.
 */
async function validateProductIds(productIds, shopId, { alreadyLinkedIds = [], db = prisma } = {}) {
  if (productIds === undefined || productIds === null) return null;
  if (!Array.isArray(productIds)) return { error: 'INVALID_PRODUCT_IDS' };
  if (productIds.length === 0) return null;
  if (productIds.some((id) => typeof id !== 'string' || !id)) return { error: 'INVALID_PRODUCT_IDS' };

  const unique = [...new Set(productIds)];
  const found = await db.product.findMany({
    where: { id: { in: unique }, shopId },
    select: { id: true, status: true },
  });

  // Anything missing here is either a bad id or another shop's product. Both are the
  // caller's mistake and both deserve the same answer — saying which would leak whether
  // an id exists somewhere else on the platform.
  if (found.length !== unique.length) {
    const foundIds = new Set(found.map((p) => p.id));
    return { error: 'PRODUCT_NOT_FOUND', product_ids: unique.filter((id) => !foundIds.has(id)) };
  }

  const keep = new Set(alreadyLinkedIds);
  const archived = found.filter((p) => p.status !== 'active' && !keep.has(p.id)).map((p) => p.id);
  if (archived.length > 0) return { error: 'PRODUCT_ARCHIVED', product_ids: archived };

  return null;
}

/**
 * Checks a { [productId]: number } map of per-product flat-baht discounts before an event
 * is created/relaunched with linked products.
 *
 * Returns null immediately for a whole-shop event (no linked products, nothing to check —
 * that path still uses the single flat `discount_value_baht` field untouched). For a
 * product-scoped event, every id in `linkedProductIds` must have a finite, non-negative
 * amount in `discounts` — a missing key is exactly as invalid as a bad number, so a vendor
 * (or a relaunch request that adds a product the source event never had) can't silently
 * ship a product with no discount attached.
 */
function validateProductDiscounts(discounts, linkedProductIds) {
  if (linkedProductIds.length === 0) return null;
  if (typeof discounts !== 'object' || discounts === null || Array.isArray(discounts)) {
    return { error: 'INVALID_PRODUCT_DISCOUNTS' };
  }
  for (const productId of linkedProductIds) {
    const value = Number(discounts[productId]);
    if (!Number.isFinite(value) || value < 0) {
      return { error: 'INVALID_PRODUCT_DISCOUNTS', product_id: productId };
    }
  }
  return null;
}

/**
 * Checks the one fallback flat-baht discount a vendor sets for a product-scoped event —
 * used when staff mark a redemption "product unavailable" instead of picking one of the
 * event's linked products, since there's no specific item left to price the discount
 * against. Required whenever the event links 1+ products (there's always a chance the one
 * a customer wants is out of stock, even with a single linked product); irrelevant and
 * always valid for a whole-shop event, which has no "out of stock" case to cover.
 */
function validateFallbackDiscount(fallback, linkedProductIds) {
  if (linkedProductIds.length === 0) return null;
  const value = Number(fallback);
  if (!Number.isFinite(value) || value < 0) return { error: 'INVALID_FALLBACK_DISCOUNT' };
  return null;
}

/**
 * The min/max flat-baht discount across an event's linked products, for the badge that
 * has to summarize a whole event in one line ("ลด X บาท" vs "ลดสูงสุด X บาท"). A
 * whole-shop event (no linked products) has exactly one rate — its own — so min and max
 * come back equal there by construction, which is what lets every call site skip a
 * separate "is this even product-scoped" branch before deciding how to word the badge.
 */
function discountRange(eventProducts, wholeShopDiscountBaht) {
  if (eventProducts.length === 0) {
    const value = Number(wholeShopDiscountBaht);
    return { min: value, max: value };
  }
  const values = eventProducts.map((ep) => Number(ep.discountValueBaht));
  return { min: Math.min(...values), max: Math.max(...values) };
}

module.exports = { validateProductIds, validateProductDiscounts, validateFallbackDiscount, discountRange };
