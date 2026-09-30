const { asyncRouter } = require('../lib/asyncRouter');
const prisma = require('../services/prismaClient');
// requireAuthAllowSuspended, not requireAuth — this is the user-facing appeal channel, so
// a suspended account must still be able to reach it (see middleware/auth.js).
const { requireAuthAllowSuspended } = require('../middleware/auth');
const { requireAdminAuth } = require('../middleware/adminAuth');
const { getIO } = require('../services/realtime');

const router = asyncRouter();       // mounted at /v1/admin/support-tickets — admin-only
const userRouter = asyncRouter();   // mounted at /v1/support-tickets — regular users raise tickets here

router.use(requireAdminAuth);

const CATEGORIES = new Set(['redemption_dispute', 'billing_issue', 'fraud_report', 'other']);

// POST /v1/support-tickets — { category, message } (User-facing: raise a ticket)
userRouter.post('/', requireAuthAllowSuspended, async (req, res) => {
  const { category, message } = req.body || {};
  if (!CATEGORIES.has(category)) return res.status(400).json({ error: 'INVALID_CATEGORY' });
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'MESSAGE_REQUIRED' });

  const ticket = await prisma.supportTicket.create({
    data: {
      raisedByUserId: req.userId,
      category,
      messages: { create: { senderType: 'user', senderId: req.userId, message: message.trim() } },
    },
    include: { messages: true },
  });
  getIO()?.emit('support-ticket-changed');
  return res.status(201).json(ticket);
});

// GET /v1/support-tickets — the caller's own tickets
userRouter.get('/', requireAuthAllowSuspended, async (req, res) => {
  const tickets = await prisma.supportTicket.findMany({
    where: { raisedByUserId: req.userId },
    include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 } },
    orderBy: { createdAt: 'desc' },
  });

  return res.json(
    tickets.map((t) => ({
      id: t.id,
      category: t.category,
      status: t.status,
      last_message: t.messages[0]?.message ?? null,
      created_at: t.createdAt,
    }))
  );
});

// GET /v1/support-tickets/:id — full thread, own ticket only
userRouter.get('/:id', requireAuthAllowSuspended, async (req, res) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: req.params.id },
    include: { messages: { orderBy: { createdAt: 'asc' } }, assignedAdmin: { select: { id: true, username: true } } },
  });
  if (!ticket) return res.status(404).json({ error: 'NOT_FOUND' });
  if (ticket.raisedByUserId !== req.userId) return res.status(403).json({ error: 'FORBIDDEN' });

  // Opening the thread means the user has seen everything in it so far.
  //
  // Deliberately does NOT emit 'changed' here: this GET is itself what a 'changed'
  // handler calls (see mobile SupportThreadScreen / admin-web support/[id] — both
  // socket-triggered reloads land here). Emitting on every GET would mean the client
  // that just reloaded because of an event immediately re-triggers that same event on
  // itself via the room it's joined to — an infinite refetch loop. Only the message/
  // PATCH endpoints below emit; a read with no accompanying reply is picked up by the
  // 60s polling fallback instead of live.
  const userLastReadAt = new Date();
  await prisma.supportTicket.update({ where: { id: ticket.id }, data: { userLastReadAt } });

  return res.json({
    id: ticket.id,
    category: ticket.category,
    status: ticket.status,
    resolution_note: ticket.resolutionNote,
    created_at: ticket.createdAt,
    assigned_admin: ticket.assignedAdmin ? { id: ticket.assignedAdmin.id, username: ticket.assignedAdmin.username } : null,
    user_last_read_at: userLastReadAt,
    admin_last_read_at: ticket.adminLastReadAt,
    messages: ticket.messages.map((m) => ({
      id: m.id,
      sender_type: m.senderType,
      message: m.message,
      created_at: m.createdAt,
    })),
  });
});

// POST /v1/support-tickets/:id/messages — { message } (the user's side of the reply
// loop; the admin's equivalent is the `message` field on PATCH .../:id below)
userRouter.post('/:id/messages', requireAuthAllowSuspended, async (req, res) => {
  const { message } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'MESSAGE_REQUIRED' });

  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ error: 'NOT_FOUND' });
  if (ticket.raisedByUserId !== req.userId) return res.status(403).json({ error: 'FORBIDDEN' });
  if (ticket.status === 'closed') return res.status(409).json({ error: 'TICKET_CLOSED' });

  const created = await prisma.supportMessage.create({
    data: { supportTicketId: ticket.id, senderType: 'user', senderId: req.userId, message: message.trim() },
  });
  await prisma.supportTicket.update({ where: { id: ticket.id }, data: { userLastReadAt: new Date() } });

  getIO()?.to(`ticket:${ticket.id}`).emit('changed');
  getIO()?.emit('support-ticket-changed');

  return res.status(201).json({
    id: created.id,
    sender_type: created.senderType,
    message: created.message,
    created_at: created.createdAt,
  });
});

// GET /v1/admin/support-tickets?status=open
router.get('/', async (req, res) => {
  const { status } = req.query;
  const where = status ? { status: String(status) } : {};
  const tickets = await prisma.supportTicket.findMany({
    where,
    include: {
      raisedBy: { select: { id: true, name: true, phone: true } },
      assignedAdmin: { select: { id: true, username: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  return res.json(tickets);
});

// GET /v1/admin/support-tickets/:id — full thread
router.get('/:id', async (req, res) => {
  const ticket = await prisma.supportTicket.findUnique({
    where: { id: req.params.id },
    include: {
      raisedBy: true,
      messages: { orderBy: { createdAt: 'asc' } },
      assignedAdmin: { select: { id: true, username: true } },
    },
  });
  if (!ticket) return res.status(404).json({ error: 'NOT_FOUND' });

  // Opening the thread means this admin has seen everything in it so far. Any admin may
  // view (and this marks read) — the claim restriction below only gates *replying*.
  // No 'changed' emit here either — same self-loop reasoning as the user-side GET above.
  const adminLastReadAt = new Date();
  await prisma.supportTicket.update({ where: { id: ticket.id }, data: { adminLastReadAt } });

  return res.json({ ...ticket, adminLastReadAt });
});

// PATCH /v1/admin/support-tickets/:id — { status?, message?, resolution_note? }
router.patch('/:id', async (req, res) => {
  const { status, message, resolution_note } = req.body || {};
  const ticket = await prisma.supportTicket.findUnique({ where: { id: req.params.id } });
  if (!ticket) return res.status(404).json({ error: 'NOT_FOUND' });

  // Once closed, nobody replies further — status/resolution_note-only edits (e.g.
  // correcting a note after the fact) still go through, only a new message is blocked.
  if (ticket.status === 'closed' && typeof message === 'string' && message.trim()) {
    return res.status(409).json({ error: 'TICKET_CLOSED' });
  }

  // Exclusive claim: first admin to touch an unclaimed ticket owns it; anyone else is
  // blocked outright rather than silently stealing the assignment on their own PATCH.
  if (ticket.assignedAdminId && ticket.assignedAdminId !== req.adminId) {
    return res.status(403).json({ error: 'TICKET_CLAIMED_BY_OTHER_ADMIN' });
  }

  const data = ticket.assignedAdminId ? {} : { assignedAdminId: req.adminId };
  if (status) {
    if (!['open', 'investigating', 'resolved', 'closed'].includes(status)) {
      return res.status(400).json({ error: 'INVALID_STATUS' });
    }
    data.status = status;
    if (status === 'resolved' || status === 'closed') data.resolvedAt = new Date();
  }
  if (typeof resolution_note === 'string') data.resolutionNote = resolution_note;

  const updated = await prisma.$transaction(async (tx) => {
    if (typeof message === 'string' && message.trim()) {
      await tx.supportMessage.create({
        data: { supportTicketId: ticket.id, senderType: 'admin', senderId: req.adminId, message: message.trim() },
      });
      data.adminLastReadAt = new Date(); // sending counts as having read the thread
    }
    return tx.supportTicket.update({
      where: { id: ticket.id },
      data,
      include: { assignedAdmin: { select: { id: true, username: true } } },
    });
  });

  getIO()?.to(`ticket:${ticket.id}`).emit('changed');
  getIO()?.emit('support-ticket-changed');

  return res.json(updated);
});

module.exports = router;
module.exports.userRouter = userRouter;
