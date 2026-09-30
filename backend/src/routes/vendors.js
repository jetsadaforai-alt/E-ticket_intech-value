const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { asyncRouter } = require('../lib/asyncRouter');
const prisma = require('../services/prismaClient');
const { requireAuth } = require('../middleware/auth');
const { requireAdminAuth } = require('../middleware/adminAuth');
const { ensureVendorQuota } = require('../services/quota');
const { banEventsForShop } = require('../services/moderation');

const router = asyncRouter();
const adminRouter = asyncRouter();
adminRouter.use(requireAdminAuth);

const MAX_APPEALS = 5;

// เอกสารยืนยันตัวตนมักเป็นสแกน/รูปถ่ายบัตร — รับทั้งรูปและ PDF ต่างจาก event images
// ที่รับแค่ jpeg/png (backend/src/routes/events.js)
const MAX_DOCUMENTS_PER_VENDOR = 3;
const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;
const ALLOWED_DOCUMENT_MIME = new Set(['image/jpeg', 'image/png', 'application/pdf']);
const DOCUMENT_UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'vendors');

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: MAX_DOCUMENTS_PER_VENDOR },
});

// POST /v1/vendors — multipart: { name, documents[] }
router.post('/', requireAuth, documentUpload.array('documents', MAX_DOCUMENTS_PER_VENDOR), async (req, res) => {
  const { name } = req.body || {};
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'INVALID_NAME' });
  }

  const files = req.files || [];
  for (const f of files) {
    if (!ALLOWED_DOCUMENT_MIME.has(f.mimetype)) {
      return res.status(400).json({ error: 'INVALID_FILE_TYPE', file: f.originalname });
    }
    if (f.size > MAX_DOCUMENT_BYTES) {
      return res.status(400).json({ error: 'FILE_TOO_LARGE', file: f.originalname });
    }
  }

  const existing = await prisma.vendorOwnership.findFirst({ where: { userId: req.userId } });
  if (existing) {
    return res.status(409).json({ error: 'ALREADY_HAS_VENDOR' });
  }

  // Files hit disk before the DB row exists (we don't have a vendorId yet), so on any
  // failure below we clean them up ourselves — same all-or-nothing rule as event images.
  const vendorDir = path.join(DOCUMENT_UPLOAD_ROOT, crypto.randomUUID());
  const written = [];
  try {
    if (files.length > 0) {
      fs.mkdirSync(vendorDir, { recursive: true });
      files.forEach((f) => {
        const ext = f.mimetype === 'application/pdf' ? '.pdf' : f.mimetype === 'image/png' ? '.png' : '.jpg';
        const filename = `${crypto.randomUUID()}${ext}`;
        const absolutePath = path.join(vendorDir, filename);
        fs.writeFileSync(absolutePath, f.buffer);
        written.push({ absolutePath, documentUrl: `/uploads/vendors/${path.basename(vendorDir)}/${filename}` });
      });
    }

    const vendor = await prisma.vendor.create({
      data: {
        name: name.trim(),
        owners: { create: { userId: req.userId, role: 'owner' } },
        verification: { create: { status: 'pending' } },
        documents: { create: written.map((w) => ({ documentUrl: w.documentUrl })) },
      },
      include: { verification: true, documents: true },
    });

    return res.status(201).json(vendor);
  } catch (err) {
    for (const w of written) {
      fs.unlink(w.absolutePath, () => {}); // best-effort; a stray file beats a stray row
    }
    throw err; // asyncRouter forwards this to the error handler in app.js
  }
});

// GET /v1/vendors/me
router.get('/me', requireAuth, async (req, res) => {
  const ownership = await prisma.vendorOwnership.findFirst({
    where: { userId: req.userId },
    include: { vendor: { include: { verification: true, shop: true } } },
  });
  if (!ownership) return res.status(404).json({ error: 'NO_VENDOR' });
  return res.json(ownership.vendor);
});

// POST /v1/vendors/:id/appeal — { reason }
router.post('/:id/appeal', requireAuth, async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  if (typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'REASON_REQUIRED' });
  }

  const ownership = await prisma.vendorOwnership.findUnique({
    where: { userId_vendorId: { userId: req.userId, vendorId: id } },
  });
  if (!ownership) return res.status(403).json({ error: 'NOT_YOUR_VENDOR' });

  // Atomic: the WHERE clause (status + appealCount bound) is evaluated as part of
  // one UPDATE statement, so concurrent requests serialize on the row instead of
  // both reading appealCount=4 and both incrementing past the cap. A prior version
  // of this handler did read-check-then-write as separate steps inside the
  // transaction, which does NOT prevent that race — Postgres only takes the row
  // lock at the UPDATE, so two transactions can both pass the pre-check on the
  // same stale read. Same pattern as claimAvailableTicket's remainingCount guard.
  try {
    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.vendorVerification.updateMany({
        where: { vendorId: id, status: 'rejected', appealCount: { lt: MAX_APPEALS } },
        data: { status: 'pending', appealCount: { increment: 1 }, lastAppealReason: reason.trim() },
      });

      if (result.count === 0) {
        const current = await tx.vendorVerification.findUnique({ where: { vendorId: id } });
        if (!current) throw Object.assign(new Error('NOT_FOUND'), { code: 'NOT_FOUND' });
        if (current.status !== 'rejected') {
          throw Object.assign(new Error('NOT_REJECTED'), { code: 'NOT_REJECTED' });
        }
        throw Object.assign(new Error('APPEAL_LIMIT_REACHED'), { code: 'APPEAL_LIMIT_REACHED' });
      }

      // Keep the denormalized Vendor.verificationStatus in sync (see decision endpoint).
      await tx.vendor.update({ where: { id }, data: { verificationStatus: 'pending' } });

      // No notification row is written for admins, and none is needed: flipping the
      // status back to 'pending' above is what surfaces the appeal — the vendor
      // reappears in the admin approval queue, which already shows the appeal count and
      // the vendor's reason (admin-web/app/vendors/page.tsx + [id]/page.tsx).
      // A real push/notification channel for admins would need a schema change anyway,
      // since Notification.userId references User and admins live in AdminAccount.
      return tx.vendorVerification.findUnique({ where: { vendorId: id } });
    });

    return res.json(updated);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return res.status(404).json({ error: 'NOT_FOUND' });
    if (err.code === 'NOT_REJECTED') return res.status(409).json({ error: 'NOT_REJECTED', message: 'ยื่นอุทธรณ์ได้เฉพาะตอนถูกปฏิเสธเท่านั้น' });
    if (err.code === 'APPEAL_LIMIT_REACHED') {
      return res.status(429).json({ error: 'APPEAL_LIMIT_REACHED', message: 'ยื่นอุทธรณ์ครบ 5 ครั้งแล้ว กรุณาติดต่อ Admin โดยตรง' });
    }
    console.error(err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// --- Admin-only endpoints, mounted separately at /v1/admin/vendors ---

// GET /v1/admin/vendors?status=pending|approved|rejected|suspended
adminRouter.get('/', async (req, res) => {
  const { status } = req.query;

  // 'suspended' is not a VendorVerification status — it lives on Vendor.status, a
  // separate axis from the approve/reject queue (see the comment on Vendor.status in
  // schema.prisma). Every other value still queries the verification queue as before,
  // since a suspended vendor's own verificationStatus is left untouched by suspend/
  // unsuspend and keeps showing up under 'approved' there.
  if (status === 'suspended') {
    const vendors = await prisma.vendor.findMany({
      where: { status: 'suspended' },
      include: { verification: { select: { id: true, appealCount: true } } },
      orderBy: { suspendedAt: 'desc' },
    });
    return res.json(
      vendors.map((v) => ({
        id: v.verification?.id ?? v.id,
        vendorId: v.id,
        status: 'suspended',
        appealCount: v.verification?.appealCount ?? 0,
        createdAt: v.suspendedAt,
        vendor: { name: v.name },
      }))
    );
  }

  const where = status ? { status: String(status) } : {};
  const list = await prisma.vendorVerification.findMany({
    where,
    include: { vendor: true },
    orderBy: { createdAt: 'asc' },
  });
  return res.json(list);
});

// GET /v1/admin/vendors/:id — single vendor detail (used by the admin-web detail page)
adminRouter.get('/:id', async (req, res) => {
  const vendor = await prisma.vendor.findUnique({
    where: { id: req.params.id },
    include: {
      verification: { include: { reviewer: { select: { id: true, username: true } } } },
      owners: { include: { user: { select: { id: true, name: true, phone: true } } } },
      shop: true,
      documents: { orderBy: { createdAt: 'asc' } },
      suspendedByAdmin: { select: { username: true } },
    },
  });
  if (!vendor) return res.status(404).json({ error: 'NOT_FOUND' });
  return res.json(vendor);
});

// POST /v1/admin/vendors/:id/suspend — { reason } · reversible, unlike an event ban
adminRouter.post('/:id/suspend', async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  if (typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'REASON_REQUIRED' });
  }
  const trimmedReason = reason.trim();

  const vendor = await prisma.vendor.findUnique({
    where: { id },
    select: { id: true, shop: { select: { id: true } } },
  });
  if (!vendor) return res.status(404).json({ error: 'NOT_FOUND' });

  const result = await prisma.$transaction(async (tx) => {
    // Conditional, so a double submit is a no-op rather than a second round of
    // event-banning below.
    const claimed = await tx.vendor.updateMany({
      where: { id, status: 'active' },
      data: {
        status: 'suspended',
        suspendedAt: new Date(),
        suspendedReason: trimmedReason,
        suspendedByAdminId: req.adminId,
      },
    });
    if (claimed.count === 0) return null;

    // A suspended shop's promotions stop being honoured immediately — every event it
    // currently has live is banned the same way an individually-banned event is, and no
    // quota is returned.
    const banResult = vendor.shop
      ? await banEventsForShop(tx, {
          shopId: vendor.shop.id,
          reason: `ร้านถูกระงับ: ${trimmedReason}`,
          adminId: req.adminId,
        })
      : { eventsBanned: 0, ticketsCancelled: 0 };

    const owners = await tx.vendorOwnership.findMany({ where: { vendorId: id }, select: { userId: true } });
    if (owners.length > 0) {
      await tx.notification.createMany({
        data: owners.map((o) => ({
          userId: o.userId,
          type: 'vendor_suspended',
          payload: { vendorId: id, reason: trimmedReason },
        })),
      });
    }

    return banResult;
  });

  if (!result) return res.status(409).json({ error: 'NOT_ACTIVE' });
  return res.json({
    id,
    status: 'suspended',
    events_banned: result.eventsBanned,
    tickets_cancelled: result.ticketsCancelled,
  });
});

// POST /v1/admin/vendors/:id/unsuspend — reverses account lockout only. Events already
// banned by the suspension and tickets already cancelled stay exactly as they are —
// schema.prisma doesn't record which ban came from a vendor suspension vs. an individual
// admin decision, so there is nothing to safely reverse there.
adminRouter.post('/:id/unsuspend', async (req, res) => {
  const { id } = req.params;
  const exists = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'NOT_FOUND' });

  const claimed = await prisma.vendor.updateMany({
    where: { id, status: 'suspended' },
    data: { status: 'active', suspendedAt: null, suspendedReason: null, suspendedByAdminId: null },
  });
  if (claimed.count === 0) return res.status(409).json({ error: 'NOT_SUSPENDED' });

  const owners = await prisma.vendorOwnership.findMany({ where: { vendorId: id }, select: { userId: true } });
  if (owners.length > 0) {
    await prisma.notification.createMany({
      data: owners.map((o) => ({ userId: o.userId, type: 'vendor_restored', payload: { vendorId: id } })),
    });
  }

  return res.json({ id, status: 'active' });
});

// POST /v1/admin/vendors/:id/decision — { decision: 'approved'|'rejected', reason }
adminRouter.post('/:id/decision', async (req, res) => {
  const { id } = req.params;
  const { decision, reason } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'INVALID_DECISION' });
  }
  if (typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'REASON_REQUIRED' });
  }

  // Vendor.verificationStatus is a denormalized read of VendorVerification.status
  // (kept for fast "is this vendor allowed to operate" checks elsewhere) — must be
  // updated in the same transaction or it silently goes stale.
  const verification = await prisma.$transaction(async (tx) => {
    const result = await tx.vendorVerification.update({
      where: { vendorId: id },
      data: { status: decision, reason: reason.trim(), reviewedAt: new Date() },
    });
    await tx.vendor.update({ where: { id }, data: { verificationStatus: decision } });

    // Approval is the moment a vendor can start creating events, so it's also the
    // moment they need a quota wallet — on the Free package until they buy up.
    // Idempotent, so re-approving after an appeal doesn't reset their balances.
    if (decision === 'approved') {
      await ensureVendorQuota(tx, id);
    }

    const owners = await tx.vendorOwnership.findMany({ where: { vendorId: id } });
    await tx.notification.createMany({
      data: owners.map((o) => ({
        userId: o.userId,
        type: 'vendor_verification_result',
        payload: { vendorId: id, decision, reason: reason.trim() },
      })),
    });

    return result;
  });
  return res.json(verification);
});

module.exports = router;
module.exports.adminRouter = adminRouter;
