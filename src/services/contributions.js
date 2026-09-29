/**
 * "Help improve recognition": opt-in, per-sample contributions.
 *
 * - OFF by default. Even when on, every sample is sent only after the user
 *   confirms THAT sample (per-sample consent), with the label they chose.
 * - What is stored: the landmark window exactly as the model reads it
 *   (float16, base64), the label, model id + version, sign language, basic
 *   device info, and raw glove frames if a glove was used. NEVER video.
 * - Samples queue on the device and upload when online and signed in; the
 *   server marks them 'pending' until reviewed.
 */

import { isConfigured, getSession, insertAsUser } from './account.js';

const ENABLED_KEY = 'aangika.contribute';
const QUEUE_KEY = 'aangika.contributions.queue';
export const MAX_QUEUE = 50;

// ── float16 (IEEE 754 half) ─────────────────────────────────────────────────
const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

/** float32 -> float16 bits (round to nearest even; NaN / Inf preserved). */
export function toHalf(value) {
  f32[0] = value;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = (x >>> 23) & 0xff;
  let mant = x & 0x7fffff;
  if (exp === 0xff) return sign | 0x7c00 | (mant ? 0x200 : 0);          // Inf / NaN
  let e = exp - 127 + 15;
  if (e >= 0x1f) return sign | 0x7c00;                                   // overflow -> Inf
  if (e <= 0) {                                                          // subnormal / zero
    if (e < -10) return sign;
    mant |= 0x800000;
    const shift = 14 - e;
    let half = mant >> shift;
    const rem = mant & ((1 << shift) - 1);
    const halfway = 1 << (shift - 1);
    if (rem > halfway || (rem === halfway && (half & 1))) half += 1;
    return sign | half;
  }
  let half = sign | (e << 10) | (mant >> 13);
  const rem = mant & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (half & 1))) half += 1;         // may carry into exponent: correct
  return half;
}

export function fromHalf(h) {
  const sign = h & 0x8000 ? -1 : 1;
  const exp = (h >> 10) & 0x1f;
  const mant = h & 0x3ff;
  if (exp === 0) return sign * 2 ** -14 * (mant / 1024);
  if (exp === 0x1f) return mant ? NaN : sign * Infinity;
  return sign * 2 ** (exp - 15) * (1 + mant / 1024);
}

const b64 = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

/** frames: array of Float32Array (all the same length) -> base64 float16 LE. */
export function encodeWindow(frames) {
  const dim = frames[0]?.length || 0;
  const out = new Uint16Array(frames.length * dim);
  frames.forEach((f, t) => { for (let i = 0; i < dim; i++) out[t * dim + i] = toHalf(f[i]); });
  return { data: b64(new Uint8Array(out.buffer)), frames: frames.length, featureDim: dim };
}

// ── Settings and queue ──────────────────────────────────────────────────────
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

export const isEnabled = () => read(ENABLED_KEY, false) === true;
export const setEnabled = (on) => write(ENABLED_KEY, Boolean(on));
export const queued = () => read(QUEUE_KEY, []);
export function clearQueue() { write(QUEUE_KEY, []); }

/**
 * Queue ONE consented sample. Call only after the user confirmed this sample.
 * Returns the queue length, or throws when contributions are off.
 */
export function contribute({
  label, frames, modelId, modelVersion, signLanguage, gloveFrames = null, consent,
}) {
  if (!isEnabled()) throw new Error('"Help improve recognition" is off.');
  if (consent !== true) throw new Error('Each sample needs your consent.');
  if (!label || !frames?.length) throw new Error('A sample needs a label and landmark frames.');
  const w = encodeWindow(frames);
  const sample = {
    consent: true,
    label: String(label).slice(0, 64),
    sign_language: signLanguage,
    model_id: modelId,
    model_version: String(modelVersion || '1'),
    landmarks: w.data,
    frames: w.frames,
    feature_dim: w.featureDim,
    glove_frames: gloveFrames ? b64(Uint8Array.from(gloveFrames.flat())) : null,
    device: {
      ua: typeof navigator !== 'undefined' ? navigator.userAgent.slice(0, 160) : '',
      platform: typeof navigator !== 'undefined' ? navigator.platform : '',
    },
    queued_at: new Date().toISOString(),
  };
  const q = [...queued(), sample].slice(-MAX_QUEUE);
  write(QUEUE_KEY, q);
  return q.length;
}

/** Upload queued samples when online and signed in. -> {sent, left, reason?} */
export async function flush() {
  const q = queued();
  if (!q.length) return { sent: 0, left: 0 };
  if (!isConfigured()) return { sent: 0, left: q.length, reason: 'accounts not configured' };
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return { sent: 0, left: q.length, reason: 'offline' };
  const session = await getSession();
  if (!session) return { sent: 0, left: q.length, reason: 'signed out' };
  const rows = q.map(({ queued_at: _q, ...r }) => r);
  try {
    await insertAsUser('contributions', rows);
  } catch (err) {
    return { sent: 0, left: q.length, reason: err.message };
  }
  clearQueue();
  return { sent: rows.length, left: 0 };
}

export default {
  isEnabled, setEnabled, contribute, flush, queued, clearQueue, encodeWindow, toHalf, fromHalf, MAX_QUEUE,
};
