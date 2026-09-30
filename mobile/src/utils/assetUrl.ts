import { API_BASE_URL } from '../api/config';

/**
 * The backend returns `imageUrl`/`thumbnail_url` as root-relative paths
 * (`/uploads/events/{eventId}/{filename}` — see backend/src/routes/events.js), so the
 * host has to be prepended before an <Image> can load them.
 *
 * Four screens each built that string by hand, which meant `API_BASE_URL` could never
 * gain a `/v1` suffix without silently breaking every image at once. Stripping it here
 * keeps that decision in one place.
 */
const ASSET_BASE_URL = API_BASE_URL.replace(/\/v1\/?$/, '');

export function resolveAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  // http(s) — in case assets ever move to a CDN. file:/data: — a locally-picked image not
  // uploaded yet (e.g. EventFormScreen's live preview, before the create request fires).
  if (/^(https?|file|data):/i.test(path)) return path;
  return `${ASSET_BASE_URL}${path}`;
}
