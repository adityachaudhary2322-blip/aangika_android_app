/**
 * ISL Studio: upper-body features (islFeatures.js) and continuous sign
 * spotting (islSpotter.js). Synthetic geometry and synthetic sign sequences:
 * this checks the maths and the spotting logic, NOT accuracy on real signers.
 *
 *     node scripts/test-isl-studio.mjs
 */
import { hand, ALL } from './fixtures/syntheticHands.mjs';
import {
  frameFeatures, mirrorFeatures, describeFeatures, FEATURE_DIM, HAND_DIM,
} from '../src/services/isl/islFeatures.js';
import { createSpotter, calibrate, toTemplate } from '../src/services/isl/islSpotter.js';

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

console.log('='.repeat(74) + '\n  ISL Studio\n' + '='.repeat(74));

// A person facing the camera: nose, mouth corners, shoulders, elbows, wrists.
function pose({ ox = 0, oy = 0, s = 1 } = {}) {
  const P = (x, y) => ({ x: 0.5 + (x - 0.5) * s + ox, y: 0.5 + (y - 0.5) * s + oy, z: 0, visibility: 1 });
  const p = Array.from({ length: 33 }, () => P(0.5, 0.95));
  p[0] = P(0.5, 0.25);                                    // nose
  p[9] = P(0.47, 0.3); p[10] = P(0.53, 0.3);              // mouth corners
  p[11] = P(0.62, 0.45); p[12] = P(0.38, 0.45);           // left / right shoulder (image right = signer's left)
  p[13] = P(0.68, 0.62); p[14] = P(0.32, 0.62);           // elbows
  p[15] = P(0.64, 0.75); p[16] = P(0.36, 0.75);           // wrists
  return p;
}
const move = (lm, { ox = 0, oy = 0, s = 1 }) => lm.map((q) => ({ x: 0.5 + (q.x - 0.5) * s + ox, y: 0.5 + (q.y - 0.5) * s + oy, z: (q.z || 0) * s }));
const frame = (lm, handedness = 'Right', t = {}) => frameFeatures({
  hands: [{ landmarks: move(lm, t), handedness }], pose: pose(t), mirrored: false,
});

console.log('\n1. Features: both hands on the upper body\n' + '-'.repeat(74));
{
  const open = hand(ALL, { ox: 0.4, oy: 0.55 });
  const f = frame(open);
  check(f.length === FEATURE_DIM && FEATURE_DIM === 100, `${FEATURE_DIM} numbers per frame`);
  const g = frame(open, 'Right', { ox: 0.08, oy: -0.05, s: 1.3 });
  let worst = 0;
  for (let i = 0; i < FEATURE_DIM; i++) worst = Math.max(worst, Math.abs(f[i] - g[i]));
  check(worst < 1e-4, 'same sign further away and elsewhere in the frame reads the same', `max diff ${worst.toExponential(1)}`);
  check(f[0] === 0 && f[HAND_DIM] === 1, 'hands are placed by the signer\'s side (right hand block filled)');

  const fist = frame(hand({}, { ox: 0.4, oy: 0.55 }));
  const bend = (x, finger) => x[HAND_DIM + 1 + finger * 3] + x[HAND_DIM + 2 + finger * 3] + x[HAND_DIM + 3 + finger * 3];
  check(bend(fist, 1) > bend(f, 1) + 0.3, 'index finger: folded in a fist, straight in an open hand', `${bend(f, 1).toFixed(2)} vs ${bend(fist, 1).toFixed(2)}`);

  const atMouth = frame(hand({ index: 1 }, { ox: 0.5, oy: 0.36, scale: 0.6 }));
  const atChest = frame(hand({ index: 1 }, { ox: 0.5, oy: 0.72, scale: 0.6 }));
  const mouthDist = (x) => x[HAND_DIM + 40];
  check(mouthDist(atMouth) < mouthDist(atChest), 'distance to the mouth: smaller at the mouth than at the chest',
    `${(mouthDist(atMouth) * 3).toFixed(2)} vs ${(mouthDist(atChest) * 3).toFixed(2)} shoulder widths`);
  const d = describeFeatures(atMouth)[0];
  check(d?.side === 'right' && d.extended.includes('index') && !d.extended.includes('middle'), 'analysis names the extended fingers', d?.text);
  check(d?.near === 'mouth' || d?.near === 'chin' || d?.near === 'nose', 'analysis places the hand at the face', d?.text);

  const m = mirrorFeatures(mirrorFeatures(atMouth));
  check(m.every((v, i) => Math.abs(v - atMouth[i]) < 1e-6), 'mirroring twice gives the same sign back');
  check(mirrorFeatures(atMouth)[HAND_DIM] === 0 && mirrorFeatures(atMouth)[0] === 1, 'mirroring moves it to the other hand');
}

console.log('\n2. Continuous signing: 200 random sentences, 20 similar signs + FULL STOP\n' + '-'.repeat(74));
{
  let seed = 11;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
  const gauss = () => { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };
  const clamp = (v) => Math.max(0, Math.min(1, v));

  // Signs share a common base and differ in ~20% of the numbers, so they are
  // deliberately similar (like real signs sharing a handshape or a place).
  const base = Float32Array.from({ length: FEATURE_DIM }, () => rand());
  const handOn = (f, right = true, left = false) => { f[HAND_DIM] = right ? 1 : 0; f[0] = left ? 1 : 0; f[FEATURE_DIM - 1] = 1; return f; };
  const keyframe = () => {
    const f = Float32Array.from(base);
    for (let i = 0; i < FEATURE_DIM; i++) if (rand() < 0.2) f[i] = clamp(f[i] + (rand() - 0.5) * 0.6);
    return handOn(f, true, rand() < 0.3);
  };
  const N = 20;
  const protos = Array.from({ length: N + 1 }, (_, k) => {
    const statik = k % 4 === 0;                             // every 4th sign is a held handshape
    const keys = statik ? [keyframe()] : [keyframe(), keyframe(), keyframe()];
    const len = 12 + Math.floor(rand() * 10);
    return { id: k === N ? 'fullstop' : `s${k}`, token: k === N ? 'FULL_STOP' : `SIGN_${k}`, keys, len };
  });
  // One performance of a sign: its keyframes interpolated, speed and noise varied.
  const perform = (p, sigma = 0.02) => {
    const len = Math.max(6, Math.round(p.len * (0.8 + rand() * 0.45)));
    return Array.from({ length: len }, (_, i) => {
      const u = (i / (len - 1)) * (p.keys.length - 1);
      const a = p.keys[Math.floor(u)];
      const b = p.keys[Math.min(p.keys.length - 1, Math.floor(u) + 1)];
      const w = u - Math.floor(u);
      const f = new Float32Array(FEATURE_DIM);
      for (let j = 0; j < FEATURE_DIM; j++) f[j] = clamp(a[j] * (1 - w) + b[j] * w + gauss() * sigma);
      f[HAND_DIM] = a[HAND_DIM]; f[0] = a[0]; f[FEATURE_DIM - 1] = 1;
      return f;
    });
  };
  const rest = () => { const f = new Float32Array(FEATURE_DIM).fill(0.5); f[0] = 0; f[HAND_DIM] = 0; f[FEATURE_DIM - 1] = 1; return f; };
  const between = (a, b, n) => Array.from({ length: n }, (_, i) => {
    const w = (i + 1) / (n + 1);
    return Float32Array.from(a, (v, j) => clamp(v * (1 - w) + b[j] * w));
  });

  const signs = protos.map((p) => ({ id: p.id, token: p.token, takes: [perform(p), perform(p), perform(p)] }));
  const taus = signs.map((s) => calibrate(s.takes.map((t) => toTemplate(t))));
  check(taus.every((t) => t >= 0.05 && t <= 0.3), 'per-sign thresholds learned from the takes', `${Math.min(...taus).toFixed(3)}..${Math.max(...taus).toFixed(3)}`);

  const lev = (a, b) => {
    const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) dp[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return dp[a.length][b.length];
  };

  let shown = 0;
  const run = (sigma) => {
    let words = 0; let errors = 0; let exact = 0; let stops = 0;
    for (let n = 0; n < 200; n++) {
      const k = 2 + Math.floor(rand() * 4);
      const truth = Array.from({ length: k }, () => protos[Math.floor(rand() * N)]);
      const spotter = createSpotter(signs);
      const out = [];
      let stream = [rest(), rest(), rest(), rest(), rest(), rest()];
      let last = stream[stream.length - 1];
      for (const p of [...truth, protos[N]]) {
        const perf = perform(p, sigma);
        stream = stream.concat(between(last, perf[0], 4), perf);
        last = perf[perf.length - 1];
      }
      stream = stream.concat(between(last, rest(), 3), Array.from({ length: 8 }, rest));
      for (const f of stream) out.push(...spotter.push(f));
      out.push(...spotter.flush());
      const said = out.map((o) => o.token);
      const want = [...truth.map((p) => p.token), 'FULL_STOP'];
      words += want.length;
      errors += lev(said, want);
      if (process.env.DEBUG && said.join() !== want.join() && shown++ < 8) {
        console.log(`      want ${want.join(' ')}\n      said ${said.join(' ')}  ${out.map((o) => `${o.token}@${o.ts}-${o.te}`).join(' ')}`);
      }
      if (said.join() === want.join()) exact++;
      if (said[said.length - 1] === 'FULL_STOP') stops++;
    }
    return { accuracy: 1 - errors / words, exact: exact / 200, stops: stops / 200 };
  };

  for (const sigma of [0.02, 0.04]) {
    const r = run(sigma);
    check(r.accuracy >= (sigma === 0.02 ? 0.95 : 0.9) && r.stops >= 0.9,
      `noise ${sigma}: signs spotted in order, sentence ended by FULL STOP`,
      `sign accuracy ${(r.accuracy * 100).toFixed(1)}% · whole sentences exact ${(r.exact * 100).toFixed(0)}% · full stop found ${(r.stops * 100).toFixed(0)}%`);
  }

  // Resting hands and random movement must not produce signs.
  const spotter = createSpotter(signs);
  const noise = [];
  for (let i = 0; i < 300; i++) noise.push(i % 50 < 25 ? rest() : handOn(Float32Array.from({ length: FEATURE_DIM }, () => rand())));
  const junk = [...noise.flatMap((f) => spotter.push(f)), ...spotter.flush()];
  check(junk.length <= 1, 'rest and random movement produce (almost) no signs', `${junk.length} false signs in 300 frames`);

  // Regression (team dictionary, Sept 2026): one sign whose takes differ a lot
  // got a loose threshold and, ranked by cost / threshold, beat every other
  // sign; deleting it moved the problem to the next loosest sign.
  const sloppy = { id: 'sloppy', token: 'SLOPPY', takes: [perform(protos[1], 0.08), perform(protos[2], 0.08), perform(protos[3], 0.08)] };
  const withSloppy = createSpotter([...signs, sloppy]);
  let stolen = 0; let total = 0;
  for (let n = 0; n < 40; n++) {
    withSloppy.reset();
    const k = [1, 2, 3][n % 3];
    const got = [...[rest(), rest(), ...perform(protos[k], 0.02), ...Array.from({ length: 8 }, rest)].flatMap((f) => withSloppy.push(f)), ...withSloppy.flush()];
    total++; if (got.some((h) => h.id === 'sloppy')) stolen++;
  }
  check(stolen / total < 0.25, 'a sign recorded inconsistently does not take over the signs it resembles', `${stolen}/${total} taken`);

  // The last sign is said once the hands drop, without waiting for more signing.
  const live = createSpotter(signs);
  const seq = [...perform(protos[5], 0.02), ...between(protos[5].keys[0], protos[N].keys[0], 3), ...perform(protos[N], 0.02)];
  let at = -1;
  [...seq, ...Array.from({ length: 12 }, rest)].forEach((f, i) => { for (const h of live.push(f)) if (h.id === 'fullstop') at = i - seq.length; });
  check(at >= 0 && at <= 6, 'FULL STOP is decided within a few frames of the hands dropping', `after ${at} frames`);
}

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
