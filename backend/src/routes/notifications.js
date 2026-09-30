const { asyncRouter } = require('../lib/asyncRouter');
const prisma = require('../services/prismaClient');
// requireAuthAllowSuspended, not requireAuth — a suspended account still needs to see the
// notification that explains why (see middleware/auth.js for the full list of routers
// this applies to).
const { requireAuthAllowSuspended } = require('../middleware/auth');

const router = asyncRouter(); // mounted at /v1/notifications

// GET /v1/notifications
router.get('/', requireAuthAllowSuspended, async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'desc' },
  });
  return res.json(notifications);
});

// PATCH /v1/notifications/:id/read
router.patch('/:id/read', requireAuthAllowSuspended, async (req, res) => {
  const notification = await prisma.notification.findUnique({ where: { id: req.params.id } });
  if (!notification || notification.userId !== req.userId) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const updated = await prisma.notification.update({
    where: { id: req.params.id },
    data: { readAt: notification.readAt ?? new Date() },
  });
  return res.json(updated);
});

module.exports = router;
