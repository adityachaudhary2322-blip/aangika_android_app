/**
 * SignBridge engine test: feature contract, classification, latency.
 *
 *     node scripts/test-signbridge.mjs
 *
 * Hands are synthesised geometrically rather than captured, so this checks the
 * classifier's logic, not its real-world accuracy. Nothing here says how it
 * behaves on an actual signer -- that needs a camera and a person.
 */

import {
  extractHandFeature, describeHand, classifySignBridgeFrame, HAND_FEATURE_DIM,
} from '../src/services/signbridgeEngine.js';

/**
 * Build a 21-landmark hand.
 * @param {object} ext which fingers are extended
 * @param {object} opts scale/origin, to prove distance-invariance
 */
function makeHand(ext = {}, { scale = 1, ox = 0.5, oy = 0.5, spread = 1 } = {}) {
  const P = (x, y, z = 0) => ({ x: ox + x * scale, y: oy + y * scale, z: z * scale });
  const lm = new Array(21);
  lm[0] = P(0, 0);                                   // wrist

  // Joint radius from the wrist is what the classifier measures, so the
  // generator has to get that right: an EXTENDED finger grows monotonically
  // outward, a CURLED one peaks at the PIP knuckle and folds back inside it.
  const chains = [
    { name: 'thumb',  idx: [1, 2, 3, 4],     dx: -0.09, dy: -0.05 },
    { name: 'index',  idx: [5, 6, 7, 8],     dx: -0.04 * spread, dy: -0.10 },
    { name: 'middle', idx: [9, 10, 11, 12],  dx: 0.00, dy: -0.11 },
    { name: 'ring',   idx: [13, 14, 15, 16], dx: 0.04, dy: -0.10 },
    { name: 'pinky',  idx: [17, 18, 19, 20], dx: 0.08 * spread, dy: -0.09 },
  ];

  // [MCP, PIP, DIP, TIP] multipliers along the finger axis.
  const EXTENDED = [1.0, 1.8, 2.5, 3.1];
  const CURLED   = [1.0, 1.45, 1.05, 0.62];   // peaks at PIP, tip tucked in

  for (const c of chains) {
    const mult = ext[c.name] ? EXTENDED : CURLED;
    for (let j = 0; j < 4; j++) {
      lm[c.idx[j]] = P(c.dx * mult[j], c.dy * mult[j]);
    }
  }
  return lm;
}

const ALL = { thumb: 1, index: 1, middle: 1, ring: 1, pinky: 1 };
const CASES = [
  ['STOP / open palm', makeHand(ALL), null, ['STOP', 'HELLO']],
  ['PEACE', makeHand({ index: 1, middle: 1 }, { spread: 1.6 }), null, ['PEACE', 'V']],
  ['GOOD / thumbs up', makeHand({ thumb: 1 }), null, ['GOOD']],
  ['I / pinky', makeHand({ pinky: 1 }), null, ['I']],
  ['L', makeHand({ thumb: 1, index: 1 }), null, ['L']],
  ['Y', makeHand({ thumb: 1, pinky: 1 }), null, ['Y']],
  ['B / flat hand', makeHand({ index: 1, middle: 1, ring: 1, pinky: 1 }, { spread: 0.4 }), null, ['B']],
  ['A / fist', makeHand({}), null, ['A', 'O']],
];

let pass = 0;
let fail = 0;

console.log('='.repeat(72));
console.log('  SignBridge static engine');
console.log('='.repeat(72));

// ── 1. Feature contract ─────────────────────────────────────────────────────
console.log('\n1. 63-coordinate feature (ported from SignBridge)\n' + '-'.repeat(72));
{
  const hand = makeHand(ALL);
  const f = extractHandFeature(hand);
  const check = (ok, label, detail) => {
    ok ? pass++ : fail++;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
  };

  check(f.length === HAND_FEATURE_DIM, 'length is 63', `got ${f.length}`);
  check(f[0] === 0 && f[1] === 0 && f[2] === 0,
    'wrist maps to the origin', '(x0-x0, y0-y0, z0-z0)');

  let maxR = 0;
  for (let i = 0; i < 21; i++) {
    maxR = Math.max(maxR, Math.hypot(f[i * 3], f[i * 3 + 1], f[i * 3 + 2]));
  }
  check(Math.abs(maxR - 1) < 1e-5, 'scaled to unit max radius', `max=${maxR.toFixed(6)}`);

  // Distance invariance: the same pose twice as large and moved must produce
  // the same vector. This is what the scale step buys.
  const near = extractHandFeature(makeHand(ALL, { scale: 1 }));
  const far = extractHandFeature(makeHand(ALL, { scale: 2.5, ox: 0.2, oy: 0.8 }));
  let worst = 0;
  for (let i = 0; i < HAND_FEATURE_DIM; i++) worst = Math.max(worst, Math.abs(near[i] - far[i]));
  check(worst < 1e-5, 'scale and position invariant', `max deviation ${worst.toExponential(1)}`);

  const empty = extractHandFeature(null);
  check(empty.every((x) => x === 0), 'missing hand is exactly zero');
}

// ── 2. Classification ───────────────────────────────────────────────────────
console.log('\n2. Static classification\n' + '-'.repeat(72));
for (const [label, hand, pose, accept] of CASES) {
  const r = classifySignBridgeFrame([{ landmarks: hand, handedness: 'Right' }], pose);
  const got = r?.label;
  const ok = accept.includes(got);
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label.padEnd(22)} -> ${String(got).padEnd(7)} ` +
    `${((r?.confidence ?? 0) * 100).toFixed(0)}%${r?.ambiguous ? ' (ambiguous)' : ''}`);
  if (!ok) console.log(`         accepted: ${accept.join(' / ')}`);
  if (r?.alternatives?.length) {
    console.log(`         also: ${r.alternatives.map((a) => a.label).join(', ')}`);
  }
}

// ── 3. HELLO vs STOP via pose ───────────────────────────────────────────────
console.log('\n3. HELLO vs STOP -- identical handshape, separated by pose\n' + '-'.repeat(72));
{
  const palm = makeHand(ALL);
  // pose[11]/[12] are the shoulders. y grows downward in image space.
  const shoulders = (y) => { const p = new Array(33).fill({ x: 0.5, y: 0.9 }); p[11] = { x: 0.4, y }; p[12] = { x: 0.6, y }; return p; };

  const raised = classifySignBridgeFrame(
    [{ landmarks: makeHand(ALL, { oy: 0.15 }), handedness: 'Right' }], shoulders(0.5));
  const chest = classifySignBridgeFrame(
    [{ landmarks: makeHand(ALL, { oy: 0.7 }), handedness: 'Right' }], shoulders(0.5));

  const a = raised?.label === 'HELLO';
  const b = chest?.label === 'STOP';
  a ? pass++ : fail++;
  b ? pass++ : fail++;
  console.log(`  [${a ? 'PASS' : 'FAIL'}] hand above shoulders -> ${raised?.label} (${(raised.confidence * 100).toFixed(0)}%)`);
  console.log(`  [${b ? 'PASS' : 'FAIL'}] hand at chest        -> ${chest?.label} (${(chest.confidence * 100).toFixed(0)}%)`);

  const noPose = classifySignBridgeFrame([{ landmarks: palm, handedness: 'Right' }], null);
  console.log(`  no pose available    -> ${noPose.label}` +
    `${noPose.ambiguous ? ' + flagged ambiguous (correct: cannot be resolved)' : ''}`);
}

// ── 4. NAME vs PEACE via hand count ─────────────────────────────────────────
console.log('\n4. NAME vs PEACE -- separated by hand count\n' + '-'.repeat(72));
{
  const two = makeHand({ index: 1, middle: 1 });
  const one = classifySignBridgeFrame([{ landmarks: two, handedness: 'Right' }], null);
  const both = classifySignBridgeFrame([
    { landmarks: two, handedness: 'Right' },
    { landmarks: two, handedness: 'Left' },
  ], null);
  const a = one?.label !== 'NAME';
  const b = both?.label === 'NAME';
  a ? pass++ : fail++;
  b ? pass++ : fail++;
  console.log(`  [${a ? 'PASS' : 'FAIL'}] one hand  -> ${one?.label}`);
  console.log(`  [${b ? 'PASS' : 'FAIL'}] two hands -> ${both?.label}`);
}

// ── 5. Latency ──────────────────────────────────────────────────────────────
console.log('\n5. Latency budget (spec: under 2 ms per frame)\n' + '-'.repeat(72));
{
  const hand = [{ landmarks: makeHand(ALL), handedness: 'Right' }];
  const pose = new Array(33).fill({ x: 0.5, y: 0.5 });
  for (let i = 0; i < 2000; i++) classifySignBridgeFrame(hand, pose);  // warm up

  const N = 20000;
  const samples = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    classifySignBridgeFrame(hand, pose);
    samples[i] = performance.now() - t0;
  }
  samples.sort();
  const mean = samples.reduce((a, b) => a + b, 0) / N;
  const p50 = samples[Math.floor(N * 0.5)];
  const p99 = samples[Math.floor(N * 0.99)];
  const max = samples[N - 1];

  console.log(`  mean ${mean.toFixed(4)} ms · p50 ${p50.toFixed(4)} ms · ` +
    `p99 ${p99.toFixed(4)} ms · max ${max.toFixed(4)} ms  (n=${N})`);
  const ok = p99 < 2;
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] p99 under 2 ms`);
}

console.log('\n' + '='.repeat(72));
console.log(`  ${pass} passed, ${fail} failed`);
console.log('='.repeat(72));
process.exit(fail ? 1 : 0);
