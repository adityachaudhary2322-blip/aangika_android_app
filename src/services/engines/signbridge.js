/**
 * Engine adapter: SignBridge (20 built-in handshape rules) + My signs.
 *
 * Classifies frame by frame through the SignBridge tracker: landmarks are
 * One-Euro smoothed and results voted over the last few frames with
 * hysteresis (signbridgeTracker.js), so a held sign stays steady through
 * jitter and single dropped frames. `frames` are {hands, pose, mirrored, t}
 * landmarker results; the newest one is classified.
 */

import { createSignBridgeTracker, TRACKER_HOLD } from '../signbridgeTracker.js';
import { init as initCustomSigns } from '../customSigns.js';

export function createSignBridgeEngine(model) {
  let loaded = false;
  const tracker = createSignBridgeTracker();
  return {
    id: model.id,
    model,
    mode: 'frame',
    /**
     * Consecutive frames of the tracker's STABLE token before auto-speech.
     * With voting ahead of it, ~330 ms from the start of a sign at 30 fps;
     * scripts/bench-signbridge.mjs chose 7 (no wrong signs spoken under noise).
     */
    holdTarget: TRACKER_HOLD,
    chipEngine: 'signbridge',

    async load(onProgress = () => {}) {
      onProgress('Loading your signs…');
      await initCustomSigns();          // taught signs live in IndexedDB
      tracker.reset();
      loaded = true;
      onProgress('Ready');
    },
    async unload() { tracker.reset(); loaded = false; },   // nothing heavy to free
    isLoaded: () => loaded,

    /** Per-frame result, smoothed over time (same shape as classifyFrame()). */
    classify: ({ hands, pose, mirrored = false, t }) => tracker.classify(hands, pose, { mirrored, t }),

    /** Forget the smoothing history (camera flipped, view changed). */
    reset: () => tracker.reset(),

    /** The common interface: [{word, confidence}] for the newest frame. */
    async recognize(frames) {
      const f = frames?.[frames.length - 1];
      const hit = f ? tracker.classify(f.hands, f.pose, { mirrored: Boolean(f.mirrored), t: f.t }) : null;
      return hit?.token ? [{ word: hit.token, confidence: hit.confidence }] : [];
    },
  };
}

export default createSignBridgeEngine;
