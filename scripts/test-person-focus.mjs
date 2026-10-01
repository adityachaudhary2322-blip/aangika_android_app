/**
 * Person focus (personFocus.js): with several people in view, only the
 * signer's body and hands reach the translators.
 *
 *     node scripts/test-person-focus.mjs
 */
import { createFocus } from '../src/services/personFocus.js';

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

/** A person standing at x (0..1), shoulder width w; wrists in front of the chest unless raised. */
function person(x, w = 0.2, { raise = false } = {}) {
  const pose = Array.from({ length: 33 }, () => ({ x, y: 0.9, visibility: 0.1 }));
  const y = 0.55;
  const set = (i, px, py) => { pose[i] = { x: px, y: py, visibility: 0.99 }; };
  set(0, x, y - w * 0.9);                       // nose
  set(11, x + w / 2, y); set(12, x - w / 2, y); // shoulders (image left/right)
  set(13, x + w / 2, y + w * 0.7); set(14, x - w / 2, y + w * 0.7);
  set(15, x + w * 0.2, raise ? y - w * 1.6 : y + w * 0.4);
  set(16, x - w * 0.2, y + w * 0.4);
  return pose;
}
const handAt = (x, y, tag) => ({ tag, landmarks: [{ x, y, z: 0 }], handedness: 'Right' });
const handsOf = (x, w = 0.2, tag = '') => [handAt(x + w * 0.2, 0.55 + w * 0.4, `${tag}L`), handAt(x - w * 0.2, 0.55 + w * 0.4, `${tag}R`)];
const tags = (r) => r.hands.map((h) => h.tag).sort().join(',');

console.log('='.repeat(74) + '\n  Person focus\n' + '='.repeat(74));

const f = createFocus();
let t = 0;
const step = (poses, hands) => f.select({ poses, hands }, (t += 66));

// Signer in the middle, one bystander on each side, all hands up.
let r = step([person(0.15, 0.15), person(0.5, 0.22), person(0.85, 0.15)], [...handsOf(0.15, 0.15, 'a'), ...handsOf(0.5, 0.22, 's'), ...handsOf(0.85, 0.15, 'b')]);
check(tags(r) === 'sL,sR' && r.pose[11].x === 0.5 + 0.11, 'three people: the central one is the signer; only their two hands are kept', `${tags(r)} (${r.ignoredHands} ignored)`);

// A bigger (closer) person slightly off-centre beats a small one dead centre.
const f2 = createFocus();
r = f2.select({ poses: [person(0.5, 0.08), person(0.4, 0.3)], hands: [...handsOf(0.5, 0.08, 'far'), ...handsOf(0.4, 0.3, 'near')] }, 66);
check(tags(r) === 'nearL,nearR', 'the closer person in front is chosen over a small one far behind', tags(r));

// Locked: the signer walks off-centre; a bystander is now nearer the middle.
for (let i = 0; i < 10; i++) r = step([person(0.5 - i * 0.03, 0.22), person(0.85 - i * 0.03, 0.15)], [...handsOf(0.5 - i * 0.03, 0.22, 's'), ...handsOf(0.85 - i * 0.03, 0.15, 'b')]);
check(tags(r) === 'sL,sR', 'the signer stays locked while moving off-centre (bystander now nearer the middle is ignored)', tags(r));

// The signer briefly disappears: nobody else is taken over in the meantime.
r = step([person(0.55, 0.15)], handsOf(0.55, 0.15, 'b'));
check(r.hands.length === 0, 'signer briefly lost: the bystander\'s hands are not used', tags(r));
r = step([person(0.2, 0.22), person(0.55, 0.15)], [...handsOf(0.2, 0.22, 's'), ...handsOf(0.55, 0.15, 'b')]);
check(tags(r) === 'sL,sR', 'and the signer is picked up again when back', tags(r));

// Gone for good: after a while the central person is chosen again.
for (let i = 0; i < 25; i++) r = step([person(0.55, 0.15)], handsOf(0.55, 0.15, 'b'));
check(tags(r) === 'bL,bR', 'signer gone for over a second: the person now in the middle becomes the signer', tags(r));

// "My turn": someone else raises a hand above their head.
const f3 = createFocus(); let t3 = 0;
const s3 = (poses, hands) => f3.select({ poses, hands }, (t3 += 66));
s3([person(0.5, 0.22), person(0.85, 0.15)], [...handsOf(0.5, 0.22, 's'), ...handsOf(0.85, 0.15, 'b')]);
for (let i = 0; i < 8; i++) r = s3([person(0.5, 0.22), person(0.85, 0.15, { raise: true })], [...handsOf(0.5, 0.22, 's'), ...handsOf(0.85, 0.15, 'b')]);
check(tags(r) === 'sL,sR' && r.raising, 'a raised hand for half a second: not yet', tags(r));
for (let i = 0; i < 8; i++) r = s3([person(0.5, 0.22), person(0.85, 0.15, { raise: true })], [...handsOf(0.5, 0.22, 's'), ...handsOf(0.85, 0.15, 'b')]);
check(tags(r) === 'bL,bR', 'held for about a second: that person becomes the signer', tags(r));
for (let i = 0; i < 5; i++) r = s3([person(0.5, 0.22), person(0.85, 0.15)], [...handsOf(0.5, 0.22, 's'), ...handsOf(0.85, 0.15, 'b')]);
check(tags(r) === 'bL,bR', 'and stays the signer after lowering the hand (even though not central)', tags(r));

// One person only: nothing changes for the usual case.
const f4 = createFocus();
r = f4.select({ poses: [person(0.5)], hands: handsOf(0.5, 0.2, 's') }, 66);
check(tags(r) === 'sL,sR' && r.ignoredHands === 0, 'one person: both hands kept, as before');
r = f4.select({ poses: [], hands: [handAt(0.1, 0.5, 'x'), handAt(0.52, 0.5, 'y'), handAt(0.45, 0.5, 'z')] }, 99999);
check(tags(r) === 'y,z', 'no body in view: the two hands nearest the middle', tags(r));

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
