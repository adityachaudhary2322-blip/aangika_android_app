/**
 * On-device sign recognition with sanketvani_word_tagger.onnx.
 *
 * Contract (from ISL-FINAL/models/production/MODEL_CARD.md):
 *
 *     input   "landmarks"     float32  (1, N, 225)   N is symbolic
 *     output  "frame_logits"  float32  (1, N, 1500)
 *
 * Layout, landmark-major, (x, y, z) per landmark:
 *     slots   0..98    33 pose landmarks
 *     slots  99..161   21 left-hand landmarks
 *     slots 162..224   21 right-hand landmarks
 *
 * There is NO pose visibility channel. A missing landmark is exactly 0.0 --
 * that is what the model was trained to read as "absent", so a missing hand
 * must never be interpolated or mirrored from the other hand.
 */

import * as ort from 'onnxruntime-web';

export const FEATURE_DIM = 225;
export const NUM_WORDS = 1500;
export const POSE_COUNT = 33;
export const HAND_COUNT = 21;
export const POSE_START = 0;
export const LEFT_HAND_START = 99;
export const RIGHT_HAND_START = 162;

const L_SHOULDER = 11;
const R_SHOULDER = 12;

// v2: retrained for the live 40-frame window (docs/RESULTS_v2.md). The file
// name is versioned because /models/* is served immutable: an in-place
// replacement would never reach browsers that cached v1.
const MODEL_URL = '/models/sanketvani_word_tagger_v2.onnx';
const VOCAB_URL = '/models/vocab.json';

let session = null;
let vocab = null;
let loading = null;

/** Load the 21 MB graph and the 1500-word vocabulary. Idempotent. */
export async function load(onProgress = () => {}) {
  if (session && vocab) return { session, vocab };
  if (loading) return loading;

  loading = (async () => {
    onProgress('Fetching vocabulary…');
    const vocabResponse = await fetch(VOCAB_URL);
    if (!vocabResponse.ok) {
      throw new Error(`vocab.json: HTTP ${vocabResponse.status}`);
    }
    vocab = await vocabResponse.json();

    if (vocab.words?.length !== NUM_WORDS) {
      throw new Error(
        `vocab.json holds ${vocab.words?.length} words, model emits ${NUM_WORDS}`
      );
    }
    if (vocab.input?.feature_dim !== FEATURE_DIM) {
      throw new Error(
        `vocab.json expects ${vocab.input?.feature_dim} features, ` +
        `this build is wired for ${FEATURE_DIM}`
      );
    }

    onProgress('Loading model (21 MB)…');
    ort.env.wasm.numThreads = 1;   // cross-origin isolation is not guaranteed
    ort.env.wasm.simd = true;

    session = await ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });

    onProgress('Ready');
    return { session, vocab };
  })().catch((err) => {
    loading = null;
    throw err;
  });

  return loading;
}

export function isLoaded() {
  return Boolean(session && vocab);
}

export function getVocab() {
  return vocab;
}

/**
 * Pack one MediaPipe result pair into a 225-float frame.
 *
 * CRITICAL: an untracked hand leaves its 63 floats at exactly 0. The array
 * starts zeroed and we only write slots actually observed.
 *
 * @param poseLandmarks array of {x,y,z} (33) or null
 * @param handSets      [{ landmarks, handedness }] as MediaPipe returns them
 * @param mirrored      true when the source frame is a mirrored front camera,
 *                      which swaps MediaPipe's Left/Right labels
 */
export function packFrame(poseLandmarks, handSets, mirrored = false) {
  const v = new Float32Array(FEATURE_DIM);

  if (poseLandmarks) {
    const n = Math.min(POSE_COUNT, poseLandmarks.length);
    for (let i = 0; i < n; i++) {
      const lm = poseLandmarks[i];
      const o = POSE_START + i * 3;
      v[o] = Number.isFinite(lm.x) ? lm.x : 0;
      v[o + 1] = Number.isFinite(lm.y) ? lm.y : 0;
      v[o + 2] = Number.isFinite(lm.z) ? lm.z : 0;
    }
  }

  for (const hand of handSets || []) {
    const label = hand.handedness;
    if (!label) continue;
    let isLeft;
    if (label.toLowerCase() === 'left') isLeft = !mirrored;
    else if (label.toLowerCase() === 'right') isLeft = mirrored;
    else continue;

    const start = isLeft ? LEFT_HAND_START : RIGHT_HAND_START;
    const points = hand.landmarks || [];
    const n = Math.min(HAND_COUNT, points.length);
    for (let j = 0; j < n; j++) {
      const lm = points[j];
      const o = start + j * 3;
      v[o] = Number.isFinite(lm.x) ? lm.x : 0;
      v[o + 1] = Number.isFinite(lm.y) ? lm.y : 0;
      v[o + 2] = Number.isFinite(lm.z) ? lm.z : 0;
    }
  }

  return v;
}

/**
 * Centre a frame on the shoulders and scale by their span.
 *
 * Rules that must not drift:
 *  - centre = midpoint of pose landmarks 11 and 12, applied to x, y AND z
 *  - scale  = 2-D shoulder span, hypot(dx, dy) -- not 3-D
 *  - a landmark at exactly (0,0,0) is missing and stays zero
 *  - a frame whose shoulder span is <= 1e-6 becomes entirely zero
 */
export function bodyNormalise(frame) {
  const out = new Float32Array(FEATURE_DIM);
  const l = L_SHOULDER * 3;
  const r = R_SHOULDER * 3;

  const span = Math.hypot(frame[l] - frame[r], frame[l + 1] - frame[r + 1]);
  if (!(span > 1e-6)) return out;

  const cx = (frame[l] + frame[r]) / 2;
  const cy = (frame[l + 1] + frame[r + 1]) / 2;
  const cz = (frame[l + 2] + frame[r + 2]) / 2;

  for (let i = 0; i < FEATURE_DIM / 3; i++) {
    const o = i * 3;
    if (frame[o] === 0 && frame[o + 1] === 0 && frame[o + 2] === 0) continue;
    out[o] = (frame[o] - cx) / span;
    out[o + 1] = (frame[o + 1] - cy) / span;
    out[o + 2] = (frame[o + 2] - cz) / span;
  }
  return out;
}

function sigmoid(x) {
  return x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x));
}

/**
 * Run one inference pass over a window of normalised frames.
 *
 * Decode is multiple-instance learning: a word's clip score is its single
 * strongest frame, and that frame is where it was signed. Words clearing the
 * threshold are ranked by confidence, cut to top-k, then re-sorted by peak
 * frame so the caller receives SIGNED ORDER, not confidence order.
 */
export async function recognize(frames, {
  threshold = vocab?.threshold ?? 0.15,
  topK = vocab?.top_k ?? 8,
} = {}) {
  if (!session) throw new Error('model not loaded');
  if (!frames.length) return { words: [], closest: [], latencyMs: 0 };

  const started = performance.now();
  const N = frames.length;

  const flat = new Float32Array(N * FEATURE_DIM);
  for (let t = 0; t < N; t++) flat.set(frames[t], t * FEATURE_DIM);

  const tensor = new ort.Tensor('float32', flat, [1, N, FEATURE_DIM]);
  const output = await session.run({ landmarks: tensor });
  const logits = output.frame_logits.data;

  // MIL max-pool over time. Pooling over LOGITS, not probabilities: sigmoid is
  // monotonic so the argmax is identical, and this skips N*1500 exponentials.
  const best = new Float32Array(NUM_WORDS).fill(-Infinity);
  const peak = new Int32Array(NUM_WORDS);
  for (let t = 0; t < N; t++) {
    const row = t * NUM_WORDS;
    for (let w = 0; w < NUM_WORDS; w++) {
      const value = logits[row + w];
      if (value > best[w]) {
        best[w] = value;
        peak[w] = t;
      }
    }
  }

  const scored = [];
  for (let w = 0; w < NUM_WORDS; w++) {
    scored.push({
      word: vocab.words[w],
      index: w,
      confidence: sigmoid(best[w]),
      peakFrame: peak[w],
    });
  }
  scored.sort((a, b) => b.confidence - a.confidence);

  const words = scored
    .filter((d) => d.confidence >= threshold)
    .slice(0, topK)
    .sort((a, b) => a.peakFrame - b.peakFrame);

  return {
    words,
    closest: scored.slice(0, 5),
    latencyMs: Math.round(performance.now() - started),
    frameCount: N,
  };
}

export default { load, isLoaded, getVocab, packFrame, bodyNormalise, recognize };
