const { asyncRouter } = require('../lib/asyncRouter');
const bcrypt = require('bcryptjs');
const prisma = require('../services/prismaClient');
const { requireAdminAuth, requireSuperAdmin } = require('../middleware/adminAuth');

const router = asyncRouter(); // mounted at /v1/superadmin/admins
router.use(requireAdminAuth, requireSuperAdmin);

const PHONE_RE = /^0\d{9}$/;

// POST /v1/superadmin/admins — { username, password, phone, role }
router.post('/', async (req, res) => {
  const { username, password, phone, role } = req.body || {};
  if (typeof username !== 'string' || !username.trim()) return res.status(400).json({ error: 'INVALID_USERNAME' });
  if (typeof password !== 'string' || password.length < 8) return res.status(400).json({ error: 'PASSWORD_TOO_SHORT' });
  if (!PHONE_RE.test(phone || '')) return res.status(400).json({ error: 'INVALID_PHONE' });
  if (!['admin', 'super_admin'].includes(role)) return res.status(400).json({ error: 'INVALID_ROLE' });

  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const admin = await prisma.adminAccount.create({
      data: { username: username.trim(), passwordHash, phone, role, createdBy: req.adminId },
    });
    return res.status(201).json({ id: admin.id, username: admin.username, role: admin.role, status: admin.status });
  } catch (err) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'USERNAME_OR_PHONE_TAKEN' });
    console.error(err);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
});

// GET /v1/superadmin/admins
router.get('/', async (req, res) => {
  const admins = await prisma.adminAccount.findMany({
    select: { id: true, username: true, role: true, status: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  return res.json(admins);
});

// PATCH /v1/superadmin/admins/:id/disable
router.patch('/:id/disable', async (req, res) => {
  if (req.params.id === req.adminId) {
    return res.status(400).json({ error: 'CANNOT_DISABLE_SELF' });
  }
  const admin = await prisma.adminAccount.update({ where: { id: req.params.id }, data: { status: 'disabled' } });
  return res.json({ id: admin.id, status: admin.status });
});

// PATCH /v1/superadmin/admins/:id/password — { newPassword }
// Own-password change goes through PATCH /v1/admin/me/password instead (requires
// currentPassword), so this rejects super_admin targets unconditionally — including self.
router.patch('/:id/password', async (req, res) => {
  const { newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'PASSWORD_TOO_SHORT' });
  }

  const target = await prisma.adminAccount.findUnique({ where: { id: req.params.id } });
  if (!target) return res.status(404).json({ error: 'NOT_FOUND' });
  if (target.role === 'super_admin') {
    return res.status(403).json({ error: 'CANNOT_CHANGE_SUPERADMIN_PASSWORD' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.adminAccount.update({ where: { id: target.id }, data: { passwordHash } });
  return res.json({ ok: true });
});

module.exports = router;
