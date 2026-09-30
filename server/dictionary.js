/**
 * The community sign dictionary: signs developers publish for every user.
 *
 *   GET  /dictionary          anyone (the app): the whole dictionary, with an
 *                             ETag so an unchanged dictionary costs a 304
 *   POST /dictionary/verify   { code }                -> { ok }
 *   POST /dictionary/publish  { code, signs: [...] }  -> { added, updated, version }
 *   POST /dictionary/remove   { code, ids: [...] }    -> { removed, version }
 *   POST /dictionary/override { code, token, override|null }
 *        reassign / disable a BUILT-IN sign for everyone (null = back to default)
 *   POST /dictionary/rules    { code, rules: [...] }   replace the shared grammar rules
 *
 * The developer code is a Worker SECRET (DEV_CODE), never in the app: a code
 * shipped in a website or APK can be read by anyone. It is compared in
 * constant time, and guessing is limited per IP (in memory) and globally
 * (a per-hour failure counter in KV that locks publishing when exceeded).
 * A 6-digit code is still short; a longer one makes guessing hopeless.
 *
 * Stored in Workers KV (binding DICT) under one key, 'dictionary'.
 */

export const DICT_FORMAT = 'aangika-dictionary/1';
const KEY = 'dictionary';
const MAX_SIGNS = 150;
const MAX_BYTES = 12 * 1024 * 1024;
const IP_FAILS = 5;                 // wrong codes per IP per 15 minutes
const GLOBAL_FAILS_PER_HOUR = 30;   // then publishing locks until the hour ends
const KINDS = new Set(['handshape', 'movement', 'glove', 'glove-motion']);
const TYPES = new Set(['word', 'name', 'sentence', 'gloss']);

const failures = new Map();         // ip -> { window, count }

export const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status, headers: { ...headers, 'Content-Type': 'application/json' },
});

async function load(env) {
  const raw = await env.DICT.get(KEY);
  const dict = raw ? JSON.parse(raw) : { format: DICT_FORMAT, version: 0, updatedAt: null, signs: [] };
  dict.overrides = dict.overrides || {};    // built-in sign token -> override
  dict.rules = dict.rules || [];            // shared grammar rules
  return dict;
}

const TOKEN_RE = /^[A-Z0-9_]{1,32}$/;
const LANG_RE = /^[a-z]{2}-[A-Z]{2}$|^hinglish$/;
const MAX_RULES = 100;

const texts = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (LANG_RE.test(k) && typeof v === 'string' && v.trim()) out[k] = v.trim().slice(0, 300);
  }
  return out;
};

/** A built-in sign override: {disabled?, token?, text_en?, texts?}; null = none. */
export function cleanOverride(o) {
  if (o === null) return { override: null };
  if (typeof o !== 'object') return { error: 'bad override' };
  const out = {};
  if (o.disabled) out.disabled = true;
  if (o.token !== undefined && o.token !== '') {
    const t = String(o.token).toUpperCase();
    if (!TOKEN_RE.test(t)) return { error: 'bad token' };
    out.token = t;
  }
  if (typeof o.text_en === 'string' && o.text_en.trim()) out.text_en = o.text_en.trim().slice(0, 300);
  const tx = texts(o.texts);
  if (Object.keys(tx).length) out.texts = tx;
  return { override: Object.keys(out).length ? out : null };
}

/**
 * A grammar rule: { id, pattern: ["@self", "@side?", "@body", "PAIN?"],
 * english: "I have pain in my {side} {body}.", texts: {'hi-IN': ..., hinglish: ...},
 * note? }. Pattern items: a sign token, or an @class; "?" = optional.
 */
export function cleanRule(r) {
  const id = String(r?.id || '').slice(0, 40);
  if (!/^[a-z0-9-]{1,40}$/.test(id)) return { error: 'bad rule id' };
  const pattern = Array.isArray(r.pattern) ? r.pattern.map(String) : [];
  if (!pattern.length || pattern.length > 8) return { error: `${id}: pattern must have 1-8 items` };
  if (!pattern.every((p) => /^(@[a-z]{2,16}|[A-Z0-9_]{1,32})\??$/.test(p))) return { error: `${id}: bad pattern item` };
  const english = String(r.english || '').trim();
  if (!english || english.length > 200) return { error: `${id}: english template required (max 200)` };
  return {
    rule: {
      id, pattern, english,
      texts: texts(r.texts),
      ...(r.note ? { note: String(r.note).slice(0, 200) } : {}),
    },
  };
}

async function save(env, dict) {
  dict.version = (dict.version || 0) + 1;
  dict.updatedAt = new Date().toISOString();
  const body = JSON.stringify(dict);
  if (body.length > MAX_BYTES) throw Object.assign(new Error('Dictionary would be too large.'), { status: 413 });
  await env.DICT.put(KEY, body);
  return dict;
}

function sameCode(a, b) {
  // Trim both: a secret set from a Windows shell can carry a trailing CR/LF
  // (and a pasted code a stray space), which would make the right code fail.
  const x = new TextEncoder().encode(String(a || '').trim());
  const y = new TextEncoder().encode(String(b || '').trim());
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0 && x.length > 0;
}

/** null when the code is right; otherwise the Response to send. */
export async function checkCode(env, ip, code, headers, now = Date.now()) {
  if (!env.DEV_CODE) return json(503, { error: 'Publishing is not set up on the server.' }, headers);
  const hourKey = `fails:${Math.floor(now / 3_600_000)}`;
  const globalFails = Number(await env.DICT.get(hourKey)) || 0;
  if (globalFails >= GLOBAL_FAILS_PER_HOUR) {
    return json(423, { error: 'Too many wrong codes recently; publishing is locked for up to an hour.' }, headers);
  }
  const window = Math.floor(now / 900_000);
  const f = failures.get(ip);
  if (f && f.window === window && f.count >= IP_FAILS) {
    return json(429, { error: 'Too many wrong codes; try again in 15 minutes.' }, headers);
  }
  if (sameCode(code, env.DEV_CODE)) return null;

  failures.set(ip, { window, count: f && f.window === window ? f.count + 1 : 1 });
  if (failures.size > 5000) failures.clear();
  await env.DICT.put(hourKey, String(globalFails + 1), { expirationTtl: 7200 });
  return json(403, { error: 'Wrong developer code.' }, headers);
}

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const numArray = (a, len) => a === null || (Array.isArray(a) && a.length === len && a.every(num));

/** Keep only well-formed fields: the app trusts what it downloads. */
export function cleanSign(s) {
  const token = String(s?.token || '').toUpperCase();
  if (!/^[A-Z0-9_]{1,32}$/.test(token)) return { error: 'bad token' };
  if (!KINDS.has(s.kind)) return { error: `${token}: bad kind` };
  const o = s.output || {};
  if (!TYPES.has(o.type) || !String(o.text_en || '').trim()) return { error: `${token}: bad output` };
  const samples = Array.isArray(s.samples) ? s.samples : [];
  if (!samples.length) return { error: `${token}: no samples (untrained)` };
  if (samples.length > 400) return { error: `${token}: too many samples` };
  const vec = (a) => Array.isArray(a) && a.length > 0 && a.length <= 64 && a.every(num);
  const clean = [];
  for (const x of samples) {
    const capture = num(x?.capture) ? x.capture : 0;
    if (s.kind === 'glove') {                                                 // one glove frame
      if (!vec(x?.f)) return { error: `${token}: malformed sample` };
      clean.push({ capture, f: x.f });
    } else if (s.kind === 'glove-motion') {                                   // one take
      if (!(Array.isArray(x?.seq) && x.seq.length && x.seq.length <= 600 && x.seq.every(vec))) {
        return { error: `${token}: malformed sample` };
      }
      clean.push({ capture, seq: x.seq });
    } else {                                                                  // camera frame
      const left = x?.left ?? null;
      const right = x?.right ?? null;
      if (!(numArray(left, 63) && numArray(right, 63) && (left || right))) return { error: `${token}: malformed sample` };
      const pose = {};
      for (const [k, v] of Object.entries(x.pose || {})) {
        if (/^\d{1,2}$/.test(k) && Array.isArray(v) && v.length === 2 && v.every(num)) pose[k] = v;
      }
      clean.push({ capture, left, right, pose });
    }
  }
  const texts = {};
  for (const [k, v] of Object.entries(o.texts || {})) {
    if (/^[a-z]{2}-[A-Z]{2}$/.test(k) && typeof v === 'string') texts[k] = v.slice(0, 300);
  }
  return {
    sign: {
      id: String(s.id || '').slice(0, 64) || token,
      token,
      kind: s.kind,
      hands: s.hands === 'two' ? 'two' : 'one',
      eitherHand: Boolean(s.eitherHand),
      side: s.side === 'left' || s.side === 'right' ? s.side : undefined,
      location: typeof s.location === 'string' ? s.location.slice(0, 32) : undefined,
      output: {
        type: o.type,
        text_en: String(o.text_en).slice(0, 300),
        texts,
        ...(o.category ? { category: String(o.category).slice(0, 24) } : {}),
      },
      samples: clean,
      createdAt: num(s.createdAt) ? s.createdAt : Date.now(),
    },
  };
}

export async function readJson(request) {
  const len = Number(request.headers.get('Content-Length') || 0);
  if (len > MAX_BYTES) throw Object.assign(new Error('Request too large.'), { status: 413 });
  const text = await request.text();
  if (text.length > MAX_BYTES) throw Object.assign(new Error('Request too large.'), { status: 413 });
  try { return JSON.parse(text); } catch { throw Object.assign(new Error('Bad JSON.'), { status: 400 }); }
}

export async function handleDictionary(request, env, headers) {
  const url = new URL(request.url);
  if (!env.DICT) return json(503, { error: 'Dictionary storage is not set up on the server.' }, headers);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';

  try {
    if (url.pathname === '/dictionary' && request.method === 'GET') {
      const dict = await load(env);
      const etag = `"v${dict.version}"`;
      const h = { ...headers, ETag: etag, 'Cache-Control': 'no-cache' };
      if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: h });
      return json(200, dict, h);
    }
    if (request.method !== 'POST') return json(405, { error: 'POST only.' }, headers);

    const data = await readJson(request);
    const denied = await checkCode(env, ip, data.code, headers);
    if (denied) return denied;

    if (url.pathname === '/dictionary/verify') return json(200, { ok: true }, headers);

    if (url.pathname === '/dictionary/publish') {
      if (!Array.isArray(data.signs) || !data.signs.length) return json(400, { error: 'No signs to publish.' }, headers);
      const dict = await load(env);
      const byId = new Map(dict.signs.map((s) => [s.id, s]));
      const rejected = [];
      let added = 0; let updated = 0;
      for (const raw of data.signs) {
        const { sign, error } = cleanSign(raw);
        if (error) { rejected.push(error); continue; }
        // A different published sign already uses this token: keep the first.
        const clash = dict.signs.find((s) => s.token === sign.token && s.id !== sign.id);
        if (clash) { rejected.push(`${sign.token}: already in the dictionary`); continue; }
        sign.publishedAt = new Date().toISOString();
        if (byId.has(sign.id)) updated += 1; else added += 1;
        byId.set(sign.id, sign);
        dict.signs = [...byId.values()];
      }
      if (dict.signs.length > MAX_SIGNS) return json(413, { error: `The dictionary holds at most ${MAX_SIGNS} signs.` }, headers);
      if (added + updated === 0) return json(400, { error: 'Nothing publishable.', rejected }, headers);
      const saved = await save(env, dict);
      return json(200, { added, updated, rejected, version: saved.version, total: saved.signs.length }, headers);
    }

    if (url.pathname === '/dictionary/override') {
      const token = String(data.token || '').toUpperCase();
      if (!TOKEN_RE.test(token)) return json(400, { error: 'Bad sign token.' }, headers);
      const { override, error } = cleanOverride(data.override ?? null);
      if (error) return json(400, { error }, headers);
      const dict = await load(env);
      if (override) dict.overrides[token] = override; else delete dict.overrides[token];
      const saved = await save(env, dict);
      return json(200, { token, override, version: saved.version }, headers);
    }

    if (url.pathname === '/dictionary/rules') {
      if (!Array.isArray(data.rules)) return json(400, { error: 'rules must be a list.' }, headers);
      if (data.rules.length > MAX_RULES) return json(413, { error: `At most ${MAX_RULES} rules.` }, headers);
      const rules = [];
      const rejected = [];
      const ids = new Set();
      for (const raw of data.rules) {
        const { rule, error } = cleanRule(raw);
        if (error) { rejected.push(error); continue; }
        if (ids.has(rule.id)) { rejected.push(`${rule.id}: duplicate id`); continue; }
        ids.add(rule.id);
        rules.push(rule);
      }
      if (rejected.length) return json(400, { error: 'Some rules are invalid.', rejected }, headers);
      const dict = await load(env);
      dict.rules = rules;
      const saved = await save(env, dict);
      return json(200, { rules: rules.length, version: saved.version }, headers);
    }

    if (url.pathname === '/dictionary/remove') {
      const ids = new Set((data.ids || []).map(String));
      const dict = await load(env);
      const before = dict.signs.length;
      dict.signs = dict.signs.filter((s) => !ids.has(s.id));
      const removed = before - dict.signs.length;
      const saved = removed ? await save(env, dict) : dict;
      return json(200, { removed, version: saved.version, total: saved.signs.length }, headers);
    }

    return json(404, { error: 'Unknown endpoint.' }, headers);
  } catch (err) {
    return json(err.status || 500, { error: err.status ? err.message : 'Dictionary error.' }, headers);
  }
}

export const _dictTest = { failures, MAX_SIGNS, IP_FAILS, GLOBAL_FAILS_PER_HOUR };
