/**
 * Offline speech-to-text, on the device (Vosk small models via vosk-browser,
 * Apache 2.0). Hindi (also used for Hinglish) and Indian English.
 *
 * The models (42.9 MB Hindi, 36.2 MB English) are downloaded once, on
 * request, into Cache Storage ('aangika-speech'); after that recognition
 * works with no network at all, on the website and in the Android app.
 * The website serves them from /models/speech/ (fetched at build time by
 * scripts/fetch-speech-models.mjs); the app downloads them from the website.
 *
 * Quality: Vosk small models are lighter and less accurate than Sarvam's
 * online recognition. They are the offline fallback, and the UI says so.
 */

import { isNativeApp } from './platform.js';

export const SPEECH_MODELS = {
  hi: { file: 'vosk-hi.tar.gz', bytes: 44_981_000, label: 'Hindi', langs: ['hi-IN', 'hinglish'] },
  'en-in': { file: 'vosk-en-in.tar.gz', bytes: 37_950_000, label: 'English (India)', langs: ['en-IN'] },
};

const CACHE = 'aangika-speech';
const SITE = String(import.meta.env?.VITE_SITE_URL || 'https://aangika-pwa02.onrender.com').replace(/\/+$/, '');

/** Which offline model serves this app language, or null. */
export function modelFor(appLang) {
  return Object.keys(SPEECH_MODELS).find((k) => SPEECH_MODELS[k].langs.includes(appLang)) || null;
}

/** Where a model is downloaded from (the app has no copy of its own). */
export const modelUrl = (key) => `${isNativeApp() ? SITE : ''}/models/speech/${SPEECH_MODELS[key].file}`;

const hasCaches = () => typeof caches !== 'undefined';

export async function isDownloaded(key) {
  if (!hasCaches() || !SPEECH_MODELS[key]) return false;
  const c = await caches.open(CACHE);
  return Boolean(await c.match(modelUrl(key)));
}

/** Download once into Cache Storage, with byte progress. */
export async function download(key, onProgress = () => {}) {
  if (!SPEECH_MODELS[key]) throw new Error('No offline speech model for that language.');
  if (await isDownloaded(key)) { onProgress(1, 1); return; }
  const res = await fetch(modelUrl(key), { cache: 'no-store' });
  if (!res.ok) throw new Error(`Offline speech model not available (HTTP ${res.status}).`);
  const total = Number(res.headers.get('content-length')) || SPEECH_MODELS[key].bytes;
  const reader = res.body.getReader();
  const chunks = [];
  let loaded = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress(loaded, total);
  }
  const blob = new Blob(chunks, { type: 'application/gzip' });
  if (hasCaches()) {
    const c = await caches.open(CACHE);
    await c.put(modelUrl(key), new Response(blob, { headers: { 'Content-Type': 'application/gzip', 'Content-Length': String(blob.size) } }));
  }
  // Load the recognition engine now, while online, so the service worker
  // caches it too: offline recognition needs both.
  await import('vosk-browser').catch(() => {});
  return blob;
}

export async function remove(key) {
  if (!hasCaches()) return;
  const c = await caches.open(CACHE);
  await c.delete(modelUrl(key));
  loaded.delete(key);
}

// ── Recogniser ──────────────────────────────────────────────────────────────

const loaded = new Map();   // key -> Promise<Model>

/** The Vosk model, loaded from the cached copy (never the network). */
function getModel(key) {
  if (!loaded.has(key)) {
    loaded.set(key, (async () => {
      let blob = null;
      if (hasCaches()) {
        const hit = await (await caches.open(CACHE)).match(modelUrl(key));
        if (hit) blob = await hit.blob();
      }
      if (!blob) throw new Error(`Download the offline ${SPEECH_MODELS[key].label} speech model first.`);
      const { createModel } = await import('vosk-browser');
      const url = URL.createObjectURL(blob);
      try {
        const model = await createModel(url, -1);
        return model;
      } finally {
        URL.revokeObjectURL(url);
      }
    })().catch((err) => { loaded.delete(key); throw err; }));
  }
  return loaded.get(key);
}

/** Trim Vosk's "[unk]" and doubled spaces. */
const clean = (s) => String(s || '').replace(/\[unk\]/gi, '').replace(/\s+/g, ' ').trim();

/**
 * Transcribe decoded audio (an AudioBuffer) offline. Used for recordings and
 * by the tests. -> final text
 */
export async function transcribeAudioBuffer(audioBuffer, key) {
  const model = await getModel(key);
  const rec = new model.KaldiRecognizer(audioBuffer.sampleRate);
  const parts = [];
  return new Promise((resolve, reject) => {
    let done = false;
    rec.on('result', (m) => {
      const t = clean(m.result?.text);
      if (t) parts.push(t);
      if (done) { rec.remove(); resolve(parts.join(' ')); }
    });
    rec.on('error', (m) => { rec.remove(); reject(new Error(m.error)); });
    const data = audioBuffer.getChannelData(0);
    const step = 4096;
    for (let i = 0; i < data.length; i += step) {
      rec.acceptWaveformFloat(data.subarray(i, i + step), audioBuffer.sampleRate);
    }
    done = true;
    rec.retrieveFinalResult();       // emits a final 'result'
  });
}

/**
 * Live captions from the microphone, offline.
 * -> stop(): Promise<void>
 */
export async function startLive(key, { onPartial = () => {}, onResult = () => {}, onError = () => {} } = {}) {
  const model = await getModel(key);
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
    video: false,
  });
  const ctx = new AudioContext();
  const rec = new model.KaldiRecognizer(ctx.sampleRate);
  rec.on('partialresult', (m) => onPartial(clean(m.result?.partial)));
  rec.on('result', (m) => { const t = clean(m.result?.text); if (t) onResult(t); });
  rec.on('error', (m) => onError(new Error(m.error)));
  const source = ctx.createMediaStreamSource(stream);
  // ScriptProcessor is old but works everywhere, including Android WebView.
  const node = ctx.createScriptProcessor(4096, 1, 1);
  node.onaudioprocess = (e) => {
    try { rec.acceptWaveform(e.inputBuffer); } catch (err) { onError(err); }
  };
  source.connect(node);
  node.connect(ctx.destination);
  return async () => {
    try { rec.retrieveFinalResult(); } catch { /* already gone */ }
    node.disconnect(); source.disconnect();
    stream.getTracks().forEach((t) => t.stop());
    await ctx.close().catch(() => {});
    setTimeout(() => rec.remove(), 500);
  };
}

export default {
  SPEECH_MODELS, modelFor, modelUrl, isDownloaded, download, remove, transcribeAudioBuffer, startLive,
};
