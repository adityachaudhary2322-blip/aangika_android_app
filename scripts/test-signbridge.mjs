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
import {
  shapeVector, packSample, SHAPE_DIM, locationBucket, locationOf, shoulderFrame,
  palmCentre,
} from '../src/services/handshapeFeatures.js';
import {
  buildIndex, classifyCustom, calibrate, sampleFeature,
} from '../src/services/customHandshapes.js';
import * as store from '../src/services/customSigns.js';
import { checkConflicts } from '../src/services/signConflicts.js';
import { classifyFrame } from '../src/services/signbridgeCombined.js';
import { translate, glossaryFor } from '../src/services/translationService.js';
import { glossaryBlock } from '../src/services/qwenRules.js';

import { hand, ALL, H, pose, POSE, CASES } from './fixtures/syntheticHands.mjs';

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

// ════════════════════════════════════════════════════════════════════════════
//  My signs: user-taught handshapes
// ════════════════════════════════════════════════════════════════════════════

/** Deterministic PRNG so every run sees the same jitter. */
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const rand = rng(7);
const jitter = (lm, amt = 0.003) => lm.map((p) => ({
  x: p.x + (rand() - 0.5) * 2 * amt, y: p.y + (rand() - 0.5) * 2 * amt, z: p.z,
}));

/** Mirror a hand left-right about its own wrist. */
const mirrorHand = (lm) => lm.map((p) => ({ x: 2 * lm[0].x - p.x, y: p.y, z: p.z }));

/**
 * Recorded samples for a sign: `captures` takes, each `frames` long, each take
 * slightly tilted as the capture flow asks the user to do. Labels are side-true
 * (packSample with mirrored=false).
 */
function recordSign(ext, opts = {}, { captures = 3, frames = 15, side = 'right', two = null } = {}) {
  const samples = [];
  for (let c = 0; c < captures; c++) {
    const tilt = (opts.tilt || 0) + (c - 1) * 8;          // -8, 0, +8 degrees
    for (let f = 0; f < frames; f++) {
      const hands = [{
        landmarks: jitter(hand(ext, { ...opts, tilt })),
        handedness: side === 'right' ? 'Right' : 'Left',
      }];
      if (two) {
        hands.push({
          landmarks: jitter(hand(two.ext, { ...two.opts, tilt })),
          handedness: side === 'right' ? 'Left' : 'Right',
        });
      }
      samples.push(packSample(hands, POSE, false, c));
    }
  }
  return samples;
}

const signRecord = (token, samples, extra = {}) => ({
  id: token, token, kind: 'handshape', hands: 'one', side: 'right', eitherHand: false,
  output: { type: 'word', text_en: token.toLowerCase(), texts: {} },
  samples, ...extra,
});

const maxDev = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0);

console.log('\n6. My signs: feature invariances\n' + '-'.repeat(74));
{
  const base = shapeVector(hand({ index: 1, middle: 1 }));
  const tilted = shapeVector(hand({ index: 1, middle: 1 }, { tilt: 35 }));
  const scaled = shapeVector(hand({ index: 1, middle: 1 }, { scale: 2.2, ox: 0.3, oy: 0.7 }));
  check(base.length === SHAPE_DIM, `shape vector is ${SHAPE_DIM}-dim`);
  check(maxDev(base, tilted) < 1e-5, 'in-plane rotation invariant (35 degrees)',
    `max dev ${maxDev(base, tilted).toExponential(1)}`);
  check(maxDev(base, scaled) < 1e-5, 'scale and position invariant',
    `max dev ${maxDev(base, scaled).toExponential(1)}`);
  const mirroredShape = shapeVector(mirrorHand(hand({ index: 1, thumb: 1 })));
  const mirrorFlag = shapeVector(hand({ index: 1, thumb: 1 }), true);
  check(maxDev(mirroredShape, mirrorFlag) < 1e-5, 'mirror flag equals a mirrored hand',
    `max dev ${maxDev(mirroredShape, mirrorFlag).toExponential(1)}`);
  const fist = shapeVector(hand({}));
  check(maxDev(base, fist) > 0.3, 'different handshapes stay apart',
    `max dev ${maxDev(base, fist).toFixed(2)}`);
  const fr = shoulderFrame(POSE);
  const buckets = [0.28, 0.55, 0.85].map((oy) =>
    locationBucket(locationOf(palmCentre(hand(ALL, { oy })), fr)));
  check(buckets.join() === 'face,chest,low', 'location buckets face / chest / low',
    buckets.join(', '));
}

console.log('\n7. My signs: calibration, acceptance, ratio test\n' + '-'.repeat(74));
{
  const vSamples = recordSign({ index: 1, middle: 1 }, { oy: 0.55, spread: 1.6 });
  const vSign = signRecord('VICTORY', vSamples);
  const feats = vSign.samples.map((s) => sampleFeature(vSign, s));
  const cal = calibrate(feats, vSign.samples.map((s) => s.capture));
  check(Number.isFinite(cal.radius) && cal.radius > 0, 'radius calibrated from own samples',
    `radius ${cal.radius.toFixed(3)} · p95 ${cal.p95.toFixed(3)} · ${cal.consistency}`);
  check(cal.captures === 3 && cal.consistency === 'good', 'three consistent captures',
    `${cal.captures} captures, ${cal.consistency}`);

  const idx = buildIndex([vSign]);
  const again = classifyCustom([{ landmarks: jitter(hand({ index: 1, middle: 1 }, { oy: 0.55, spread: 1.6, tilt: 4 })), handedness: 'Right' }], POSE, { index: idx });
  check(again?.token === 'VICTORY', 'same handshape, new take: accepted',
    again ? `d ${again.distance.toFixed(3)} / r ${again.radius.toFixed(3)}` : 'null');
  const other = classifyCustom([{ landmarks: hand({}, { oy: 0.55 }), handedness: 'Right' }], POSE, { index: idx });
  check(other && !other.accepted, 'a fist is rejected by the radius',
    other ? `d ${other.distance.toFixed(3)} > r ${other.radius.toFixed(3)}` : 'null');
  const wrongPlace = classifyCustom([{ landmarks: hand({ index: 1, middle: 1 }, { oy: 0.26, spread: 1.6 }), handedness: 'Right' }], POSE, { index: idx });
  check(wrongPlace && !wrongPlace.accepted, 'same handshape at the face is rejected (location)',
    wrongPlace ? `d ${wrongPlace.distance.toFixed(3)} > r ${wrongPlace.radius.toFixed(3)}` : 'null');
  const leftHand = classifyCustom([{ landmarks: mirrorHand(hand({ index: 1, middle: 1 }, { oy: 0.55, spread: 1.6 })), handedness: 'Left' }], POSE, { index: idx });
  check(!leftHand?.accepted, 'other hand not accepted when "either hand" is off');
  const eitherIdx = buildIndex([{ ...vSign, eitherHand: true }]);
  const leftEither = classifyCustom([{ landmarks: mirrorHand(hand({ index: 1, middle: 1 }, { ox: 0.5, oy: 0.55, spread: 1.6 })), handedness: 'Left' }], POSE, { index: eitherIdx });
  check(leftEither?.token === 'VICTORY', 'other hand accepted when "either hand" is on',
    leftEither ? `d ${leftEither.distance.toFixed(3)}` : 'null');

  // Two nearly identical taught signs: a frame between them must be refused.
  const a = signRecord('TWIN_A', recordSign({ index: 1, middle: 1, ring: 1 }, { oy: 0.55 }));
  const b = signRecord('TWIN_B', recordSign({ index: 1, middle: 1, ring: 1 }, { oy: 0.56, spread: 1.05 }));
  const twinIdx = buildIndex([a, b]);
  const between = classifyCustom([{ landmarks: hand({ index: 1, middle: 1, ring: 1 }, { oy: 0.555, spread: 1.025 }), handedness: 'Right' }], POSE, { index: twinIdx });
  check(between && !between.accepted && between.ratio > 0.8, 'ratio test refuses a frame between twins',
    between ? `ratio ${between.ratio.toFixed(2)}` : 'null');

  // Two-handed sign.
  const twoSamples = recordSign({ index: 1 }, { ox: 0.44, oy: 0.55 }, { two: { ext: ALL, opts: { ox: 0.58, oy: 0.55 } } });
  const twoSign = signRecord('BOOK_OPEN', twoSamples, { hands: 'two', side: null });
  const twoIdx = buildIndex([twoSign]);
  const twoHit = classifyCustom([
    { landmarks: jitter(hand({ index: 1 }, { ox: 0.44, oy: 0.55 })), handedness: 'Right' },
    { landmarks: jitter(hand(ALL, { ox: 0.58, oy: 0.55 })), handedness: 'Left' },
  ], POSE, { index: twoIdx });
  check(twoHit?.token === 'BOOK_OPEN', 'two-handed sign accepted',
    twoHit ? `d ${twoHit.distance.toFixed(3)} / r ${twoHit.radius.toFixed(3)}` : 'null');
  const oneOnly = classifyCustom([{ landmarks: hand({ index: 1 }, { ox: 0.44, oy: 0.55 }), handedness: 'Right' }], POSE, { index: twoIdx });
  check(!oneOnly?.accepted, 'two-handed sign needs both hands');
}

console.log('\n8. My signs: conflicts and arbitration\n' + '-'.repeat(74));
{
  // Taught on the built-in HELLO handshape (open palm, raised).
  const helloLike = signRecord('WAVE_HI', recordSign(ALL, { oy: 0.30 }));
  const r1 = checkConflicts(helloLike, []);
  check(r1.conflicts.some((c) => c.kind === 'builtin' && c.token === 'HELLO'),
    'conflict with built-in HELLO detected', r1.conflicts.map((c) => c.token).join(', '));

  const pinch = signRecord('PINCH', recordSign({ index: 1, thumb: 1 }, { oy: 0.55, spread: 0.4 }));
  const pinch2 = signRecord('PINCH_TWO', recordSign({ index: 1, thumb: 1 }, { oy: 0.56, spread: 0.45 }));
  const r2 = checkConflicts(pinch2, [pinch]);
  check(r2.conflicts.some((c) => c.kind === 'custom' && c.token === 'PINCH'),
    'conflict with an existing taught sign detected',
    r2.conflicts.map((c) => `${c.token} ${Math.round(c.fraction * 100)}%`).join(', '));
  check(r2.conflicts[0]?.suggestion?.length > 10, 'conflict carries a suggestion',
    r2.conflicts[0]?.suggestion || '');

  const distinct = signRecord('ROCK', recordSign({ index: 1, pinky: 1 }, { oy: 0.28 }));
  const r3 = checkConflicts(distinct, [pinch]);
  check(!r3.conflicts.some((c) => c.kind === 'custom'), 'a distinct sign has no custom conflict',
    r3.conflicts.map((c) => c.token).join(', ') || 'none');

  // Arbitration through the live wrapper, on the real store.
  store._resetForTests();
  await store.saveSign({ ...signRecord('WAVE_HI', helloLike.samples), id: undefined });
  const combined = classifyFrame(
    [{ landmarks: jitter(hand(ALL, { oy: 0.30 })), handedness: 'Right' }], POSE, { mirrored: false });
  check(combined?.engine === 'custom' && combined.token === 'WAVE_HI',
    'confident custom match wins over the built-in rule',
    `${combined?.engine}:${combined?.token}${combined?.ambiguous ? ' (ambiguous)' : ''}`);
  const builtinStill = classifyFrame(
    [{ landmarks: hand({ thumb: 1 }, { oy: 0.55 }), handedness: 'Right' }], POSE, { mirrored: false });
  check(builtinStill?.token === 'GOOD' && builtinStill.engine === 'SignBridge',
    'unrelated frames still reach the built-in rules', `${builtinStill?.engine}:${builtinStill?.token}`);
}

console.log('\n9. My signs: storage, export / import, migration\n' + '-'.repeat(74));
{
  store._resetForTests();
  store.setReservedTokens(['WATER', 'NAME']);
  const rec = signRecord('PRIYA', recordSign({ index: 1, pinky: 1 }, { oy: 0.3 }, { frames: 4 }), {
    id: undefined,
    output: { type: 'name', text_en: 'Priya', texts: { 'hi-IN': 'प्रिया' } },
  });
  const saved = await store.saveSign(rec);
  await store.saveSign({
    token: 'GOOD_MORNING', kind: 'handshape', hands: 'one', side: 'right',
    output: { type: 'sentence', text_en: 'Good morning!', texts: { 'hi-IN': 'सुप्रभात!' } },
    samples: recordSign({ thumb: 1, pinky: 1 }, { oy: 0.55 }, { frames: 4 }),
  });
  let rejected = null;
  try { await store.saveSign({ token: 'WATER', kind: 'handshape', hands: 'one', output: { type: 'word', text_en: 'water' } }); }
  catch (err) { rejected = err.message; }
  check(Boolean(rejected), 'a built-in / model token is refused', rejected || '');

  const json = store.exportJSON();
  store._resetForTests();
  store.setReservedTokens(['WATER', 'NAME']);
  const rep = await store.importJSON(json);
  const back = store.findByToken('PRIYA');
  check(rep.added === 2 && back && back.samples.length === saved.samples.length &&
    JSON.stringify(back.samples) === JSON.stringify(saved.samples),
  'export -> import round trip keeps tokens and samples', `${rep.added} added`);
  const rep2 = await store.importJSON(json);
  check(rep2.renamed.length === 2 && store.findByToken('PRIYA_2'), 'importing twice renames clashes',
    rep2.renamed.map((r) => r.join('->')).join(', '));

  const mig = await store.migrateFromVocab({ custom_signs: { entries: [
    { token: 'NAMASTE', type: 'greeting', in_model: false },
    { token: 'HELLO', type: 'greeting', in_model: false },
    { token: 'MY', type: 'pronoun', in_model: false },
    { token: 'NAME', type: 'noun', in_model: true },
    { token: 'ADITYA', type: 'proper_noun', in_model: false },
  ] } });
  check(mig.migrated.join() === 'NAMASTE,MY,ADITYA' &&
    store.findByToken('ADITYA')?.output.type === 'name' && store.findByToken('MY')?.untrained,
  'vocab custom_signs migrated as untrained entries',
    `migrated ${mig.migrated.join(', ')} · skipped ${mig.skipped.map((s) => s.token).join(', ')}`);
  const again = await store.migrateFromVocab({ custom_signs: { entries: [{ token: 'ZED', type: 'noun' }] } });
  check(again.migrated.length === 0, 'migration runs only once');

  // Output paths.
  const sent = await translate(['GOOD_MORNING'], 'hi-IN', { mode: 'offline' });
  check(sent.english === 'Good morning!' && sent.translated === 'सुप्रभात!' && sent.engine === 'my-sign',
    'sentence sign returns its stored text, no grammar', `${sent.english} / ${sent.translated}`);
  const sentOnline = await translate(['GOOD_MORNING'], 'hi-IN', { mode: 'online' });
  check(sentOnline.engine === 'my-sign', 'sentence sign skips the LLM in online mode too');
  const intro = await translate(['NAME', 'PRIYA'], 'hi-IN', { mode: 'offline' });
  check(intro.english === 'Hello, my name is Priya.' && intro.translated.includes('प्रिया'),
    'taught name works in the introduction template', `${intro.english} / ${intro.translated}`);
  const builtinHi = await translate(['WATER'], 'hi-IN', { mode: 'offline' });
  check(builtinHi.translated === 'मुझे पानी चाहिए।', 'built-in gesture reaches Hindi offline (bug fix)',
    builtinHi.translated || '(empty)');
  const gl = glossaryFor(['PRIYA', 'GOOD_MORNING', 'WATER']);
  const block = glossaryBlock(gl, 'hi-IN');
  check(gl.length === 1 && /proper noun/.test(block) && block.includes('प्रिया'),
    'names reach online prompts as a protected glossary', block.split('\n')[1] || '');
}

console.log('\n10. My signs: speed with ~100 taught signs (target < 0.1 ms / frame)\n' + '-'.repeat(74));
{
  const shapes = [];
  const fingers = ['thumb', 'index', 'middle', 'ring', 'pinky'];
  for (let m = 1; m < 32; m++) {
    shapes.push(Object.fromEntries(fingers.filter((_, i) => m & (1 << i)).map((f) => [f, 1])));
  }
  const places = [0.28, 0.55, 0.85, 0.42];
  const signs = [];
  for (let i = 0; signs.length < 100; i++) {
    const ext = shapes[i % shapes.length];
    const oy = places[Math.floor(i / shapes.length) % places.length];
    signs.push(signRecord(`S${i}`, recordSign(ext, { oy }, { frames: 15 })));
  }
  const t0 = performance.now();
  const idx = buildIndex(signs);
  const buildMs = performance.now() - t0;
  const frames = signs.slice(0, 40).map((s, i) => ({
    hands: [{ landmarks: jitter(hand(shapes[i % shapes.length], { oy: places[Math.floor(i / shapes.length) % places.length] })), handedness: 'Right' }],
  }));
  for (let i = 0; i < 2000; i++) classifyCustom(frames[i % frames.length].hands, POSE, { index: idx });
  const N = 20000;
  const s = new Float64Array(N);
  let correct = 0;
  for (let i = 0; i < N; i++) {
    const f = frames[i % frames.length];
    const t = performance.now();
    const r = classifyCustom(f.hands, POSE, { index: idx });
    s[i] = performance.now() - t;
    if (i < frames.length && r?.token === `S${i}`) correct += 1;
  }
  s.sort();
  const mean = s.reduce((a, b) => a + b, 0) / N;
  console.log(`  ${idx.entries.length} signs x 45 frames · index built in ${buildMs.toFixed(0)} ms`);
  console.log(`  mean ${mean.toFixed(4)} ms · p50 ${s[N >> 1].toFixed(4)} ms · p99 ${s[Math.floor(N * 0.99)].toFixed(4)} ms`);
  check(s[N >> 1] < 0.1, 'p50 under 0.1 ms per frame with 100 signs');
  check(correct >= 36, 'the right sign is found among 100', `${correct}/${frames.length}`);
}

console.log('\n' + '='.repeat(74));
console.log(`  ${pass} passed, ${fail} failed · ${detected.size}/20 signs classified`);
console.log('='.repeat(74));
process.exit(fail ? 1 : 0);
