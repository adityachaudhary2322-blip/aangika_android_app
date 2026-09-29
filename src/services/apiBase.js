/**
 * Base URL of Aangika's API Worker (server/: Sarvam proxy + community sign
 * dictionary), built in at build time. Not a secret. Empty = not configured:
 * features that need it say so and the app works as before.
 *
 * VITE_API_URL is the name; VITE_SARVAM_PROXY_URL (the earlier name) still works.
 */
let override = null;

export function apiBase() {
  if (override !== null) return override;
  const env = import.meta.env || {};
  return String(env.VITE_API_URL || env.VITE_SARVAM_PROXY_URL || '').replace(/\/+$/, '');
}

/** Tests only. */
export function _setApiBaseForTests(url) { override = url === undefined ? null : String(url); }

export default apiBase;
