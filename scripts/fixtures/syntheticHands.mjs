/**
 * Synthetic hands for the SignBridge rules: one geometric builder and one
 * case per built-in sign. Shared by test-signbridge.mjs and
 * bench-signbridge.mjs. Geometry only: says nothing about real hands.
 */


/**
 * @param ext   which fingers are extended
 * @param opts  ox/oy place the wrist in the frame; tilt rotates the hand;
 *              curlTip pulls fingertips toward the palm (cluster shapes)
 */
export function hand(ext = {}, opts = {}) {
  const {
    ox = 0.5, oy = 0.55, scale = 1, tilt = 0, spread = 1,
    thumbAcross = false, thumbDownward = false, cluster = 0,
    thumbToTips = false,
  } = opts;

  const rad = (tilt * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const P = (x, y) => ({
    x: ox + (x * cos - y * sin) * scale,
    y: oy + (x * sin + y * cos) * scale,
    z: 0,
  });

  const lm = new Array(21);
  lm[0] = P(0, 0);

  const chains = [
    { name: 'thumb', idx: [1, 2, 3, 4], dx: -0.085, dy: -0.045 },
    { name: 'index', idx: [5, 6, 7, 8], dx: -0.035 * spread, dy: -0.10 },
    { name: 'middle', idx: [9, 10, 11, 12], dx: 0.0, dy: -0.11 },
    { name: 'ring', idx: [13, 14, 15, 16], dx: 0.035, dy: -0.10 },
    { name: 'pinky', idx: [17, 18, 19, 20], dx: 0.07 * spread, dy: -0.088 },
  ];

  const EXTENDED = [1.0, 1.8, 2.5, 3.1];
  const CURLED = [1.0, 1.45, 1.05, 0.62];

  for (const c of chains) {
    let mult = ext[c.name] ? EXTENDED : CURLED;
    let dx = c.dx;
    let dy = c.dy;

    if (c.name === 'thumb') {
      if (thumbDownward) { dy = 0.05; mult = [1.0, 1.6, 2.2, 2.7]; }
      else if (thumbToTips) {
        // Thumb reaches up to meet extended index/middle tips (a real pinch).
        // The old `cluster` option collapsed whole fingers, which made a pinch
        // read as a fist and sent NO / HOW_MUCH to the YES rule.
        // Track the index tip wherever `spread` put it, instead of assuming
        // spread === 1. A fixed offset left the thumb short of a wide hand.
        dx = -0.0353 * spread; dy = -0.101; mult = [0.6, 1.4, 2.2, 3.07];
      } else if (thumbAcross) { dx = 0.02; dy = -0.02; mult = [1.0, 1.6, 1.4, 1.1]; }
    }
    for (let j = 0; j < 4; j++) {
      let m = mult[j];
      // `cluster` pulls the extended tips back together (FOOD / pinches).
      if (cluster > 0 && j === 3) m *= 1 - cluster;
      const px = dx * m * (cluster > 0 && j === 3 ? 0.15 : 1);
      lm[c.idx[j]] = P(px, dy * m);
    }
  }
  return lm;
}

export const ALL = { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 };
export const H = (lm, handedness = 'Right') => ({ landmarks: lm, handedness });

/** Pose with shoulders at y and nose at (0.5, 0.25). */
export function pose(shoulderY = 0.42) {
  const p = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.9 }));
  p[0] = { x: 0.5, y: 0.25 };
  p[11] = { x: 0.38, y: shoulderY };
  p[12] = { x: 0.62, y: shoulderY };
  return p;
}
export const POSE = pose();

// ── Cases: one per sign ─────────────────────────────────────────────────────

export const CASES = [
  ['HELLO', [H(hand(ALL, { oy: 0.30 }))], POSE],
  ['STOP', [H(hand(ALL, { oy: 0.55 }))], POSE],
  ['GOOD', [H(hand({ thumb: 1 }, { oy: 0.55 }))], POSE],
  ['BAD', [H(hand({}, { oy: 0.55, thumbDownward: true }))], POSE],
  ['YES', [H(hand({}, { oy: 0.63, thumbAcross: true }))], POSE],
  ['NO', [H(hand({ index: 1, middle: 1 }, { oy: 0.55, spread: 0.25, thumbToTips: true }))], POSE],
  ['WATER', [H(hand({}, { ox: 0.5, oy: 0.34 }))], POSE],
  ['FOOD', [H(hand(ALL, { ox: 0.5, oy: 0.40, cluster: 0.985 }))], POSE],
  ['PLEASE', [H(hand(ALL, { oy: 0.68 }))], POSE],
  ['THANK_YOU', [H(hand(ALL, { ox: 0.5, oy: 0.45, tilt: 30 }))], POSE],
  ['HELP', [H(hand(ALL, { ox: 0.45, oy: 0.55 })), H(hand({}, { ox: 0.55, oy: 0.5 }), 'Left')], POSE],
  ['WASHROOM', [H(hand({ index: 1, middle: 1, ring: 1 }, { oy: 0.55, thumbAcross: true }))], POSE],
  ['SORRY', [H(hand({}, { ox: 0.5, oy: 0.52, thumbAcross: true }))], POSE],
  ['UNDERSTAND', [H(hand({ index: 1 }, { ox: 0.42, oy: 0.30 }))], POSE],
  ['DONT_UNDERSTAND', [H(hand({ index: 1 }, { ox: 0.47, oy: 0.55 })), H(hand({ index: 1 }, { ox: 0.53, oy: 0.55 }), 'Left')], POSE],
  ['DOCTOR', [H(hand({ index: 1, middle: 1 }, { ox: 0.5, oy: 0.55 })), H(hand({}, { ox: 0.39, oy: 0.25 }), 'Left')], POSE],
  ['POLICE', [H(hand({ index: 1, middle: 1 }, { ox: 0.68, oy: 0.38 }))], POSE],
  ['HOW_MUCH', [H(hand({ index: 1, middle: 1 }, { oy: 0.60, spread: 1.1, thumbToTips: true }))], POSE],
  ['NAME_ADITYA', [H(hand({ index: 1, middle: 1 }, { ox: 0.44, oy: 0.5 })), H(hand({ index: 1, middle: 1 }, { ox: 0.56, oy: 0.5 }), 'Left')], POSE],
  ['GOODBYE', [H(hand(ALL, { oy: 0.28, tilt: 45 }))], POSE],
];
