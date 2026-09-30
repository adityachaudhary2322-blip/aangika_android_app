/**
 * Accounts, on the same Worker and KV as everything else. Optional: the app
 * works signed out; an account keeps a person's own dictionary (islPersonal)
 * on every device they use.
 *
 *   POST /auth/register     { username, pin, name }   -> { token, user }
 *   POST /auth/login        { username, pin }         -> { token, user }
 *   POST /auth/google       { idToken }               -> { token, user }
 *   POST /auth/link-google  { idToken }  (signed in)  -> { user }
 *   GET  /me                              (signed in) -> { user }
 *   GET  /me/personal                     (signed in) -> my dictionary (ETag / 304)
 *   POST /me/personal       { data }      (signed in) -> { version }
 *
 * Username + PIN: no email or SMS, so it is not a verified identity, and a
 * forgotten PIN cannot be reset (link Google to be able to get back in). The
 * PIN is stored as PBKDF2-SHA256 (salted; iterations kept low enough for the
 * Workers free plan's CPU limit) and guessing is stopped by lockouts: per
 * username in KV, per IP in memory.
 *
 * Google: the app gets an ID token from Google; it is verified HERE against
 * Google's public keys (signature, issuer, audience = our client ids, expiry).
 *
 * Sessions: "v1.<uid>.<expiry>.<HMAC-SHA256>" signed with SESSION_SECRET, so a
 * login costs no KV write (the free plan allows 1,000 writes a day).
 *
 * KV keys: acct:u:<username>, acct:g:<google sub>, user:<uid>:personal,
 * lf:<username>:<hour> (failed logins).
 */

import { json, readJson } from './dictionary.js';
import { cleanIslSign, CATEGORIES } from './isl.js';

const PBKDF2_ITER = 10_000;
const SESSION_DAYS = 90;
const USER_FAILS_PER_HOUR = 10;
const IP_FAILS = 20;                          // per 15 minutes, per Worker instance
const IP_REGISTERS_PER_HOUR = 5;
const MAX_PERSONAL_BYTES = 3 * 1024 * 1024;
const MAX_PERSONAL_SIGNS = 150;
const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISS = new Set(['accounts.google.com', 'https://accounts.google.com']);
const LANG_RE = /^[a-z]{2}-[A-Z]{2}$|^hinglish$/;

const ipFails = new Map();                    // ip -> { window, count }
const ipRegs = new Map();                     // ip -> { hour, count }
let jwksCache = null;                         // { at, keys }

const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const b64uText = (s) => b64u(enc.encode(s));
const unb64uText = (s) => new TextDecoder().decode(unb64u(s));

function sameBytes(a, b) {
  const x = typeof a === 'string' ? enc.encode(a) : a;
  const y = typeof b === 'string' ? enc.encode(b) : b;
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

async function pinHash(pin, salt, iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return b64u(bits);
}

// ── Sessions ────────────────────────────────────────────────────────────────

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey('raw', enc.encode(String(secret).trim()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64u(await crypto.subtle.sign('HMAC', key, enc.encode(text)));
}

export async function makeToken(env, uid, now = Date.now()) {
  const body = `v1.${b64uText(uid)}.${now + SESSION_DAYS * 86_400_000}`;
  return `${body}.${await hmac(env.SESSION_SECRET, body)}`;
}

/** -> uid, or null for a missing, tampered or expired token. */
export async function readToken(env, token, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return null;
  const body = parts.slice(0, 3).join('.');
  if (!sameBytes(parts[3], await hmac(env.SESSION_SECRET, body))) return null;
  if (!(Number(parts[2]) > now)) return null;
  try { return unb64uText(parts[1]); } catch { return null; }
}

async function signedIn(request, env) {
  const m = /^Bearer\s+(.+)$/i.exec(request.headers.get('Authorization') || '');
  return m ? readToken(env, m[1]) : null;
}

// ── Google ID tokens ────────────────────────────────────────────────────────

async function googleKeys(env, fetchImpl, now = Date.now()) {
  if (jwksCache && now - jwksCache.at < 3_600_000 && jwksCache.url === (env.GOOGLE_JWKS_URL || GOOGLE_JWKS)) return jwksCache.keys;
  const url = env.GOOGLE_JWKS_URL || GOOGLE_JWKS;           // tests point this at a local key
  const r = await fetchImpl(url);
  if (!r.ok) throw Object.assign(new Error('Could not reach Google to check the sign-in.'), { status: 502 });
  const { keys } = await r.json();
  jwksCache = { at: now, url, keys };
  return keys;
}

/** Verified Google claims { sub, email, name } or throws 401. */
export async function verifyGoogle(env, idToken, fetchImpl = fetch, now = Date.now()) {
  const bad = (why) => Object.assign(new Error(`Google sign-in not accepted (${why}).`), { status: 401 });
  const ids = String(env.GOOGLE_CLIENT_IDS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!ids.length) throw Object.assign(new Error('Google sign-in is not set up on the server.'), { status: 503 });
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw bad('malformed');
  let header; let claims;
  try { header = JSON.parse(unb64uText(parts[0])); claims = JSON.parse(unb64uText(parts[1])); } catch { throw bad('malformed'); }
  if (header.alg !== 'RS256') throw bad('algorithm');
  const jwk = (await googleKeys(env, fetchImpl, now)).find((k) => k.kid === header.kid);
  if (!jwk) throw bad('unknown key');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(parts[2]), enc.encode(`${parts[0]}.${parts[1]}`));
  if (!ok) throw bad('signature');
  if (!GOOGLE_ISS.has(claims.iss)) throw bad('issuer');
  if (!ids.includes(claims.aud)) throw bad('audience');
  if (!(Number(claims.exp) * 1000 > now)) throw bad('expired');
  if (!claims.sub) throw bad('no account id');
  return { sub: String(claims.sub), email: claims.email || '', name: claims.name || claims.email || 'Google user' };
}

// ── Personal dictionary (cleaned: the app trusts what it downloads) ─────────

function cleanPersonal(raw) {
  const d = raw && typeof raw === 'object' ? raw : {};
  const signs = [];
  for (const s of (Array.isArray(d.signs) ? d.signs : []).slice(0, MAX_PERSONAL_SIGNS)) {
    const { sign, error } = cleanIslSign(s, { personal: true });
    if (error) throw Object.assign(new Error(`My dictionary: ${error}`), { status: 400 });
    signs.push(sign);
  }
  const overrides = {};
  for (const [id, o] of Object.entries(d.overrides && typeof d.overrides === 'object' ? d.overrides : {}).slice(0, 500)) {
    if (!o || typeof o !== 'object' || String(id).length > 64) continue;
    const texts = {};
    for (const [k, v] of Object.entries(o.texts && typeof o.texts === 'object' ? o.texts : {})) {
      if (LANG_RE.test(k) && typeof v === 'string') texts[k] = v.slice(0, 300);
    }
    overrides[id] = {
      ...(typeof o.word === 'string' && o.word.trim() ? { word: o.word.trim().slice(0, 60) } : {}),
      ...(Object.keys(texts).length ? { texts } : {}),
      ...(CATEGORIES.includes(o.category) ? { category: o.category } : {}),
      ...(o.hidden === true ? { hidden: true } : {}),
      ...(o.disabled === true ? { disabled: true } : {}),
      ...(typeof o.by === 'string' && o.by.startsWith('p-') ? { by: o.by.slice(0, 64) } : {}),
      updatedAt: Number(o.updatedAt) || 0,
    };
  }
  const deleted = {};
  for (const [k, t] of Object.entries(d.deleted && typeof d.deleted === 'object' ? d.deleted : {}).slice(0, 2000)) {
    if (String(k).length <= 70 && Number.isFinite(Number(t))) deleted[k] = Number(t);
  }
  return { signs, overrides, deleted, updatedAt: Number(d.updatedAt) || Date.now() };
}

// ── Handler ─────────────────────────────────────────────────────────────────

const USERNAME_RE = /^[a-z0-9_]{3,24}$/;
const userOut = (a) => ({ uid: a.uid, name: a.name, username: a.username || null, google: Boolean(a.google || a.email) });

export async function handleAuth(request, env, headers, fetchImpl = fetch) {
  const url = new URL(request.url);
  if (!env.DICT) return json(503, { error: 'Storage is not set up on the server.' }, headers);
  if (!env.SESSION_SECRET) return json(503, { error: 'Accounts are not set up on the server yet.' }, headers);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  try {
    // ── Signed-in endpoints ──
    if (url.pathname === '/me' || url.pathname.startsWith('/me/') || url.pathname === '/auth/link-google') {
      const uid = await signedIn(request, env);
      if (!uid) return json(401, { error: 'Please sign in again.' }, headers);
      const acct = JSON.parse(await env.DICT.get(`acct:${uid}`) || 'null');
      if (!acct) return json(401, { error: 'This account no longer exists.' }, headers);

      if (url.pathname === '/me' && request.method === 'GET') return json(200, { user: userOut(acct) }, headers);

      if (url.pathname === '/me/personal' && request.method === 'GET') {
        const raw = await env.DICT.get(`user:${uid}:personal`);
        const d = raw ? JSON.parse(raw) : { version: 0, signs: [], overrides: {}, deleted: {} };
        const etag = `"p${d.version}"`;
        const h = { ...headers, ETag: etag, 'Cache-Control': 'no-store' };
        if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: h });
        return json(200, d, h);
      }
      if (url.pathname === '/me/personal' && request.method === 'POST') {
        const len = Number(request.headers.get('Content-Length') || 0);
        if (len > MAX_PERSONAL_BYTES) return json(413, { error: 'My dictionary is too large (3 MB).' }, headers);
        const body = await readJson(request);
        const clean = cleanPersonal(body.data);
        const prev = JSON.parse(await env.DICT.get(`user:${uid}:personal`) || '{"version":0}');
        const next = { ...clean, version: (prev.version || 0) + 1 };
        const text = JSON.stringify(next);
        if (text.length > MAX_PERSONAL_BYTES) return json(413, { error: 'My dictionary is too large (3 MB).' }, headers);
        await env.DICT.put(`user:${uid}:personal`, text);
        return json(200, { version: next.version }, headers);
      }
      if (url.pathname === '/auth/link-google' && request.method === 'POST') {
        const g = await verifyGoogle(env, (await readJson(request)).idToken, fetchImpl, now);
        const taken = JSON.parse(await env.DICT.get(`acct:g:${g.sub}`) || 'null');
        if (taken && taken.uid !== uid) return json(409, { error: 'That Google account already has its own Aangika account.' }, headers);
        await env.DICT.put(`acct:g:${g.sub}`, JSON.stringify({ uid, name: acct.name, email: g.email, link: true }));
        const updated = { ...acct, google: g.sub, email: g.email };
        await env.DICT.put(`acct:${uid}`, JSON.stringify(updated));
        return json(200, { user: userOut(updated) }, headers);
      }
      return json(404, { error: 'Unknown endpoint.' }, headers);
    }

    if (request.method !== 'POST') return json(405, { error: 'POST only.' }, headers);
    const data = await readJson(request);

    if (url.pathname === '/auth/register') {
      const username = String(data.username || '').trim().toLowerCase();
      const pin = String(data.pin || '').trim();
      const name = String(data.name || '').trim().slice(0, 40) || username;
      if (!USERNAME_RE.test(username)) return json(400, { error: 'Username: 3–24 letters, digits or _.' }, headers);
      if (!/^\d{6,12}$/.test(pin)) return json(400, { error: 'PIN: 6 to 12 digits.' }, headers);
      if (/^(\d)\1+$/.test(pin) || '0123456789012'.includes(pin) || '9876543210987'.includes(pin)) {
        return json(400, { error: 'That PIN is too easy to guess.' }, headers);
      }
      const hour = Math.floor(now / 3_600_000);
      const r = ipRegs.get(ip);
      if (r && r.hour === hour && r.count >= IP_REGISTERS_PER_HOUR) return json(429, { error: 'Too many new accounts from here; try again later.' }, headers);
      ipRegs.set(ip, { hour, count: r && r.hour === hour ? r.count + 1 : 1 });
      if (ipRegs.size > 5000) ipRegs.clear();
      if (await env.DICT.get(`acct:u:${username}`)) return json(409, { error: 'That username is taken.' }, headers);
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const acct = { uid: `u:${username}`, username, name, salt: b64u(salt), hash: await pinHash(pin, salt), iter: PBKDF2_ITER, createdAt: new Date(now).toISOString() };
      await env.DICT.put(`acct:u:${username}`, JSON.stringify(acct));
      return json(200, { token: await makeToken(env, acct.uid, now), user: userOut(acct) }, headers);
    }

    if (url.pathname === '/auth/login') {
      const username = String(data.username || '').trim().toLowerCase();
      const window = Math.floor(now / 900_000);
      const f = ipFails.get(ip);
      if (f && f.window === window && f.count >= IP_FAILS) return json(429, { error: 'Too many wrong PINs; try again in 15 minutes.' }, headers);
      const failKey = `lf:${username}:${Math.floor(now / 3_600_000)}`;
      const userFails = Number(await env.DICT.get(failKey)) || 0;
      if (userFails >= USER_FAILS_PER_HOUR) return json(423, { error: 'This account is locked for up to an hour after too many wrong PINs.' }, headers);
      const acct = USERNAME_RE.test(username) ? JSON.parse(await env.DICT.get(`acct:u:${username}`) || 'null') : null;
      const ok = acct && sameBytes(await pinHash(String(data.pin || '').trim(), unb64u(acct.salt), acct.iter), acct.hash);
      if (!ok) {
        ipFails.set(ip, { window, count: f && f.window === window ? f.count + 1 : 1 });
        if (ipFails.size > 5000) ipFails.clear();
        if (acct) await env.DICT.put(failKey, String(userFails + 1), { expirationTtl: 7200 });
        return json(403, { error: 'Wrong username or PIN.' }, headers);
      }
      return json(200, { token: await makeToken(env, acct.uid, now), user: userOut(acct) }, headers);
    }

    if (url.pathname === '/auth/google') {
      const g = await verifyGoogle(env, data.idToken, fetchImpl, now);
      let link = JSON.parse(await env.DICT.get(`acct:g:${g.sub}`) || 'null');
      if (!link) {
        link = { uid: `g:${g.sub}`, name: g.name, email: g.email, createdAt: new Date(now).toISOString() };
        await env.DICT.put(`acct:g:${g.sub}`, JSON.stringify(link));
      }
      const acct = link.link ? JSON.parse(await env.DICT.get(`acct:${link.uid}`) || 'null') : link;
      if (!acct) return json(401, { error: 'The account linked to this Google login no longer exists.' }, headers);
      return json(200, { token: await makeToken(env, acct.uid, now), user: userOut(acct) }, headers);
    }

    return json(404, { error: 'Unknown endpoint.' }, headers);
  } catch (err) {
    return json(err.status || 500, { error: err.status ? err.message : 'Account error.' }, headers);
  }
}
