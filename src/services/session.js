/**
 * Signing in (server/auth.js on the Cloudflare Worker), and keeping my
 * dictionary (islPersonal.js) the same on every device I sign in on.
 *
 * Optional: signed out, everything still works on this device. Signed in:
 *   - on sign-in, the server copy is downloaded and merged with this
 *     device's (newer change wins, deletes stick), and the result uploaded;
 *   - after that, every change is uploaded 5 s after the last one (the free
 *     Cloudflare plan allows 1,000 writes a day across all users).
 *
 * The session token is kept in localStorage.
 */

import { apiBase } from './apiBase.js';
import personal from './isl/islPersonal.js';

const KEY = 'aangika-session';
const PUSH_DELAY_MS = 5000;
const listeners = new Set();

let state = read();
let pushTimer = 0;
let applying = false;
let etag = null;
let unsubscribePersonal = null;

function read() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s?.token ? s : null; } catch { return null; }
}
function write(next) {
  state = next;
  try { if (next) localStorage.setItem(KEY, JSON.stringify(next)); else localStorage.removeItem(KEY); } catch { /* storage blocked */ }
  listeners.forEach((fn) => { try { fn(state); } catch { /* listener bug */ } });
}

export const getSession = () => state;
export const getUser = () => state?.user || null;
export const isSignedIn = () => Boolean(state?.token);
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

async function api(path, { method = 'POST', body, auth = false, headers = {} } = {}) {
  const base = apiBase();
  if (!base) throw new Error('Accounts need the Aangika server (not set up in this build).');
  const r = await fetch(base + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(auth && state?.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...headers,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (r.status === 304) return { status: 304 };
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && auth) { write(null); stopSync(); }
  if (!r.ok) throw Object.assign(new Error(data.error || `Server error ${r.status}`), { status: r.status });
  return { status: r.status, data, etag: r.headers.get('ETag') };
}

async function signedIn({ token, user }) {
  write({ token, user });
  await startSync();
  return user;
}

export const register = ({ username, pin, name }) => api('/auth/register', { body: { username, pin, name } }).then((r) => signedIn(r.data));
export const login = ({ username, pin }) => api('/auth/login', { body: { username, pin } }).then((r) => signedIn(r.data));
export const googleLogin = (idToken) => api('/auth/google', { body: { idToken } }).then((r) => signedIn(r.data));
export async function linkGoogle(idToken) {
  const r = await api('/auth/link-google', { body: { idToken }, auth: true });
  write({ ...state, user: r.data.user });
  return r.data.user;
}

/** Sign out. My dictionary stays on this device unless `forget`. */
export async function logout({ forget = false } = {}) {
  await flush().catch(() => {});
  stopSync();
  write(null);
  etag = null;
  if (forget) await personal.replaceData({});
}

// ── My dictionary sync ──────────────────────────────────────────────────────

async function pull() {
  const r = await api('/me/personal', { method: 'GET', auth: true, headers: etag ? { 'If-None-Match': etag } : {} });
  if (r.status === 304) return false;
  etag = r.etag;
  await personal.init();
  const merged = personal.merge(personal.getData(), r.data);
  applying = true;
  try { await personal.replaceData(merged); } finally { applying = false; }
  return true;
}

async function push() {
  if (!isSignedIn()) return;
  await api('/me/personal', { body: { data: personal.getData() }, auth: true });
  etag = null;                                       // the server has a new version now
}

/** Upload now (e.g. before signing out). */
export async function flush() {
  if (!pushTimer) return;
  clearTimeout(pushTimer);
  pushTimer = 0;
  await push();
}

function stopSync() {
  clearTimeout(pushTimer);
  pushTimer = 0;
  unsubscribePersonal?.();
  unsubscribePersonal = null;
}

/** Download + merge, upload the result, then upload changes as they happen. */
export async function startSync() {
  if (!isSignedIn()) return;
  stopSync();
  try {
    await pull();
    await push();
  } catch (e) {
    if (e.status === 401) return;
    console.warn('[session] sync:', e.message);            // offline: try again on the next change
  }
  unsubscribePersonal = personal.subscribe(() => {
    if (applying || !isSignedIn()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { pushTimer = 0; push().catch((e) => console.warn('[session] upload:', e.message)); }, PUSH_DELAY_MS);
  });
}

/** App start: resume syncing for a stored session. */
export function resume() { if (isSignedIn()) startSync(); }

// ── Google (web) ────────────────────────────────────────────────────────────

export const googleClientId = () => import.meta.env?.VITE_GOOGLE_CLIENT_ID || '';

/** Load Google Identity Services and draw its button into `el`. */
export function renderGoogleButton(el, onToken) {
  const id = googleClientId();
  if (!id || !el) return;
  const draw = () => {
    window.google.accounts.id.initialize({ client_id: id, callback: (res) => onToken(res.credential) });
    window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill' });
  };
  if (window.google?.accounts?.id) { draw(); return; }
  const s = document.createElement('script');
  s.src = 'https://accounts.google.com/gsi/client';
  s.async = true;
  s.onload = draw;
  document.head.appendChild(s);
}

export default {
  getSession, getUser, isSignedIn, subscribe, register, login, googleLogin, linkGoogle, logout,
  flush, startSync, resume, googleClientId, renderGoogleButton,
};
