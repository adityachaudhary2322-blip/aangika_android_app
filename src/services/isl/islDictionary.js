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
let ruleDrafts = [];      // rules made on THIS device, not yet published (same id = an edit)
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
  ? idb('readwrite', (s) => { s.put(shared, 'shared'); s.put(drafts, 'drafts'); s.put(ruleDrafts, 'ruleDrafts'); }).catch(() => {})
  : Promise.resolve());

export function init() {
  if (ready) return ready;
  ready = (async () => {
    if (!hasIDB()) return;
    try {
      const [s, d, rd] = await Promise.all([idb('readonly', (st) => st.get('shared')), idb('readonly', (st) => st.get('drafts')), idb('readonly', (st) => st.get('ruleDrafts'))]);
      if (s && typeof s === 'object') shared = s;
      if (Array.isArray(d)) drafts = d;
      if (Array.isArray(rd)) ruleDrafts = rd;
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
const okRule = (r) => r && typeof r.id === 'string' && Array.isArray(r.pattern) && r.pattern.length && typeof r.english === 'string';
/** The team's published rules. */
export const getPublishedRules = () => arr(shared?.rules).filter(okRule);
/** This device's unpublished rules. */
export const listRuleDrafts = () => arr(ruleDrafts).filter(okRule);
/**
 * The rules this device translates with: published ones, with this device's
 * drafts on top (so a new rule can be tried before it is published).
 */
export function getRules() {
  const byId = new Map(getPublishedRules().map((r) => [r.id, { ...r, status: 'published' }]));
  for (const r of listRuleDrafts()) byId.set(r.id, { ...r, status: byId.has(r.id) ? 'edited' : 'draft' });
  return [...byId.values()];
}
/** Same signs in the same order (what makes two rules clash). */
export const rulePatternKey = (r) => arr(r?.pattern).map((p) => String(p).toUpperCase()).join(' ');

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
  if (res.status === 304) { markRecoveryDone(); return 'current'; }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const d = await res.json();
  recoverLostRules(d.rules || []);
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

// ── One-time rescue of rules lost to the old whole-list saves ──────────────
//
// Until 1.9.2 every rule save replaced the server's whole list with the
// saving phone's copy, so rules teammates added in between were erased. A
// phone that has not refreshed since may still hold them: on the first sync
// of this version, rules this device knows that the server no longer has
// (and whose signs no live rule uses) become drafts marked "recovered", for
// their owner to publish (with the clash check) or discard. Once per device.
const RECOVERY_KEY = 'aangika-isl-rule-recovery-1';
function recoveryDone() { try { return localStorage.getItem(RECOVERY_KEY) === 'done'; } catch { return true; } }
function markRecoveryDone() { try { localStorage.setItem(RECOVERY_KEY, 'done'); } catch { /* no storage */ } }
function recoverLostRules(serverRules) {
  if (recoveryDone()) return;
  markRecoveryDone();
  if (!shared.version) return;                                   // nothing stored on this device yet
  const ids = new Set(serverRules.map((r) => r.id));
  const pats = new Set(serverRules.map(rulePatternKey));
  const lost = getPublishedRules().filter((r) => !ids.has(r.id) && !pats.has(rulePatternKey(r)) && !ruleDrafts.some((x) => x.id === r.id));
  if (lost.length) ruleDrafts = [...ruleDrafts, ...lost.map((r) => ({ ...r, recovered: true, updatedAt: new Date().toISOString() }))];
}
export const recoveredRuleCount = () => ruleDrafts.filter((r) => r.recovered).length;

// ── Rule drafts ─────────────────────────────────────────────────────────────

/** Save a rule on this device only (a draft), until it is published. */
export async function saveRuleDraft(rule) {
  await init();
  ruleDrafts = [...ruleDrafts.filter((r) => r.id !== rule.id), { ...rule, updatedAt: new Date().toISOString() }];
  await persist();
  emit();
  return rule;
}

export async function discardRuleDraft(id) {
  await init();
  ruleDrafts = ruleDrafts.filter((r) => r.id !== id);
  await persist();
  emit();
}

/**
 * Publish rule drafts (by id) for everyone. The server refuses a draft that
 * uses the same signs as a different published rule (a clash), unless its id
 * is in `replace` ("replace theirs"). -> { published: [ids], conflicts: [{ id, existing }] }
 */
export async function publishRules(code, ids, { replace = [] } = {}) {
  const chosen = listRuleDrafts().filter((r) => ids.includes(r.id)).map(({ status, ...r }) => r);
  if (!chosen.length) throw new Error('No draft rules to publish.');
  const result = await post('/isl/rules/publish', { code, rules: chosen, replace });
  ruleDrafts = ruleDrafts.filter((r) => !result.published.includes(r.id));
  await persist();
  await sync({ force: true });
  emit();
  return result;
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

/** Add or update ONE rule on the server (merged there; never overwrites others'). */
export async function upsertRule(code, rule) {
  const result = await post('/isl/rules/upsert', { code, rule });
  await sync({ force: true });
  return result;
}

export async function deleteRule(code, id) {
  const result = await post('/isl/rules/delete', { code, id });
  await sync({ force: true });
  return result;
}

/** Older API: the whole list, now merged on the server (never removes). */
export async function saveRules(code, rules) {
  const result = await post('/isl/rules', { code, rules });
  await sync({ force: true });
  return result;
}

/** Test hook. */
/** Tests only: load exactly this data, as if read from storage. */
export function _loadForTests(sharedData, draftData) { shared = sharedData; drafts = draftData; ruleDrafts = []; ready = Promise.resolve(); }
export function _resetForTests() { shared = { version: 0, signs: [], rules: [] }; drafts = []; ruleDrafts = []; ready = Promise.resolve(); }

export default {
  init, subscribe, listSigns, getSign, getRules, saveDraft, discardDraft, sync, publish, removeSigns,
  saveRules, upsertRule, deleteRule, listDeleted, getPublishedRules, listRuleDrafts, saveRuleDraft, discardRuleDraft, publishRules, rulePatternKey, restoreSigns, isAvailable, tokenFor, version, listDrafts,
};
