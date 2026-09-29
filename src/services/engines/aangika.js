/**
 * Engine adapter: the Aangika ISL tagger (ONNX, 40-frame windows).
 *
 * Thin wrapper over signRecognizer.js, which keeps the model contract
 * (vocab.json, ONNX input/output, packFrame/bodyNormalise) untouched.
 * `frames` are body-normalised 225-float frames, oldest first.
 */

import recognizer from '../signRecognizer.js';

export function createAangikaEngine(model) {
  return {
    id: model.id,
    model,
    mode: 'window',
    window: model.input.frames,
    stride: model.input.stride,
    /** Agreeing results before auto-speech (one result per STRIDE frames). */
    holdTarget: 2,
    chipEngine: 'aangika',

    load: (onProgress = () => {}, { onBytes } = {}) =>
      recognizer.load(onProgress, { onBytes, modelUrl: model.files[0].url }),
    unload: () => recognizer.unload(),
    isLoaded: () => recognizer.isLoaded(),

    /** Full result: {words, closest, latencyMs, frameCount}. */
    recognizeDetailed: (frames) => recognizer.recognize(frames),

    /** The common interface: [{word, confidence}], signed order. */
    async recognize(frames) {
      const r = await recognizer.recognize(frames);
      return r.words.map((w) => ({ word: w.word, confidence: w.confidence }));
    },
  };
}

export default createAangikaEngine;
