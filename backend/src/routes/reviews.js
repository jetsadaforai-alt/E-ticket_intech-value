const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const prisma = require('../services/prismaClient');
const { requireAuth } = require('../middleware/auth');
const { verifyToken } = require('../services/jwt');
const { validateReviewInput, userMayReviewEvent } = require('../services/reviewRules');

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png']);
const UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'reviews');

const upload = multer({
  storage: multer.memoryStorage(), // validate before anything reaches disk, same as event/product images
  limits: { fileSize: MAX_IMAGE_BYTES, files: 1 },
});

/**
 * Event reviews (rating 1-5 + optional comment).
 *
 * Reading is open to guests, the same as the event detail it sits on. Writing requires
 * having actually redeemed a ticket for that event — see services/reviewRules.js.
 *
 * One review per person per event is enforced by a DB unique constraint, and POST is an
 * upsert, so "edit my review" needs no second endpoint and no read-then-write race.
 *
 * Averages are computed per request rather than cached on Event/Shop, matching the
 * project's general preference for deriving totals at query time.
 */

const eventRouter = asyncRouter(); // mounted at /v1/events

/**
 * The reviewer's display name.
 *
 * Accounts created automatically on first OTP verify get `name` = their phone number.
 * This endpoint is readable by guests, so echoing the raw name would publish customers'
 * phone numbers — anything that still looks like a bare phone gets masked.
 */
function displayName(name) {
  const raw = (name || '').trim();
  if (!raw) return 'ผู้ใช้';
  if (/^[0-9]{9,10}$/.test(raw)) return `${raw.slice(0, 3)}xxxx${raw.slice(-3)}`;
  return raw;
}

/** Reads the bearer token if one was sent, without rejecting guests. */
function optionalUserId(req) {
  const [scheme, token] = (req.headers.authorization || '').split(' ');
  if (scheme !== 'Bearer' || !token) return null;
  try {
    return verifyToken(token).sub;
  } catch {
    return null; // an expired token just means "browsing as a guest" here
  }
}

function toSummary(rows) {
  const count = rows.reduce((n, r) => n + r._count._all, 0);
  const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  for (const r of rows) {
    distribution[r.rating] = r._count._all;
    total += r.rating * r._count._all;
  }
  return {
    average: count === 0 ? null : Math.round((total / count) * 10) / 10,
    count,
    distribution,
  };
}

function toReview(r) {
  return {
    id: r.id,
    rating: r.rating,
    comment: r.comment,
    photo_url: r.photoUrl,
    user_name: displayName(r.user?.name),
    created_at: r.createdAt,
    updated_at: r.updatedAt,
  };
}

// GET /v1/events/:id/reviews — guest ok
eventRouter.get('/:id/reviews', async (req, res) => {
  const eventId = req.params.id;
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { shopId: true } });
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  const userId = optionalUserId(req);

  const [byRating, shopAgg, reviews, mine] = await Promise.all([
    prisma.eventReview.groupBy({ by: ['rating'], where: { eventId }, _count: { _all: true } }),
    // ค่าเฉลี่ยระดับร้าน = รีวิวของทุก event ในร้านนี้รวมกัน
    prisma.eventReview.aggregate({
      where: { event: { shopId: event.shopId } },
      _avg: { rating: true },
      _count: { _all: true },
    }),
    prisma.eventReview.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { name: true } } },
    }),
    userId
      ? prisma.eventReview.findUnique({ where: { eventId_userId: { eventId, userId } } })
      : Promise.resolve(null),
  ]);

  // Guests can't review, so skip the eligibility query entirely for them.
  const eligibility = userId ? await userMayReviewEvent(userId, eventId) : { error: 'GUEST' };

  return res.json({
    summary: toSummary(byRating),
    shop_summary: {
      average: shopAgg._count._all === 0 ? null : Math.round(shopAgg._avg.rating * 10) / 10,
      count: shopAgg._count._all,
    },
    can_review: eligibility === null,
    my_review: mine
      ? { id: mine.id, rating: mine.rating, comment: mine.comment, photo_url: mine.photoUrl, updated_at: mine.updatedAt }
      : null,
    // ไม่ส่งรีวิวของตัวเองซ้ำในรายการ — UI โชว์แยกไว้บนสุดอยู่แล้ว
    reviews: reviews.filter((r) => r.userId !== userId).map(toReview),
  });
});

// POST /v1/events/:id/reviews — { rating, comment? } · ยิงซ้ำ = แก้รีวิวเดิม
eventRouter.post('/:id/reviews', requireAuth, async (req, res) => {
  const eventId = req.params.id;
  const { rating, comment } = req.body || {};

  const invalid = validateReviewInput({ rating, comment });
  if (invalid) return res.status(400).json(invalid);

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) return res.status(404).json({ error: 'NOT_FOUND' });

  const notAllowed = await userMayReviewEvent(req.userId, eventId);
  if (notAllowed) return res.status(403).json(notAllowed);

  const text = typeof comment === 'string' && comment.trim() ? comment.trim() : null;
  const review = await prisma.eventReview.upsert({
    where: { eventId_userId: { eventId, userId: req.userId } },
    create: { eventId, userId: req.userId, rating, comment: text },
    update: { rating, comment: text },
  });

  return res.status(201).json({
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    photo_url: review.photoUrl,
    updated_at: review.updatedAt,
  });
});

// POST /v1/events/:id/reviews/photo — multipart, single file, replaces whatever was there.
// Review must already exist (submit rating/comment first) — same "attach to an existing
// resource" shape as POST /v1/products/:id/image.
eventRouter.post('/:id/reviews/photo', requireAuth, upload.single('image'), async (req, res) => {
  const eventId = req.params.id;
  const existing = await prisma.eventReview.findUnique({
    where: { eventId_userId: { eventId, userId: req.userId } },
  });
  if (!existing) return res.status(404).json({ error: 'NO_REVIEW', message: 'ต้องส่งรีวิวก่อนถึงจะแนบรูปได้' });

  const file = req.file;
  if (!file) return res.status(400).json({ error: 'NO_FILE' });
  if (!ALLOWED_MIME.has(file.mimetype)) return res.status(400).json({ error: 'INVALID_FILE_TYPE' });
  if (file.size > MAX_IMAGE_BYTES) return res.status(400).json({ error: 'FILE_TOO_LARGE' });

  const reviewDir = path.join(UPLOAD_ROOT, existing.id);
  fs.mkdirSync(reviewDir, { recursive: true });

  const ext = file.mimetype === 'image/png' ? '.png' : '.jpg';
  const filename = `${crypto.randomUUID()}${ext}`; // never the client's filename
  const absolutePath = path.join(reviewDir, filename);
  fs.writeFileSync(absolutePath, file.buffer);

  const previous = existing.photoUrl;
  try {
    const updated = await prisma.eventReview.update({
      where: { id: existing.id },
      data: { photoUrl: `/uploads/reviews/${existing.id}/${filename}` },
    });
    // ลบรูปเก่าออกจากดิสก์ต่อเมื่อ DB ชี้ไปที่รูปใหม่แล้วเท่านั้น (เหมือน products.js)
    if (previous) {
      fs.unlink(path.join(__dirname, '..', '..', previous.replace(/^\//, '')), () => {});
    }
    return res.status(201).json({ id: updated.id, photo_url: updated.photoUrl });
  } catch (err) {
    fs.unlink(absolutePath, () => {}); // put the disk back; the row never moved
    throw err;
  }
});

// DELETE /v1/events/:id/reviews/me
eventRouter.delete('/:id/reviews/me', requireAuth, async (req, res) => {
  const eventId = req.params.id;
  const existing = await prisma.eventReview.findUnique({
    where: { eventId_userId: { eventId, userId: req.userId } },
    select: { id: true },
  });
  if (!existing) return res.status(404).json({ error: 'NOT_FOUND' });

  await prisma.eventReview.delete({ where: { id: existing.id } });
  return res.status(204).send();
});

module.exports = eventRouter;
module.exports.eventRouter = eventRouter;
