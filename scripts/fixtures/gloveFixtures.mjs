/**
 * Deterministic synthetic glove data for tests (Node) and the simulated glove
 * (Playwright). Frames are plain objects accepted by protocol.encodeFrame.
 *
 * Handshapes are 5 flex values 0..255 (thumb..pinky) plus orientation; each
 * "take" adds sensor noise and a small posture change, like a real re-take.
 */

let seed = 97;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
export const resetSeed = (s = 97) => { seed = s; };

export const SHAPES = {
  DOCTOR: { flex: [200, 20, 20, 220, 220], roll: 10, pitch: -20 },   // index+middle out
  HELP: { flex: [30, 230, 230, 230, 230], roll: 80, pitch: 0 },        // fist, thumb up, rotated
  NEED: { flex: [230, 20, 230, 230, 230], roll: -30, pitch: 40 },      // index out, bent wrist
  REST: { flex: [60, 60, 60, 60, 60], roll: 0, pitch: -70 },           // hand relaxed, down
};

export function frameOf(shape, { noise = 6, tilt = 0, seq = 0 } = {}) {
  const s = SHAPES[shape] || shape;
  return {
    seq,
    flex: s.flex.map((v) => Math.max(0, Math.min(255, v + (rnd() - 0.5) * 2 * noise))),
    accel: [0, 0, 16384],
    gyro: [0, 0, 0],
    battery: 87,
    flags: 1 | 4,
    roll: s.roll + tilt + (rnd() - 0.5) * 4,
    pitch: s.pitch + (rnd() - 0.5) * 4,
  };
}

/** Held frames of a shape: `n` frames at 50 Hz. */
export function hold(shape, n, opts = {}) {
  return Array.from({ length: n }, () => frameOf(shape, opts));
}

/** A "Z"-like motion over 50 frames: index extended, pitch zig-zag. */
export function motionZ(offset = 0) {
  return Array.from({ length: 50 }, (_, i) => {
    const t = i / 49;
    const pitch = t < 0.33 ? -20 + 120 * t : t < 0.66 ? 20 - 120 * (t - 0.33) : -20 + 120 * (t - 0.66);
    return { ...frameOf('NEED', { noise: 4 }), roll: -30 + 90 * t + offset, pitch };
  });
}

/** Linear blend between two shapes (the transition between signs). */
export function transition(a, b, n) {
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / (n + 1);
    const A = SHAPES[a];
    const B = SHAPES[b];
    return frameOf({
      flex: A.flex.map((v, k) => v + (B.flex[k] - v) * t),
      roll: A.roll + (B.roll - A.roll) * t,
      pitch: A.pitch + (B.pitch - A.pitch) * t,
    }, { noise: 3 });
  });
}
