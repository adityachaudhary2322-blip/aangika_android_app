/**
 * ISL Studio dictionary on the device.
 *
 *   shared   the team's published dictionary (server /isl), synced, kept offline
 *   drafts   signs recorded on THIS device, not yet published (a draft with
 *            the id of a published sign is an edit of it)
 *
 * A sign: { id, token, word, texts: {'hi-IN', hinglish}, category,
 *   type: 'word' | 'name' | 'sentence' | 'full-stop',
 *   hands: 'one' | 'two' | 'either', takes: [frames[]], tau?, publishedAt? }
 * Takes are islFeatures frames (plain arrays of FEATURE_DIM numbers).
 *
 * Persistence: IndexedDB (two records), in-memory when unavailable.
 */

import { apiBase } from '../apiBase.js';
import { FEATURE_DIM, FEATURE_VERSION } from './islFeatures.js';

const DB = 'aangika-isl';
const STORE = 'kv';
const listeners = new Set();

let shared = { version: 0, signs: [], rules: [] };
let drafts = [];
let ready = null;

const hasIDB = () => typeof indexedDB !== 'undefined' && indexedDB !== null;
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { db.close(); resolve(out?.result); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    };
  });
}
const persist = () => (hasIDB()
  ? idb('readwrite', (s) => { s.put(shared, 'shared'); s.put(drafts, 'drafts'); }).catch(() => {})
  : Promise.resolve());

export function init() {
  if (ready) return ready;
  ready = (async () => {
    if (!hasIDB()) return;
    try {
      const [s, d] = await Promise.all([idb('readonly', (st) => st.get('shared')), idb('readonly', (st) => st.get('drafts'))]);
      if (s && typeof s === 'object') shared = s;
      if (Array.isArray(d)) drafts = d;
    } catch { /* blocked storage: memory only */ }
    emit();
  })();
  return ready;
}

function emit() { listeners.forEach((fn) => { try { fn(); } catch { /* listener bug */ } }); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Every usable sign: published ones, with this device's drafts on top. */
export function listSigns() {
  const byId = new Map(arr(shared?.signs).filter(okSign).map((s) => [s.id, { ...tidy(s), status: 'published' }]));
  for (const d of arr(drafts).filter(okSign)) byId.set(d.id, { ...tidy(d), status: byId.has(d.id) ? 'edited' : 'draft' });
  return [...byId.values()].sort((a, b) => a.word.localeCompare(b.word));
}
export const getSign = (id) => listSigns().find((s) => s.id === id) || null;
export const getRules = () => arr(shared?.rules).filter((r) => r && typeof r.id === 'string' && Array.isArray(r.pattern) && r.pattern.length && typeof r.english === 'string');

// Stored or downloaded data is never trusted to have every field: one odd
// sign must not take the whole screen down.
const arr = (x) => (Array.isArray(x) ? x : []);
const okSign = (s) => s && typeof s.id === 'string' && typeof s.word === 'string' && s.word.trim();
const tidy = (s) => ({
  ...s,
  token: typeof s.token === 'string' && s.token ? s.token : tokenFor(s.word),
  texts: s.texts && typeof s.texts === 'object' ? s.texts : {},
  takes: arr(s.takes).filter((t) => Array.isArray(t) && t.every(Array.isArray)),
});
export const version = () => shared.version || 0;
export const listDrafts = () => drafts;

export const tokenFor = (word) => String(word || '').normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32);

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `isl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

/** Create or update a draft (validated). -> the draft */
export async function saveDraft(input) {
  await init();
  const word = String(input.word || '').trim();
  if (!word) throw new Error('Enter the word this sign means.');
  const token = input.token || tokenFor(word);
  if (!/^[A-Z0-9_]{1,32}$/.test(token)) throw new Error('The word needs letters or digits.');
  const id = input.id || newId();
  const clash = listSigns().find((s) => s.token === token && s.id !== id);
  if (clash) throw new Error(`"${clash.word}" already uses this name (${token}).`);
  const takes = (input.takes || []).map((t) => t.map((f) => Array.from(f)));
  if (takes.some((t) => t.some((f) => f.length !== FEATURE_DIM))) throw new Error('Recording is from another app version; record it again.');
  const draft = {
    id, token, word,
    texts: input.texts || {},
    category: input.category || 'other',
    type: input.type || 'word',
    hands: input.hands || 'one',
    ...(input.description ? { description: String(input.description).trim().slice(0, 500) } : {}),
    ...(input.videoUrl ? { videoUrl: String(input.videoUrl).trim().slice(0, 300) } : {}),
    takes,
    featureVersion: FEATURE_VERSION,
    updatedAt: Date.now(),
  };
  drafts = [...drafts.filter((d) => d.id !== id), draft];
  await persist();
  emit();
  return draft;
}

export async function discardDraft(id) {
  await init();
  drafts = drafts.filter((d) => d.id !== id);
  await persist();
  emit();
}

// ── Server ──────────────────────────────────────────────────────────────────

export const isAvailable = () => Boolean(apiBase());

async function post(path, body) {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `HTTP ${res.status}`);
    err.status = res.status; err.rejected = data.rejected;
    throw err;
  }
  return data;
}

/**
 * Recovery: forget this device's cached dictionary (and unpublished drafts),
 * then download the team's published one again.
 */
export async function resetLocal() {
  shared = { version: 0, signs: [], rules: [] };
  drafts = [];
  await persist();
  emit();
  await sync({ force: true }).catch(() => {});
}

/** Fetch the published dictionary if it changed. -> 'updated' | 'current' | 'offline' | 'unavailable' */
export async function sync({ force = false } = {}) {
  await init();
  if (!isAvailable()) return 'unavailable';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  const headers = !force && shared.version ? { 'If-None-Match': `"i${shared.version}"` } : {};
  const res = await fetch(`${apiBase()}/isl`, { headers, cache: 'no-store' });
  if (res.status === 304) return 'current';
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  shared = { version: d.version || 0, signs: d.signs || [], rules: d.rules || [] };
  // A draft identical to what is now published is done.
  drafts = drafts.filter((dr) => {
    const pub = shared.signs.find((s) => s.id === dr.id);
    return !(pub && pub.publishedAt && Date.parse(pub.publishedAt) >= dr.updatedAt);
  });
  await persist();
  emit();
  return 'updated';
}

/** Publish drafts (by id) for everyone. */
export async function publish(code, ids) {
  const chosen = drafts.filter((d) => ids.includes(d.id));
  if (!chosen.length) throw new Error('Nothing to publish.');
  const result = await post('/isl/publish', { code, signs: chosen });
  await sync({ force: true });
  return result;
}

/** Delete published signs for everyone (and any local draft of them). */
export async function removeSigns(code, ids) {
  const result = await post('/isl/remove', { code, ids });
  drafts = drafts.filter((d) => !ids.includes(d.id));
  await sync({ force: true });
  return result;
}

/** Recently deleted signs (the server keeps them so a delete can be undone). */
export const listDeleted = (code) => post('/isl/deleted', { code }).then((r) => r.deleted || []);

export async function restoreSigns(code, ids) {
  const result = await post('/isl/restore', { code, ids });
  await sync({ force: true });
  return result;
}

export async function saveRules(code, rules) {
  const result = await post('/isl/rules', { code, rules });
  await sync({ force: true });
  return result;
}

/** Test hook. */
/** Tests only: load exactly this data, as if read from storage. */
export function _loadForTests(sharedData, draftData) { shared = sharedData; drafts = draftData; ready = Promise.resolve(); }
export function _resetForTests() { shared = { version: 0, signs: [], rules: [] }; drafts = []; ready = Promise.resolve(); }

export default {
  init, subscribe, listSigns, getSign, getRules, saveDraft, discardDraft, sync, publish, removeSigns,
  saveRules, listDeleted, restoreSigns, isAvailable, tokenFor, version, listDrafts,
};
