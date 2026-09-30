import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL, getToken } from './api';

let socket: Socket | null = null;

/**
 * One shared connection per browser tab, created lazily and reused across pages —
 * mirrors mobile/src/services/socket.ts. API_BASE_URL already has no /v1 suffix here
 * (see lib/api.ts), so it's used directly as the socket host — same port as REST,
 * socket.io shares the backend's HTTP server (backend/src/index.js).
 */
export function getSocket(): Socket {
  const token = getToken();
  if (socket && (socket.auth as { token?: string | null }).token === token) {
    if (!socket.connected) socket.connect();
    return socket;
  }
  socket?.disconnect();
  socket = io(API_BASE_URL, { auth: { token }, transports: ['websocket'] });
  return socket;
}
