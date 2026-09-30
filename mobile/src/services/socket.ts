import { io, type Socket } from 'socket.io-client';
import { API_BASE_URL } from '../api/config';
import { getToken } from '../storage/token';

// Same host as REST calls, stripped the same way assetUrl.ts does — socket.io shares
// the HTTP server/port (see backend/src/index.js), no separate host/port to configure.
const SOCKET_BASE_URL = API_BASE_URL.replace(/\/v1\/?$/, '');

let socket: Socket | null = null;

/**
 * One shared connection for the whole app, created lazily on first use and reused —
 * screens join/leave rooms on it rather than each opening their own socket. Auth token
 * is read fresh every call so a just-logged-in user doesn't reuse a stale (missing)
 * token from before login.
 */
export async function getSocket(): Promise<Socket> {
  const token = await getToken();
  if (socket && socket.auth && (socket.auth as { token?: string }).token === token) {
    if (!socket.connected) socket.connect();
    return socket;
  }
  socket?.disconnect();
  socket = io(SOCKET_BASE_URL, { auth: { token }, transports: ['websocket'] });
  return socket;
}
