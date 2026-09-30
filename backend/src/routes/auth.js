const { asyncRouter } = require('../lib/asyncRouter');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const prisma = require('../services/prismaClient');
const { signToken } = require('../services/jwt');
const { requireAuth, requireAuthAllowSuspended } = require('../middleware/auth');

const router = asyncRouter();

// ---------------------------------------------------------------------------
// Phone OTP, stored in Redis. SMS delivery goes through services/smsProvider.js,
// which is currently a stub: it logs instead of sending and returns `devCode` in
// the response, but ONLY when NODE_ENV !== 'production' (it throws otherwise).
// Plugging in a real SMS gateway means replacing that one provider.
// ---------------------------------------------------------------------------
const { requestOtp, verifyOtp } = require('../services/otp');
const PHONE_RE = /^0\d{9}$/; // Thai mobile format, e.g. 0812345678

function isValidPhone(phone) {
  return typeof phone === 'string' && PHONE_RE.test(phone);
}

// Login and registration are separate flows: logging in never creates an account,
// and registering never silently logs into an existing one. The client must say
// which one it means on both OTP calls.
const OTP_PURPOSES = new Set(['login', 'register']);
const NOT_REGISTERED = { error: 'NOT_REGISTERED', message: 'เบอร์นี้ยังไม่ได้สมัครสมาชิก กรุณาสมัครก่อน' };
const ALREADY_REGISTERED = { error: 'ALREADY_REGISTERED', message: 'เบอร์นี้สมัครแล้ว กรุณาเข้าสู่ระบบ' };

function isValidPurpose(purpose) {
  return typeof purpose === 'string' && OTP_PURPOSES.has(purpose);
}

router.post('/otp/request', async (req, res) => {
  const { phone, purpose } = req.body || {};
  if (!isValidPhone(phone)) return res.status(400).json({ error: 'INVALID_PHONE' });
  if (!isValidPurpose(purpose)) return res.status(400).json({ error: 'INVALID_PURPOSE' });

  // Checked before an OTP is sent so the user is pointed at the right screen
  // without waiting for (or burning) a code.
  const existing = await prisma.user.findUnique({ where: { phone }, select: { id: true } });
  if (purpose === 'login' && !existing) return res.status(404).json(NOT_REGISTERED);
  if (purpose === 'register' && existing) return res.status(409).json(ALREADY_REGISTERED);

  try {
    const { devCode } = await requestOtp(phone);
    return res.json({ message: 'OTP sent', ...(devCode ? { devCode } : {}) });
  } catch (err) {
    if (err.code === 'COOLDOWN_ACTIVE') {
      return res.status(429).json({ error: 'COOLDOWN_ACTIVE', message: 'รอ 60 วินาทีก่อนขอรหัสใหม่' });
    }
    if (err.code === 'LOCKED_OUT') {
      return res.status(429).json({ error: 'LOCKED_OUT', message: 'ลองผิดเกินกำหนด กรุณารอสักครู่' });
    }
    console.error(err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

router.post('/otp/verify', async (req, res) => {
  const { phone, code, purpose } = req.body || {};
  if (!isValidPhone(phone) || typeof code !== 'string') {
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }
  if (!isValidPurpose(purpose)) return res.status(400).json({ error: 'INVALID_PURPOSE' });

  try {
    await verifyOtp(phone, code);
  } catch (err) {
    if (err.code === 'LOCKED_OUT') {
      return res.status(429).json({ error: 'LOCKED_OUT', message: 'ลองผิดเกินกำหนด กรุณารอสักครู่' });
    }
    if (err.code === 'INVALID_CODE') {
      return res.status(400).json({ error: 'INVALID_CODE' });
    }
    if (err.code === 'OTP_EXPIRED_OR_NOT_REQUESTED') {
      return res.status(400).json({ error: 'OTP_EXPIRED_OR_NOT_REQUESTED' });
    }
    console.error(err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }

  // Re-checked here (after the code is proven valid, so verify can't be used to probe
  // which numbers exist) in case a client calls verify without the matching request.
  let user = await prisma.user.findUnique({ where: { phone } });
  let isNewUser = false;
  if (purpose === 'login') {
    if (!user) return res.status(404).json(NOT_REGISTERED);
  } else {
    if (user) return res.status(409).json(ALREADY_REGISTERED);
    try {
      user = await prisma.user.create({ data: { phone, name: phone } });
    } catch (err) {
      // Two concurrent register verifies for the same number — the unique phone
      // constraint lets exactly one through.
      if (err && err.code === 'P2002') return res.status(409).json(ALREADY_REGISTERED);
      throw err;
    }
    isNewUser = true;
  }

  const token = signToken(user.id);
  return res.json({ access_token: token, user: { id: user.id, phone: user.phone, name: user.name }, isNewUser });
});

module.exports = router;

// --- /v1/me — separate router, mounted at /v1/me (not under /auth) ---
const meRouter = asyncRouter();

// Same validate-before-disk pattern as routes/products.js's POST /:id/image.
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_MIME = new Set(['image/jpeg', 'image/png']);
const AVATAR_UPLOAD_ROOT = path.join(__dirname, '..', '..', 'uploads', 'avatars');

const uploadAvatar = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_AVATAR_BYTES, files: 1 },
});

// GET /v1/me — requireAuthAllowSuspended, not requireAuth: a suspended account still needs
// this to know *why* it's locked out (mobile decides which stack to render from `status`).
meRouter.get('/', requireAuthAllowSuspended, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    include: {
      vendorOwnerships: { include: { vendor: { include: { shop: true } } } },
      shopStaffAssignments: { where: { status: 'active' }, include: { shop: true } },
    },
  });
  if (!user) return res.status(404).json({ error: 'USER_NOT_FOUND' });

  return res.json({
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    avatar_url: user.avatarUrl,
    status: user.status,
    suspended_reason: user.suspendedReason,
    suspended_at: user.suspendedAt,
    roles: {
      // verificationStatus/hasShop added so ProfileScreen can show an accurate status
      // label (pending review vs. approved-but-no-shop-yet) without a second request —
      // ModeContext's canVendor still comes from shopStaff below, this is display-only.
      vendorOwner: user.vendorOwnerships.map((o) => ({
        vendorId: o.vendorId,
        vendorName: o.vendor.name,
        verificationStatus: o.vendor.verificationStatus,
        hasShop: Boolean(o.vendor.shop),
      })),
      shopStaff: user.shopStaffAssignments.map((a) => ({ shopId: a.shopId, role: a.role })),
    },
  });
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// PATCH /v1/me — { name?, email? } — phone is the fixed login identity, not editable here
// Stays on requireAuth: editing a profile is not part of the appeal channel.
meRouter.patch('/', requireAuth, async (req, res) => {
  const { name, email } = req.body || {};
  const data = {};
  if (typeof name === 'string' && name.trim()) data.name = name.trim();
  if (typeof email === 'string') {
    const trimmed = email.trim();
    if (trimmed && !EMAIL_RE.test(trimmed)) return res.status(400).json({ error: 'INVALID_EMAIL' });
    data.email = trimmed || null;
  }

  const user = await prisma.user.update({ where: { id: req.userId }, data });
  return res.json({ id: user.id, name: user.name, phone: user.phone, email: user.email, avatar_url: user.avatarUrl });
});

// POST /v1/me/avatar — multipart, single file, replaces whatever was there
meRouter.post('/avatar', requireAuth, uploadAvatar.single('image'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'NO_FILE' });
  if (!ALLOWED_AVATAR_MIME.has(file.mimetype)) return res.status(400).json({ error: 'INVALID_FILE_TYPE' });
  if (file.size > MAX_AVATAR_BYTES) return res.status(400).json({ error: 'FILE_TOO_LARGE' });

  const userDir = path.join(AVATAR_UPLOAD_ROOT, req.userId);
  fs.mkdirSync(userDir, { recursive: true });

  const ext = file.mimetype === 'image/png' ? '.png' : '.jpg';
  const filename = `${crypto.randomUUID()}${ext}`; // never the client's filename
  const absolutePath = path.join(userDir, filename);
  fs.writeFileSync(absolutePath, file.buffer);

  const previous = (await prisma.user.findUnique({ where: { id: req.userId }, select: { avatarUrl: true } }))?.avatarUrl;
  try {
    const updated = await prisma.user.update({
      where: { id: req.userId },
      data: { avatarUrl: `/uploads/avatars/${req.userId}/${filename}` },
    });
    // Only now is the old file unreachable — drop it after the row points elsewhere.
    if (previous) {
      fs.unlink(path.join(__dirname, '..', '..', previous.replace(/^\//, '')), () => {});
    }
    return res.status(201).json({ id: updated.id, name: updated.name, phone: updated.phone, email: updated.email, avatar_url: updated.avatarUrl });
  } catch (err) {
    fs.unlink(absolutePath, () => {}); // put the disk back; the row never moved
    throw err; // asyncRouter hands this to the error handler in app.js
  }
});

module.exports.meRouter = meRouter;
