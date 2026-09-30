/**
 * The community sign dictionary, on the device side.
 *
 * Developers publish signs they taught (with the developer code, checked by
 * the server: server/dictionary.js); every copy of the app, website and
 * Android alike, downloads them into its sign store (customSigns.applyShared)
 * so every recogniser knows them, offline too.
 *
 * Updates: checked in the background when the app starts or comes online,
 * and on demand from My signs / Word list. The server answers 304 when
 * nothing changed, so a check costs almost nothing.
 *
 * The developer code is only ever held in memory for the current screen and
 * sent to the server over HTTPS; it is never stored on the device.
 */

import { apiBase } from './apiBase.js';
import { applyShared, listSharedSigns, listOwnSigns, init as initSigns } from './customSigns.js';
import { getOverrides, setOverrides } from './builtinOverrides.js';
import { getSharedRules, setSharedRules } from './phraseRules.js';

// Shared grammar rules persist for offline use, and load at start-up.
const RULES_KEY = 'aangika.sharedRules';
try { setSharedRules(JSON.parse(localStorage.getItem(RULES_KEY) || '[]')); } catch { /* none yet */ }

/** The last full dictionary downloaded (for the developer section). */
let lastDict = null;

// ── Developer session: the code lives in memory only, for this page load ──
let devCode = '';
const devListeners = new Set();
export const isUnlocked = () => Boolean(devCode);
export const getDevCode = () => devCode;
export function onDevChange(fn) { devListeners.add(fn); return () => devListeners.delete(fn); }
function setDev(code) { devCode = code; devListeners.forEach((fn) => { try { fn(Boolean(code)); } catch { /* */ } }); }
/** Verify with the server and remember for this session. -> true | false */
export async function unlock(code) {
  const ok = await verifyCode(String(code || '').trim());
  if (ok) setDev(String(code).trim());
  return ok;
}
export const lock = () => setDev('');

const VERSION_KEY = 'aangika.dictionary.version';
const CHECKED_KEY = 'aangika.dictionary.checkedAt';

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* private mode */ } };

const listeners = new Set();
let state = {
  status: 'idle',                // idle | checking | updated | current | offline | unavailable | error
  version: Number(read(VERSION_KEY)) || 0,
  checkedAt: Number(read(CHECKED_KEY)) || null,
  count: 0,
  error: null,
  last: null,                    // last applyShared report
};

function set(patch) {
  state = { ...state, ...patch, count: listSharedSigns().length };
  listeners.forEach((fn) => { try { fn(state); } catch { /* listener bug */ } });
  return state;
}

export const getState = () => ({ ...state, count: listSharedSigns().length });
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** A dictionary server is built into this app. */
export const isAvailable = () => Boolean(apiBase());

/**
 * Fetch the dictionary if it changed and apply it.
 * @param force  download even if the version looks current
 */
let inflight = null;
export function checkForUpdates({ force = false } = {}) {
  if (inflight) return inflight;
  inflight = (async () => {
    if (!isAvailable()) return set({ status: 'unavailable', error: null });
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return set({ status: 'offline' });
    await initSigns();
    set({ status: 'checking', error: null });
    try {
      const headers = {};
      if (!force && state.version && listSharedSigns().length) headers['If-None-Match'] = `"v${state.version}"`;
      const res = await fetch(`${apiBase()}/dictionary`, { headers, cache: 'no-store' });
      const now = Date.now();
      write(CHECKED_KEY, now);
      if (res.status === 304) return set({ status: 'current', checkedAt: now });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
      const dict = await res.json();
      const report = await applyShared(dict.signs || []);
      const before = JSON.stringify([getOverrides(), getSharedRules()]);
      setOverrides(dict.overrides || {});
      setSharedRules(dict.rules || []);
      try { localStorage.setItem(RULES_KEY, JSON.stringify(dict.rules || [])); } catch { /* private mode */ }
      const overridesChanged = JSON.stringify([getOverrides(), getSharedRules()]) !== before;
      write(VERSION_KEY, dict.version || 0);
      lastDict = dict;
      const changed = report.added + report.updated + report.removed > 0 || overridesChanged;
      return set({
        status: changed ? 'updated' : 'current', version: dict.version || 0, checkedAt: now, last: report,
      });
    } catch (err) {
      return set({ status: 'error', error: err.message });
    }
  })().finally(() => { inflight = null; });
  return inflight;
}

async function post(path, body) {
  if (!isAvailable()) throw new Error('No dictionary server in this build.');
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status;
    err.rejected = data.rejected;
    throw err;
  }
  return data;
}

/** true if the server accepts this developer code. Throws on lockout / network. */
export async function verifyCode(code) {
  try {
    await post('/dictionary/verify', { code });
    return true;
  } catch (err) {
    if (err.status === 403) return false;
    throw err;
  }
}

/** Own signs a developer can publish: taught (with samples) and not from the dictionary. */
export const publishable = () => listOwnSigns().filter((s) => s.samples?.length);

/** Publish these own signs to everyone; then refresh this device's copy. */
export async function publish(code, signs) {
  const payload = signs.map(({ calibration: _c, untrained: _u, ...s }) => s);
  const result = await post('/dictionary/publish', { code, signs: payload });
  await checkForUpdates({ force: true });
  return result;
}

/**
 * What the server's dictionary holds right now: [{id, token, text}]. For the
 * developer view, which must also list signs this device holds as its own
 * (a developer's published signs stay "own" on their device).
 */
export async function fetchSummary() {
  if (!isAvailable()) return [];
  const res = await fetch(`${apiBase()}/dictionary`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const dict = await res.json();
  return (dict.signs || []).map((s) => ({ id: s.id, token: s.token, text: s.output?.text_en || s.token }));
}

/** The whole server dictionary (signs, overrides, rules), fresh. */
export async function fetchFull() {
  if (!isAvailable()) return null;
  const res = await fetch(`${apiBase()}/dictionary`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  lastDict = await res.json();
  return lastDict;
}
export const getLastDict = () => lastDict;

/** Reassign / disable a built-in sign for everyone (null = back to default). */
export async function setOverride(code, token, override) {
  const result = await post('/dictionary/override', { code, token, override });
  await checkForUpdates({ force: true });
  return result;
}

/** Replace the shared grammar rules for everyone. */
export async function saveRules(code, rules) {
  const result = await post('/dictionary/rules', { code, rules });
  await checkForUpdates({ force: true });
  return result;
}

/** Remove shared signs (by their server id) for everyone. */
export async function removeShared(code, sharedIds) {
  const result = await post('/dictionary/remove', { code, ids: sharedIds });
  await checkForUpdates({ force: true });
  return result;
}

export default {
  isAvailable, checkForUpdates, verifyCode, publish, publishable, removeShared, fetchSummary,
  fetchFull, getLastDict, setOverride, saveRules, unlock, lock, isUnlocked, getDevCode, onDevChange,
  getState, subscribe,
};
