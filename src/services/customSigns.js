/**
 * "My signs": the user's own sign library, shared by every engine.
 *
 * Record shape:
 *   { id, token,                       // UPPERCASE, unique vs built-ins and model vocab
 *     kind: 'handshape' | 'movement',
 *     output: { type: 'word' | 'name' | 'sentence', text_en, texts: {langCode: text},
 *               category?,             // word signs, used by sentence mode
 *               pendingLangs? },       // languages still to be filled online
 *     hands: 'one' | 'two', eitherHand, side,   // side: recorded hand, one-handed
 *     location,                        // bucket, for display and conflicts
 *     samples: [packSample(...)],      // RAW landmarks, see handshapeFeatures.js
 *     calibration?,                    // cached by customHandshapes.js
 *     untrained?,                      // migrated entry with no samples yet
 *     createdAt, updatedAt }
 *
 * Persistence is IndexedDB. Where IndexedDB does not exist (node tests,
 * some private modes) the same API runs on an in-memory map, so nothing
 * crashes and the UI can say "not saved on this device".
 *
 * Reads are synchronous from an in-memory cache, because the classifier runs
 * on every camera frame and cannot await a database.
 */

import { GESTURE_TOKENS } from '../config/gestureSentences.js';

const DB_NAME = 'aangika-custom-signs';
const STORE = 'signs';
const META = 'meta';
const DB_VERSION = 1;
export const EXPORT_FORMAT = 'aangika-custom-signs/1';

export const OUTPUT_TYPES = ['word', 'name', 'sentence'];
export const WORD_CATEGORIES = [
  'pronoun', 'person', 'action', 'thing', 'place', 'time', 'describing',
  'question', 'negation', 'other',
];

let cache = new Map();          // id -> record
let reserved = new Set(GESTURE_TOKENS);
let ready = null;
let persistent = false;
const listeners = new Set();

// ── Backend ─────────────────────────────────────────────────────────────────

const hasIDB = () => typeof indexedDB !== 'undefined' && indexedDB !== null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(storeName, mode);
    const store = t.objectStore(storeName);
    const out = fn(store);
    t.oncomplete = () => { db.close(); resolve(out?.result ?? out); };
    t.onerror = () => { db.close(); reject(t.error); };
    t.onabort = () => { db.close(); reject(t.error); };
  }));
}

const getAll = () => tx(STORE, 'readonly', (s) => s.getAll());
const putRecord = (r) => (persistent ? tx(STORE, 'readwrite', (s) => s.put(r)) : Promise.resolve());
const deleteRecord = (id) => (persistent ? tx(STORE, 'readwrite', (s) => s.delete(id)) : Promise.resolve());
const getMeta = (k) => (persistent ? tx(META, 'readonly', (s) => s.get(k)) : Promise.resolve(memMeta[k]));
const setMeta = (k, v) => {
  memMeta[k] = v;
  return persistent ? tx(META, 'readwrite', (s) => s.put(v, k)) : Promise.resolve();
};
const memMeta = {};

// ── Lifecycle ───────────────────────────────────────────────────────────────

/** Load the library into memory. Idempotent; safe to call from anywhere. */
export function init() {
  if (ready) return ready;
  ready = (async () => {
    if (hasIDB()) {
      try {
        const rows = await getAll();
        persistent = true;
        cache = new Map(rows.map((r) => [r.id, r]));
      } catch {
        persistent = false;          // blocked storage: run in memory
      }
    }
    emit();
    return listSigns();
  })();
  return ready;
}

export const isPersistent = () => persistent;

/** Test hook: forget everything and start again in memory. */
export function _resetForTests() {
  cache = new Map();
  ready = Promise.resolve([]);
  persistent = false;
  for (const k of Object.keys(memMeta)) delete memMeta[k];
  version += 1;
}

/** Tokens a custom sign may not take: built-in gestures and model vocabulary. */
export function setReservedTokens(tokens) {
  reserved = new Set([...GESTURE_TOKENS, ...[...tokens].map((t) => String(t).toUpperCase())]);
}

// ── Change notification ─────────────────────────────────────────────────────

let version = 0;
/** Bumped on every change; the classifier re-indexes when it moves. */
export const getVersion = () => version;

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  version += 1;
  const list = listSigns();
  for (const fn of listeners) {
    try { fn(list); } catch { /* a listener's bug is not the store's */ }
  }
}

// ── Queries (synchronous) ───────────────────────────────────────────────────

export function listSigns() {
  return [...cache.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export const getSign = (id) => cache.get(id) || null;

export function findByToken(token) {
  const t = String(token || '').toUpperCase();
  for (const r of cache.values()) if (r.token === t) return r;
  return null;
}

/** Text for a sign's output in a language, falling back to English. */
export function textFor(sign, code = 'en-IN') {
  if (!sign) return null;
  const o = sign.output || {};
  if (code === 'en-IN') return o.text_en || null;
  return o.texts?.[code] || o.text_en || null;
}

// ── Validation ──────────────────────────────────────────────────────────────

/** "Good morning!" -> "GOOD_MORNING". */
export function tokenFromText(text) {
  return String(text || '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, 32);
}

export function validate(record, { ignoreId = null } = {}) {
  const errors = [];
  const token = String(record.token || '').toUpperCase();
  if (!/^[A-Z0-9_]{1,32}$/.test(token)) errors.push('Token must be 1-32 letters, digits or _.');
  if (reserved.has(token)) errors.push(`${token} is already a built-in sign or model word.`);
  const clash = findByToken(token);
  if (clash && clash.id !== ignoreId) errors.push(`You already have a sign called ${token}.`);
  if (!['handshape', 'movement'].includes(record.kind)) errors.push('Unknown sign kind.');
  if (!['one', 'two'].includes(record.hands)) errors.push('Choose one or two hands.');
  const o = record.output || {};
  if (!OUTPUT_TYPES.includes(o.type)) errors.push('Choose word, name or sentence.');
  if (!String(o.text_en || '').trim()) errors.push('Enter the text this sign means.');
  if (o.type === 'word' && o.category && !WORD_CATEGORIES.includes(o.category)) {
    errors.push('Unknown word category.');
  }
  return errors;
}

// ── Mutations ───────────────────────────────────────────────────────────────

const newId = () => (typeof crypto !== 'undefined' && crypto.randomUUID
  ? crypto.randomUUID()
  : `sign-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

/** Create or update. Throws with the validation messages when invalid. */
export async function saveSign(input) {
  await init();
  const now = Date.now();
  const prev = input.id ? cache.get(input.id) : null;
  const record = {
    kind: 'handshape',
    hands: 'one',
    eitherHand: false,
    samples: [],
    ...prev,
    ...input,
    token: String(input.token || prev?.token || '').toUpperCase(),
    id: prev?.id || input.id || newId(),
    createdAt: prev?.createdAt || input.createdAt || now,
    updatedAt: now,
  };
  record.output = { texts: {}, ...(prev?.output || {}), ...(input.output || {}) };
  record.untrained = !record.samples?.length;
  const errors = validate(record, { ignoreId: record.id });
  if (errors.length) {
    const err = new Error(errors.join(' '));
    err.errors = errors;
    throw err;
  }
  cache.set(record.id, record);
  await putRecord(record);
  emit();
  return record;
}

export async function deleteSign(id) {
  await init();
  cache.delete(id);
  await deleteRecord(id);
  emit();
}

// ── Export / import ─────────────────────────────────────────────────────────

export function exportJSON() {
  return JSON.stringify({
    format: EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    signs: listSigns(),
  }, null, 2);
}

/**
 * Import signs from exportJSON() output.
 * mode 'merge': keep existing signs, and rename imported tokens that clash
 *               (FOO -> FOO_2).
 * mode 'replace': delete everything first.
 * Returns {added, renamed, skipped: [{token, reason}]}.
 */
export async function importJSON(json, { mode = 'merge' } = {}) {
  await init();
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  if (data?.format !== EXPORT_FORMAT || !Array.isArray(data.signs)) {
    throw new Error('Not an Aangika sign export.');
  }
  if (mode === 'replace') {
    for (const id of [...cache.keys()]) { cache.delete(id); await deleteRecord(id); }
  }
  const report = { added: 0, renamed: [], skipped: [] };
  for (const raw of data.signs) {
    const r = { ...raw, id: undefined };
    let token = String(r.token || '').toUpperCase();
    if (findByToken(token) || reserved.has(token)) {
      let n = 2;
      while (findByToken(`${token}_${n}`) || reserved.has(`${token}_${n}`)) n += 1;
      report.renamed.push([token, `${token}_${n}`]);
      token = `${token}_${n}`;
    }
    try {
      await saveSign({ ...r, token, createdAt: raw.createdAt });
      report.added += 1;
    } catch (err) {
      report.skipped.push({ token, reason: err.message });
    }
  }
  return report;
}

// ── One-time migration from vocab.json custom_signs ─────────────────────────

/**
 * vocab.json lists NAMASTE / HELLO / MY / NAME / ADITYA under custom_signs.
 * Entries the model already emits (in_model) and tokens that are built-in
 * gestures stay where they are; the rest become UNTRAINED entries waiting for
 * the user to record them. Runs once per device.
 */
export async function migrateFromVocab(vocab) {
  await init();
  if (await getMeta('migratedVocab')) return { migrated: [], skipped: [] };
  const TYPE = { greeting: 'word', pronoun: 'word', noun: 'word', proper_noun: 'name' };
  const CATEGORY = { greeting: 'other', pronoun: 'pronoun', noun: 'thing' };
  const TEXT = { NAMASTE: 'Namaste', HELLO: 'Hello', MY: 'my', ADITYA: 'Aditya' };
  const HI = { NAMASTE: 'नमस्ते', HELLO: 'नमस्ते', MY: 'मेरा', ADITYA: 'आदित्य' };
  const migrated = [];
  const skipped = [];
  for (const e of vocab?.custom_signs?.entries || []) {
    const token = String(e.token || '').toUpperCase();
    if (e.in_model) { skipped.push({ token, reason: 'already a model word' }); continue; }
    if (reserved.has(token)) { skipped.push({ token, reason: 'built-in SignBridge sign' }); continue; }
    if (findByToken(token)) { skipped.push({ token, reason: 'already in My signs' }); continue; }
    const type = TYPE[e.type] || 'word';
    await saveSign({
      token,
      kind: 'handshape',
      hands: 'one',
      output: {
        type,
        text_en: TEXT[token] || token.charAt(0) + token.slice(1).toLowerCase(),
        texts: HI[token] ? { 'hi-IN': HI[token] } : {},
        ...(type === 'word' ? { category: CATEGORY[e.type] || 'other' } : {}),
      },
      samples: [],
      migratedFrom: 'vocab.json',
    });
    migrated.push(token);
  }
  await setMeta('migratedVocab', true);
  return { migrated, skipped };
}

/**
 * My signs holds only what the user taught. Earlier builds seeded it with
 * untrained placeholders from vocab.json (NAMASTE, HELLO, MY, ADITYA); those
 * belong with the normal words, so remove any the user never recorded. A
 * placeholder the user DID record samples for is theirs now and stays.
 */
export async function prunePlaceholders() {
  await init();
  const removed = [];
  for (const r of [...cache.values()]) {
    if (r.migratedFrom === 'vocab.json' && !r.samples?.length) {
      cache.delete(r.id);
      await deleteRecord(r.id);
      removed.push(r.token);
    }
  }
  if (removed.length) emit();
  return removed;
}

export default {
  init, listSigns, prunePlaceholders, getSign, findByToken, saveSign, deleteSign, exportJSON,
  importJSON, migrateFromVocab, subscribe, getVersion, textFor, tokenFromText,
  validate, setReservedTokens, isPersistent, OUTPUT_TYPES, WORD_CATEGORIES,
};
