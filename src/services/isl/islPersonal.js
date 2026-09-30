/**
 * My dictionary: one person's own ISL Studio layer on top of the team's.
 *
 * Private and never publishable (there is no publish path from here; the
 * server also refuses personal signs on /isl/publish). It holds:
 *
 *   signs      signs this person recorded ({...team sign shape, personal: true,
 *              id 'p-…', disabled?})
 *   overrides  changes to TEAM signs for this person only, by team sign id:
 *              { word?, texts?, category?, hidden?, disabled?, by? }
 *                word/texts/category  "Change for me": same recording, my word
 *                hidden               "Hide for me" / "use mine instead"
 *                by                   the personal sign that hid it (deleting or
 *                                     disabling that sign brings the team sign back)
 *   deleted    tombstones {id: time}, so a delete survives syncing
 *
 * effectiveSigns(team, data) is what every translator uses. It is pure: every
 * change is an entry here, so removing or disabling the entry restores the
 * team's sign by construction.
 *
 * Stored in IndexedDB on this device (works signed out and offline); when
 * logged in, session.js keeps a copy on the server (private to the account).
 */

import { FEATURE_DIM, FEATURE_VERSION } from './islFeatures.js';
import { tokenFor } from './islDictionary.js';

const DB = 'aangika-isl-personal';
const STORE = 'kv';
const KEY = 'mine';
const TOMBSTONE_DAYS = 60;
const listeners = new Set();

const empty = () => ({ version: 0, updatedAt: 0, signs: [], overrides: {}, deleted: {} });
let data = empty();
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
const persist = () => (hasIDB() ? idb('readwrite', (s) => s.put(data, KEY)).catch(() => {}) : Promise.resolve());

function emit() { listeners.forEach((fn) => { try { fn(); } catch { /* listener bug */ } }); }
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function init() {
  if (ready) return ready;
  ready = (async () => {
    if (!hasIDB()) return;
    try {
      const d = await idb('readonly', (st) => st.get(KEY));
      if (d && typeof d === 'object') data = normalise(d);
    } catch { /* blocked storage: memory only */ }
    emit();
  })();
  return ready;
}

const arr = (x) => (Array.isArray(x) ? x : []);
const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
function normalise(d) {
  return {
    version: Number(d.version) || 0,
    updatedAt: Number(d.updatedAt) || 0,
    signs: arr(d.signs).filter((s) => s && typeof s.id === 'string' && typeof s.word === 'string' && s.word.trim()),
    overrides: obj(d.overrides),
    deleted: obj(d.deleted),
  };
}

async function commit(next) {
  data = { ...next, version: data.version + 1, updatedAt: Date.now() };
  await persist();
  emit();
}

const newId = () => `p-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`}`;

// ── Reading ─────────────────────────────────────────────────────────────────

export const getData = () => data;
export const listPersonal = () => data.signs.slice().sort((a, b) => a.word.localeCompare(b.word));
export const getOverride = (teamId) => data.overrides[teamId] || null;
export const listOverrides = () => Object.entries(data.overrides).map(([id, o]) => ({ id, ...o }));
export const isEmpty = () => !data.signs.length && !Object.keys(data.overrides).length;

/**
 * The dictionary this person translates with: team signs with their own
 * changes applied (hidden ones left out), plus their enabled own signs.
 */
export function effectiveSigns(team, d = data) {
  const out = [];
  const hiders = new Map(arr(d.signs).map((s) => [s.id, s]));
  for (const s of arr(team)) {
    const o = d.overrides?.[s.id];
    if (!o || o.disabled) { out.push(s); continue; }
    // A sign hidden BY one of my signs comes back when that sign is disabled or deleted.
    const hider = o.by ? hiders.get(o.by) : null;
    const hidden = o.hidden && (!o.by || (hider && !hider.disabled));
    if (hidden) continue;
    const changed = o.word || o.texts || o.category;
    out.push(changed ? {
      ...s,
      word: o.word || s.word,
      token: o.word ? tokenFor(o.word) : s.token,
      texts: o.texts ? { ...s.texts, ...o.texts } : s.texts,
      category: o.category || s.category,
      overriddenForMe: true,
      teamWord: s.word,
    } : s);
  }
  for (const p of arr(d.signs)) if (!p.disabled) out.push({ ...p, personal: true, status: 'mine' });
  return out.sort((a, b) => a.word.localeCompare(b.word));
}

// ── My signs ────────────────────────────────────────────────────────────────

/**
 * Save one of my signs. `replaces`: team sign ids to hide for me while this
 * sign is enabled ("use mine instead of …"). -> the sign
 */
export async function savePersonal(input, { replaces = [] } = {}) {
  await init();
  const word = String(input.word || '').trim();
  if (!word) throw new Error('Enter the word this sign means.');
  const token = tokenFor(word);
  if (!/^[A-Z0-9_]{1,32}$/.test(token)) throw new Error('The word needs letters or digits.');
  const takes = arr(input.takes).map((t) => arr(t).map((f) => Array.from(f)));
  if (!takes.length) throw new Error('Record the sign first.');
  if (takes.some((t) => t.some((f) => f.length !== FEATURE_DIM))) throw new Error('Recording is from another app version; record it again.');
  const id = input.id && String(input.id).startsWith('p-') ? input.id : newId();
  const sign = {
    id, token, word,
    texts: obj(input.texts),
    category: input.category || 'other',
    type: ['word', 'name', 'sentence', 'full-stop'].includes(input.type) ? input.type : 'word',
    hands: input.hands || 'one',
    ...(input.description ? { description: String(input.description).slice(0, 500) } : {}),
    takes,
    personal: true,
    disabled: Boolean(input.disabled),
    featureVersion: FEATURE_VERSION,
    updatedAt: Date.now(),
  };
  const overrides = { ...data.overrides };
  for (const teamId of replaces) overrides[teamId] = { ...overrides[teamId], hidden: true, by: id, updatedAt: Date.now() };
  const deleted = { ...data.deleted };
  delete deleted[id];
  await commit({ ...data, signs: [...data.signs.filter((s) => s.id !== id), sign], overrides, deleted });
  return sign;
}

export async function setPersonalDisabled(id, disabled) {
  await init();
  await commit({ ...data, signs: data.signs.map((s) => (s.id === id ? { ...s, disabled, updatedAt: Date.now() } : s)) });
}

/** Delete one of my signs; team signs it replaced come back. */
export async function removePersonal(id) {
  await init();
  const overrides = {};
  const deleted = { ...data.deleted, [id]: Date.now() };
  for (const [teamId, o] of Object.entries(data.overrides)) {
    if (o.by === id) {
      const { hidden, by, ...rest } = o;
      if (rest.word || rest.texts || rest.category) overrides[teamId] = { ...rest, updatedAt: Date.now() };
      else deleted[`o:${teamId}`] = Date.now();
    } else overrides[teamId] = o;
  }
  await commit({ ...data, signs: data.signs.filter((s) => s.id !== id), overrides, deleted });
}

// ── My changes to team signs ────────────────────────────────────────────────

/** "Change for me" / "Hide for me": patch = { word?, texts?, category?, hidden?, disabled? } */
export async function setOverride(teamId, patch) {
  await init();
  const next = { ...data.overrides[teamId], ...patch, updatedAt: Date.now() };
  if (patch.hidden === false) { delete next.hidden; delete next.by; }
  const deleted = { ...data.deleted };
  delete deleted[`o:${teamId}`];
  await commit({ ...data, overrides: { ...data.overrides, [teamId]: next }, deleted });
}

/** Undo every change to a team sign: the team's version is back. */
export async function clearOverride(teamId) {
  await init();
  const overrides = { ...data.overrides };
  delete overrides[teamId];
  await commit({ ...data, overrides, deleted: { ...data.deleted, [`o:${teamId}`]: Date.now() } });
}

// ── Sync (session.js) ───────────────────────────────────────────────────────

/**
 * Merge a copy from elsewhere (the server) with this device's: per sign and
 * per override the newer change wins; deletions travel as tombstones.
 */
export function merge(a, b) {
  const A = normalise(a); const B = normalise(b);
  const deleted = { ...A.deleted };
  for (const [k, t] of Object.entries(B.deleted)) deleted[k] = Math.max(deleted[k] || 0, t);

  const signs = new Map();
  for (const s of [...A.signs, ...B.signs]) {
    const cur = signs.get(s.id);
    if (!cur || (s.updatedAt || 0) > (cur.updatedAt || 0)) signs.set(s.id, s);
  }
  for (const [id, s] of signs) if ((deleted[id] || 0) >= (s.updatedAt || 0)) signs.delete(id);

  const overrides = {};
  for (const [id, o] of [...Object.entries(A.overrides), ...Object.entries(B.overrides)]) {
    if (!overrides[id] || (o.updatedAt || 0) > (overrides[id].updatedAt || 0)) overrides[id] = o;
  }
  for (const id of Object.keys(overrides)) if ((deleted[`o:${id}`] || 0) >= (overrides[id].updatedAt || 0)) delete overrides[id];
  // Tombstones are applied first, then old ones are forgotten.
  const cutoff = Date.now() - TOMBSTONE_DAYS * 86_400_000;
  for (const [k, t] of Object.entries(deleted)) if (t < cutoff) delete deleted[k];

  return { version: Math.max(A.version, B.version), updatedAt: Math.max(A.updatedAt, B.updatedAt), signs: [...signs.values()], overrides, deleted };
}

/** Replace this device's copy (after a merge). */
export async function replaceData(next) {
  data = normalise(next);
  await persist();
  emit();
}

/** Tests only. */
export function _resetForTests(d = empty()) { data = normalise(d); ready = Promise.resolve(); }

export default {
  init, subscribe, getData, listPersonal, getOverride, listOverrides, isEmpty, effectiveSigns,
  savePersonal, setPersonalDisabled, removePersonal, setOverride, clearOverride, merge, replaceData,
};
