/**
 * Glove: frame parser on fixed bytes, commands, k-NN / DTW recognition on
 * recorded (synthetic) fixtures, camera+glove fusion, replayed end-to-end.
 *
 *     node scripts/test-glove.mjs
 */
import { parseFrame, encodeFrame, commands, FRAME_BYTES } from '../src/services/glove/protocol.js';
import { replayTransport } from '../src/services/glove/transports.js';
import glove from '../src/services/glove/glove.js';
import {
  featureOf, buildGloveIndex, classifyStatic, classifyMotion, dtw, fuseWords, MOTION_FRAMES,
} from '../src/services/glove/recognizer.js';
import { hold, motionZ, frameOf, resetSeed } from './fixtures/gloveFixtures.mjs';

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

console.log('='.repeat(74) + '\n  Glove\n' + '='.repeat(74));

console.log('\n1. Frame parser on fixed byte arrays\n' + '-'.repeat(74));
{
  // Hand-written bytes (NOT produced by encodeFrame), little-endian:
  // seq 7 | flex 0,64,128,192,255 | accel 16384, -16384, 1 | gyro -1, 655, -32768 | batt 42 | flags 0x05
  const bytes = Uint8Array.from([
    7, 0, 64, 128, 192, 255,
    0x00, 0x40, 0x00, 0xc0, 0x01, 0x00,
    0xff, 0xff, 0x8f, 0x02, 0x00, 0x80,
    42, 0x05,
  ]);
  const f = parseFrame(bytes);
  check(f.seq === 7 && f.flex.join() === '0,64,128,192,255', 'seq and flex', `${f.seq} | ${f.flex}`);
  check(f.accel.join() === '16384,-16384,1' && f.gyro.join() === '-1,655,-32768', 'signed little-endian accel / gyro', `${f.accel} | ${f.gyro}`);
  check(f.battery === 42 && f.calibrated && !f.lowBattery && f.imuOk && !f.viaWifi && !f.extended, 'battery and flags');
  check(Math.abs(f.accelG[0] - 1) < 1e-9 && Math.abs(f.gyroDps[1] - 10) < 1e-9, 'unit conversion (16384/g, 65.5 per deg/s)');
  const ext = Uint8Array.from([...bytes.slice(0, 19), 0x85, 0x28, 0x23, 0x18, 0xfc]);   // roll 90.00, pitch -10.00
  const e = parseFrame(ext);
  check(e.extended && e.roll === 90 && e.pitch === -10, 'extended 24-byte frame: roll / pitch centi-degrees', `${e.roll}, ${e.pitch}`);
  let threw = false;
  try { parseFrame(Uint8Array.from([1, 2, 3])); } catch { threw = true; }
  check(threw, 'a malformed frame is rejected, not guessed');
  const round = parseFrame(encodeFrame({ seq: 3, flex: [1, 2, 3, 4, 5], accel: [-2, 3, -4], gyro: [5, -6, 7], battery: 9, flags: 1, roll: -12.34, pitch: 56.78 }, { extended: true }));
  check(round.flex.join() === '1,2,3,4,5' && round.accel.join() === '-2,3,-4' && round.roll === -12.34 && round.pitch === 56.78,
    'encode -> parse round trip', `${round.roll}, ${round.pitch}`);
  check(encodeFrame(frameOf('REST')).length === FRAME_BYTES, 'plain frame is 20 bytes');
}

console.log('\n2. Control commands\n' + '-'.repeat(74));
{
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join(' ');
  check(hex(commands.calibrateOpen()) === '01' && hex(commands.calibrateFist()) === '02', 'calibrate open / fist');
  check(hex(commands.setRate(50)) === '03 32' && hex(commands.setRate(500)) === '03 64', 'set rate (clamped to 100)');
  check(hex(commands.beep(880, 150)) === '04 70 03 96 00', 'beep 880 Hz 150 ms, little-endian', hex(commands.beep(880, 150)));
  check(hex(commands.playClip(2)) === '05 02' && hex(commands.sleep()) === '06' && hex(commands.wifiSetup()) === '07', 'clip / sleep / wifi');
}

// ── Recorded samples: 3 takes per sign, like the teach flow ────────────────
resetSeed(5);
const staticSign = (token, shape) => ({
  id: token, token, kind: 'glove', output: { type: 'gloss', text_en: token.toLowerCase() },
  samples: [0, 1, 2].flatMap((capture) => hold(shape, 20, { tilt: (capture - 1) * 6 })
    .map((fr) => ({ capture, f: Array.from(featureOf(fr)) }))),
});
const motionSign = (token) => ({
  id: token, token, kind: 'glove-motion', output: { type: 'word', text_en: token.toLowerCase() },
  samples: [0, 1, 2].map((capture) => ({ capture, seq: motionZ((capture - 1) * 5).map((fr) => Array.from(featureOf(fr))) })),
});
const SIGNS = [staticSign('DOCTOR', 'DOCTOR'), staticSign('HELP', 'HELP'), staticSign('NEED', 'NEED'), motionSign('Z')];
const index = buildGloveIndex(SIGNS);

console.log('\n3. Static handshapes: k-NN with calibrated radius\n' + '-'.repeat(74));
{
  check(index.statics.length === 3 && index.motions.length === 1, 'index: 3 handshapes + 1 motion');
  for (const t of ['DOCTOR', 'HELP', 'NEED']) {
    const r = classifyStatic(index, frameOf(t, { tilt: 3 }));
    check(r.token === t, `new take of ${t} is recognised`, `d ${r.distance.toFixed(3)} / r ${r.radius.toFixed(3)}, ${Math.round(r.confidence * 100)}%`);
  }
  const rest = classifyStatic(index, frameOf('REST'));
  check(rest.token === null, 'a relaxed hand is not a sign', `nearest ${rest.nearest}, d ${rest.distance.toFixed(3)}`);
  const half = classifyStatic(index, frameOf({ flex: [115, 125, 125, 225, 225], roll: 45, pitch: -10 }));
  check(half.token === null, 'a shape between DOCTOR and HELP is refused', `d ${half.distance.toFixed(3)} ratio ${half.ratio.toFixed(2)}`);
}

console.log('\n4. Motion signs: DTW over 1 s\n' + '-'.repeat(74));
{
  const same = dtw(motionZ(2).map(featureOf), motionZ(-2).map(featureOf));
  const other = dtw(motionZ(0).map(featureOf), hold('HELP', 50).map(featureOf));
  check(same < other / 3, 'DTW: two Z takes are close, Z vs a held HELP is far', `${same.toFixed(3)} vs ${other.toFixed(3)}`);
  const hit = classifyMotion(index, [...hold('REST', 20), ...motionZ(3)]);
  check(hit?.token === 'Z', 'a new Z movement is recognised', `d ${hit.distance.toFixed(3)} / thr ${hit.threshold.toFixed(3)}`);
  const still = classifyMotion(index, hold('NEED', MOTION_FRAMES));
  check(!still?.token, 'holding NEED still is not the Z movement', `d ${still?.distance.toFixed(3)}`);
  const t0 = performance.now();
  for (let i = 0; i < 50; i++) classifyMotion(index, motionZ(1));
  check((performance.now() - t0) / 50 < 20, 'DTW cost per check', `${((performance.now() - t0) / 50).toFixed(2)} ms`);
}

console.log('\n5. Camera + glove fusion\n' + '-'.repeat(74));
{
  const fused = fuseWords([{ word: 'HELP', confidence: 0.6, engine: 'aangika' }], [{ word: 'HELP', confidence: 0.5, engine: 'glove' }, { word: 'NEED', confidence: 0.7, engine: 'glove' }]);
  const help = fused.find((w) => w.word === 'HELP');
  check(Math.abs(help.confidence - 0.8) < 1e-9 && help.sources.join() === 'aangika,glove', 'same token from both: 1-(1-0.6)(1-0.5) = 0.8', help.sources.join('+'));
  check(fused.find((w) => w.word === 'NEED')?.sources.join() === 'glove', 'glove-only token passes through');
  check(fuseWords([], [{ word: 'NEED', confidence: 0.7 }]).length === 1, 'camera lost the hand: the glove carries on');
}

console.log('\n6. Replayed glove, end to end through the glove service\n' + '-'.repeat(74));
{
  resetSeed(9);
  const frames = [...hold('DOCTOR', 25), ...hold('HELP', 25), ...hold('NEED', 25)].map((f) => encodeFrame(f, { extended: true }));
  const t = replayTransport(frames, { hz: 200 });
  const seen = [];
  let received = 0;
  const off = glove.onFrame((fr) => {
    received += 1;
    const r = classifyStatic(index, fr);
    if (r.token && seen.at(-1) !== r.token) seen.push(r.token);
  });
  await glove.connect(t);
  // Timer resolution varies (15.6 ms on Windows): wait for every frame.
  for (let waited = 0; received < frames.length && waited < 10_000; waited += 50) {
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50));
  }
  off();
  check(received === frames.length, 'every replayed frame arrived', `${received}/${frames.length}`);
  await glove.calibrateOpen();
  await glove.beep(440, 100);
  check(seen.join(' ') === 'DOCTOR HELP NEED', 'replayed frames -> DOCTOR HELP NEED, in order', seen.join(' '));
  check(t.sent.length === 2 && t.sent[0][0] === 1 && t.sent[1][0] === 4, 'commands reach the transport');
  await glove.disconnect();
  check(glove.getState().status === 'disconnected', 'disconnect');
}

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
