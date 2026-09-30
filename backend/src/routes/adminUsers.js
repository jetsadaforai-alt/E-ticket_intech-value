const { asyncRouter } = require('../lib/asyncRouter');
const prisma = require('../services/prismaClient');
const { requireAdminAuth } = require('../middleware/adminAuth');
const { cancelTicketsHeldBy } = require('../services/moderation');

// Mounted at /v1/admin/users. Mirrors the shape of the event-moderation admin router in
// routes/events.js (adminRouter) — same requireAdminAuth (admin + super_admin, not
// super-admin-only: this is day-to-day tenant/user oversight, not platform config), same
// REASON_REQUIRED / conditional-updateMany / 409 NOT_ACTIVE pattern.
const adminRouter = asyncRouter();
adminRouter.use(requireAdminAuth);

// GET /v1/admin/users?status=active|suspended&q=<name or phone substring>
adminRouter.get('/', async (req, res) => {
  const { status, q } = req.query;
  const where = {};
  if (status) where.status = String(status);
  if (typeof q === 'string' && q.trim()) {
    const term = q.trim();
    where.OR = [
      { name: { contains: term, mode: 'insensitive' } },
      { phone: { contains: term } },
    ];
  }

  const users = await prisma.user.findMany({
    where,
    include: {
      _count: { select: { heldTickets: true, eventReviews: true, vendorOwnerships: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });

  return res.json(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      phone: u.phone,
      status: u.status,
      suspended_at: u.suspendedAt,
      created_at: u.createdAt,
      ticket_count: u._count.heldTickets,
      review_count: u._count.eventReviews,
      owns_vendor: u._count.vendorOwnerships > 0,
    }))
  );
});

// GET /v1/admin/users/:id — everything needed to judge whether the account is behaving
adminRouter.get('/:id', async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      vendorOwnerships: { include: { vendor: { select: { id: true, name: true } } } },
      supportTicketsRaised: { select: { id: true, category: true, status: true, createdAt: true } },
      suspendedByAdmin: { select: { username: true } },
    },
  });
  if (!user) return res.status(404).json({ error: 'NOT_FOUND' });

  const [ticketGroups, reviews] = await Promise.all([
    prisma.ticket.groupBy({ by: ['status'], where: { currentHolderUserId: user.id }, _count: true }),
    prisma.eventReview.findMany({
      where: { userId: user.id },
      select: { id: true, rating: true, comment: true, createdAt: true, event: { select: { id: true, title: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  return res.json({
    id: user.id,
    name: user.name,
    phone: user.phone,
    email: user.email,
    status: user.status,
    created_at: user.createdAt,
    suspended_at: user.suspendedAt,
    suspended_reason: user.suspendedReason,
    suspended_by: user.suspendedByAdmin?.username ?? null,
    vendors_owned: user.vendorOwnerships.map((o) => ({ id: o.vendor.id, name: o.vendor.name })),
    support_tickets: user.supportTicketsRaised,
    tickets: Object.fromEntries(ticketGroups.map((g) => [g.status, g._count])),
    reviews: reviews.map((r) => ({
      id: r.id,
      rating: r.rating,
      comment: r.comment,
      created_at: r.createdAt,
      event_id: r.event.id,
      event_title: r.event.title,
    })),
  });
});

// POST /v1/admin/users/:id/suspend — { reason } · reversible
adminRouter.post('/:id/suspend', async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body || {};
  if (typeof reason !== 'string' || !reason.trim()) {
    return res.status(400).json({ error: 'REASON_REQUIRED' });
  }
  const trimmedReason = reason.trim();

  const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'NOT_FOUND' });

  const result = await prisma.$transaction(async (tx) => {
    // Conditional, so a double submit is a no-op rather than a second round of ticket
    // cancellations below.
    const claimed = await tx.user.updateMany({
      where: { id, status: 'active' },
      data: {
        status: 'suspended',
        suspendedAt: new Date(),
        suspendedReason: trimmedReason,
        suspendedByAdminId: req.adminId,
      },
    });
    if (claimed.count === 0) return null;

    const { ticketsCancelled } = await cancelTicketsHeldBy(tx, id);

    // requireAuthAllowSuspended is what lets this land in a list the account can still
    // read — GET /v1/notifications does not require an active account
    // (middleware/auth.js).
    await tx.notification.create({
      data: { userId: id, type: 'account_suspended', payload: { reason: trimmedReason } },
    });

    return { ticketsCancelled };
  });

  if (!result) return res.status(409).json({ error: 'NOT_ACTIVE' });
  return res.json({ id, status: 'suspended', tickets_cancelled: result.ticketsCancelled });
});

// POST /v1/admin/users/:id/unsuspend — reverses the login lockout only. Tickets already
// cancelled by the suspension do not come back — the same
// permanence an event ban leaves behind.
adminRouter.post('/:id/unsuspend', async (req, res) => {
  const { id } = req.params;
  const exists = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return res.status(404).json({ error: 'NOT_FOUND' });

  const claimed = await prisma.user.updateMany({
    where: { id, status: 'suspended' },
    data: { status: 'active', suspendedAt: null, suspendedReason: null, suspendedByAdminId: null },
  });
  if (claimed.count === 0) return res.status(409).json({ error: 'NOT_SUSPENDED' });

  await prisma.notification.create({
    data: { userId: id, type: 'account_restored', payload: {} },
  });

  return res.json({ id, status: 'active' });
});

module.exports = adminRouter;
