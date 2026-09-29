/**
 * SignBridge robustness benchmark on SYNTHETIC hands (seeded, repeatable).
 *
 *     node scripts/bench-signbridge.mjs            # table
 *     node scripts/bench-signbridge.mjs --json     # numbers only
 *
 * Measures what makes the handshape engine feel jumpy or wrong, before and
 * after smoothing:
 *   1. scale     the 20 signs with the hand smaller / larger in the frame
 *                (further from / nearer the camera), wrist kept in place
 *   2. jitter    per-frame accuracy and output flicker while each sign is
 *                held for 45 frames with landmark noise and 5% dropped frames
 *   3. events    what the user actually gets: signs spoken (held for the
 *                engine's holdTarget frames) that were right / wrong / missed
 *
 * "old" = raw per-frame classifyFrame + 9 consecutive agreeing frames (the
 * previous pipeline). "new" = the SignBridge tracker the app now uses.
 * Synthetic geometry and Gaussian noise: this says nothing about real
 * signers' accuracy, only about stability and scale handling.
 */
import { classifyFrame } from '../src/services/signbridgeCombined.js';
import { createSignBridgeTracker, TRACKER_HOLD } from '../src/services/signbridgeTracker.js';
import { CASES } from './fixtures/syntheticHands.mjs';

const JSON_OUT = process.argv.includes('--json');

// ── Seeded noise ────────────────────────────────────────────────────────────
let seed = 1234;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const gauss = () => { let u = 0; while (!u) u = rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand()); };

const scaleHand = (lm, s) => lm.map((p) => ({ x: lm[0].x + (p.x - lm[0].x) * s, y: lm[0].y + (p.y - lm[0].y) * s, z: 0 }));
const jitter = (lm, sigma) => lm.map((p) => ({ x: p.x + gauss() * sigma, y: p.y + gauss() * sigma, z: 0 }));
const scaled = (hands, s) => hands.map((h) => ({ ...h, landmarks: scaleHand(h.landmarks, s) }));

// ── Paths ───────────────────────────────────────────────────────────────────
function oldPath() {
  return { hold: 9, step: (hands, pose) => classifyFrame(hands, pose)?.token || null };
}
function newPath() {
  const t = createSignBridgeTracker();
  let now = 0;
  return { hold: TRACKER_HOLD, step: (hands, pose) => { now += 33; return t.classify(hands, pose, { t: now })?.token || null; } };
}

// ── 1. Scale ────────────────────────────────────────────────────────────────
const SCALES = [0.6, 0.8, 1, 1.25, 1.6];
function scaleTest(make) {
  const out = [];
  for (const s of SCALES) {
    let ok = 0;
    for (const [want, hands, pose] of CASES) {
      const p = make();
      let got = null;
      for (let i = 0; i < 12; i++) got = p.step(scaled(hands, s), pose);   // settle
      if (got === want) ok++;
    }
    out.push(ok);
  }
  return out;
}

// ── 2 + 3. Held signs with jitter and dropouts ──────────────────────────────
function streamTest(make, sigma, dropRate = 0.05, holdFrames = 45) {
  seed = 99;                                    // same noise for both paths
  const p = make();
  let frames = 0; let correctFrames = 0; let changes = 0; let last = null;
  let right = 0; let wrong = 0; let missed = 0; let firstSum = 0; let firstN = 0;
  const wrongs = [];
  let holdKey = ''; let holdCount = 0;

  for (const [want, hands, pose] of CASES) {
    let emitted = false; let first = -1;
    for (let i = 0; i < holdFrames; i++) {
      const drop = rand() < dropRate;
      const frame = drop ? [] : hands.map((h) => ({ ...h, landmarks: jitter(h.landmarks, sigma) }));
      const tok = p.step(frame, pose);
      if (i >= 10) { frames++; if (tok === want) correctFrames++; }
      if (first < 0 && tok === want) first = i;
      if (tok !== last) { changes++; last = tok; }
      // The pipeline's hold rule: speak once when a token has held holdTarget frames.
      if (!tok) { holdKey = ''; holdCount = 0; continue; }
      if (tok === holdKey) holdCount++; else { holdKey = tok; holdCount = 1; }
      if (holdCount === p.hold) {
        if (tok === want && !emitted) { right++; emitted = true; } else if (tok !== want) { wrong++; wrongs.push(`${want}->${tok}`); }
      }
    }
    if (!emitted) missed++;
    if (first >= 0) { firstSum += first; firstN++; }
    // Hands down between signs, as a signer would.
    for (let i = 0; i < 8; i++) { const tok = p.step([], pose); if (tok !== last) { changes++; last = tok; } holdKey = ''; holdCount = 0; }
  }
  return {
    frameAccuracy: +(correctFrames / frames).toFixed(3),
    flickerPerSign: +(changes / CASES.length).toFixed(2),
    right, wrong, missed,
    firstFrame: +(firstSum / Math.max(firstN, 1)).toFixed(1),
    wrongs,
  };
}

const SIGMAS = [0.002, 0.004, 0.006, 0.008];
const report = { old: {}, new: {} };
for (const [name, make] of [['old', oldPath], ['new', newPath]]) {
  report[name].scale = scaleTest(make);
  report[name].jitter = Object.fromEntries(SIGMAS.map((s) => [s, streamTest(make, s)]));
}

if (JSON_OUT) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log('='.repeat(78) + '\n  SignBridge robustness (synthetic hands, seeded noise)\n' + '='.repeat(78));
  console.log('\n1. Signs recognised (of 20) by hand size in frame');
  console.log('   scale      ' + SCALES.map((s) => `x${s}`.padStart(7)).join(''));
  for (const n of ['old', 'new']) console.log(`   ${n.padEnd(10)} ` + report[n].scale.map((v) => String(v).padStart(7)).join(''));
  console.log('\n2-3. Each sign held 45 frames; landmark noise sigma (fraction of frame), 5% frames without hands');
  console.log('   sigma   path  frame-acc  flicker/sign  first-shown  spoken-right  spoken-wrong  missed');
  for (const s of SIGMAS) {
    for (const n of ['old', 'new']) {
      const r = report[n].jitter[s];
      console.log(`   ${String(s).padEnd(7)} ${n.padEnd(5)} ${String(r.frameAccuracy).padStart(9)} ${String(r.flickerPerSign).padStart(13)} ${String(r.firstFrame).padStart(12)} ${String(r.right).padStart(13)} ${String(r.wrong).padStart(13)} ${String(r.missed).padStart(7)}${r.wrongs.length ? '  ' + r.wrongs.join(' ') : ''}`);
    }
  }
  console.log('\n   first-shown: mean frames from the start of a sign until it is shown (~33 ms each).');
  console.log('   Synthetic geometry only; real-hand accuracy is not measured by this.');
}
