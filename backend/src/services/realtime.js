const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const prisma = require('./prismaClient');

// Same secret as services/jwt.js / services/adminJwt.js — a user token and an admin
// token are both just JWTs signed with this, distinguished by the `type: 'admin'`
// claim (see adminJwt.js). Verifying here directly (rather than importing verifyToken/
// verifyAdminToken) avoids guessing which one to try first.
const SECRET = process.env.JWT_SECRET || 'change-me-in-dev';

let io = null;

/**
 * Socket events are a "something changed, go refetch" signal only — no message payload
 * is carried over the socket itself. This keeps the socket layer thin: every screen's
 * existing REST `load()` (already tested, already handles auth/shape) stays the single
 * source of truth for what's actually shown, the socket just triggers it instantly
 * instead of waiting for the next poll tick.
 */
function initRealtime(server) {
  io = new Server(server, { cors: { origin: '*' } });

  io.use((socket, next) => {
    try {
      const payload = jwt.verify(socket.handshake.auth?.token || '', SECRET);
      if (payload.type === 'admin') {
        socket.data.adminId = payload.sub;
      } else {
        socket.data.userId = payload.sub;
      }
      next();
    } catch {
      next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    socket.on('join-conversation', async (conversationId, ack) => {
      try {
        if (!socket.data.userId) return ack?.({ error: 'FORBIDDEN' });
        const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });
        if (!conversation) return ack?.({ error: 'NOT_FOUND' });
        // Mirrors routes/conversations.js's resolveSide exactly — same rule, not a copy.
        const { resolveSide } = require('../routes/conversations');
        const side = await resolveSide(socket.data.userId, conversation);
        if (!side) return ack?.({ error: 'FORBIDDEN' });
        socket.join(`conversation:${conversationId}`);
        ack?.({ ok: true });
      } catch {
        ack?.({ error: 'INTERNAL_ERROR' });
      }
    });

    socket.on('join-ticket', async (ticketId, ack) => {
      try {
        // Admins can view any ticket (same rule as GET /v1/admin/support-tickets/:id);
        // a user may only join their own (same rule as GET /v1/support-tickets/:id).
        if (socket.data.adminId) {
          socket.join(`ticket:${ticketId}`);
          return ack?.({ ok: true });
        }
        const ticket = await prisma.supportTicket.findUnique({ where: { id: ticketId } });
        if (!ticket) return ack?.({ error: 'NOT_FOUND' });
        if (ticket.raisedByUserId !== socket.data.userId) return ack?.({ error: 'FORBIDDEN' });
        socket.join(`ticket:${ticketId}`);
        ack?.({ ok: true });
      } catch {
        ack?.({ error: 'INTERNAL_ERROR' });
      }
    });
  });
}

// Returns null rather than throwing when uninitialized — route handlers use
// `getIO()?.to(...).emit(...)`, a harmless no-op for tests/scripts that import app.js
// directly without going through index.js's http.createServer + initRealtime.
function getIO() {
  return io;
}

module.exports = { initRealtime, getIO };
