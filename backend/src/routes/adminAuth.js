const { asyncRouter } = require('../lib/asyncRouter');
const bcrypt = require('bcryptjs');
const prisma = require('../services/prismaClient');
const { requestOtp, verifyOtp } = require('../services/otp');
const { signAdminToken } = require('../services/adminJwt');

const router = asyncRouter(); // mounted at /v1/admin/auth

// Namespacing the OTP redis keys so an admin's login attempt can never collide
// with a regular User's OTP flow even if they happen to share a phone number.
const otpKey = (phone) => `admin:${phone}`;

// POST /v1/admin/auth/login — { username, password }
router.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }

  const admin = await prisma.adminAccount.findUnique({ where: { username } });
  // Same "invalid credentials" response whether the username doesn't exist or the
  // password is wrong — don't let this endpoint be used to enumerate admin usernames.
  if (!admin || admin.status !== 'active') {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }
  const passwordOk = await bcrypt.compare(password, admin.passwordHash);
  if (!passwordOk) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }

  try {
    const { devCode } = await requestOtp(otpKey(admin.phone), admin.phone);
    return res.json({ message: 'OTP sent', username, ...(devCode ? { devCode } : {}) });
  } catch (err) {
    if (err.code === 'COOLDOWN_ACTIVE') return res.status(429).json({ error: 'COOLDOWN_ACTIVE' });
    if (err.code === 'LOCKED_OUT') return res.status(429).json({ error: 'LOCKED_OUT' });
    console.error(err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// POST /v1/admin/auth/otp/verify — { username, code }
router.post('/otp/verify', async (req, res) => {
  const { username, code } = req.body || {};
  if (typeof username !== 'string' || typeof code !== 'string') {
    return res.status(400).json({ error: 'INVALID_INPUT' });
  }

  const admin = await prisma.adminAccount.findUnique({ where: { username } });
  if (!admin || admin.status !== 'active') {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }

  try {
    await verifyOtp(otpKey(admin.phone), code);
  } catch (err) {
    if (err.code === 'LOCKED_OUT') return res.status(429).json({ error: 'LOCKED_OUT' });
    if (err.code === 'INVALID_CODE') return res.status(400).json({ error: 'INVALID_CODE' });
    if (err.code === 'OTP_EXPIRED_OR_NOT_REQUESTED') return res.status(400).json({ error: 'OTP_EXPIRED_OR_NOT_REQUESTED' });
    console.error(err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }

  const token = signAdminToken(admin.id);
  return res.json({ access_token: token, admin: { id: admin.id, username: admin.username, role: admin.role } });
});

module.exports = router;
