/**
 * ISL Studio features: one frame -> FEATURE_DIM numbers describing BOTH hands
 * in detail and where they are on the UPPER BODY.
 *
 * Per hand (48):
 *   presence                      1
 *   finger flexion               15   bend at each joint, 3 per finger (3-D)
 *   finger spread                 4   angle between neighbouring fingers
 *   fingertip distances           9   thumb tip to each tip, each tip to palm
 *   orientation                   6   palm normal + pointing direction,
 *                                     in the BODY's frame (leaning ignored)
 *   placement                     4   palm centre and index tip, body units
 *   distances to the body         7   nose, mouth, chin, forehead, chest,
 *                                     same-side and other shoulder
 *   arm posture                   2   elbow bend, upper-arm raise
 * Both hands (4): hands-apart distance, direction (dx, dy), body visible.
 *
 * "Body units": origin at the shoulder midpoint, x along the shoulders
 * (towards the signer's LEFT), y down the body, scaled by shoulder width. So a
 * sign reads the same near or far from the camera, anywhere in the frame, for
 * tall or short signers. Joint angles use MediaPipe's 3-D hand (metres) when
 * available, so they do not change with the hand's rotation or distance.
 *
 * Everything is scaled to about 0..1 so groups can be weighted (GROUPS).
 */

import { sideOf } from '../handshapeFeatures.js';

export const FEATURE_VERSION = 1;
export const HAND_DIM = 48;
export const FEATURE_DIM = 2 * HAND_DIM + 4;

// Offsets inside one hand's block.
const O = { presence: 0, flex: 1, spread: 16, tips: 20, orient: 29, place: 35, dist: 39, arm: 46 };

/** Feature groups and their weight in the distance (islSpotter.js). */
export const GROUPS = [
  { name: 'presence', from: O.presence, to: O.flex, weight: 2.0 },
  { name: 'finger shape', from: O.flex, to: O.orient, weight: 1.0 },
  { name: 'orientation', from: O.orient, to: O.place, weight: 0.8 },
  { name: 'placement', from: O.place, to: O.arm, weight: 1.2 },
  { name: 'arm posture', from: O.arm, to: HAND_DIM, weight: 0.4 },
];

const FINGERS = [[1, 2, 3, 4], [5, 6, 7, 8], [9, 10, 11, 12], [13, 14, 15, 16], [17, 18, 19, 20]];
const TIPS = [4, 8, 12, 16, 20];
const PALM = [0, 5, 9, 13, 17];

// ── vector helpers ──────────────────────────────────────────────────────────
const sub = (a, b) => [a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0)];
const norm = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => { const n = norm(v) || 1; return [v[0] / n, v[1] / n, v[2] / n]; };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(unit(a), unit(b)))));
const clip01 = (v) => Math.max(0, Math.min(1, v));
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ok = (p) => p && Number.isFinite(p.x) && Number.isFinite(p.y);

/**
 * The signer's body frame from the pose, or null when the shoulders are not
 * visible. x points from the signer's right shoulder (12) to their left (11).
 */
export function bodyFrame(pose) {
  const L = pose?.[11];
  const R = pose?.[12];
  if (!ok(L) || !ok(R)) return null;
  const span = dist2(L, R);
  if (!(span > 1e-3)) return null;
  const ux = [(L.x - R.x) / span, (L.y - R.y) / span];
  const uy = [-ux[1], ux[0]];                         // 90 degrees: down the body
  const origin = { x: (L.x + R.x) / 2, y: (L.y + R.y) / 2 };
  const toBody = (p) => {
    const dx = p.x - origin.x;
    const dy = p.y - origin.y;
    return { x: (dx * ux[0] + dy * ux[1]) / span, y: (dx * uy[0] + dy * uy[1]) / span };
  };
  // Face points from the pose (the face landmarker is not needed).
  const nose = pose[0];
  const mouth = ok(pose[9]) && ok(pose[10]) ? { x: (pose[9].x + pose[10].x) / 2, y: (pose[9].y + pose[10].y) / 2 } : null;
  const chin = nose && mouth ? { x: mouth.x + (mouth.x - nose.x) * 0.9, y: mouth.y + (mouth.y - nose.y) * 0.9 } : null;
  const forehead = nose && mouth ? { x: nose.x + (nose.x - mouth.x) * 1.6, y: nose.y + (nose.y - mouth.y) * 1.6 } : null;
  const chest = { x: origin.x + uy[0] * 0.7 * span, y: origin.y + uy[1] * 0.7 * span };
  return {
    origin, span, ux, uy, toBody,
    theta: Math.atan2(ux[1], ux[0]),
    points: { nose: ok(nose) ? nose : null, mouth, chin, forehead, chest, left: L, right: R },
    arm: { left: [pose[11], pose[13], pose[15]], right: [pose[12], pose[14], pose[16]] },
  };
}

/** Rotate a camera-space direction into the body frame (undo body roll). */
function toBodyDir(v, frame) {
  if (!frame) return v;
  const c = Math.cos(-frame.theta);
  const s = Math.sin(-frame.theta);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

/** Write one hand's 48 numbers into out[off..]. */
function handBlock(out, off, lm, world, side, frame) {
  out[off + O.presence] = 1;
  const P = world && world.length >= 21 ? world : lm;         // 3-D when we have it

  // Finger flexion: 0 straight .. 1 folded back on itself.
  FINGERS.forEach((f, i) => {
    const bones = [sub(P[f[0]], P[0]), sub(P[f[1]], P[f[0]]), sub(P[f[2]], P[f[1]]), sub(P[f[3]], P[f[2]])];
    for (let j = 0; j < 3; j++) out[off + O.flex + i * 3 + j] = angle(bones[j], bones[j + 1]) / Math.PI;
  });

  // Spread between neighbouring fingers (tip direction from the knuckle).
  const dirs = FINGERS.map((f) => sub(P[f[3]], P[f[0]]));
  for (let i = 0; i < 4; i++) out[off + O.spread + i] = angle(dirs[i], dirs[i + 1]) / Math.PI;

  // Fingertip distances, in palm lengths (wrist to middle knuckle).
  const palmLen = norm(sub(P[9], P[0])) || 1;
  const centre = PALM.reduce((a, i) => ({ x: a.x + P[i].x / 5, y: a.y + P[i].y / 5, z: a.z + (P[i].z || 0) / 5 }), { x: 0, y: 0, z: 0 });
  [8, 12, 16, 20].forEach((t, i) => { out[off + O.tips + i] = clip01(norm(sub(P[t], P[4])) / palmLen / 3); });
  TIPS.forEach((t, i) => { out[off + O.tips + 4 + i] = clip01(norm(sub(P[t], centre)) / palmLen / 3); });

  // Orientation: palm normal (out of the palm for either hand) and pointing
  // direction, in the body frame, mapped from -1..1 to 0..1.
  const normal = unit(cross(sub(P[5], P[0]), sub(P[17], P[0])).map((v) => v * (side === 'left' ? -1 : 1)));
  const point = unit(sub(P[9], P[0]));
  const n = toBodyDir(normal, frame);
  const d = toBodyDir(point, frame);
  for (let i = 0; i < 3; i++) {
    out[off + O.orient + i] = (n[i] + 1) / 2;
    out[off + O.orient + 3 + i] = (d[i] + 1) / 2;
  }

  // Placement on the body (image landmarks; body units).
  if (frame) {
    const palm = PALM.reduce((a, i) => ({ x: a.x + lm[i].x / 5, y: a.y + lm[i].y / 5 }), { x: 0, y: 0 });
    const b = frame.toBody(palm);
    const tip = frame.toBody(lm[8]);
    const s = (v) => clip01((v + 3) / 6);
    out[off + O.place] = s(b.x); out[off + O.place + 1] = s(b.y);
    out[off + O.place + 2] = s(tip.x); out[off + O.place + 3] = s(tip.y);
    const pts = frame.points;
    const same = side === 'left' ? pts.left : pts.right;
    const other = side === 'left' ? pts.right : pts.left;
    [pts.nose, pts.mouth, pts.chin, pts.forehead, pts.chest, same, other].forEach((p, i) => {
      out[off + O.dist + i] = p ? clip01(dist2(palm, p) / frame.span / 3) : 0.5;
    });
    const [sh, el, wr] = frame.arm[side] || [];
    if (ok(sh) && ok(el) && ok(wr)) {
      out[off + O.arm] = angle(sub(sh, el), sub(wr, el)) / Math.PI;
      const down = [frame.uy[0], frame.uy[1], 0];
      out[off + O.arm + 1] = angle(sub(el, sh), down) / Math.PI;
    } else {
      out[off + O.arm] = 0.5; out[off + O.arm + 1] = 0.5;
    }
  } else {
    for (let i = O.place; i < HAND_DIM; i++) out[off + i] = 0.5;   // unknown: neutral
  }
}

/**
 * One frame -> Float32Array(FEATURE_DIM).
 * Hands are placed by the SIGNER's side: [left hand | right hand | both].
 * @param frame { hands: [{landmarks, handedness, world}], pose, mirrored }
 */
export function frameFeatures({ hands, pose, mirrored = false }) {
  const out = new Float32Array(FEATURE_DIM);
  const body = bodyFrame(pose);
  const bySide = { left: null, right: null };
  for (const h of hands || []) {
    if (!h?.landmarks || h.landmarks.length < 21 || !h.landmarks.every(ok)) continue;
    const side = sideOf(h.handedness, mirrored);
    if (side && !bySide[side]) bySide[side] = h;
  }
  if (bySide.left) handBlock(out, 0, bySide.left.landmarks, bySide.left.world, 'left', body);
  if (bySide.right) handBlock(out, HAND_DIM, bySide.right.landmarks, bySide.right.world, 'right', body);
  const B = 2 * HAND_DIM;
  if (bySide.left && bySide.right && body) {
    const a = body.toBody(bySide.left.landmarks[9]);
    const b = body.toBody(bySide.right.landmarks[9]);
    out[B] = clip01(Math.hypot(a.x - b.x, a.y - b.y) / 3);
    out[B + 1] = clip01((a.x - b.x + 3) / 6);
    out[B + 2] = clip01((a.y - b.y + 3) / 6);
  } else {
    out[B] = 0.5; out[B + 1] = 0.5; out[B + 2] = 0.5;
  }
  out[B + 3] = body ? 1 : 0;
  return out;
}

/**
 * The same sign made with the other hand: swap the hand blocks and reflect
 * left-right quantities (placement x, orientation x). For "either hand" signs.
 */
export function mirrorFeatures(f) {
  const out = new Float32Array(FEATURE_DIM);
  out.set(f.subarray(HAND_DIM, 2 * HAND_DIM), 0);
  out.set(f.subarray(0, HAND_DIM), HAND_DIM);
  for (const off of [0, HAND_DIM]) {
    out[off + O.orient] = 1 - out[off + O.orient];            // normal x
    out[off + O.orient + 3] = 1 - out[off + O.orient + 3];    // pointing x
    out[off + O.place] = 1 - out[off + O.place];              // palm x
    out[off + O.place + 2] = 1 - out[off + O.place + 2];      // index tip x
    // same / other shoulder distances swap meaning
    const s = out[off + O.dist + 5];
    out[off + O.dist + 5] = out[off + O.dist + 6];
    out[off + O.dist + 6] = s;
  }
  const B = 2 * HAND_DIM;
  out[B] = f[B]; out[B + 1] = 1 - f[B + 1]; out[B + 2] = f[B + 2]; out[B + 3] = f[B + 3];
  return out;
}

// ── Reading a frame back as words (the analysis shown to the signer) ───────

const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'];

/** Human-readable analysis of one frame's features. */
export function describeFeatures(f) {
  const parts = [];
  for (const [side, off] of [['left', 0], ['right', HAND_DIM]]) {
    if (f[off + O.presence] < 0.5) continue;
    const bent = FINGER_NAMES.map((name, i) => {
      const total = f[off + O.flex + i * 3] + f[off + O.flex + i * 3 + 1] + f[off + O.flex + i * 3 + 2];
      return total > (i === 0 ? 0.55 : 0.6) ? null : name;
    }).filter(Boolean);
    const d = (i) => f[off + O.dist + i] * 3;             // back to body units
    const near = [['mouth', d(1)], ['chin', d(2)], ['nose', d(0)], ['forehead', d(3)], ['chest', d(4)],
      ['own shoulder', d(5)], ['other shoulder', d(6)]].sort((a, b) => a[1] - b[1])[0];
    // (Palm orientation is in the features but not put into words: its sign
    // convention depends on MediaPipe's 3-D axes, not verified on real hands.)
    parts.push({
      side,
      extended: bent,
      near: near[1] < 0.45 ? near[0] : null,
      text: `${side} hand: ${bent.length ? bent.join(', ') + ' extended' : 'fist'}` +
        (near[1] < 0.45 ? `; at the ${near[0]}` : ''),
    });
  }
  return parts;
}

export default { frameFeatures, mirrorFeatures, describeFeatures, bodyFrame, FEATURE_DIM, FEATURE_VERSION, GROUPS };
