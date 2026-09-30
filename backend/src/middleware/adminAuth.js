const { verifyAdminToken } = require('../services/adminJwt');
const prisma = require('../services/prismaClient');

async function requireAdminAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'UNAUTHORIZED' });
  }

  let payload;
  try {
    payload = verifyAdminToken(token);
  } catch {
    return res.status(401).json({ error: 'INVALID_OR_EXPIRED_TOKEN' });
  }

  const admin = await prisma.adminAccount.findUnique({ where: { id: payload.sub } });
  if (!admin || admin.status !== 'active') {
    return res.status(401).json({ error: 'ADMIN_DISABLED_OR_NOT_FOUND' });
  }

  req.adminId = admin.id;
  req.adminRole = admin.role; // 'admin' | 'super_admin'
  next();
}

function requireSuperAdmin(req, res, next) {
  if (req.adminRole !== 'super_admin') {
    return res.status(403).json({ error: 'SUPER_ADMIN_ONLY' });
  }
  next();
}

module.exports = { requireAdminAuth, requireSuperAdmin };
