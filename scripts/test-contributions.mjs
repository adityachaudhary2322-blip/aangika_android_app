/**
 * Contributions and model updates: float16 encoding (must match numpy's
 * '<f2', which training/pull_contributions.py decodes), the off-by-default
 * and per-sample consent guards, the queue cap, and which index.json
 * entries count as updates.
 *
 *     node scripts/test-contributions.mjs
 */
import { readFileSync } from 'node:fs';

// Node has no localStorage: a Map-backed stand-in, installed before import.
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const C = await import('../src/services/contributions.js');
const { newerModels } = await import('../src/services/modelUpdates.js');
const { MODELS } = await import('../src/config/models.js');

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

console.log('='.repeat(74) + '\n  Contributions + model updates\n' + '='.repeat(74));

console.log('\n1. float16\n' + '-'.repeat(74));
// Bit patterns numpy produces for np.float16(x).view('<u2').
const KNOWN = [[0, 0x0000], [1, 0x3c00], [-2, 0xc000], [0.5, 0x3800], [65504, 0x7bff],
  [1e6, 0x7c00], [2 ** -24, 0x0001], [0.1, 0x2e66], [0.333333, 0x3555]];
for (const [x, bits] of KNOWN) check(C.toHalf(x) === bits, `toHalf(${x}) = 0x${C.toHalf(x).toString(16)}`, `want 0x${bits.toString(16)}`);
check(Number.isNaN(C.fromHalf(C.toHalf(NaN))), 'NaN survives (the ASL model uses NaN for missing points)');
let worst = 0;
for (let i = 0; i < 5000; i++) {
  const x = (Math.random() - 0.5) * 4;
  const y = C.fromHalf(C.toHalf(x));
  worst = Math.max(worst, Math.abs(y - x) / Math.max(Math.abs(x), 2 ** -14));
}
check(worst <= 2 ** -11 + 1e-9, 'round trip within half-precision rounding', `max rel err ${worst.toExponential(2)}`);

const frames = Array.from({ length: 40 }, (_, t) => Float32Array.from({ length: 225 }, (_, i) => Math.sin(t + i)));
const w = C.encodeWindow(frames);
check(w.frames === 40 && w.featureDim === 225, 'window shape kept', `${w.frames}x${w.featureDim}`);
const raw = Buffer.from(w.data, 'base64');
check(raw.length === 40 * 225 * 2, 'base64 payload is 2 bytes per value', `${raw.length} bytes`);
const v = raw.readUInt16LE((3 * 225 + 7) * 2);
check(Math.abs(C.fromHalf(v) - Math.sin(3 + 7)) < 1e-3, 'little-endian, row-major [frame][feature] (what numpy reshape expects)');

console.log('\n2. Consent guards and queue\n' + '-'.repeat(74));
const sample = { label: 'HELLO', frames, modelId: 'isl-aangika-v2', modelVersion: 2, signLanguage: 'ISL', consent: true };
C.clearQueue();
check(!C.isEnabled(), 'contributions are OFF by default');
check(throws(() => C.contribute(sample)) && C.queued().length === 0, 'nothing is queued while off');
C.setEnabled(true);
check(throws(() => C.contribute({ ...sample, consent: undefined })), 'a sample without explicit consent is refused');
check(throws(() => C.contribute({ ...sample, consent: 'yes' })), 'consent must be exactly true');
check(throws(() => C.contribute({ ...sample, label: '' })), 'a sample needs a label');
check(C.contribute(sample) === 1, 'a consented sample is queued');
const q0 = C.queued()[0];
check(!('video' in q0) && typeof q0.landmarks === 'string' && q0.consent === true, 'stored: landmarks + consent, never video');
check(q0.model_version === '2' && q0.sign_language === 'ISL', 'model version and language recorded');
for (let i = 0; i < 60; i++) C.contribute({ ...sample, label: `W${i}` });
check(C.queued().length === C.MAX_QUEUE, `queue capped at ${C.MAX_QUEUE}`);
check(C.queued().at(-1).label === 'W59', 'the oldest samples are dropped first');
const r = await C.flush();
check(r.sent === 0 && r.left === C.MAX_QUEUE, 'no accounts configured: nothing sent, queue kept', r.reason);
C.clearQueue();
C.setEnabled(false);

console.log('\n3. Model updates (index.json)\n' + '-'.repeat(74));
const base = MODELS.find((m) => m.id === 'isl-aangika-v2');
const entry = (over) => ({ ...base, ...over });
check(newerModels({ models: [entry({ version: 2 })] }).length === 0, 'same version: not an update');
check(newerModels({ models: [entry({ version: 1 })] }).length === 0, 'older version: ignored');
check(newerModels({ models: [entry({ version: 3 })] }).length === 1, 'higher version: update');
check(newerModels({ models: [entry({ id: 'isl-new', version: 1 })] }).length === 1, 'new id: added');
const { accuracy: _a, ...noAcc } = entry({ version: 9 });
check(newerModels({ models: [noAcc] }).length === 0, 'entry missing required fields (accuracy): rejected');
check(newerModels({ models: [entry({ version: '3' })] }).length === 0, 'non-numeric version: rejected');
check(newerModels(null).length === 0 && newerModels({}).length === 0, 'no index: nothing');

console.log('\n4. Server side keeps the same rules\n' + '-'.repeat(74));
const sql = readFileSync('supabase/migrations/20260929000001_init.sql', 'utf8');
check(/contributions_insert_own[\s\S]*?review_status = 'pending'/.test(sql), 'users can only insert pending samples (RLS)');
const pull = readFileSync('training/pull_contributions.py', 'utf8');
check(/choices=\["approved"\]/.test(pull) && /dtype="<f2"/.test(pull), 'pull_contributions.py: approved only, decodes <f2');
const pub = readFileSync('training/publish_model.py', 'utf8');
check(/--approved-by", required=True/.test(pub) && /measuredOn/.test(pub), 'publish_model.py: needs --approved-by and a measured accuracy');

console.log('\n' + '='.repeat(74));
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
