/**
 * ISL Studio dictionary: the team's own ISL signs, each recorded (a few
 * takes of upper-body features, islFeatures.js) and assigned a word by the
 * team. Shared with every user; editing needs the developer code.
 *
 *   GET  /isl                 anyone: { signs, rules, version } (ETag / 304)
 *   POST /isl/publish         { code, signs: [...] }  add or update
 *   POST /isl/remove          { code, ids: [...] }
 *   POST /isl/rules           { code, rules: [...] }  this dictionary's rules
 *
 * Stored in Workers KV (binding DICT) under the key 'isl'.
 */

import { json, checkCode, readJson, cleanRule } from './dictionary.js';

const KEY = 'isl';
export const ISL_FORMAT = 'aangika-isl/1';
export const FEATURE_DIM = 100;             // islFeatures.js FEATURE_DIM
export const FEATURE_VERSION = 1;
const MAX_SIGNS = 400;
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
  d.version = (d.version || 0) + 1;
  d.updatedAt = new Date().toISOString();
  const body = JSON.stringify(d);
  if (body.length > MAX_BYTES) throw Object.assign(new Error('The ISL dictionary would be too large.'), { status: 413 });
  await env.DICT.put(KEY, body);
  return d;
}

const num01 = (v) => typeof v === 'number' && Number.isFinite(v) && v >= -0.001 && v <= 1.001;

/** Keep only well-formed fields; round features to 3 decimals. */
export function cleanIslSign(s) {
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
  return {
    sign: {
      id: String(s.id || '').slice(0, 64) || token,
      token, word, texts, category, type: s.type,
      hands: ['one', 'two', 'either'].includes(s.hands) ? s.hands : 'one',
      takes: clean,
      ...(num01(s.tau) ? { tau: s.tau } : {}),
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
      const before = d.signs.length;
      d.signs = d.signs.filter((s) => !ids.has(s.id));
      const removed = before - d.signs.length;
      const saved = removed ? await save(env, d) : d;
      return json(200, { removed, version: saved.version, total: saved.signs.length }, headers);
    }
    if (url.pathname === '/isl/rules') {
      if (!Array.isArray(data.rules) || data.rules.length > 100) return json(400, { error: 'rules must be a list (max 100).' }, headers);
      const rules = [];
      const rejected = [];
      for (const raw of data.rules) {
        const { rule, error } = cleanRule(raw);
        if (error) rejected.push(error); else rules.push(rule);
      }
      if (rejected.length) return json(400, { error: 'Some rules are invalid.', rejected }, headers);
      const d = await load(env);
      d.rules = rules;
      const saved = await save(env, d);
      return json(200, { rules: rules.length, version: saved.version }, headers);
    }
    return json(404, { error: 'Unknown endpoint.' }, headers);
  } catch (err) {
    return json(err.status || 500, { error: err.status ? err.message : 'ISL dictionary error.' }, headers);
  }
}
