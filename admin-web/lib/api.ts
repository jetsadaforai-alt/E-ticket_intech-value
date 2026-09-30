// NEXT_PUBLIC_* vars are inlined into the client bundle at `next build` time (not
// container start time) — see admin-web/Dockerfile's ARG/ENV and docker-compose.yml's
// admin-web `build.args`, both of which feed this from the same BACKEND_PUBLIC_URL
// the mobile app already uses. Falls back to localhost for `npm run dev` outside Docker.
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';

const TOKEN_KEY = 'eticket_admin_token';
export const PROFILE_KEY = 'eticket_admin_profile';

// Fired when the backend rejects our token. AuthContext listens for it and drops
// the in-memory session — api.ts can't call useRouter(), so an event is the seam.
export const SESSION_EXPIRED_EVENT = 'eticket:session-expired';

export function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (typeof window === 'undefined') return;
  if (token) window.localStorage.setItem(TOKEN_KEY, token);
  else window.localStorage.removeItem(TOKEN_KEY);
}

export function clearSession() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(PROFILE_KEY);
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    const message = typeof body === 'object' && body && 'error' in body ? String((body as { error: unknown }).error) : 'API_ERROR';
    super(message);
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean;
};

export async function apiRequest<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true } = opts;
  const headers: Record<string, string> = {};

  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let requestBody: string | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: requestBody });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    // The admin JWT only lives 8h, and AuthContext restores the session from
    // localStorage without validating it — so a stale token used to reach here as
    // INVALID_OR_EXPIRED_TOKEN on every page. Drop the dead session centrally so
    // the user lands back on /login instead of staring at a crashed page.
    if (res.status === 401 && auth) {
      clearSession();
      window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
    }
    throw new ApiError(res.status, data);
  }
  return data as T;
}
