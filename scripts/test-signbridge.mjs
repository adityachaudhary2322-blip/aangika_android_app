/**
 * SignBridge 20-sign classifier test.
 *
 *     node scripts/test-signbridge.mjs
 *
 * Hands are synthesised geometrically. This verifies the decision tree's logic
 * and the feature contract -- NOT real-world accuracy, which needs a camera and
 * a signer. Nothing here says how it behaves on actual hands.
 */

import {
  extractHandFeature, classifySignBridgeFrame, HAND_FEATURE_DIM,
} from '../src/services/signbridgeEngine.js';
import { GESTURE_TOKENS, sentenceFor } from '../src/config/gestureSentences.js';
import { LANGUAGES } from '../src/config/languages.js';

// ── Synthetic hand builder ──────────────────────────────────────────────────

/**
 * @param ext   which fingers are extended
 * @param opts  ox/oy place the wrist in the frame; tilt rotates the hand;
 *              curlTip pulls fingertips toward the palm (cluster shapes)
 */
function hand(ext = {}, opts = {}) {
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

const ALL = { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 };
const H = (lm, handedness = 'Right') => ({ landmarks: lm, handedness });

/** Pose with shoulders at y and nose at (0.5, 0.25). */
function pose(shoulderY = 0.42) {
  const p = new Array(33).fill(null).map(() => ({ x: 0.5, y: 0.9 }));
  p[0] = { x: 0.5, y: 0.25 };
  p[11] = { x: 0.38, y: shoulderY };
  p[12] = { x: 0.62, y: shoulderY };
  return p;
}
const POSE = pose();

// ── Cases: one per sign ─────────────────────────────────────────────────────

const CASES = [
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

let pass = 0;
let fail = 0;
const check = (ok, label, detail) => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

console.log('='.repeat(74));
console.log('  SignBridge 20-sign deterministic classifier');
console.log('='.repeat(74));

// ── 1. Feature contract ─────────────────────────────────────────────────────
console.log('\n1. 63-coordinate feature (ported from SignBridge)\n' + '-'.repeat(74));
{
  const f = extractHandFeature(hand(ALL));
  check(f.length === HAND_FEATURE_DIM, 'length is 63');
  check(f[0] === 0 && f[1] === 0 && f[2] === 0, 'wrist at the origin');
  const near = extractHandFeature(hand(ALL, { scale: 1 }));
  const far = extractHandFeature(hand(ALL, { scale: 2.5, ox: 0.2, oy: 0.8 }));
  let worst = 0;
  for (let i = 0; i < HAND_FEATURE_DIM; i++) worst = Math.max(worst, Math.abs(near[i] - far[i]));
  check(worst < 1e-5, 'scale and position invariant', `max dev ${worst.toExponential(1)}`);
  check(extractHandFeature(null).every((x) => x === 0), 'missing hand is exactly zero');
}

// ── 2. All 20 signs ─────────────────────────────────────────────────────────
console.log('\n2. Decision tree — all 20 signs\n' + '-'.repeat(74));
const detected = new Set();
for (const [expected, hands, p] of CASES) {
  const r = classifySignBridgeFrame(hands, p);
  const ok = r?.token === expected;
  if (ok) detected.add(expected);
  ok ? pass++ : fail++;
  const conf = r?.token ? `${(r.confidence * 100).toFixed(0)}%` : '--';
  const marks = [
    r?.motionAssumed ? 'motion-assumed' : null,
    r?.ambiguous ? `also:${r.alternatives.join('/')}` : null,
    r?.tiltUnreliable ? 'tilt' : null,
  ].filter(Boolean).join(' ');
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${expected.padEnd(16)} -> ${String(r?.token).padEnd(16)} ${conf.padStart(4)}  ${marks}`);
  if (!ok && r?.nearest) {
    console.log(`         nearest ${r.nearest.token}, missing: ${r.nearest.missing.join(', ')}`);
  }
}

// ── 3. Sentence coverage ────────────────────────────────────────────────────
console.log('\n3. Sentence templates — 20 tokens x 11 languages\n' + '-'.repeat(74));
{
  let missing = 0;
  for (const token of GESTURE_TOKENS) {
    for (const l of LANGUAGES) {
      if (!sentenceFor(token, l.code)) {
        missing++;
        console.log(`    MISSING ${token} / ${l.code}`);
      }
    }
  }
  check(GESTURE_TOKENS.length === 20, 'exactly 20 tokens', `got ${GESTURE_TOKENS.length}`);
  check(missing === 0, `all ${20 * LANGUAGES.length} token/language pairs present`,
    missing ? `${missing} missing` : '');
  console.log(`    e.g. WATER  en: ${sentenceFor('WATER', 'en-IN')}`);
  console.log(`         WATER  hi: ${sentenceFor('WATER', 'hi-IN')}`);
  console.log(`         WATER  ta: ${sentenceFor('WATER', 'ta-IN')}`);
}

// ── 4. Honesty checks ───────────────────────────────────────────────────────
console.log('\n4. Honesty of the reported confidence\n' + '-'.repeat(74));
{
  const yes = classifySignBridgeFrame([H(hand({}, { oy: 0.63, thumbAcross: true }))], POSE);
  check(Boolean(yes?.motionAssumed), 'YES is flagged motion-assumed',
    yes?.motionAssumed || '');

  const withPose = classifySignBridgeFrame([H(hand(ALL, { oy: 0.30 }))], POSE);
  const without = classifySignBridgeFrame([H(hand(ALL, { oy: 0.30 }))], null);
  check(without.confidence < withPose.confidence,
    'confidence drops without pose',
    `${(withPose.confidence * 100).toFixed(0)}% -> ${(without.confidence * 100).toFixed(0)}%`);

  const confs = CASES.map(([, h, p]) => classifySignBridgeFrame(h, p))
    .filter((r) => r?.token).map((r) => r.confidence);
  const unique = new Set(confs.map((c) => c.toFixed(3)));
  check(unique.size > 1, 'confidence varies by evidence, not a constant',
    `${unique.size} distinct values across ${confs.length} matches`);
}

// ── 5. Latency ──────────────────────────────────────────────────────────────
console.log('\n5. Latency (spec: under 2 ms per frame)\n' + '-'.repeat(74));
{
  const hands = [H(hand(ALL, { oy: 0.3 }))];
  for (let i = 0; i < 3000; i++) classifySignBridgeFrame(hands, POSE);
  const N = 20000;
  const s = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    classifySignBridgeFrame(hands, POSE);
    s[i] = performance.now() - t0;
  }
  s.sort();
  const mean = s.reduce((a, b) => a + b, 0) / N;
  console.log(`  mean ${mean.toFixed(4)} ms · p50 ${s[N >> 1].toFixed(4)} ms · ` +
    `p99 ${s[Math.floor(N * 0.99)].toFixed(4)} ms  (n=${N})`);
  check(s[Math.floor(N * 0.99)] < 2, 'p99 under 2 ms');
}

console.log('\n' + '='.repeat(74));
console.log(`  ${pass} passed, ${fail} failed · ${detected.size}/20 signs classified`);
console.log('='.repeat(74));
process.exit(fail ? 1 : 0);
