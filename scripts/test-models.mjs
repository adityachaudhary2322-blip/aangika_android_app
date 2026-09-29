/**
 * Model registry + engine interface tests.
 *
 *     node scripts/test-models.mjs
 *
 * Runs the REAL v2 ONNX model through onnxruntime-web under node: `fetch` is
 * served from public/ so the same code path the browser uses (download with
 * progress -> InferenceSession from bytes) is exercised.
 */

import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// ── fetch from disk for app-relative URLs ───────────────────────────────────
const PUBLIC = resolve('public');
const realFetch = globalThis.fetch;
let fetchLog = [];
globalThis.fetch = async (url, init) => {
  const u = String(url?.url || url);
  if (u.startsWith('/')) {
    fetchLog.push(u);
    const p = resolve(PUBLIC, '.' + u);
    if (!existsSync(p)) return new Response('not found', { status: 404 });
    const buf = readFileSync(p);
    return new Response(buf, { status: 200, headers: { 'content-length': String(buf.length) } });
  }
  return realFetch(url, init);
};
// signRecognizer tunes ort.env.wasm; under node a single thread is fine.

const { MODELS, REQUIRED_FIELDS, getModel, defaultModel, modelsFor, downloadBytes } =
  await import('../src/config/models.js');
const manager = await import('../src/services/engines/manager.js');
const recognizer = (await import('../src/services/signRecognizer.js')).default;
const { classifyFrame } = await import('../src/services/signbridgeCombined.js');
const state = await import('../src/services/engineState.js');

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

console.log('='.repeat(74) + '\n  Model registry and engine interface\n' + '='.repeat(74));

// ── 1. Registry ─────────────────────────────────────────────────────────────
console.log('\n1. Registry entries\n' + '-'.repeat(74));
{
  const ids = MODELS.map((m) => m.id);
  check(new Set(ids).size === ids.length, 'model ids are unique', ids.join(', '));
  for (const m of MODELS) {
    const missing = REQUIRED_FIELDS.filter((f) => m[f] === undefined);
    check(!missing.length, `${m.id}: all required fields`, missing.join(', '));
    check(['ISL', 'ASL'].includes(m.language), `${m.id}: language ${m.language}`);
    check(Boolean(m.accuracy?.summary), `${m.id}: accuracy stated (measured or "not measured")`);
    check(typeof m.licence?.commercial === 'boolean', `${m.id}: commercial-use flag set`);
    for (const f of m.files) {
      const p = resolve(PUBLIC, '.' + f.url);
      const onDisk = existsSync(p) ? statSync(p).size : null;
      check(onDisk === f.bytes, `${m.id}: ${f.url} size matches the file`, `${onDisk} vs ${f.bytes}`);
    }
  }
  for (const lang of ['ISL', 'ASL']) {
    const list = modelsFor(lang);
    if (!list.length) { console.log(`    (${lang}: no models yet)`); continue; }
    const defaults = list.filter((m) => m.default);
    check(defaults.length === 1, `${lang}: exactly one default`, defaults.map((m) => m.id).join(', '));
  }
  check(defaultModel('ISL')?.id === 'isl-aangika-v2', 'ISL default is the v2 tagger');
  check(downloadBytes(getModel('isl-signbridge')) === 0, 'SignBridge downloads nothing');
  check(state.modelIdFor('aangika') === 'isl-aangika-v2' && state.modelIdFor('signbridge') === 'isl-signbridge',
    'legacy engine names map to registry ids');
}

// ── 2. Interface ────────────────────────────────────────────────────────────
console.log('\n2. Every engine implements the interface\n' + '-'.repeat(74));
for (const m of MODELS) {
  const e = manager.engineFor(m.id);
  const fns = ['load', 'unload', 'recognize', 'isLoaded'].filter((k) => typeof e[k] !== 'function');
  check(!fns.length, `${m.id}: load / recognize / unload / isLoaded`, fns.join(', '));
  check(['frame', 'window'].includes(e.mode), `${m.id}: mode ${e.mode}`);
}

// ── 3. Aangika through the manager, real model ──────────────────────────────
console.log('\n3. Aangika v2: download with progress, recognise, free\n' + '-'.repeat(74));
let aangika;
{
  const progress = [];
  fetchLog = [];
  const t0 = performance.now();
  const res = await manager.activate('isl-aangika-v2', {
    onProgress: (p) => { if (p.total) progress.push(p.loaded / p.total); },
  });
  aangika = res.engine;
  check(res.modelId === 'isl-aangika-v2' && !res.fellBack && aangika.isLoaded(),
    'activate() loads the v2 tagger', `${Math.round(performance.now() - t0)} ms`);
  check(progress.length > 0 && progress.at(-1) === 1 && progress.every((v, i) => i === 0 || v >= progress[i - 1]),
    'byte progress rises monotonically to 100%', `${progress.length} updates`);
  check(fetchLog.includes('/models/sanketvani_word_tagger_v2.onnx'), 'fetched the v2 file (cacheable by the service worker)');

  // A deterministic 40-frame window of plausible normalised landmarks.
  const frames = Array.from({ length: 40 }, (_, t) => Float32Array.from(
    { length: 225 }, (_, i) => Math.sin(0.37 * i + 0.21 * t) * 0.6,
  ));
  const direct = await recognizer.recognize(frames);
  const viaEngine = await aangika.recognizeDetailed(frames);
  const sig = (r) => JSON.stringify([...r.words, ...r.closest]
    .map((w) => [w.word, w.confidence.toFixed(6), w.peakFrame]));
  check(sig(direct) === sig(viaEngine) && direct.closest.length === 5,
    'adapter output == recognizer.recognize() (no behaviour change)',
    `${direct.words.length} words, top-5 ${direct.closest.map((w) => `${w.word} ${w.confidence.toFixed(3)}`).join(', ')}`);
  const simple = await aangika.recognize(frames);
  check(Array.isArray(simple) && simple.every((w) => Object.keys(w).join() === 'word,confidence'),
    'recognize(frames) -> [{word, confidence}]', JSON.stringify(simple.slice(0, 2)));
}

// ── 4. SignBridge through the manager ───────────────────────────────────────
console.log('\n4. SignBridge: switch frees the tagger, same output as before\n' + '-'.repeat(74));
{
  const res = await manager.activate('isl-signbridge');
  check(res.modelId === 'isl-signbridge' && res.engine.mode === 'frame', 'activate() switches to SignBridge');
  check(!recognizer.isLoaded() && !aangika.isLoaded(), 'switching freed the ONNX session');

  // Open palm raised (HELLO) and a thumbs-up fist (GOOD), plus random hands.
  const hand = (ext, oy) => {
    const lm = [{ x: 0.5, y: oy, z: 0 }];
    const chains = [[-0.085, -0.045], [-0.035, -0.10], [0, -0.11], [0.035, -0.10], [0.07, -0.088]];
    chains.forEach(([dx, dy], c) => {
      const m = ext[c] ? [1.0, 1.8, 2.5, 3.1] : [1.0, 1.45, 1.05, 0.62];
      for (const k of m) lm.push({ x: 0.5 + dx * k, y: oy + dy * k, z: 0 });
    });
    return lm;
  };
  const pose = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.9 }));
  pose[0] = { x: 0.5, y: 0.25 }; pose[11] = { x: 0.38, y: 0.42 }; pose[12] = { x: 0.62, y: 0.42 };
  let rnd = 3;
  const r = () => ((rnd = (rnd * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const frames = [
    [{ landmarks: hand([1, 1, 1, 1, 1], 0.30), handedness: 'Right' }],
    [{ landmarks: hand([1, 0, 0, 0, 0], 0.55), handedness: 'Right' }],
    ...Array.from({ length: 30 }, () => [{
      landmarks: Array.from({ length: 21 }, () => ({ x: r(), y: r(), z: 0 })),
      handedness: r() < 0.5 ? 'Left' : 'Right',
    }]),
  ];
  let same = 0;
  for (const hands of frames) {
    const a = classifyFrame(hands, pose, { mirrored: true });
    const b = res.engine.classify({ hands, pose, mirrored: true });
    if (a?.token === b?.token && a?.confidence === b?.confidence) same += 1;
  }
  check(same === frames.length, 'classify() == classifyFrame() on 32 frames', `${same}/${frames.length}`);
  const words = await res.engine.recognize([{ hands: frames[0], pose, mirrored: true }]);
  check(words[0]?.word === 'HELLO', 'recognize([frame]) -> [{word, confidence}]', JSON.stringify(words));
}

// ── 5. Fallback ─────────────────────────────────────────────────────────────
console.log('\n5. A model that fails to load falls back to the default\n' + '-'.repeat(74));
{
  manager.registerEngine('broken', (m) => ({
    id: m.id, model: m, mode: 'frame',
    load: async () => { throw new Error('simulated download failure'); },
    unload: async () => {}, isLoaded: () => false, recognize: async () => [],
  }));
  MODELS.push({
    id: 'isl-broken-test', name: 'Broken', language: 'ISL', kind: 'isolated signs', runtime: 'js',
    engine: 'broken', input: {}, decode: '', files: [], licence: { commercial: true },
    sourceUrl: '', accuracy: { summary: 'n/a' }, default: false,
  });
  const res = await manager.activate('isl-broken-test');
  check(res.fellBack && res.modelId === 'isl-aangika-v2' && res.engine.isLoaded(),
    'fell back to the ISL default and loaded it', `${res.modelId}: ${res.error}`);
  check(manager.getActive().modelId === 'isl-aangika-v2', 'manager reports the model actually running');
  MODELS.pop();
  await manager.deactivate();
  check(!recognizer.isLoaded(), 'deactivate() frees the active model');
}

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
