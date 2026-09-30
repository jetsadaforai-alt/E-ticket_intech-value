const { asyncRouter } = require('../lib/asyncRouter');
const prisma = require('../services/prismaClient');
const { requireAuth } = require('../middleware/auth');
const { isActiveShopMember } = require('../services/shopAuth');
const { getIO } = require('../services/realtime');

const router = asyncRouter();     // mounted at /v1/conversations
const shopRouter = asyncRouter(); // mounted at /v1/shops — shop-scoped chat routes

const MAX_MESSAGE_LENGTH = 2000;

/**
 * Which side of the conversation the caller is on, or null if neither.
 * Staff count as the shop side (isActiveShopMember covers owner/manager/staff) —
 * re-checked on every call, so a removed staff member loses chat access immediately.
 */
async function resolveSide(userId, conversation) {
  if (conversation.userId === userId) return 'user';
  if (await isActiveShopMember(userId, conversation.shopId)) return 'shop';
  return null;
}

function unreadWhere(conversationId, side, conversation) {
  // Each side only ever has unread messages written by the other side.
  const marker = side === 'user' ? conversation.userLastReadAt : conversation.shopLastReadAt;
  return {
    conversationId,
    senderType: side === 'user' ? 'shop' : 'user',
    ...(marker ? { createdAt: { gt: marker } } : {}),
  };
}

// GET /v1/conversations — the customer's own rooms
router.get('/', requireAuth, async (req, res) => {
  const conversations = await prisma.conversation.findMany({
    where: { userId: req.userId },
    include: {
      shop: { select: { id: true, name: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { lastMessageAt: 'desc' },
  });

  const withUnread = await Promise.all(
    conversations.map(async (c) => ({
      id: c.id,
      shop_id: c.shop.id,
      shop_name: c.shop.name,
      last_message: c.messages[0]?.message ?? null,
      last_message_at: c.lastMessageAt,
      unread_count: await prisma.chatMessage.count({ where: unreadWhere(c.id, 'user', c) }),
    }))
  );

  return res.json(withUnread);
});

// POST /v1/shops/:shopId/conversations — customer opens (or re-opens) their room
// Idempotent: the [shopId, userId] unique constraint makes this a get-or-create.
shopRouter.post('/:shopId/conversations', requireAuth, async (req, res) => {
  const { shopId } = req.params;

  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop) return res.status(404).json({ error: 'SHOP_NOT_FOUND' });

  // A shop member messaging their own shop would sit on both sides of the thread.
  if (await isActiveShopMember(req.userId, shopId)) {
    return res.status(400).json({ error: 'CANNOT_CHAT_WITH_OWN_SHOP' });
  }

  const conversation = await prisma.conversation.upsert({
    where: { shopId_userId: { shopId, userId: req.userId } },
    update: {},
    create: { shopId, userId: req.userId },
  });

  return res.json({ id: conversation.id, shop_id: shopId, shop_name: shop.name });
});

// GET /v1/shops/:shopId/conversations — the shop's inbox
shopRouter.get('/:shopId/conversations', requireAuth, async (req, res) => {
  const { shopId } = req.params;

  if (!(await isActiveShopMember(req.userId, shopId))) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const conversations = await prisma.conversation.findMany({
    where: { shopId },
    include: {
      user: { select: { id: true, name: true, phone: true } },
      messages: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
    orderBy: { lastMessageAt: 'desc' },
  });

  const withUnread = await Promise.all(
    conversations.map(async (c) => ({
      id: c.id,
      customer_name: c.user.name,
      customer_phone: c.user.phone,
      last_message: c.messages[0]?.message ?? null,
      last_message_at: c.lastMessageAt,
      unread_count: await prisma.chatMessage.count({ where: unreadWhere(c.id, 'shop', c) }),
    }))
  );

  return res.json(withUnread);
});

// GET /v1/conversations/:id/messages — full thread, either side
router.get('/:id/messages', requireAuth, async (req, res) => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: req.params.id },
    include: { shop: { select: { name: true } }, user: { select: { name: true } } },
  });
  if (!conversation) return res.status(404).json({ error: 'NOT_FOUND' });

  const side = await resolveSide(req.userId, conversation);
  if (!side) return res.status(403).json({ error: 'FORBIDDEN' });

  const messages = await prisma.chatMessage.findMany({
    where: { conversationId: conversation.id },
    orderBy: { createdAt: 'asc' },
  });

  return res.json({
    id: conversation.id,
    // "the other side" from the caller's point of view — the title of the thread
    title: side === 'user' ? conversation.shop.name : conversation.user.name,
    my_side: side,
    // Both markers, not just "the other side's" — cheaper than a per-message read
    // column, and the client already knows my_side so it can pick the right one to
    // compare each message's created_at against for a read/unread indicator.
    user_last_read_at: conversation.userLastReadAt,
    shop_last_read_at: conversation.shopLastReadAt,
    messages: messages.map((m) => ({
      id: m.id,
      sender_type: m.senderType,
      message: m.message,
      created_at: m.createdAt,
    })),
  });
});

// POST /v1/conversations/:id/messages — { message }
router.post('/:id/messages', requireAuth, async (req, res) => {
  const { message } = req.body || {};
  if (typeof message !== 'string' || !message.trim()) return res.status(400).json({ error: 'MESSAGE_REQUIRED' });
  if (message.length > MAX_MESSAGE_LENGTH) return res.status(400).json({ error: 'MESSAGE_TOO_LONG' });

  const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
  if (!conversation) return res.status(404).json({ error: 'NOT_FOUND' });

  const side = await resolveSide(req.userId, conversation);
  if (!side) return res.status(403).json({ error: 'FORBIDDEN' });

  const now = new Date();
  const [created] = await prisma.$transaction([
    prisma.chatMessage.create({
      data: { conversationId: conversation.id, senderType: side, senderId: req.userId, message: message.trim() },
    }),
    // Sending also marks the sender's own side read — they've obviously seen the thread.
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: now, ...(side === 'user' ? { userLastReadAt: now } : { shopLastReadAt: now }) },
    }),
  ]);

  getIO()?.to(`conversation:${conversation.id}`).emit('changed');

  return res.status(201).json({
    id: created.id,
    sender_type: created.senderType,
    message: created.message,
    created_at: created.createdAt,
  });
});

// PATCH /v1/conversations/:id/read — mark the caller's side as caught up
router.patch('/:id/read', requireAuth, async (req, res) => {
  const conversation = await prisma.conversation.findUnique({ where: { id: req.params.id } });
  if (!conversation) return res.status(404).json({ error: 'NOT_FOUND' });

  const side = await resolveSide(req.userId, conversation);
  if (!side) return res.status(403).json({ error: 'FORBIDDEN' });

  const now = new Date();
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: side === 'user' ? { userLastReadAt: now } : { shopLastReadAt: now },
  });

  // Deliberately no 'changed' emit here — ChatRoomScreen's load() calls this same
  // endpoint every time it runs, including when load() itself was triggered by a
  // 'changed' event. Emitting here would make the caller re-trigger the event on its
  // own joined room — an infinite refetch loop. POST /:id/messages below (sending,
  // which also marks the sender's side read) is the only place this emits; a plain
  // read with no accompanying message falls back to the 60s poll instead of live.

  return res.status(204).send();
});

// GET /v1/shops/:shopId/conversations/unread-count — chat tab badge, shop side
shopRouter.get('/:shopId/conversations/unread-count', requireAuth, async (req, res) => {
  const { shopId } = req.params;
  if (!(await isActiveShopMember(req.userId, shopId))) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }

  const conversations = await prisma.conversation.findMany({ where: { shopId } });
  const counts = await Promise.all(
    conversations.map((c) => prisma.chatMessage.count({ where: unreadWhere(c.id, 'shop', c) }))
  );
  return res.json({ unread_count: counts.reduce((a, b) => a + b, 0) });
});

// GET /v1/conversations/unread-count — drives the chat tab badge (customer side)
router.get('/unread-count', requireAuth, async (req, res) => {
  const conversations = await prisma.conversation.findMany({ where: { userId: req.userId } });
  const counts = await Promise.all(
    conversations.map((c) => prisma.chatMessage.count({ where: unreadWhere(c.id, 'user', c) }))
  );
  return res.json({ unread_count: counts.reduce((a, b) => a + b, 0) });
});

module.exports = router;
module.exports.shopRouter = shopRouter;
// Reused by services/realtime.js's join-conversation handler so socket room access
// uses the exact same authorization check as the REST endpoints, not a re-derived copy.
module.exports.resolveSide = resolveSide;
