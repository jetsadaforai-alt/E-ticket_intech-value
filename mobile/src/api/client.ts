import { API_BASE_URL } from './config';
import { notifyAccountSuspended } from './accountEvents';

// Token storage moved to ../storage/token (SecureStore, with an AsyncStorage fallback).
// Re-exported from here so AuthContext and anything else keeps importing it from the
// same place it always did.
export { getToken, setToken } from '../storage/token';
import { getToken } from '../storage/token';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(typeof body === 'object' && body && 'error' in body ? String((body as any).error) : 'API_ERROR');
    this.status = status;
    this.body = body;
  }
}

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  auth?: boolean; // attach Authorization header (default true)
  formData?: FormData;
};

export async function apiRequest<T = unknown>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, auth = true, formData } = opts;
  const headers: Record<string, string> = {};

  if (auth) {
    const token = await getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let requestBody: BodyInit | undefined;
  if (formData) {
    requestBody = formData; // let fetch set the multipart Content-Type/boundary itself
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    requestBody = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE_URL}${path}`, { method, headers, body: requestBody });

  const text = await res.text();
  // Not every failure comes back as JSON — an unhandled middleware error (multer,
  // for one) produces Express's default HTML page. Parsing that blindly threw a
  // SyntaxError that replaced the real status/body with a useless generic message.
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text.slice(0, 200) };
    }
  }

  if (!res.ok) {
    // Backend rejects every request from a suspended account with this shape
    // (middleware/auth.js) — but `me` in AuthContext only gets refreshed on cold
    // start/login/foreground. Poke it here too so a ban lands immediately on the
    // very next request instead of only after the app is backgrounded and reopened.
    if (res.status === 403 && typeof data === 'object' && data && (data as any).error === 'ACCOUNT_SUSPENDED') {
      notifyAccountSuspended();
    }
    throw new ApiError(res.status, data);
  }
  return data as T;
}
