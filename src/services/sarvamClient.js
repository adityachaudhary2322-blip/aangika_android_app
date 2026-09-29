/**
 * Every Sarvam request goes through here, so users do not need a key.
 *
 *   1. The user's own key (Settings), if they entered one: direct to
 *      api.sarvam.ai, exactly as before.
 *   2. Otherwise the hosted proxy (VITE_SARVAM_PROXY_URL, see proxy/sarvam):
 *      it holds the project's key on the server and adds it there. The key is
 *      never in the website bundle or the APK.
 *   3. Neither: Sarvam is unavailable and callers fall back (offline rules,
 *      the device voice), as they always have.
 */

const API = 'https://api.sarvam.ai';
const PROXY = String(import.meta.env?.VITE_SARVAM_PROXY_URL || '').replace(/\/+$/, '');

export function personalKey() {
  try { return localStorage.getItem('isl.sarvamKey') || ''; } catch { return ''; }
}

/** A hosted proxy is built into this app. */
export const isHosted = () => Boolean(PROXY);

/** Sarvam can be used right now (own key or hosted), network permitting. */
export const hasSarvam = () => Boolean(personalKey() || PROXY);

/** Which route a request takes: 'own key' | 'hosted' | null. */
export const sarvamRoute = () => (personalKey() ? 'own key' : PROXY ? 'hosted' : null);

/**
 * fetch() for a Sarvam path ('/text-to-speech', '/translate',
 * '/v1/chat/completions', '/speech-to-text'). Throws when no route exists.
 */
export function sarvamFetch(path, init = {}) {
  const key = personalKey();
  if (key) {
    return fetch(API + path, { ...init, headers: { ...(init.headers || {}), 'api-subscription-key': key } });
  }
  if (PROXY) return fetch(PROXY + path, init);
  return Promise.reject(new Error('Sarvam is not available: no key and no hosted service in this build.'));
}

export default { personalKey, isHosted, hasSarvam, sarvamRoute, sarvamFetch };
