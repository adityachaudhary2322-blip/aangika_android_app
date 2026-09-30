/**
 * ISL Studio dictionary: the team's own ISL signs, each recorded (a few
 * takes of upper-body features, islFeatures.js) and assigned a word by the
 * team. Shared with every user; editing needs the developer code.
 *
 *   GET  /isl                 anyone: { signs, rules, version } (ETag / 304)
 *   POST /isl/publish         { code, signs: [...] }  add or update
 *   POST /isl/remove          { code, ids: [...] }
 *   POST /isl/rules           { code, rules: [...] }  this dictionary's rules
 *   POST /isl/deleted         { code }  recently deleted signs (recoverable)
 *   POST /isl/restore         { code, ids: [...] }  bring deleted signs back
 *
 * Stored in Workers KV (binding DICT) under the key 'isl'. Recordings take
 * the team real effort, so nothing is ever lost in one step:
 *   - deleting a sign moves it to a bin (key 'isl:deleted', last 100);
 *   - every change first copies the previous dictionary to one of ten
 *     rotating backups ('isl:backup:0'..'isl:backup:9', by version).
 */

import { json, checkCode, readJson, cleanRule } from './dictionary.js';

const KEY = 'isl';
const BIN_KEY = 'isl:deleted';
const BIN_MAX = 100;
const BACKUPS = 10;
export const ISL_FORMAT = 'aangika-isl/1';
export const FEATURE_DIM = 100;             // islFeatures.js FEATURE_DIM
export const FEATURE_VERSION = 1;
const MAX_SIGNS = 400;
const MAX_RULES = 200;
/** Same signs in the same order: two such rules clash (only one can fire). */
const patternKey = (r) => (Array.isArray(r?.pattern) ? r.pattern : []).map((p) => String(p).toUpperCase()).join(' ');
const MAX_BYTES = 20 * 1024 * 1024;         // KV allows 25 MB per value
const TYPES = new Set(['word', 'name', 'sentence', 'full-stop']);
export const CATEGORIES = ['pronoun', 'person', 'action', 'thing', 'place', 'time', 'describing', 'question', 'negation', 'other'];
const LANG_RE = /^[a-z]{2}-[A-Z]{2}$|^hinglish$/;

async function load(env) {
  const raw = await env.DICT.get(KEY);
  const d = raw ? JSON.parse(raw) : {};
  return {
    format: ISL_FORMAT, featureVersion: FEATURE_VERSION, version: 0, updatedAt: null,
    signs: [], rules: [], ...d,
  };
}

async function save(env, d) {
  const before = await env.DICT.get(KEY);
  if (before) await env.DICT.put(`${KEY}:backup:${(d.version || 0) % BACKUPS}`, before);
  d.version = (d.version || 0) + 1;
  d.updatedAt = new Date().toISOString();
  const body = JSON.stringify(d);
  if (body.length > MAX_BYTES) throw Object.assign(new Error('The ISL dictionary would be too large.'), { status: 413 });
  await env.DICT.put(KEY, body);
  return d;
}

async function loadBin(env) {
  const raw = await env.DICT.get(BIN_KEY);
  const bin = raw ? JSON.parse(raw) : [];
  return Array.isArray(bin) ? bin : [];
}
const saveBin = (env, bin) => env.DICT.put(BIN_KEY, JSON.stringify(bin.slice(0, BIN_MAX)));

const num01 = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -0.001 && v <= 1.001;

/** Keep only well-formed fields; round features to 3 decimals. */
export function cleanIslSign(s, { personal = false } = {}) {
  // A person's own dictionary is private: never publishable (islPersonal.js);
  // only the account store (auth.js) keeps personal signs.
  const isPersonal = Boolean(s?.personal) || String(s?.id || '').startsWith('p-');
  if (isPersonal !== personal) return { error: personal ? 'not a personal sign' : 'personal signs cannot be published' };
  const token = String(s?.token || '').toUpperCase();
  if (!/^[A-Z0-9_]{1,32}$/.test(token)) return { error: 'bad token' };
  const word = String(s.word || '').trim();
  if (!word || word.length > 60) return { error: `${token}: word required (max 60)` };
  if (!TYPES.has(s.type)) return { error: `${token}: bad type` };
  const category = CATEGORIES.includes(s.category) ? s.category : 'other';
  const takes = Array.isArray(s.takes) ? s.takes : [];
  if (!takes.length || takes.length > 8) return { error: `${token}: 1-8 takes needed` };
  const clean = [];
  for (const take of takes) {
    if (!Array.isArray(take) || take.length < 3 || take.length > 60) return { error: `${token}: each take needs 3-60 frames` };
    const frames = [];
    for (const f of take) {
      if (!Array.isArray(f) || f.length !== FEATURE_DIM || !f.every(num01)) return { error: `${token}: malformed frame` };
      frames.push(f.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000));
    }
    clean.push(frames);
  }
  const texts = {};
  for (const [k, v] of Object.entries(s.texts || {})) {
    if (LANG_RE.test(k) && typeof v === 'string' && v.trim()) texts[k] = v.trim().slice(0, 300);
  }
  // For Learn: how to make the sign, and an optional reference video (https only).
  const description = typeof s.description === 'string' ? s.description.trim().slice(0, 500) : '';
  let videoUrl = '';
  try { if (s.videoUrl && new URL(s.videoUrl).protocol === 'https:') videoUrl = String(s.videoUrl).slice(0, 300); } catch { /* not a URL */ }
  return {
    sign: {
      id: String(s.id || '').slice(0, 64) || token,
      token, word, texts, category, type: s.type,
      ...(description ? { description } : {}),
      ...(videoUrl ? { videoUrl } : {}),
      hands: ['one', 'two', 'either'].includes(s.hands) ? s.hands : 'one',
      takes: clean,
      ...(num01(s.tau) ? { tau: s.tau } : {}),
      ...(personal ? { personal: true, disabled: s.disabled === true, updatedAt: Number(s.updatedAt) || 0 } : {}),
      featureVersion: FEATURE_VERSION,
    },
  };
}

export async function handleIsl(request, env, headers) {
  const url = new URL(request.url);
  if (!env.DICT) return json(503, { error: 'Storage is not set up on the server.' }, headers);
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  try {
    if (url.pathname === '/isl' && request.method === 'GET') {
      const d = await load(env);
      const etag = `"i${d.version}"`;
      const h = { ...headers, ETag: etag, 'Cache-Control': 'no-cache' };
      if (request.headers.get('If-None-Match') === etag) return new Response(null, { status: 304, headers: h });
      return json(200, d, h);
    }
    if (request.method !== 'POST') return json(405, { error: 'POST only.' }, headers);
    const data = await readJson(request);
    const denied = await checkCode(env, ip, data.code, headers);
    if (denied) return denied;

    if (url.pathname === '/isl/publish') {
      if (!Array.isArray(data.signs) || !data.signs.length) return json(400, { error: 'No signs to publish.' }, headers);
      const d = await load(env);
      const byId = new Map(d.signs.map((s) => [s.id, s]));
      const rejected = [];
      let added = 0; let updated = 0;
      for (const raw of data.signs) {
        const { sign, error } = cleanIslSign(raw);
        if (error) { rejected.push(error); continue; }
        if (d.signs.some((s) => s.token === sign.token && s.id !== sign.id)) { rejected.push(`${sign.token}: another sign already has this name`); continue; }
        sign.publishedAt = new Date().toISOString();
        if (byId.has(sign.id)) updated += 1; else added += 1;
        byId.set(sign.id, sign);
        d.signs = [...byId.values()];
      }
      if (d.signs.length > MAX_SIGNS) return json(413, { error: `At most ${MAX_SIGNS} signs.` }, headers);
      if (!added && !updated) return json(400, { error: 'Nothing publishable.', rejected }, headers);
      const saved = await save(env, d);
      return json(200, { added, updated, rejected, version: saved.version, total: saved.signs.length }, headers);
    }
    if (url.pathname === '/isl/remove') {
      const ids = new Set((data.ids || []).map(String));
      const d = await load(env);
      const gone = d.signs.filter((s) => ids.has(s.id));
      if (!gone.length) return json(200, { removed: 0, version: d.version, total: d.signs.length }, headers);
      // Into the bin first: if the dictionary write then fails, nothing is lost.
      const bin = await loadBin(env);
      const deletedAt = new Date().toISOString();
      await saveBin(env, [...gone.map((s) => ({ ...s, deletedAt })), ...bin.filter((b) => !ids.has(b.id))]);
      d.signs = d.signs.filter((s) => !ids.has(s.id));
      const saved = await save(env, d);
      return json(200, { removed: gone.length, version: saved.version, total: saved.signs.length }, headers);
    }
    if (url.pathname === '/isl/deleted') {
      const bin = await loadBin(env);
      return json(200, { deleted: bin.map(({ id, token, word, type, category, deletedAt, takes }) => ({ id, token, word, type, category, deletedAt, takes: takes.length })) }, headers);
    }
    if (url.pathname === '/isl/restore') {
      const ids = new Set((data.ids || []).map(String));
      const bin = await loadBin(env);
      const d = await load(env);
      const restored = []; const rejected = [];
      for (const b of bin.filter((x) => ids.has(x.id))) {
        const { deletedAt, ...sign } = b;
        if (d.signs.some((s) => s.token === sign.token && s.id !== sign.id)) { rejected.push(`${sign.token}: another sign now has this name`); continue; }
        d.signs = [...d.signs.filter((s) => s.id !== sign.id), sign];
        restored.push(sign.id);
      }
      if (!restored.length) return json(400, { error: 'Nothing to restore.', rejected }, headers);
      if (d.signs.length > MAX_SIGNS) return json(413, { error: `At most ${MAX_SIGNS} signs.` }, headers);
      const saved = await save(env, d);
      await saveBin(env, bin.filter((b) => !restored.includes(b.id)));
      return json(200, { restored: restored.length, rejected, version: saved.version, total: saved.signs.length }, headers);
    }
    // Publishing rule drafts (the app's normal path). Each draft is merged
    // into the SERVER's list; one that uses the same signs as a DIFFERENT
    // published rule is a clash: it is not published, and the author decides
    // (replace theirs: its id in `replace`; or keep theirs: discard the draft).
    if (url.pathname === '/isl/rules/publish') {
      if (!Array.isArray(data.rules) || !data.rules.length || data.rules.length > MAX_RULES) return json(400, { error: 'No rules to publish.' }, headers);
      const replace = new Set((Array.isArray(data.replace) ? data.replace : []).map(String));
      const d = await load(env);
      const now = new Date().toISOString();
      const published = []; const conflicts = []; const rejected = [];
      for (const raw of data.rules) {
        const { rule, error } = cleanRule({ ...raw, updatedAt: now });
        if (error) { rejected.push(error); continue; }
        const clash = d.rules.find((r) => r.id !== rule.id && patternKey(r) === patternKey(rule));
        if (clash && !replace.has(rule.id)) { conflicts.push({ id: rule.id, existing: clash }); continue; }
        d.rules = d.rules.filter((r) => r.id !== rule.id && !(clash && r.id === clash.id));
        if (d.rules.length >= MAX_RULES) { rejected.push(`${rule.id}: at most ${MAX_RULES} rules`); continue; }
        d.rules.push(rule);
        published.push(rule.id);
      }
      const saved = published.length ? await save(env, d) : d;
      return json(200, { published, conflicts, rejected, rules: d.rules.length, version: saved.version }, headers);
    }
    // One rule at a time, merged into the SERVER's list: several teammates can
    // add rules at once without one phone's older copy erasing the others'.
    if (url.pathname === '/isl/rules/upsert') {
      const { rule, error } = cleanRule({ ...data.rule, updatedAt: new Date().toISOString() });
      if (error) return json(400, { error }, headers);
      const d = await load(env);
      const clash = d.rules.find((r) => r.id !== rule.id && patternKey(r) === patternKey(rule));
      if (clash) return json(409, { error: `Clashes with the published rule “${clash.english}”${clash.by ? ` by ${clash.by}` : ''} (same signs). Update the app to choose which to keep.` }, headers);
      const exists = d.rules.some((r) => r.id === rule.id);
      if (!exists && d.rules.length >= MAX_RULES) return json(413, { error: `At most ${MAX_RULES} rules.` }, headers);
      d.rules = exists ? d.rules.map((r) => (r.id === rule.id ? rule : r)) : [...d.rules, rule];
      const saved = await save(env, d);
      return json(200, { rules: d.rules.length, version: saved.version, updated: exists }, headers);
    }
    if (url.pathname === '/isl/rules/delete') {
      const id = String(data.id || '');
      const d = await load(env);
      const before = d.rules.length;
      d.rules = d.rules.filter((r) => r.id !== id);
      if (d.rules.length === before) return json(404, { error: 'No such rule (already deleted?).' }, headers);
      const saved = await save(env, d);
      return json(200, { rules: d.rules.length, version: saved.version }, headers);
    }
    // Older app versions send their whole list. It is MERGED (added / updated),
    // never used to remove rules: an out-of-date phone must not erase the
    // rules teammates added since it last synced. Deleting needs /rules/delete.
    if (url.pathname === '/isl/rules') {
      if (!Array.isArray(data.rules) || data.rules.length > MAX_RULES) return json(400, { error: `rules must be a list (max ${MAX_RULES}).` }, headers);
      const rules = [];
      const rejected = [];
      for (const raw of data.rules) {
        const { rule, error } = cleanRule(raw);
        if (error) rejected.push(error); else rules.push(rule);
      }
      if (rejected.length) return json(400, { error: 'Some rules are invalid.', rejected }, headers);
      const d = await load(env);
      const byId = new Map(d.rules.map((r) => [r.id, r]));
      for (const r of rules) byId.set(r.id, { ...byId.get(r.id), ...r });
      d.rules = [...byId.values()].slice(0, MAX_RULES);
      const saved = await save(env, d);
      return json(200, { rules: d.rules.length, version: saved.version }, headers);
    }
    return json(404, { error: 'Unknown endpoint.' }, headers);
  } catch (err) {
    return json(err.status || 500, { error: err.status ? err.message : 'ISL dictionary error.' }, headers);
  }
}
