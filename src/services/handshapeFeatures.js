/**
 * Handshape features for user-taught signs ("My signs").
 *
 * Built on SignBridge's 63-dim wrist-relative, scale-normalised hand vector
 * (extractHandFeature), plus three things a user's own sign needs:
 *
 *  1. IN-PLANE ROTATION NORMALISATION. The vector is rotated so the wrist ->
 *     middle-finger MCP axis points straight up. The same handshape held a
 *     little tilted then maps to (nearly) the same vector; that is what lets
 *     three short captures generalise. The price: tilt alone can no longer tell
 *     two signs apart. Location and the second hand still can.
 *  2. COARSE LOCATION from pose: palm centre relative to the shoulder midpoint,
 *     in shoulder spans. Kept continuous for matching and bucketed
 *     (face / chest / side / low) for display and conflict messages.
 *  3. TWO-HANDED OFFSET: right palm minus left palm, divided by the mean hand
 *     size, so it needs no pose and survives camera distance.
 *
 * Sides follow packFrame's convention exactly: MediaPipe's label is swapped
 * when `mirrored`, so "left" is always the signer's left hand.
 *
 * Pure functions, no DOM: runs in the browser and under node for tests.
 */

import { extractHandFeature } from './signbridgeEngine.js';

// Landmarks 1..20 x (x,y,z). The wrist is the origin after extractHandFeature,
// so its three zeros carry no information and are dropped.
export const SHAPE_DIM = 60;
export const LOC_DIM = 2;
export const OFFSET_DIM = 2;

/** Weights balance shape against location. Shape vectors live in [-1, 1]. */
export const LOC_WEIGHT = 0.35;
export const OFFSET_WEIGHT = 0.5;

const MIDDLE_MCP = 9;
const PALM = [0, 5, 9, 13, 17];

/** packFrame's side rule: MediaPipe label, swapped when the frame is mirrored. */
export function sideOf(handedness, mirrored = false) {
  const label = String(handedness || '').toLowerCase();
  if (label === 'left') return mirrored ? 'right' : 'left';
  if (label === 'right') return mirrored ? 'left' : 'right';
  return null;
}

export const otherSide = (side) => (side === 'left' ? 'right' : side === 'right' ? 'left' : null);

/** A hand is usable only when all 21 landmarks are present and finite. */
export function isFullHand(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;
  for (let i = 0; i < 21; i++) {
    const p = landmarks[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
  }
  return true;
}

/** Largest wrist distance in image units: the hand's apparent size. */
export function handScale(landmarks) {
  const w = landmarks[0];
  let max = 0;
  for (let i = 1; i < 21; i++) {
    const p = landmarks[i];
    const d = Math.hypot(p.x - w.x, p.y - w.y, (p.z || 0) - (w.z || 0));
    if (d > max) max = d;
  }
  return max;
}

export function palmCentre(landmarks) {
  let x = 0;
  let y = 0;
  for (const i of PALM) { x += landmarks[i].x; y += landmarks[i].y; }
  return { x: x / PALM.length, y: y / PALM.length };
}

/**
 * 60-dim rotation-normalised shape vector, written into `out` at `offset`.
 * mirror=true reflects it left-right (x -> -x), turning a right-hand shape
 * into the equivalent left-hand one.
 */
export function shapeVector(landmarks, mirror = false, out = null, offset = 0) {
  const v = out || new Float32Array(SHAPE_DIM);
  const f = extractHandFeature(landmarks);          // 63, wrist at origin, scaled
  const mx = f[MIDDLE_MCP * 3];
  const my = f[MIDDLE_MCP * 3 + 1];
  // Rotate by -a, where a is the axis angle from "up" (0, -1) in image coords.
  const a = Math.atan2(mx, -my);
  const c = Math.cos(-a);
  const s = Math.sin(-a);
  const sx = mirror ? -1 : 1;
  for (let i = 1; i < 21; i++) {
    const x = f[i * 3];
    const y = f[i * 3 + 1];
    const o = offset + (i - 1) * 3;
    v[o] = (x * c - y * s) * sx;
    v[o + 1] = x * s + y * c;
    v[o + 2] = f[i * 3 + 2];
  }
  return v;
}

/** Shoulder frame from pose, or null when the shoulders are not visible. */
export function shoulderFrame(pose) {
  const l = pose?.[11];
  const r = pose?.[12];
  if (!l || !r || !Number.isFinite(l.x) || !Number.isFinite(r.x)) return null;
  const span = Math.hypot(l.x - r.x, l.y - r.y);
  if (!(span > 1e-3)) return null;
  return { x: (l.x + r.x) / 2, y: (l.y + r.y) / 2, span };
}

/** Palm centre in shoulder spans relative to the shoulder midpoint. */
export function locationOf(point, frame, mirror = false) {
  if (!frame) return null;
  return {
    dx: ((point.x - frame.x) / frame.span) * (mirror ? -1 : 1),
    dy: (point.y - frame.y) / frame.span,
  };
}

/** Human-readable bucket; image y grows downward, so "up" is negative dy. */
export function locationBucket(loc) {
  if (!loc) return 'unknown';
  if (loc.dy > 1.1) return 'low';
  if (Math.abs(loc.dx) > 0.9) return 'side';
  if (loc.dy < -0.45 && Math.abs(loc.dx) < 0.75) return 'face';
  return 'chest';
}

export const LOCATION_LABELS = {
  face: 'near the face', chest: 'in front of the chest', side: 'out to the side',
  low: 'low, below the chest', unknown: 'unknown (shoulders not visible)',
};

/** Dimensions of a one- / two-handed feature vector, location last. */
export const dimsFor = (hands) => (hands === 'two'
  ? { shape: 2 * SHAPE_DIM + OFFSET_DIM, total: 2 * SHAPE_DIM + OFFSET_DIM + LOC_DIM }
  : { shape: SHAPE_DIM, total: SHAPE_DIM + LOC_DIM });

/**
 * Split a frame's hands by side. `hands` is [{landmarks, handedness}] as the
 * landmarker returns them; incomplete hands are ignored.
 */
export function handsBySide(hands, mirrored) {
  const out = { left: null, right: null };
  for (const h of hands || []) {
    if (!isFullHand(h?.landmarks)) continue;
    const side = sideOf(h.handedness, mirrored);
    if (side && !out[side]) out[side] = h.landmarks;
  }
  return out;
}

/**
 * One-handed feature: [shape 60 | loc 2]. Returns {vec, hasLoc, side}.
 * `mirror` reflects shape and location and reports the opposite side.
 */
export function oneHandFeature(landmarks, side, pose, mirror = false) {
  const { total } = dimsFor('one');
  const vec = new Float32Array(total);
  shapeVector(landmarks, mirror, vec, 0);
  const loc = locationOf(palmCentre(landmarks), shoulderFrame(pose), mirror);
  if (loc) {
    vec[SHAPE_DIM] = loc.dx * LOC_WEIGHT;
    vec[SHAPE_DIM + 1] = loc.dy * LOC_WEIGHT;
  }
  return { vec, hasLoc: Boolean(loc), side: mirror ? otherSide(side) : side, loc };
}

/**
 * Two-handed feature: [left shape 60 | right shape 60 | offset 2 | loc 2].
 * mirror=true produces the reflected sign: shapes mirrored AND swapped between
 * the sides, offset x negated.
 */
export function twoHandFeature(left, right, pose, mirror = false) {
  const { shape, total } = dimsFor('two');
  const vec = new Float32Array(total);
  const [a, b] = mirror ? [right, left] : [left, right];
  shapeVector(a, mirror, vec, 0);
  shapeVector(b, mirror, vec, SHAPE_DIM);

  const ca = palmCentre(a);
  const cb = palmCentre(b);
  const size = (handScale(left) + handScale(right)) / 2 || 1;
  const sx = mirror ? -1 : 1;
  vec[2 * SHAPE_DIM] = ((cb.x - ca.x) / size) * sx * OFFSET_WEIGHT;
  vec[2 * SHAPE_DIM + 1] = ((cb.y - ca.y) / size) * OFFSET_WEIGHT;

  const mid = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
  const loc = locationOf(mid, shoulderFrame(pose), mirror);
  if (loc) {
    vec[shape] = loc.dx * LOC_WEIGHT;
    vec[shape + 1] = loc.dy * LOC_WEIGHT;
  }
  return { vec, hasLoc: Boolean(loc), loc };
}

// ── Stored-sample (de)serialisation ─────────────────────────────────────────
// Samples are stored as RAW landmarks, never as features, so the feature
// definition can change later without re-recording anyone's signs.

const POSE_KEEP = [0, 11, 12, 13, 14, 15, 16];

const round = (v) => Math.round(v * 1e5) / 1e5;

/** Frame -> compact JSON-safe sample. */
export function packSample(hands, pose, mirrored, capture = 0) {
  const bySide = handsBySide(hands, mirrored);
  const flat = (lm) => lm.slice(0, 21).flatMap((p) => [round(p.x), round(p.y), round(p.z || 0)]);
  const p = {};
  for (const i of POSE_KEEP) {
    const q = pose?.[i];
    if (q && Number.isFinite(q.x)) p[i] = [round(q.x), round(q.y)];
  }
  return {
    capture,
    left: bySide.left ? flat(bySide.left) : null,
    right: bySide.right ? flat(bySide.right) : null,
    pose: p,
  };
}

const unflat = (a) => (a
  ? Array.from({ length: 21 }, (_, i) => ({ x: a[i * 3], y: a[i * 3 + 1], z: a[i * 3 + 2] }))
  : null);

/** Stored sample -> {left, right, pose} with landmark objects again. */
export function unpackSample(s) {
  const pose = new Array(33).fill(null);
  for (const [i, xy] of Object.entries(s.pose || {})) pose[+i] = { x: xy[0], y: xy[1], z: 0 };
  return { left: unflat(s.left), right: unflat(s.right), pose, capture: s.capture || 0 };
}

/**
 * Stored sample -> the landmarker's frame shape ({hands, pose}), e.g. to run
 * the built-in SignBridge rules over a recorded sign. Labels are emitted for
 * mirrored=false, i.e. label === side.
 */
export function sampleAsFrame(s) {
  const u = unpackSample(s);
  const hands = [];
  if (u.right) hands.push({ landmarks: u.right, handedness: 'Right' });
  if (u.left) hands.push({ landmarks: u.left, handedness: 'Left' });
  return { hands, pose: u.pose };
}

export default {
  SHAPE_DIM, LOC_DIM, OFFSET_DIM, sideOf, otherSide, isFullHand, shapeVector,
  locationOf, locationBucket, oneHandFeature, twoHandFeature, handsBySide,
  packSample, unpackSample, sampleAsFrame, dimsFor, LOCATION_LABELS,
};
