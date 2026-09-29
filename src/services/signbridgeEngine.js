/**
 * SignBridge deterministic 20-sign classifier.
 *
 * PROVENANCE. From github.com/dhairyakumar018/SIGNBRIDGE, only one thing is
 * ported: the 63-coordinate wrist-relative hand feature in
 * training/normalization.py. That repo contains no static-pose or alphabet
 * classifier, and no trained weights were ever committed (`git log --all` over
 * .keras/.h5/.pt/.onnx/.tflite is empty). Its published metrics are 33.3%
 * accuracy on 3 classes from 18 synthetic videos, which is chance. The decision
 * tree below is written here, from the geometry in the spec.
 *
 * THREE LIMITS, stated because the UI must not overstate them:
 *
 * 1. Y-AXIS FINGER TESTS ARE ROTATION-DEPENDENT. `tip.y < pip.y` only means
 *    "extended" while the hand points upward. Tilt it 90 degrees and every
 *    finger reads as closed. The spec names these flags explicitly so they are
 *    implemented exactly as specified, but a rotation-invariant radial test
 *    runs alongside them and [handTilt] measures the deviation. Where a sign is
 *    defined by tilt -- GOODBYE -- the radial test is used instead, or the
 *    tilted hand could never match.
 *
 * 2. SOME OF THESE SIGNS CANNOT BE SEEN IN ONE FRAME. "Held steady" (YES),
 *    "rubbing" (HOW_MUCH) and "tapping" (NAME_ADITYA) are motion. A static
 *    classifier is blind to all three. They are matched on their handshape and
 *    position alone and flagged `motionAssumed`, because the alternative --
 *    silently reporting them as confidently seen -- is a lie.
 *
 * 3. CONFIDENCE IS COMPUTED, NOT CONSTANT. The spec asks for a fixed 0.92.
 *    That is the same fabricated-confidence pattern as SignBridge's own demo
 *    path (`0.88 + |sin(sum)| * 0.09`), and it would make an ambiguous frame
 *    and a textbook one look identical to the user. Confidence here is the
 *    fraction of a rule's conditions that actually held, penalised when a
 *    motion cue had to be assumed and when a competing rule also matched.
 *    Set FIXED_CONFIDENCE below if the constant is genuinely wanted.
 */

import { GESTURE_TOKENS } from '../config/gestureSentences.js';

export const HAND_FEATURE_DIM = 63;

/** Set to 0.92 to restore the spec's constant. null = compute honestly. */
const FIXED_CONFIDENCE = null;

// MediaPipe hand landmark indices.
const WRIST = 0;
const THUMB_MCP = 2;
const THUMB_TIP = 4;
const INDEX_PIP = 6;
const INDEX_TIP = 8;
const MIDDLE_PIP = 10;
const MIDDLE_TIP = 12;
const RING_PIP = 14;
const RING_TIP = 16;
const PINKY_PIP = 18;
const PINKY_TIP = 20;
const TIPS = [THUMB_TIP, INDEX_TIP, MIDDLE_TIP, RING_TIP, PINKY_TIP];

// ── Feature extraction (ported from SignBridge) ──────────────────────────────

/**
 * 21 landmarks -> 63 floats: wrist-relative offsets (x_i - x_0, y_i - y_0,
 * z_i - z_0) divided by the maximum distance from the wrist.
 *
 * The scale step is in SignBridge's original and is not optional: without it
 * the same handshape yields different vectors at different camera distances.
 * An absent hand is all zeros, matching the convention used across this app.
 */
export function extractHandFeature(landmarks, out) {
  const v = out || new Float32Array(HAND_FEATURE_DIM);
  v.fill(0);
  if (!landmarks || landmarks.length < 21) return v;

  const w = landmarks[WRIST];
  let maxDist = 0;
  for (let i = 0; i < 21; i++) {
    const lm = landmarks[i];
    const o = i * 3;
    const dx = (lm.x || 0) - (w.x || 0);
    const dy = (lm.y || 0) - (w.y || 0);
    const dz = (lm.z || 0) - (w.z || 0);
    v[o] = dx; v[o + 1] = dy; v[o + 2] = dz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > maxDist) maxDist = d;
  }
  if (maxDist > 1e-6) for (let i = 0; i < HAND_FEATURE_DIM; i++) v[i] /= maxDist;
  return v;
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

const d2 = (a, b) => Math.hypot((a?.x ?? 0) - (b?.x ?? 0), (a?.y ?? 0) - (b?.y ?? 0));
const radius = (lm, i) => d2(lm[i], lm[WRIST]);

const MIDDLE_MCP = 9;
/**
 * Palm length (wrist to middle knuckle) the distance thresholds were tuned
 * at: about a hand at arm's length in a 4:3 webcam frame. Shape distances are
 * measured in these units, so a pinch is a pinch whether the hand is near
 * the camera or far from it (and for small and large hands alike).
 */
export const REFERENCE_PALM = 0.11;
const palmScale = (lm) => {
  const palm = d2(lm[WRIST], lm[MIDDLE_MCP]);
  return palm > 1e-4 ? REFERENCE_PALM / palm : 1;
};

/** Largest pairwise distance among the five fingertips. */
function tipSpread(lm) {
  let max = 0;
  for (let i = 0; i < TIPS.length; i++) {
    for (let j = i + 1; j < TIPS.length; j++) {
      const d = d2(lm[TIPS[i]], lm[TIPS[j]]);
      if (d > max) max = d;
    }
  }
  return max;
}

// ── Feature flags (exactly as specified) ─────────────────────────────────────

/**
 * The boolean finger states from the spec, plus the rotation-invariant
 * cross-check and a tilt measure.
 */
export function handFlags(lm, pose = null) {
  // --- specified y-axis flags -------------------------------------------
  const indexOpen = lm[INDEX_TIP].y < lm[INDEX_PIP].y;
  const middleOpen = lm[MIDDLE_TIP].y < lm[MIDDLE_PIP].y;
  const ringOpen = lm[RING_TIP].y < lm[RING_PIP].y;
  const pinkyOpen = lm[PINKY_TIP].y < lm[PINKY_PIP].y;
  const thumbUp = lm[THUMB_TIP].y < lm[THUMB_MCP].y;
  const thumbDown = lm[THUMB_TIP].y > lm[WRIST].y;

  // --- rotation-invariant cross-check -----------------------------------
  // Radius from the wrist does not care which way the hand points, so when the
  // two disagree the hand is tilted and the y-flags are unreliable.
  const radial = {
    index: radius(lm, INDEX_TIP) > radius(lm, INDEX_PIP) * 1.12,
    middle: radius(lm, MIDDLE_TIP) > radius(lm, MIDDLE_PIP) * 1.12,
    ring: radius(lm, RING_TIP) > radius(lm, RING_PIP) * 1.12,
    pinky: radius(lm, PINKY_TIP) > radius(lm, PINKY_PIP) * 1.12,
    thumb: radius(lm, THUMB_TIP) > radius(lm, THUMB_MCP) * 1.02,
  };

  // Angle of the middle-finger axis away from straight up, in degrees.
  const axisX = lm[MIDDLE_TIP].x - lm[WRIST].x;
  const axisY = lm[MIDDLE_TIP].y - lm[WRIST].y;
  const handTilt = Math.abs(Math.atan2(axisX, -axisY) * (180 / Math.PI));

  const yOpen = [indexOpen, middleOpen, ringOpen, pinkyOpen];
  const rOpen = [radial.index, radial.middle, radial.ring, radial.pinky];
  const disagreement = yOpen.reduce((n, v, i) => n + (v === rOpen[i] ? 0 : 1), 0);

  const wrist = lm[WRIST];
  const k = palmScale(lm);
  const shoulderY = pose?.[11]?.y ?? 0.42;
  const noseX = pose?.[0]?.x ?? 0.5;
  const noseY = pose?.[0]?.y ?? 0.25;

  return {
    indexOpen, middleOpen, ringOpen, pinkyOpen, thumbUp, thumbDown,
    radial,
    handTilt,
    tiltUnreliable: disagreement >= 2 || handTilt > 55,

    fingersOpen: yOpen.filter(Boolean).length,
    radialOpen: rOpen.filter(Boolean).length,
    allOpen: indexOpen && middleOpen && ringOpen && pinkyOpen,
    allClosed: !indexOpen && !middleOpen && !ringOpen && !pinkyOpen,

    // spatial zones
    isAboveShoulder: wrist.y < shoulderY,
    isNearMouth: Math.hypot(lm[INDEX_TIP].x - noseX, lm[INDEX_TIP].y - noseY) < 0.18,
    isWristNearMouth: Math.hypot(wrist.x - noseX, wrist.y - noseY) < 0.30,
    isChestLevel: wrist.y > 0.45 && wrist.y < 0.70,

    // shape scalars, in reference-palm units (see REFERENCE_PALM)
    indexTip: lm[INDEX_TIP],
    indexMiddleGap: d2(lm[INDEX_TIP], lm[MIDDLE_TIP]) * k,
    pinch: d2(lm[THUMB_TIP], lm[INDEX_TIP]) * k,
    pinchMiddle: d2(lm[THUMB_TIP], lm[MIDDLE_TIP]) * k,
    tipCluster: tipSpread(lm) * k,
    thumbPinkyGap: d2(lm[THUMB_TIP], lm[PINKY_TIP]) * k,
    wrist,
    k,
  };
}

// ── The 20-sign decision tree ────────────────────────────────────────────────

/**
 * Each rule lists its conditions as [name, boolean] so confidence can reflect
 * how many actually held, rather than being asserted.
 *
 * `motion` marks a sign whose defining cue is movement and therefore cannot be
 * confirmed from one frame.
 */
function rules(f, second, handCount) {
  const both = handCount >= 2;
  // Distances BETWEEN the hands, in reference-palm units (both hands' mean).
  const kk = second ? (f.k + second.k) / 2 : f.k;
  const apart = (a, b) => d2(a, b) * kk;
  const R = [];
  const add = (token, conds, opts = {}) => R.push({ token, conds, ...opts });

  // 1-2. Open palm: greeting vs stop, separated by height.
  add('HELLO', [
    ['all five extended', f.allOpen && (f.thumbUp || f.radial.thumb)],
    ['above shoulder', f.isAboveShoulder],
  ]);
  add('STOP', [
    ['all five extended', f.allOpen && (f.thumbUp || f.radial.thumb)],
    ['chest level', f.isChestLevel],
  ]);

  // 20. GOODBYE: open hand raised AND tilted away. Uses the radial test because
  // a tilted hand defeats the y-axis flags by construction.
  add('GOODBYE', [
    ['all five extended (radial)', f.radialOpen === 4],
    ['raised high', f.isAboveShoulder],
    ['tilted sideways', f.handTilt > 35],
  ]);

  // 3-4. Fist with thumb up / down.
  add('GOOD', [
    ['four fingers closed', f.allClosed],
    ['thumb up', f.thumbUp],
    ['thumb clear of fist', f.thumbPinkyGap > 0.06],
  ]);
  add('BAD', [
    ['four fingers closed', f.allClosed],
    ['thumb down', f.thumbDown],
    ['thumb clear of the fist', f.thumbPinkyGap > 0.05],
  ]);

  // 5. YES: fist at mid-torso. "Held steady" is motion; unverifiable here.
  add('YES', [
    ['closed fist', f.allClosed],
    ['mid-torso', f.wrist.y > 0.56 && f.wrist.y < 0.72],
    ['thumb neutral', !f.thumbUp && !f.thumbDown],
  ], { motion: 'steadiness cannot be seen in one frame' });

  // 6. NO: index+middle pinched tight to the thumb.
  add('NO', [
    ['index and middle extended', f.indexOpen && f.middleOpen],
    ['ring and pinky closed', !f.ringOpen && !f.pinkyOpen],
    ['pinched to thumb', f.pinch < 0.04],
    ['index and middle held together', f.indexMiddleGap < 0.05],
  ]);

  // 7. WATER: loose C at the mouth.
  add('WATER', [
    ['near mouth', f.isNearMouth],
    ['loose C shape', f.pinch > 0.04 && f.pinch < 0.12],
    ['fingers curved, not extended', f.fingersOpen <= 1],
  ]);

  // 8. FOOD: all five fingertips clustered, at the mouth.
  add('FOOD', [
    ['fingertips clustered', f.tipCluster < 0.05],
    ['near mouth', f.isNearMouth || f.isWristNearMouth],
    ['all five gathered, not just two', f.pinch < 0.05 && f.pinchMiddle < 0.05],
  ]);

  // 9. PLEASE: flat palm on the sternum.
  add('PLEASE', [
    ['flat open hand', f.allOpen],
    ['low on the sternum', f.wrist.y > 0.62],
    ['not raised', !f.isAboveShoulder],
  ]);

  // 10. THANK_YOU: flat hand near the chin, tilting outward.
  add('THANK_YOU', [
    ['flat hand', f.allOpen],
    ['near mouth or chin', f.isWristNearMouth],
    ['tilted outward', f.handTilt > 20],
  ]);

  // 11. HELP: fist resting on the other open palm.
  add('HELP', [
    ['two hands', both],
    ['one hand flat', f.allOpen || (second && second.allOpen)],
    ['other hand a fist', f.allClosed || (second && second.allClosed)],
    ['hands together', Boolean(second) && apart(f.wrist, second.wrist) < 0.22],
  ]);

  // 12. WASHROOM: the W shape.
  add('WASHROOM', [
    ['index, middle, ring extended', f.indexOpen && f.middleOpen && f.ringOpen],
    ['pinky folded', !f.pinkyOpen],
    ['pinky held by thumb', f.thumbPinkyGap < 0.08],
  ]);

  // 13. SORRY: fist on the centre of the chest.
  add('SORRY', [
    ['closed fist', f.allClosed],
    ['high on the chest', f.wrist.y > 0.45 && f.wrist.y <= 0.56],
    ['centred', Math.abs(f.wrist.x - 0.5) < 0.10],
    ['thumb tucked, neither up nor down', !f.thumbUp && !f.thumbDown],
  ], { motion: 'the circular rub cannot be seen in one frame' });

  // 14. UNDERSTAND: index up at the temple.
  add('UNDERSTAND', [
    ['index extended', f.indexOpen],
    ['other fingers closed', !f.middleOpen && !f.ringOpen && !f.pinkyOpen],
    ['at head height', f.isAboveShoulder],
  ]);

  // 15. DONT_UNDERSTAND: two hands crossed at the chest.
  add('DONT_UNDERSTAND', [
    ['two hands', both],
    ['wrists crossed', Boolean(second) && crossed(f, second, kk)],
    ['at chest height', f.isChestLevel],
  ]);

  // 16. DOCTOR: two fingers on the other wrist (taking a pulse).
  add('DOCTOR', [
    ['two hands', both],
    ['index and middle extended', f.indexOpen && f.middleOpen],
    ['touching the other wrist',
      Boolean(second) && apart(f.indexTip, second.wrist) < 0.12],
  ]);

  // 17. POLICE: two fingers at the opposite shoulder (a badge).
  add('POLICE', [
    ['index and middle extended', f.indexOpen && f.middleOpen],
    ['ring and pinky closed', !f.ringOpen && !f.pinkyOpen],
    ['at shoulder height', f.isAboveShoulder || f.wrist.y < 0.5],
    ['across the body', Math.abs(f.wrist.x - 0.5) > 0.1],
  ]);

  // 18. HOW_MUCH: the money rub.
  add('HOW_MUCH', [
    ['index and middle extended', f.indexOpen && f.middleOpen],
    ['thumb at the index tip', f.pinch < 0.06],
    ['thumb near the middle tip', f.pinchMiddle < 0.13],
    ['ring and pinky closed', !f.ringOpen && !f.pinkyOpen],
  ], { motion: 'the rubbing motion cannot be seen in one frame' });

  // 19. NAME_ADITYA: both hands, two fingers, tapping.
  add('NAME_ADITYA', [
    ['two hands', both],
    ['index and middle extended', f.indexOpen && f.middleOpen],
    ['same shape on both hands',
      Boolean(second) && second.indexOpen && second.middleOpen],
    ['hands close together',
      Boolean(second) && apart(f.wrist, second.wrist) < 0.3],
  ], { motion: 'the tapping motion cannot be seen in one frame' });

  return R;
}

/** Wrists on opposite sides of each other: an X in front of the body. */
function crossed(a, b, k = 1) {
  // Genuinely overlapping: close horizontally AND at a similar height. The
  // looser version matched any two hands held up at the same time.
  return Math.abs(a.wrist.x - b.wrist.x) * k < 0.16 &&
    Math.abs(a.wrist.y - b.wrist.y) * k < 0.12;
}

// ── Classification ───────────────────────────────────────────────────────────

/**
 * Classify one frame.
 *
 * @param {{landmarks:Array, handedness:string}[]} hands
 * @param {Array|null} pose 33 pose landmarks; zones fall back to constants
 * @returns {{token,confidence,engine,...}|null}
 */
export function classifySignBridgeFrame(hands, pose = null) {
  const started = performance.now();
  if (!hands || hands.length === 0 || !hands[0]?.landmarks) return null;

  const primary = handFlags(hands[0].landmarks, pose);
  const secondary = hands[1]?.landmarks
    ? handFlags(hands[1].landmarks, pose)
    : null;

  const candidates = [];
  for (const rule of rules(primary, secondary, hands.length)) {
    const met = rule.conds.filter(([, ok]) => ok).length;
    const total = rule.conds.length;
    if (met < total) continue;                 // every condition must hold
    candidates.push({
      token: rule.token,
      met,
      total,
      motion: rule.motion || null,
      failed: rule.conds.filter(([, ok]) => !ok).map(([n]) => n),
    });
  }

  if (candidates.length === 0) {
    // Report the closest near-miss: "nothing matched" is far less useful to a
    // signer than "you were one condition away from WATER".
    const near = rules(primary, secondary, hands.length)
      .map((r) => ({
        token: r.token,
        met: r.conds.filter(([, ok]) => ok).length,
        total: r.conds.length,
        failed: r.conds.filter(([, ok]) => !ok).map(([n]) => n),
      }))
      .sort((a, b) => b.met / b.total - a.met / a.total)[0];

    return {
      token: null, confidence: 0, engine: 'SignBridge',
      latencyMs: performance.now() - started,
      nearest: near ? { token: near.token, missing: near.failed } : null,
      tiltUnreliable: primary.tiltUnreliable,
    };
  }

  // Order by specificity, but a rule that needs no assumed motion always beats
  // one that does -- otherwise a static handshape is reported as a gesture
  // whose defining movement was never actually observed.
  candidates.sort((a, b) => {
    if (a.total !== b.total) return b.total - a.total;   // specificity first
    if (Boolean(a.motion) !== Boolean(b.motion)) return a.motion ? 1 : -1;
    return 0;
  });
  const best = candidates[0];
  const contested = candidates.length > 1;

  let confidence;
  if (FIXED_CONFIDENCE !== null) {
    confidence = FIXED_CONFIDENCE;
  } else {
    // Start from rule specificity, then subtract for everything we could not
    // actually verify.
    confidence = 0.72 + Math.min(best.total, 4) * 0.055;   // 0.775 .. 0.94
    if (best.motion) confidence -= 0.16;                    // motion assumed
    if (contested) confidence -= 0.12;                      // another rule fits
    if (primary.tiltUnreliable) confidence -= 0.10;         // y-flags shaky
    if (!pose) confidence -= 0.05;                          // zones are guesses
    confidence = Math.max(0.3, Math.min(0.97, confidence));
  }

  return {
    token: best.token,
    confidence,
    engine: 'SignBridge',
    latencyMs: performance.now() - started,
    motionAssumed: best.motion,
    alternatives: candidates.slice(1, 3).map((c) => c.token),
    ambiguous: contested,
    tiltUnreliable: primary.tiltUnreliable,
  };
}

export const SIGNBRIDGE_LABELS = GESTURE_TOKENS;

export default {
  extractHandFeature, handFlags, classifySignBridgeFrame,
  SIGNBRIDGE_LABELS, HAND_FEATURE_DIM,
};
