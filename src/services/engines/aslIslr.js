/**
 * Engine adapter: ASL isolated signs (Kaggle ISLR 1st place, 250 signs).
 *
 * Input per frame: the 543-point Holistic layout (asl/holistic543.js) with
 * NaN for missing parts; the model normalises internally. It reads lips, so
 * loading this engine also loads MediaPipe's face landmarker, and unloading
 * frees it again.
 *
 * Live decoding: a rolling window of recent frames (model.input.frames),
 * classified every `stride` frames. A window with too few hand frames is not
 * a sign and returns nothing; otherwise the top class is reported only when
 * its probability clears the threshold. Everything else goes to `closest`.
 */

import * as ort from 'onnxruntime-web';
import landmarker from '../landmarker.js';
import { packHolistic543, hasHand, N_LANDMARKS } from '../asl/holistic543.js';
import { fetchWithProgress } from '../download.js';

const MIN_HAND_FRACTION = 0.3;

export function createAslIslrEngine(model) {
  let session = null;
  let vocab = null;
  let inputName = null;
  const threshold = model.decodeParams?.threshold ?? 0.5;

  const display = (label) => vocab?.display?.[label] || label;
  const token = (label) => String(display(label)).toUpperCase().replace(/[^A-Z0-9]+/g, '_');

  async function run(frames) {
    const T = frames.length;
    const flat = new Float32Array(T * N_LANDMARKS * 3);
    for (let t = 0; t < T; t++) flat.set(frames[t], t * N_LANDMARKS * 3);
    const out = await session.run({ [inputName]: new ort.Tensor('float32', flat, [T, N_LANDMARKS, 3]) });
    const scores = out[session.outputNames[0]].data;
    if (vocab.output_is === 'probabilities') return Float32Array.from(scores);
    // Scores -> probabilities (softmax), so a threshold means the same thing.
    let max = -Infinity;
    for (const s of scores) max = Math.max(max, s);
    let sum = 0;
    const p = new Float32Array(scores.length);
    for (let i = 0; i < p.length; i++) { p[i] = Math.exp(scores[i] - max); sum += p[i]; }
    for (let i = 0; i < p.length; i++) p[i] /= sum;
    return p;
  }

  return {
    id: model.id,
    model,
    mode: 'window',
    window: model.input.frames,
    stride: model.input.stride,
    holdTarget: 2,
    chipEngine: 'asl',

    /** Per-frame input this model wants (instead of the ISL 225 features). */
    frameFromLandmarks: (result, mirrored) => packHolistic543(result, mirrored),

    async load(onProgress = () => {}, { onBytes } = {}) {
      if (session && vocab) return;
      onProgress('Loading ASL vocabulary…');
      const res = await fetch(model.vocabUrl);
      if (!res.ok) throw new Error(`${model.vocabUrl}: HTTP ${res.status}`);
      vocab = await res.json();
      await landmarker.loadFace(onProgress);          // lips are part of the input
      onProgress('Loading ASL model…');
      const weights = model.files.find((f) => f.role === 'weights');
      const bytes = await fetchWithProgress(weights.url, onBytes || (() => {}), weights.bytes);
      ort.env.wasm.numThreads = 1;
      session = await ort.InferenceSession.create(bytes, {
        executionProviders: ['wasm'], graphOptimizationLevel: 'all',
      });
      inputName = session.inputNames[0];
      onProgress('Ready');
    },

    async unload() {
      const s = session;
      session = null;
      landmarker.unloadFace();
      if (s?.release) await s.release();
    },

    isLoaded: () => Boolean(session && vocab),

    async recognizeDetailed(frames) {
      const started = performance.now();
      const handFrames = frames.filter(hasHand).length;
      if (!frames.length || handFrames / frames.length < MIN_HAND_FRACTION) {
        return { words: [], closest: [], latencyMs: 0, frameCount: frames.length, skipped: 'no hands' };
      }
      const p = await run(frames);
      const order = Array.from(p.keys()).sort((a, b) => p[b] - p[a]);
      const top = order.slice(0, 5).map((i) => ({
        word: token(vocab.labels[i]), label: vocab.labels[i], display: display(vocab.labels[i]),
        index: i, confidence: p[i], peakFrame: frames.length - 1,
      }));
      return {
        words: top[0].confidence >= threshold ? [top[0]] : [],
        closest: top,
        latencyMs: Math.round(performance.now() - started),
        frameCount: frames.length,
      };
    },

    async recognize(frames) {
      const r = await this.recognizeDetailed(frames);
      return r.words.map((w) => ({ word: w.word, confidence: w.confidence }));
    },
  };
}

export default createAslIslrEngine;
