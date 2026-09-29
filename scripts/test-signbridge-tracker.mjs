/**
 * SignBridge tracker (smoothing + voting) and palm-scaled thresholds.
 * Synthetic hands: checks stability and scale handling, not real accuracy.
 *
 *     node scripts/test-signbridge-tracker.mjs
 */
import { spawnSync } from 'node:child_process';
import { createSignBridgeTracker, TRACKER_HOLD } from '../src/services/signbridgeTracker.js';
import { CASES } from './fixtures/syntheticHands.mjs';

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

console.log('='.repeat(74) + '\n  SignBridge tracker\n' + '='.repeat(74));

const [, helloHands, P] = CASES.find(([t]) => t === 'HELLO');
const [, stopHands] = CASES.find(([t]) => t === 'STOP');

console.log('\n1. Behaviour\n' + '-'.repeat(74));
{
  const tr = createSignBridgeTracker();
  let t = 0;
  const step = (hands) => { t += 33; return tr.classify(hands, P, { t })?.token || null; };
  let first = -1;
  for (let i = 0; i < 10; i++) if (step(helloHands) === 'HELLO' && first < 0) first = i;
  check(first >= 0 && first <= 3, 'a held sign is shown within a few frames', `frame ${first}`);
  check(step([]) === 'HELLO' && step(helloHands) === 'HELLO', 'one dropped frame does not end a held sign');
  let gone = -1;
  for (let i = 0; i < 12; i++) if (step([]) === null && gone < 0) gone = i;
  check(gone >= 0 && gone <= 6, 'lowering the hands ends it quickly', `after ${gone + 1} empty frames`);
  let switched = -1;
  for (let i = 0; i < 10; i++) step(helloHands);
  for (let i = 0; i < 12; i++) if (step(stopHands) === 'STOP' && switched < 0) switched = i;
  check(switched >= 0 && switched <= 5, 'a new sign takes over after a short majority', `frame ${switched}`);
  const hit = tr.classify(stopHands, P, { t: t + 33 });
  check(hit.engine === 'SignBridge' && typeof hit.stability === 'number' && hit.confidence <= 0.97,
    'result keeps classifyFrame()\'s shape, adds stability');
  tr.reset();
  check(tr.classify([], P, { t: t + 66 }) === null, 'reset forgets the history');
  check(TRACKER_HOLD >= 5 && TRACKER_HOLD <= 9, `hold before speaking: ${TRACKER_HOLD} frames`);
}

console.log('\n2. Benchmark thresholds (scripts/bench-signbridge.mjs --json)\n' + '-'.repeat(74));
{
  const run = spawnSync(process.execPath, ['scripts/bench-signbridge.mjs', '--json'], { encoding: 'utf8' });
  const r = JSON.parse(run.stdout);
  const n = r.new;
  check(n.scale.every((v) => v >= 19), 'all but at most one of 20 signs at every hand size (x0.6 .. x1.6)', n.scale.join(','));
  for (const [sigma, j] of Object.entries(n.jitter)) {
    check(j.flickerPerSign <= 2.2 && j.wrong === 0 && j.missed === 0 && j.frameAccuracy >= 0.98,
      `noise ${sigma}: steady, nothing wrong or missed`,
      `acc ${j.frameAccuracy}, flicker ${j.flickerPerSign}, wrong ${j.wrong}, missed ${j.missed}`);
  }
}

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
