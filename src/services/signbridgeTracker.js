/**
 * SignBridge over time: steady, smooth handshape recognition.
 *
 * classifyFrame() judges one frame in isolation, so MediaPipe's landmark
 * jitter flips borderline conditions (a pinch at 0.039 vs 0.041) from frame to
 * frame, one dropped frame breaks a held sign, and the chip flickers. This
 * wraps it with two stages, used identically on the website and in the app:
 *
 *   1. One Euro filter on every landmark (Casiez et al., CHI 2012): strong
 *      smoothing while the hand is still, little lag while it moves fast.
 *      One filter set per hand (keyed by handedness), reset when that hand
 *      has been gone for a moment.
 *   2. A confidence-weighted vote over the last WINDOW frames, with
 *      hysteresis: a new sign takes over with a clear majority (ENTER), the
 *      current one survives until its share falls below EXIT. A frame or two
 *      without hands (a dropout) no longer ends a held sign; lowering the
 *      hands does, within a few frames.
 *
 * The result keeps classifyFrame()'s shape and honesty flags; `confidence`
 * becomes the sign's mean confidence scaled by how consistently it was seen.
 * scripts/bench-signbridge.mjs measures the effect (synthetic hands).
 */

import { classifyFrame } from './signbridgeCombined.js';

/** Frames a stable token must hold before auto-speech (voting already ran). */
export const TRACKER_HOLD = 7;

const WINDOW = 7;
const ENTER = 0.5;     // share of the window a new sign needs to take over
const EXIT = 0.3;      // share below which the current sign is dropped
const NONE = '';       // "no sign" votes: no hands, or no rule matched
const HAND_GONE_MS = 250;

// â”€â”€ One Euro filter â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Tuned for MediaPipe's normalised coordinates at 20-60 fps.
const MIN_CUTOFF = 1.2;   // Hz: smoothing when still
const BETA = 8;           // how fast the cutoff opens with speed (units/s)
const D_CUTOFF = 1.0;

const alpha = (cutoff, dt) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

function createOneEuro() {
  let x = null; let dx = 0; let last = 0;
  return (value, t) => {
    if (x === null) { x = value; last = t; return value; }
    const dt = Math.max((t - last) / 1000, 1e-3);
    last = t;
    const rawDx = (value - x) / dt;
    dx += alpha(D_CUTOFF, dt) * (rawDx - dx);
    const cutoff = MIN_CUTOFF + BETA * Math.abs(dx);
    x += alpha(cutoff, dt) * (value - x);
    return x;
  };
}

/** 21 landmarks x (x, y, z) filters for one hand. */
function createHandFilter() {
  const f = Array.from({ length: 21 }, () => [createOneEuro(), createOneEuro(), createOneEuro()]);
  return (landmarks, t) => landmarks.map((p, i) => ({
    ...p,
    x: f[i][0](p.x ?? 0, t),
    y: f[i][1](p.y ?? 0, t),
    z: f[i][2](p.z ?? 0, t),
  }));
}

// â”€â”€ Tracker â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function createSignBridgeTracker({ smooth = true, vote = true } = {}) {
  const filters = new Map();        // hand key -> { filter, seen }
  let votes = [];                   // [{ token, weight, hit }]
  let current = NONE;

  const keyOf = (h, i) => h.handedness || `hand${i}`;

  function smoothHands(hands, t) {
    if (!smooth) return hands;
    const out = hands.map((h, i) => {
      if (!h?.landmarks?.length) return h;
      const key = keyOf(h, i);
      let entry = filters.get(key);
      if (!entry || t - entry.seen > HAND_GONE_MS) {
        entry = { filter: createHandFilter(), seen: t };
        filters.set(key, entry);
      }
      entry.seen = t;
      return { ...h, landmarks: entry.filter(h.landmarks, t) };
    });
    return out;
  }

  function decide() {
    const tally = new Map();
    let total = 0;
    for (const v of votes) {
      tally.set(v.token, (tally.get(v.token) || 0) + v.weight);
      total += v.weight;
    }
    const share = (tok) => (total ? (tally.get(tok) || 0) / total : 0);
    let best = NONE; let bestShare = -1;
    for (const [tok] of tally) {
      const s = share(tok);
      if (s > bestShare) { best = tok; bestShare = s; }
    }
    if (current !== NONE && share(current) >= EXIT && (best === current || bestShare < ENTER)) {
      return current;                 // hysteresis: keep the held sign
    }
    return bestShare >= ENTER ? best : (share(current) >= EXIT ? current : NONE);
  }

  return {
    /**
     * @param hands  [{landmarks, handedness}] for this frame ([] = no hands)
     * @param pose   33 pose landmarks or null
     * @param opts   { mirrored, t }  t = timestamp in ms (defaults to now)
     */
    classify(hands, pose = null, { mirrored = false, t = (typeof performance !== 'undefined' ? performance.now() : Date.now()) } = {}) {
      const present = (hands || []).filter((h) => h?.landmarks?.length);
      const hit = present.length ? classifyFrame(smoothHands(present, t), pose, { mirrored }) : null;
      if (!vote) return hit;

      const token = hit?.token || NONE;
      // "No sign" votes count less than a real read, so a stray empty frame
      // cannot outvote a held sign, but lowered hands still end it quickly.
      const weight = token ? Math.max(0.35, hit.confidence) : 0.5;
      votes.push({ token, weight, hit });
      if (votes.length > WINDOW) votes = votes.slice(-WINDOW);

      current = decide();
      if (current === NONE) {
        return hit?.token ? { ...hit, token: null, confidence: 0 } : hit;
      }
      const mine = votes.filter((v) => v.token === current);
      const total = votes.reduce((s, v) => s + v.weight, 0);
      const mean = mine.reduce((s, v) => s + v.hit.confidence, 0) / mine.length;
      const stability = mine.reduce((s, v) => s + v.weight, 0) / total;
      const latest = mine[mine.length - 1].hit;
      return {
        ...latest,
        token: current,
        confidence: Math.max(0.3, Math.min(0.97, mean * (0.75 + 0.25 * stability))),
        stability: Number(stability.toFixed(2)),
        latencyMs: hit?.latencyMs ?? latest.latencyMs,
      };
    },

    /** Forget everything (camera switched, engine changed). */
    reset() { filters.clear(); votes = []; current = NONE; },
  };
}

export default createSignBridgeTracker;
