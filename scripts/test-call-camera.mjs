/**
 * Flipping the camera during a call (callCamera.js): the new camera's track
 * must replace the old one in every live connection and in the self view,
 * and a camera switched off must stay off.
 *
 *     node scripts/test-call-camera.mjs
 */
let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

const cameraManager = (await import('../src/services/cameraManager.js')).default;
const { keepCallVideoCurrent } = await import('../src/services/callCamera.js');

// A camera that can "flip": tracks are plain objects, as WebRTC sees them.
let track = { id: 'front-1', kind: 'video', enabled: true };
const listeners = new Set();
cameraManager.getStream = () => ({ getVideoTracks: () => [track] });
cameraManager.subscribe = (fn) => { listeners.add(fn); fn(); return () => listeners.delete(fn); };
const flip = (id) => { track = { id, kind: 'video', enabled: true }; listeners.forEach((fn) => fn()); };

const sender = (kind, t) => ({ track: t, replaced: null, async replaceTrack(n) { this.replaced = n; this.track = n; } });
const pcA = { senders: [sender('video', { id: 'front-1', kind: 'video' }), sender('audio', { id: 'mic', kind: 'audio' })], getSenders() { return this.senders; } };
const pcB = { senders: [sender('video', { id: 'front-1', kind: 'video' })], getSenders() { return this.senders; } };
const local = (() => { let tracks = [{ id: 'front-1', kind: 'video' }, { id: 'mic', kind: 'audio' }]; return {
  getVideoTracks: () => tracks.filter((t) => t.kind === 'video'),
  removeTrack: (t) => { tracks = tracks.filter((x) => x !== t); },
  addTrack: (t) => { tracks.push(t); },
  all: () => tracks,
}; })();

console.log('='.repeat(74) + '\n  Flipping the camera in a call\n' + '='.repeat(74));
let camOn = true;
const off = keepCallVideoCurrent(() => [pcA, pcB], local, () => camOn);
check(!pcA.senders[0].replaced, 'no change: nothing is touched');
flip('back-1');
await new Promise((r) => setTimeout(r, 0));
check(pcA.senders[0].replaced?.id === 'back-1' && pcB.senders[0].replaced?.id === 'back-1', 'the back camera is sent to every person in the call');
check(pcA.senders[1].replaced === null, 'the microphone is left alone');
check(local.getVideoTracks().length === 1 && local.getVideoTracks()[0].id === 'back-1' && local.all().some((t) => t.id === 'mic'), 'the self view shows the new camera (microphone kept)');
camOn = false;
flip('front-2');
await new Promise((r) => setTimeout(r, 0));
check(pcA.senders[0].replaced?.id === 'front-2' && track.enabled === false, 'a camera switched off stays off after flipping');
off();
flip('back-2');
await new Promise((r) => setTimeout(r, 0));
check(pcA.senders[0].replaced?.id === 'front-2', 'after the call ends, flips are not sent anymore');

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
