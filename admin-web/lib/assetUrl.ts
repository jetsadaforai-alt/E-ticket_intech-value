import { API_BASE_URL } from './api';

/**
 * The backend returns document/image URLs as root-relative paths
 * (`/uploads/vendors/{vendorId}/{filename}` — see backend/src/routes/vendors.js), so the
 * host has to be prepended before an <img>/<a> can load them. Mirrors
 * mobile/src/utils/assetUrl.ts — admin-web's API_BASE_URL has no `/v1` suffix to strip.
 */
export function resolveAssetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_BASE_URL}${path}`;
}
