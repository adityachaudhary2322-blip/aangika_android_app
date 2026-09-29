/**
 * ASL isolated-sign model: input mapping parity + engine behaviour.
 *
 *     node scripts/test-asl.mjs
 *
 * 1. packHolistic543 (JS) == training/asl/reference_pack.py (Python, written
 *    from the Kaggle data spec) on saved fixture frames, NaN positions included.
 * 2. The real ONNX model through the engine manager: loads, frees, ignores
 *    windows without hands, returns [{word, confidence}].
 * Accuracy on real signing is NOT tested here (no labelled ASL data in repo).
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const PUBLIC = resolve('public');
globalThis.fetch = async (url) => {
  const u = String(url?.url || url);
  const p = resolve(PUBLIC, '.' + u);
  if (!existsSync(p)) return new Response('not found', { status: 404 });
  const buf = readFileSync(p);
  return new Response(buf, { status: 200, headers: { 'content-length': String(buf.length) } });
};

const { packHolistic543, hasHand } = await import('../src/services/asl/holistic543.js');
const landmarker = (await import('../src/services/landmarker.js')).default;
const manager = await import('../src/services/engines/manager.js');
const { getModel } = await import('../src/config/models.js');

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

// ── Fixtures: deterministic frames covering the mapping's edge cases ────────
let seed = 11;
const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pts = (n) => Array.from({ length: n }, () => ({ x: r(), y: r(), z: r() * 0.1 - 0.05 }));
const FIXTURES = [
  { name: 'all parts, mirrored', mirrored: true, face: pts(478), pose: pts(33), hands: [{ handedness: 'Left', landmarks: pts(21) }, { handedness: 'Right', landmarks: pts(21) }] },
  { name: 'all parts, not mirrored', mirrored: false, face: pts(478), pose: pts(33), hands: [{ handedness: 'Left', landmarks: pts(21) }, { handedness: 'Right', landmarks: pts(21) }] },
  { name: 'no face', mirrored: true, face: null, pose: pts(33), hands: [{ handedness: 'Right', landmarks: pts(21) }] },
  { name: 'no hands', mirrored: true, face: pts(478), pose: pts(33), hands: [] },
  { name: 'nothing detected', mirrored: false, face: null, pose: null, hands: [] },
  { name: 'unknown handedness ignored', mirrored: true, face: null, pose: pts(33), hands: [{ handedness: null, landmarks: pts(21) }, { handedness: 'left', landmarks: pts(21) }] },
  { name: 'two hands same side: later wins', mirrored: false, face: null, pose: null, hands: [{ handedness: 'Right', landmarks: pts(21) }, { handedness: 'Right', landmarks: pts(21) }] },
  { name: 'non-finite coordinate', mirrored: false, face: null, pose: [{ x: NaN, y: 0.5, z: 0 }, ...pts(32)], hands: [] },
];

console.log('='.repeat(74) + '\n  ASL isolated signs (Kaggle ISLR 1st place)\n' + '='.repeat(74));
console.log('\n1. 543-landmark packing: JS vs Python reference\n' + '-'.repeat(74));
{
  mkdirSync('training/runs', { recursive: true });
  const fixturePath = 'training/runs/asl_fixtures.json';
  const jsonSafe = JSON.stringify(FIXTURES, (k, v) => (typeof v === 'number' && !Number.isFinite(v) ? null : v));
  writeFileSync(fixturePath, jsonSafe);
  const py = spawnSync(resolve('training/.venv/Scripts/python.exe'), ['training/asl/reference_pack.py'],
    { input: jsonSafe, encoding: 'utf8', maxBuffer: 64 << 20 });
  if (py.status !== 0) {
    check(false, 'python reference ran', py.stderr.slice(0, 300));
  } else {
    const ref = JSON.parse(py.stdout);
    FIXTURES.forEach((f, i) => {
      // JSON turned NaN into null for Python; give JS the same input.
      const input = JSON.parse(jsonSafe)[i];
      const js = packHolistic543(input, input.mirrored);
      const same = js.length === ref[i].length
        && ref[i].every((v, j) => (v === null ? Number.isNaN(js[j]) : Math.fround(v) === js[j]));
      check(same, f.name, `${js.length / 3} landmarks, ${ref[i].filter((v) => v !== null).length / 3} present`);
    });
  }
  const full = packHolistic543({ face: pts(478), pose: pts(33), hands: [{ handedness: 'Left', landmarks: pts(21) }] }, true);
  check(Number.isFinite(full[522 * 3]) && Number.isNaN(full[468 * 3]),
    'mirrored "Left" label -> signer\'s RIGHT hand slot (same rule as ISL packFrame)');
  check(hasHand(full) && !hasHand(packHolistic543({ face: null, pose: pts(33), hands: [] })),
    'hasHand() detects hand presence');
}

console.log('\n2. Engine: load through the manager, recognise, free\n' + '-'.repeat(74));
{
  let faceLoaded = 0;
  let faceFreed = 0;
  landmarker.loadFace = async () => { faceLoaded += 1; };      // no MediaPipe under node
  landmarker.unloadFace = () => { faceFreed += 1; };
  const model = getModel('asl-islr-250');
  const t0 = performance.now();
  const res = await manager.activate('asl-islr-250');
  check(res.modelId === 'asl-islr-250' && !res.fellBack && res.engine.isLoaded(),
    'activate() loads the ASL model', `${Math.round(performance.now() - t0)} ms`);
  check(faceLoaded === 1, 'loading it also loads the face landmarker (lips are an input)');

  const eng = res.engine;
  const noHands = Array.from({ length: model.input.frames }, () => packHolistic543({ face: pts(478), pose: pts(33), hands: [] }));
  const skipped = await eng.recognizeDetailed(noHands);
  check(skipped.words.length === 0 && skipped.skipped === 'no hands', 'a window without hands is not classified');

  const withHands = Array.from({ length: model.input.frames }, () => packHolistic543({
    face: pts(478), pose: pts(33), hands: [{ handedness: 'Right', landmarks: pts(21) }],
  }, true));
  const det = await eng.recognizeDetailed(withHands);
  const psum = det.closest.reduce((s, w) => s + w.confidence, 0);
  check(det.closest.length === 5 && det.closest.every((w) => w.confidence >= 0 && w.confidence <= 1) && psum <= 1.0001,
    'top-5 are softmax probabilities', det.closest.map((w) => `${w.word} ${w.confidence.toFixed(3)}`).join(', '));
  check(det.words.every((w) => w.confidence >= 0.5), 'a word is only reported above the 0.5 threshold',
    `${det.words.length} reported on random landmarks, ${det.latencyMs} ms`);
  const simple = await eng.recognize(withHands);
  check(Array.isArray(simple), 'recognize(frames) -> [{word, confidence}]');

  const back = await manager.activate('isl-signbridge');
  check(back.modelId === 'isl-signbridge' && !eng.isLoaded() && faceFreed === 1,
    'switching away frees the ASL session and the face landmarker');
}

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
