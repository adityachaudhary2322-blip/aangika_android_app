/**
 * Background model updates.
 *
 * /models/index.json (written by training/publish_model.py, only after the
 * owner approves a release) lists published models:
 *   { "schema": 1, "models": [ { id, version, name, language, kind, runtime,
 *       engine, input, decode, vocabUrl, vocabSize, files, sharedFiles,
 *       licence, sourceUrl, accuracy, replaces? } ] }
 *
 * A model with a new id, or a higher version than the one this build knows,
 * is added to the registry and its files are downloaded in the background
 * (into the offline cache) so switching to it later is instant and offline.
 * No index, no network, or a bad entry: nothing changes.
 */

import { MODELS, REQUIRED_FIELDS } from '../config/models.js';
import engines from './engines/manager.js';

const INDEX_URL = '/models/index.json';
const listeners = new Set();
let lastResult = { checked: false, added: [], error: null };

export const getUpdateState = () => lastResult;
export function onUpdates(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Pure: which index entries are new or newer than the registry. */
export function newerModels(index, registry = MODELS) {
  const out = [];
  for (const m of index?.models || []) {
    if (REQUIRED_FIELDS.some((f) => m[f] === undefined) || !Number.isFinite(m.version)) continue;
    const known = registry.find((r) => r.id === m.id);
    if (!known || (known.version ?? 1) < m.version) out.push(m);
  }
  return out;
}

export async function checkForUpdates({ prefetch = true } = {}) {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return lastResult;
    const res = await fetch(INDEX_URL, { cache: 'no-cache' });
    if (!res.ok) { lastResult = { checked: true, added: [], error: null }; return lastResult; }
    const index = await res.json();
    const fresh = newerModels(index);
    for (const m of fresh) {
      const i = MODELS.findIndex((r) => r.id === m.id);
      const entry = { ...m, default: false, fromIndex: true };
      if (i >= 0) MODELS[i] = { ...MODELS[i], ...entry, default: MODELS[i].default };
      else MODELS.push(entry);
    }
    lastResult = { checked: true, added: fresh.map((m) => `${m.id} v${m.version}`), error: null };
    listeners.forEach((fn) => fn(lastResult));
    if (prefetch) {
      for (const m of fresh) {
        // eslint-disable-next-line no-await-in-loop
        await engines.prefetch(m.id).catch(() => {});
      }
    }
  } catch (err) {
    lastResult = { checked: true, added: [], error: err.message };
  }
  return lastResult;
}

export default { checkForUpdates, newerModels, getUpdateState, onUpdates };
