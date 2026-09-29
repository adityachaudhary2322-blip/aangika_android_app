/**
 * Glove recognition: the user's own glove signs, no model training.
 *
 *   kind 'glove'         static handshape + orientation. k-NN (k=5) over the
 *                        stored frames; each sign's acceptance radius comes
 *                        from its own takes (leave-one-take-out, the same
 *                        calibration as the camera's My signs); ratio test
 *                        against the runner-up.
 *   kind 'glove-motion'  a movement over ~1 s (e.g. ASL J, Z). DTW between
 *                        the last second of frames and each recorded take;
 *                        threshold from the takes' distances to each other.
 *
 * Feature per frame (7): five flex values / 255, roll and pitch / 180 scaled
 * by ORIENT_WEIGHT. Signs with a single letter A-Z as token are letters: the
 * token stream joins them into fingerspelled words (FS-NAME).
 */

import { calibrate, K, RATIO } from '../customHandshapes.js';

export const DIM = 7;
export const ORIENT_WEIGHT = 0.6;
export const MOTION_FRAMES = 50;          // 1 s at 50 Hz
export const DTW_MARGIN = 1.5;

export function featureOf(frame) {
  const v = new Float32Array(DIM);
  for (let i = 0; i < 5; i++) v[i] = frame.flex[i] / 255;
  v[5] = ((frame.roll || 0) / 180) * ORIENT_WEIGHT;
  v[6] = ((frame.pitch || 0) / 180) * ORIENT_WEIGHT;
  return v;
}

function dist(a, b) {
  let s = 0;
  for (let i = 0; i < DIM; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

/** Mean of the k smallest numbers. */
function meanK(arr, k) {
  const s = [...arr].sort((x, y) => x - y).slice(0, Math.min(k, arr.length));
  return s.reduce((a, b) => a + b, 0) / (s.length || 1);
}

/**
 * Dynamic time warping distance between two sequences of feature vectors,
 * normalised by path length, with a Sakoe-Chiba band of `band` frames.
 */
export function dtw(a, b, band = 15) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return Infinity;
  const w = Math.max(band, Math.abs(n - m));
  let prev = new Float64Array(m + 1).fill(Infinity);
  let cur = new Float64Array(m + 1).fill(Infinity);
  prev[0] = 0;
  for (let i = 1; i <= n; i++) {
    cur.fill(Infinity);
    const lo = Math.max(1, i - w);
    const hi = Math.min(m, i + w);
    for (let j = lo; j <= hi; j++) {
      const cost = dist(a[i - 1], b[j - 1]);
      cur[j] = cost + Math.min(prev[j], cur[j - 1], prev[j - 1]);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[m] / (n + m);
}

/** Build the recogniser's index from sign records (the My signs store). */
export function buildGloveIndex(signs) {
  const statics = [];
  const motions = [];
  for (const s of signs) {
    if (!s.samples?.length) continue;
    if (s.kind === 'glove') {
      const feats = s.samples.map((x) => ({ vec: Float32Array.from(x.f), hasLoc: true }));
      const cal = calibrate(feats, s.samples.map((x) => x.capture || 0));
      statics.push({ token: s.token, id: s.id, feats: feats.map((f) => f.vec), radius: cal.radius, cal });
    } else if (s.kind === 'glove-motion') {
      const takes = s.samples.map((x) => x.seq.map((f) => Float32Array.from(f)));
      const pair = [];
      for (let i = 0; i < takes.length; i++) {
        for (let j = i + 1; j < takes.length; j++) pair.push(dtw(takes[i], takes[j]));
      }
      const spread = pair.length ? Math.max(...pair) : 0.1;
      motions.push({ token: s.token, id: s.id, takes, threshold: Math.max(0.05, spread * DTW_MARGIN) });
    }
  }
  return { statics, motions };
}

/** Static handshape for one frame -> {token, confidence, distance} | null. */
export function classifyStatic(index, frame) {
  if (!index.statics.length) return null;
  const q = featureOf(frame);
  const scored = index.statics
    .map((s) => ({ s, d: meanK(s.feats.map((f) => dist(q, f)), K) }))
    .sort((a, b) => a.d - b.d);
  const best = scored[0];
  const second = scored[1];
  const ratio = second ? best.d / Math.max(second.d, 1e-9) : 0;
  const accepted = best.d <= best.s.radius && ratio <= RATIO;
  return {
    token: accepted ? best.s.token : null,
    nearest: best.s.token,
    distance: best.d,
    radius: best.s.radius,
    ratio,
    confidence: accepted ? Math.max(0.5, Math.min(0.97, 0.55 + 0.3 * (1 - best.d / best.s.radius) + 0.12 * (1 - ratio))) : 0,
  };
}

/** Motion sign over the recent frames -> {token, confidence, distance} | null. */
export function classifyMotion(index, recentFrames) {
  if (!index.motions.length || recentFrames.length < MOTION_FRAMES / 2) return null;
  const q = recentFrames.slice(-MOTION_FRAMES).map(featureOf);
  const scored = index.motions
    .map((m) => ({ m, d: Math.min(...m.takes.map((t) => dtw(q, t))) }))
    .sort((a, b) => a.d - b.d);
  const best = scored[0];
  const second = scored[1];
  const ratio = second ? best.d / Math.max(second.d, 1e-9) : 0;
  const accepted = best.d <= best.m.threshold && ratio <= RATIO;
  return {
    token: accepted ? best.m.token : null,
    nearest: best.m.token,
    distance: best.d,
    threshold: best.m.threshold,
    confidence: accepted ? Math.max(0.5, Math.min(0.95, 0.9 - 0.4 * (best.d / best.m.threshold))) : 0,
  };
}

/**
 * Camera + glove fusion for one moment. Same token from both: confidences
 * combine as independent evidence (1 - (1-a)(1-b)). A token from one source
 * only is kept as is, so when the camera loses the hand the glove carries on.
 * Each word keeps `sources` for the debug view.
 */
export function fuseWords(cameraWords = [], gloveWords = []) {
  const out = new Map();
  for (const w of cameraWords) out.set(w.word, { ...w, sources: [w.engine || 'camera'] });
  for (const g of gloveWords) {
    const c = out.get(g.word);
    if (c) {
      out.set(g.word, {
        ...c,
        confidence: 1 - (1 - c.confidence) * (1 - g.confidence),
        sources: [...c.sources, 'glove'],
        engine: 'fused',
      });
    } else {
      out.set(g.word, { ...g, sources: ['glove'], engine: 'glove' });
    }
  }
  return [...out.values()];
}

export default { featureOf, dtw, buildGloveIndex, classifyStatic, classifyMotion, fuseWords };
