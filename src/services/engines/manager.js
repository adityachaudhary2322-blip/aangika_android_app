/**
 * The one place recognition engines are created, loaded and freed.
 *
 *   activate(modelId)  load that model's engine (with progress), make it the
 *                      active one, then free the previously active engine.
 *                      If loading fails, the language's DEFAULT model is
 *                      activated instead and the failure is reported.
 *   engineFor(modelId) the adapter (created lazily, one per model)
 *   prefetch(modelId)  download a model's files into the offline cache
 *                      without loading it
 *   offlineStatus(m)   which of a model's files are already cached
 *
 * Adapters implement: load(onProgress, {onBytes}), recognize(frames) ->
 * [{word, confidence}], unload(), isLoaded(), and declare mode 'window' or
 * 'frame' so the camera pipeline knows how to feed them.
 */

import { getModel, defaultModel, ORT_WASM } from '../../config/models.js';
import { fetchWithProgress } from '../download.js';
import { createAangikaEngine } from './aangika.js';
import { createSignBridgeEngine } from './signbridge.js';
import { createAslIslrEngine } from './aslIslr.js';

const FACTORIES = {
  aangika: createAangikaEngine,
  signbridge: createSignBridgeEngine,
  'asl-islr': createAslIslrEngine,
};

/** Register an adapter factory for a new runtime (used by later phases). */
export function registerEngine(name, factory) {
  FACTORIES[name] = factory;
}

const engines = new Map();          // modelId -> adapter
let active = null;                  // { modelId, engine }
let pending = null;                 // in-flight activate() promise
const listeners = new Set();
let state = { modelId: null, status: 'idle', message: '', loaded: 0, total: null, error: null };

function emit(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) {
    try { fn(state); } catch { /* listener bugs stay in the listener */ }
  }
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export const getState = () => state;
export const getActive = () => active;

export function engineFor(modelId) {
  const model = getModel(modelId);
  if (!model) throw new Error(`Unknown model: ${modelId}`);
  if (!engines.has(modelId)) {
    const make = FACTORIES[model.engine];
    if (!make) throw new Error(`No engine adapter for runtime '${model.engine}'`);
    engines.set(modelId, make(model));
  }
  return engines.get(modelId);
}

async function loadOne(modelId, onProgress) {
  const engine = engineFor(modelId);
  emit({ modelId, status: 'loading', message: 'Loading…', loaded: 0, total: null, error: null });
  await engine.load(
    (message) => { emit({ message }); onProgress?.({ message, loaded: state.loaded, total: state.total }); },
    {
      onBytes: (loaded, total) => {
        emit({ loaded, total });
        onProgress?.({ message: state.message, loaded, total });
      },
    },
  );
  return engine;
}

/**
 * Make `modelId` the active model. Resolves to
 * {modelId, engine, fellBack: boolean, error?: string}.
 */
export function activate(modelId, { onProgress } = {}) {
  const run = async () => {
    if (active?.modelId === modelId && active.engine.isLoaded()) {
      emit({ modelId, status: 'ready', message: '', error: null });
      return { modelId, engine: active.engine, fellBack: false };
    }
    const previous = active;
    let engine;
    let chosen = modelId;
    let failure = null;
    try {
      engine = await loadOne(modelId, onProgress);
    } catch (err) {
      failure = err?.message || String(err);
      // The language's default first; if that is the model that just failed
      // (e.g. the only ASL model), the app-wide default so recognition goes on.
      let fallback = defaultModel(getModel(modelId)?.language);
      if (!fallback || fallback.id === modelId) fallback = defaultModel('ISL');
      if (!fallback || fallback.id === modelId) {
        emit({ status: 'error', error: failure, message: '' });
        throw err;
      }
      chosen = fallback.id;
      engine = await loadOne(chosen, onProgress);
    }
    active = { modelId: chosen, engine };
    // Free the previous engine only once the new one is up, and never the one
    // we just activated (two ids can share an adapter's backing state).
    if (previous && previous.engine !== engine) {
      try { await previous.engine.unload(); } catch { /* best effort */ }
    }
    emit({ modelId: chosen, status: 'ready', message: '', error: failure });
    return { modelId: chosen, engine, fellBack: Boolean(failure), error: failure || undefined };
  };
  pending = (pending || Promise.resolve()).catch(() => {}).then(run);
  return pending;
}

/** Free the active engine (e.g. when leaving every camera view). */
export async function deactivate() {
  if (!active) return;
  const { engine } = active;
  active = null;
  await engine.unload();
  emit({ modelId: null, status: 'idle', message: '' });
}

// ── Offline cache ────────────────────────────────────────────────────────────

const CACHE_NAMES = ['aangika-models', 'aangika-mediapipe'];

async function cachedUrls() {
  if (typeof caches === 'undefined') return null;
  const urls = [];
  for (const name of CACHE_NAMES) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await caches.has(name))) continue;
    // eslint-disable-next-line no-await-in-loop
    const cache = await caches.open(name);
    // eslint-disable-next-line no-await-in-loop
    for (const req of await cache.keys()) urls.push(new URL(req.url).pathname);
  }
  return urls;
}

/**
 * -> {supported, ready, files: [{url, cached}], runtimeCached}
 * vocab.json is precached with the app shell, so it counts as present when
 * the service worker is active.
 */
export async function offlineStatus(model) {
  const urls = await cachedUrls();
  if (!urls) return { supported: false, ready: false, files: [] };
  const swActive = typeof navigator !== 'undefined' && Boolean(navigator.serviceWorker?.controller);
  const files = (model.files || []).map((f) => ({
    url: f.url,
    cached: urls.includes(f.url) || (swActive && f.url.endsWith('vocab.json')),
  }));
  const runtimeCached = !model.sharedFiles?.includes('ort-wasm')
    || urls.some((u) => ORT_WASM.match.test(u));
  return {
    supported: true,
    ready: files.every((f) => f.cached) && runtimeCached,
    files,
    runtimeCached,
  };
}

/** Download a model's files into the offline cache without loading it. */
export async function prefetch(modelId, onBytes = () => {}) {
  const model = getModel(modelId);
  let done = 0;
  const total = (model.files || []).reduce((s, f) => s + (f.bytes || 0), 0);
  for (const f of model.files || []) {
    // eslint-disable-next-line no-await-in-loop
    const buf = await fetchWithProgress(f.url, (loaded) => onBytes(done + loaded, total), f.bytes);
    done += buf.byteLength;
  }
  return { bytes: done };
}

/** Test hook. */
export function _resetForTests() {
  engines.clear();
  active = null;
  pending = null;
  state = { modelId: null, status: 'idle', message: '', loaded: 0, total: null, error: null };
}

export default {
  activate, deactivate, engineFor, getActive, getState, subscribe, offlineStatus,
  prefetch, registerEngine,
};
