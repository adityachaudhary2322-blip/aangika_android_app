/**
 * PWA plumbing: service worker registration, the install prompt, updates,
 * and offline preparation.
 *
 * `beforeinstallprompt` fires once, early, and only to listeners that exist
 * at that moment, so this module is imported from main.jsx before React
 * renders and keeps the event until the UI asks for it.
 */
import { registerSW } from 'virtual:pwa-register';
import landmarker from './landmarker.js';
import engines from './engines/manager.js';
import { getVisionEngine, modelIdFor } from './engineState.js';

const state = {
  installEvent: null,       // the deferred beforeinstallprompt event
  installed: false,
  needRefresh: false,
  offlineReady: false,
};
const listeners = new Set();
let updateSW = null;

const emit = () => { for (const fn of listeners) { try { fn({ ...state }); } catch { /* ignore */ } } };

export function subscribe(fn) {
  listeners.add(fn);
  fn({ ...state });
  return () => listeners.delete(fn);
}

export const getState = () => ({ ...state });

export function isStandalone() {
  return typeof window !== 'undefined' && (
    window.matchMedia?.('(display-mode: standalone)').matches
    || window.navigator.standalone === true
  );
}

/** iOS Safari never fires beforeinstallprompt; it needs Share → Add to Home Screen. */
export function isIOS() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function canInstall() {
  return !isStandalone() && !state.installed && (Boolean(state.installEvent) || isIOS());
}

/** Show the browser's install dialog. Resolves to 'accepted' | 'dismissed' | 'unavailable'. */
export async function promptInstall() {
  const ev = state.installEvent;
  if (!ev) return 'unavailable';
  ev.prompt();
  const { outcome } = await ev.userChoice;
  state.installEvent = null;
  if (outcome === 'accepted') state.installed = true;
  emit();
  return outcome;
}

/** Apply a waiting update and reload into it. */
export function applyUpdate() {
  updateSW?.(true);
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();               // we show our own, better-timed prompt
    state.installEvent = e;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    state.installed = true;
    state.installEvent = null;
    emit();
  });

  // No service worker in dev (vite-plugin-pwa only builds one for production).
  if ('serviceWorker' in navigator && import.meta.env.PROD) {
    updateSW = registerSW({
      onNeedRefresh() { state.needRefresh = true; emit(); },
      onOfflineReady() { state.offlineReady = true; emit(); },
    });
  }
}

// ── Offline preparation ─────────────────────────────────────────────────────

const MODEL_CACHES = ['aangika-models', 'aangika-mediapipe'];

/** Bytes cached for recognition, and whether the tagger itself is there. */
export async function offlineStatus() {
  if (typeof caches === 'undefined') return { supported: false, bytes: 0, tagger: false, landmarks: false };
  let bytes = 0;
  let tagger = false;
  let landmarks = false;
  for (const name of MODEL_CACHES) {
    if (!(await caches.has(name))) continue;
    const cache = await caches.open(name);
    for (const req of await cache.keys()) {
      if (req.url.endsWith('.onnx')) tagger = true;
      if (req.url.endsWith('.task')) landmarks = true;
      const res = await cache.match(req);
      const len = Number(res?.headers.get('content-length')) || 0;
      bytes += len;
    }
  }
  return { supported: true, bytes, tagger, landmarks };
}

/**
 * Load the landmarker and the chosen recognition model once while online.
 * Loading goes through the service worker, which keeps every file, so
 * recognition then works offline. `modelId` defaults to the model selected
 * in Settings > Recognition.
 */
export async function prepareOffline(onProgress, modelId = modelIdFor(getVisionEngine())) {
  await landmarker.load((m) => onProgress?.(m));
  await engines.activate(modelId, {
    onProgress: ({ message, loaded, total }) => onProgress?.(
      total ? `${message || 'Downloading'} ${Math.round((loaded / total) * 100)}%` : message,
    ),
  });
  return offlineStatus();
}
