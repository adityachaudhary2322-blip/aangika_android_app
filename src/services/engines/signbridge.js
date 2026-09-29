/**
 * Engine adapter: SignBridge (20 built-in handshape rules) + My signs.
 *
 * Classifies one frame at a time, synchronously, via classifyFrame() -- the
 * same function the pipeline called before the registry existed, so behaviour
 * is unchanged. `frames` are {hands, pose, mirrored} landmarker results; the
 * newest one is classified.
 */

import { classifyFrame } from '../signbridgeCombined.js';
import { init as initCustomSigns } from '../customSigns.js';

export function createSignBridgeEngine(model) {
  let loaded = false;
  return {
    id: model.id,
    model,
    mode: 'frame',
    /** Consecutive agreeing FRAMES before auto-speech (~300 ms at 30 fps). */
    holdTarget: 9,
    chipEngine: 'signbridge',

    async load(onProgress = () => {}) {
      onProgress('Loading your signs…');
      await initCustomSigns();          // taught signs live in IndexedDB
      loaded = true;
      onProgress('Ready');
    },
    async unload() { loaded = false; },   // nothing heavy to free
    isLoaded: () => loaded,

    /** Synchronous per-frame result, exactly classifyFrame()'s. */
    classify: ({ hands, pose, mirrored = false }) => classifyFrame(hands, pose, { mirrored }),

    /** The common interface: [{word, confidence}] for the newest frame. */
    async recognize(frames) {
      const f = frames?.[frames.length - 1];
      const hit = f ? classifyFrame(f.hands, f.pose, { mirrored: Boolean(f.mirrored) }) : null;
      return hit?.token ? [{ word: hit.token, confidence: hit.confidence }] : [];
    },
  };
}

export default createSignBridgeEngine;
