const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const prisma = require('../services/prismaClient');
const { requireAuth } = require('../middleware/auth');
const { isShopManagerOrOwner, isActiveShopMember } = require('../services/shopAuth');
const { validateProductIds } = require('../services/productRules');

/**
 * Shop products, and the link between an event and the products it discounts.
 *
 * An event with no products discounts the whole shop — that is the default and it is what
 * every event created before this table existed still means. Linking products narrows the
 * discount to just those items.
 *
 * Products are never hard-deleted, only archived. A deleted product would take its
 * EventProduct rows with it, and an event whose only product vanished would silently widen
 * from "this one item" to "the whole shop" — plus tickets already issued would no longer
 * be able to say what they were for.
 */

const shopRouter = asyncRouter(); // mounted at /v1/shops
const router = asyncRouter(); // mounted at /v1/products
const eventRouter = asyncRouter(); // mounted at /v1/events

const MAX_NAME_LEN = 200;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'products');

const upload = multer({
  storage: multer.memoryStorage(), // validate before anything reaches disk, same as event images
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

function parsePrice(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return null;
  return value;
}

// GET /v1/shops/:shopId/products?include_archived=1
// Staff can read the list too — they need to know what a ticket covers at the counter.
shopRouter.get('/:shopId/products', requireAuth, async (req, res) => {
  const { shopId } = req.params;
  const allowed = await isActiveShopMember(req.userId, shopId);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const includeArchived = req.query.include_archived === '1';
  const products = await prisma.product.findMany({
    where: { shopId, ...(includeArchived ? {} : { status: 'active' }) },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  return res.json(products);
});

// POST /v1/shops/:shopId/products — { name, price_baht }
shopRouter.post('/:shopId/products', requireAuth, async (req, res) => {
  const { shopId } = req.params;
  const allowed = await isShopManagerOrOwner(req.userId, shopId);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const { name, price_baht: priceBaht } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'INVALID_NAME' });
  if (name.trim().length > MAX_NAME_LEN) return res.status(400).json({ error: 'NAME_TOO_LONG', max: MAX_NAME_LEN });

  const price = parsePrice(priceBaht);
  if (price === null) return res.status(400).json({ error: 'INVALID_PRICE' });

  const count = await prisma.product.count({ where: { shopId } });
  const product = await prisma.product.create({
    data: { shopId, name: name.trim(), priceBaht: price, sortOrder: count },
  });
  return res.status(201).json(product);
});

// PATCH /v1/products/:id — { name?, price_baht?, status? }
router.patch('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return res.status(404).json({ error: 'NOT_FOUND' });

  const allowed = await isShopManagerOrOwner(req.userId, product.shopId);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const { name, price_baht: priceBaht, status } = req.body || {};
  const data = {};
  if (name !== undefined) {
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'INVALID_NAME' });
    if (name.trim().length > MAX_NAME_LEN) return res.status(400).json({ error: 'NAME_TOO_LONG', max: MAX_NAME_LEN });
    data.name = name.trim();
  }
  if (priceBaht !== undefined) {
    const price = parsePrice(priceBaht);
    if (price === null) return res.status(400).json({ error: 'INVALID_PRICE' });
    data.priceBaht = price;
  }
  if (status !== undefined) {
    if (!['active', 'archived'].includes(status)) return res.status(400).json({ error: 'INVALID_STATUS' });
    data.status = status;
  }

  const updated = await prisma.product.update({ where: { id }, data });
  return res.json(updated);
});

// DELETE /v1/products/:id — archives, never deletes (see the note at the top of this file)
router.delete('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return res.status(404).json({ error: 'NOT_FOUND' });

  const allowed = await isShopManagerOrOwner(req.userId, product.shopId);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });
  if (product.status === 'archived') return res.status(409).json({ error: 'ALREADY_ARCHIVED' });

  const updated = await prisma.product.update({ where: { id }, data: { status: 'archived' } });
  return res.json(updated);
});

// POST /v1/products/:id/image — multipart, single file, replaces whatever was there
router.post('/:id/image', requireAuth, upload.single('image'), async (req, res) => {
  const { id } = req.params;
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product) return res.status(404).json({ error: 'NOT_FOUND' });

  const allowed = await isShopManagerOrOwner(req.userId, product.shopId);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const file = req.file;
  if (!file) return res.status(400).json({ error: 'NO_FILE' });
  if (!ALLOWED_MIME.has(file.mimetype)) return res.status(400).json({ error: 'INVALID_FILE_TYPE' });
  if (file.size > MAX_IMAGE_BYTES) return res.status(400).json({ error: 'FILE_TOO_LARGE' });

  const productDir = path.join(UPLOAD_ROOT, id);
  fs.mkdirSync(productDir, { recursive: true });

  const ext = file.mimetype === 'image/png' ? '.png' : '.jpg';
  const filename = `${crypto.randomUUID()}${ext}`; // never the client's filename
  const absolutePath = path.join(productDir, filename);
  fs.writeFileSync(absolutePath, file.buffer);

  const previous = product.imageUrl;
  try {
    const updated = await prisma.product.update({
      where: { id },
      data: { imageUrl: `/uploads/products/${id}/${filename}` },
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

// PUT /v1/events/:id/products — { product_ids: [] }
// Replaces the whole set, same shape as the redemption-window endpoint: an empty array is
// a valid request meaning "this event discounts the whole shop again".
eventRouter.put('/:id/products', requireAuth, async (req, res) => {
  const { id } = req.params;
  const event = await prisma.event.findUnique({ where: { id }, select: { id: true, shopId: true } });
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  const allowed = await isShopManagerOrOwner(req.userId, event.shopId);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  const { product_ids: productIds } = req.body || {};
  const ids = productIds === undefined ? [] : productIds;

  // Products this event already discounts may stay even if they've since been archived;
  // only newly-added ones have to be active.
  const existing = await prisma.eventProduct.findMany({ where: { eventId: id }, select: { productId: true } });
  const problem = await validateProductIds(ids, event.shopId, {
    alreadyLinkedIds: existing.map((ep) => ep.productId),
  });
  if (problem) return res.status(400).json(problem);

  const unique = [...new Set(ids)];
  await prisma.$transaction(async (tx) => {
    await tx.eventProduct.deleteMany({ where: { eventId: id } });
    if (unique.length > 0) {
      await tx.eventProduct.createMany({ data: unique.map((productId) => ({ eventId: id, productId })) });
    }
  });

  const products = await prisma.eventProduct.findMany({
    where: { eventId: id },
    include: { product: true },
  });
  return res.json(products.map((ep) => ep.product));
});

// POST /v1/events/:id/products/substitute — { out_of_stock_product_id, substitute_product_id }
//
// One action for the whole "ran out mid-event" flow: archives the out-of-stock product
// shop-wide (same effect as DELETE /v1/products/:id — it's out everywhere, not just this
// event), links the substitute onto this event if it isn't already, and records the swap
// so a compare-events dashboard can show "X ran out → replaced with Y" as history instead
// of trying to infer it from how Redemption.productId happens to shift over time.
eventRouter.post('/:id/products/substitute', requireAuth, async (req, res) => {
  const { id: eventId } = req.params;
  const {
    out_of_stock_product_id: outOfStockProductId,
    substitute_product_id: substituteProductId,
    discount_value_baht: discountValueBahtInput,
  } = req.body || {};

  if (typeof outOfStockProductId !== 'string' || !outOfStockProductId) {
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }
  if (typeof substituteProductId !== 'string' || !substituteProductId) {
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }
  if (outOfStockProductId === substituteProductId) {
    return res.status(400).json({ error: 'SAME_PRODUCT' });
  }

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true, shopId: true } });
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  const allowed = await isShopManagerOrOwner(req.userId, event.shopId);
  if (!allowed) return res.status(403).json({ error: 'FORBIDDEN' });

  // The out-of-stock product doesn't have to still be active (it may have been archived
  // by hand already) — only that it's this shop's, so the archive-and-record below always
  // has a real row to point at. The substitute has to still be active and sellable, which
  // validateProductIds already enforces (same rule as linking any product to an event).
  const outOfStockProduct = await prisma.product.findUnique({ where: { id: outOfStockProductId } });
  if (!outOfStockProduct || outOfStockProduct.shopId !== event.shopId) {
    return res.status(400).json({ error: 'PRODUCT_NOT_FOUND', product_ids: [outOfStockProductId] });
  }

  const substituteProblem = await validateProductIds([substituteProductId], event.shopId);
  if (substituteProblem) return res.status(400).json(substituteProblem);

  // Whole-shop events never reach this with a meaningful default — they have no
  // EventProduct rows to carry a per-product rate, so a discount has to be given
  // explicitly there. A product-scoped event's out-of-stock product always has one
  // (creation requires it), so the common case just carries it over unchanged.
  const oldEventProduct = await prisma.eventProduct.findUnique({
    where: { eventId_productId: { eventId, productId: outOfStockProductId } },
  });
  const newDiscount = discountValueBahtInput !== undefined
    ? Number(discountValueBahtInput)
    : Number(oldEventProduct?.discountValueBaht);
  if (!Number.isFinite(newDiscount) || newDiscount < 0) {
    return res.status(400).json({ error: 'INVALID_DISCOUNT' });
  }

  const substitution = await prisma.$transaction(async (tx) => {
    await tx.product.update({ where: { id: outOfStockProductId }, data: { status: 'archived' } });
    // upsert, not create: the substitute may already be linked to this event from
    // earlier (e.g. it was already on the menu, or covers a second out-of-stock item) —
    // in that case the new rate replaces its old one rather than being silently ignored.
    await tx.eventProduct.upsert({
      where: { eventId_productId: { eventId, productId: substituteProductId } },
      create: { eventId, productId: substituteProductId, discountValueBaht: newDiscount },
      update: { discountValueBaht: newDiscount },
    });
    return tx.productSubstitution.create({
      data: { eventId, outOfStockProductId, substituteProductId },
      include: {
        outOfStockProduct: { select: { name: true } },
        substituteProduct: { select: { name: true } },
      },
    });
  });

  return res.status(201).json({
    id: substitution.id,
    event_id: substitution.eventId,
    out_of_stock_product: { id: substitution.outOfStockProductId, name: substitution.outOfStockProduct.name },
    substitute_product: { id: substitution.substituteProductId, name: substitution.substituteProduct.name },
    discount_value_baht: newDiscount,
    created_at: substitution.createdAt,
  });
});

module.exports = router;
module.exports.shopRouter = shopRouter;
module.exports.eventRouter = eventRouter;
