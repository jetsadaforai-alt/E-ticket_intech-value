const { asyncRouter } = require('../lib/asyncRouter');
const bcrypt = require('bcryptjs');
const prisma = require('../services/prismaClient');
const { requireAdminAuth } = require('../middleware/adminAuth');

const router = asyncRouter(); // mounted at /v1/admin/me
router.use(requireAdminAuth);

// PATCH /v1/admin/me/password — { currentPassword, newPassword }
router.patch('/password', async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 8) {
    return res.status(400).json({ error: 'PASSWORD_TOO_SHORT' });
  }

  const admin = await prisma.adminAccount.findUnique({ where: { id: req.adminId } });
  const ok = await bcrypt.compare(currentPassword || '', admin.passwordHash);
  if (!ok) return res.status(401).json({ error: 'INVALID_CURRENT_PASSWORD' });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.adminAccount.update({ where: { id: req.adminId }, data: { passwordHash } });
  return res.json({ ok: true });
});

module.exports = router;
