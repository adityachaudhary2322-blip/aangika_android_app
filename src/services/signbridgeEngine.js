/**
 * SignBridge static-pose engine.
 *
 * WHAT IS ACTUALLY FROM SIGNBRIDGE, and what is not — verified by reading
 * github.com/dhairyakumar018/SIGNBRIDGE at training/normalization.py:
 *
 *   PORTED FAITHFULLY: the 63-coordinate hand feature. Wrist-relative offsets
 *   (x_i - x_0, y_i - y_0, z_i - z_0) for all 21 landmarks, then divided by the
 *   maximum distance from the wrist. That scale step is in the original and is
 *   not optional: without it the same handshape produces different vectors at
 *   different distances from the camera.
 *
 *   WRITTEN HERE: the classifier. SignBridge contains no static-pose or
 *   alphabet classifier at all — grepping the repo for alphabet/letter/static
 *   classification returns nothing — and no trained weights were ever committed
 *   (`git log --all` over .keras/.h5/.pt/.onnx/.tflite is empty). Its only
 *   published metrics are 33.3% accuracy on 3 classes from 18 synthetic
 *   OpenCV-drawn videos, which is chance, and its demo path returns a fabricated
 *   confidence of `0.88 + |sin(sum)| * 0.09`.
 *
 * So this file implements SignBridge's feature contract with a geometric
 * classifier of our own. Confidence here is derived from the margin between the
 * best and second-best template — it is a real separation measure, not a
 * decorative number.
 *
 * Scope, honestly: static handshape only. It cannot see movement, so it cannot
 * distinguish gestures that differ only in motion. Where two gestures share a
 * handshape, they are separated using the other hand or the body pose, and
 * where that is impossible the engine returns both and says it is unsure.
 */

export const HAND_FEATURE_DIM = 63;

// MediaPipe hand topology.
const WRIST = 0;
const FINGERS = {
  thumb: { mcp: 2, pip: 3, tip: 4 },
  index: { mcp: 5, pip: 6, tip: 8 },
  middle: { mcp: 9, pip: 10, tip: 12 },
  ring: { mcp: 13, pip: 14, tip: 16 },
  pinky: { mcp: 17, pip: 18, tip: 20 },
};
const FINGER_ORDER = ['thumb', 'index', 'middle', 'ring', 'pinky'];

// ── Feature extraction (ported from SignBridge) ──────────────────────────────

/**
 * 21 landmarks -> 63 floats, wrist-relative and scale-normalised.
 *
 * Returns an all-zero vector for a missing hand, matching SignBridge's
 * behaviour and the convention used everywhere else in this app: exact zero
 * means "not tracked".
 *
 * @param {{x:number,y:number,z:number}[]|null} landmarks
 * @param {Float32Array} [out] optional buffer to fill, to avoid allocating
 */
export function extractHandFeature(landmarks, out) {
  const v = out || new Float32Array(HAND_FEATURE_DIM);
  v.fill(0);
  if (!landmarks || landmarks.length < 21) return v;

  const w = landmarks[WRIST];
  const wx = w.x || 0;
  const wy = w.y || 0;
  const wz = w.z || 0;

  // Pass 1: wrist-relative offsets, tracking the largest radius as we go.
  let maxDist = 0;
  for (let i = 0; i < 21; i++) {
    const lm = landmarks[i];
    const dx = (lm.x || 0) - wx;
    const dy = (lm.y || 0) - wy;
    const dz = (lm.z || 0) - wz;
    const o = i * 3;
    v[o] = dx;
    v[o + 1] = dy;
    v[o + 2] = dz;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d > maxDist) maxDist = d;
  }

  // Pass 2: scale to unit max radius, so the vector is distance-invariant.
  if (maxDist > 1e-6) {
    for (let i = 0; i < HAND_FEATURE_DIM; i++) v[i] /= maxDist;
  }
  return v;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

function radius(v, i) {
  const o = i * 3;
  return Math.hypot(v[o], v[o + 1], v[o + 2]);
}

function dist(v, a, b) {
  const oa = a * 3;
  const ob = b * 3;
  return Math.hypot(v[oa] - v[ob], v[oa + 1] - v[ob + 1], v[oa + 2] - v[ob + 2]);
}

/**
 * Describe a hand: which fingers are extended, how confidently, and a few
 * shape scalars the templates need.
 *
 * Extension is decided by comparing tip radius to PIP radius from the wrist.
 * That is rotation-invariant, which matters because a signer's hand is rarely
 * upright and a y-axis test would misread every tilted hand.
 */
export function describeHand(v) {
  const extended = {};
  const margin = {};

  for (const name of FINGER_ORDER) {
    const { pip, tip } = FINGERS[name];
    const rTip = radius(v, tip);
    const rPip = radius(v, pip);
    // Normalised difference: >0 means the tip reaches past the knuckle.
    const m = (rTip - rPip) / Math.max(rPip, 1e-6);
    // The thumb folds sideways rather than curling, so it needs a lower bar.
    const threshold = name === 'thumb' ? 0.02 : 0.12;
    extended[name] = m > threshold;
    margin[name] = m;
  }

  const count = FINGER_ORDER.filter((f) => extended[f]).length;
  const fingerCount = FINGER_ORDER.filter((f) => f !== 'thumb' && extended[f]).length;

  // Spread between index and pinky tips separates a flat palm from a fist.
  const spread = dist(v, FINGERS.index.tip, FINGERS.pinky.tip);
  // Thumb tip to index tip: small means an O / pinched shape.
  const pinch = dist(v, FINGERS.thumb.tip, FINGERS.index.tip);
  // How far the thumb sits from the pinky knuckle: separates thumb-out poses.
  const thumbOut = dist(v, FINGERS.thumb.tip, FINGERS.pinky.mcp);

  return { extended, margin, count, fingerCount, spread, pinch, thumbOut };
}

// ── Templates ────────────────────────────────────────────────────────────────

/**
 * Each template scores a described hand in 0..1.
 *
 * `pattern` is the expected [thumb, index, middle, ring, pinky] extension.
 * `refine` adds continuous evidence so two gestures with the same finger
 * pattern can still separate.
 */
const TEMPLATES = [
  {
    label: 'STOP', pattern: [1, 1, 1, 1, 1],
    refine: (d) => (d.spread > 0.6 ? 1 : d.spread / 0.6),
    note: 'open palm',
  },
  {
    label: 'HELLO', pattern: [1, 1, 1, 1, 1],
    refine: (d) => (d.spread > 0.6 ? 1 : d.spread / 0.6),
    note: 'open palm, raised',
    // Same handshape as STOP; separated by hand height, see disambiguate().
    needsPose: true,
  },
  {
    label: 'PEACE', pattern: [0, 1, 1, 0, 0],
    refine: (d) => (dist ? 1 : 1),
    note: 'index and middle extended',
  },
  {
    label: 'NAME', pattern: [0, 1, 1, 0, 0],
    refine: () => 1,
    note: 'two hands, index and middle',
    needsTwoHands: true,
  },
  {
    label: 'GOOD', pattern: [1, 0, 0, 0, 0],
    refine: (d) => (d.thumbOut > 0.55 ? 1 : d.thumbOut / 0.55),
    note: 'thumbs up',
  },
  {
    label: 'I', pattern: [0, 0, 0, 0, 1],
    refine: () => 1,
    note: 'pinky extended',
  },
  // Alphabet poses that are genuinely separable from a single static frame.
  { label: 'A', pattern: [0, 0, 0, 0, 0], refine: (d) => (d.pinch > 0.35 ? 1 : 0.6), note: 'fist, thumb alongside' },
  { label: 'B', pattern: [0, 1, 1, 1, 1], refine: (d) => (d.spread < 0.55 ? 1 : 0.7), note: 'flat hand, thumb tucked' },
  { label: 'L', pattern: [1, 1, 0, 0, 0], refine: () => 1, note: 'thumb and index' },
  { label: 'V', pattern: [0, 1, 1, 0, 0], refine: (d) => (d.spread > 0.35 ? 1 : 0.6), note: 'index and middle spread' },
  { label: 'Y', pattern: [1, 0, 0, 0, 1], refine: () => 1, note: 'thumb and pinky' },
  { label: 'O', pattern: [0, 0, 0, 0, 0], refine: (d) => (d.pinch < 0.25 ? 1 : 0.2), note: 'fingertips meet thumb' },
];

function patternScore(d, pattern) {
  let matched = 0;
  for (let i = 0; i < FINGER_ORDER.length; i++) {
    const want = Boolean(pattern[i]);
    const got = d.extended[FINGER_ORDER[i]];
    if (want === got) matched += 1;
  }
  return matched / FINGER_ORDER.length;
}

// ── Classification ───────────────────────────────────────────────────────────

/**
 * Classify one frame.
 *
 * @param {{landmarks:Array, handedness:string}[]} hands  MediaPipe hand results
 * @param {Array|null} pose  33 pose landmarks, used only to separate gestures
 *   that share a handshape (HELLO vs STOP). Optional.
 * @returns {{label,confidence,engine,alternatives,latencyMs,note}|null}
 */
export function classifySignBridgeFrame(hands, pose = null) {
  const started = performance.now();
  if (!hands || hands.length === 0) return null;

  const scored = [];
  const handCount = hands.length;

  // Score against the dominant (first tracked) hand.
  const feature = extractHandFeature(hands[0].landmarks);
  const d = describeHand(feature);

  for (const t of TEMPLATES) {
    if (t.needsTwoHands && handCount < 2) continue;
    const base = patternScore(d, t.pattern);
    if (base < 0.6) continue;                 // too far off to be worth ranking
    const score = base * 0.75 + t.refine(d) * 0.25;
    scored.push({ label: t.label, score, note: t.note, needsPose: t.needsPose });
  }

  if (scored.length === 0) {
    return {
      label: null, confidence: 0, engine: 'signbridge',
      alternatives: [], latencyMs: performance.now() - started,
      note: 'no matching static pose',
    };
  }

  scored.sort((a, b) => b.score - a.score);
  const resolved = disambiguate(scored, { handCount, pose, hands });

  // Confidence from the MARGIN between the top two candidates, not from the
  // raw score. Two templates that both fit at 0.9 mean the frame is ambiguous,
  // and reporting 0.9 for either would be a lie.
  const best = resolved[0];
  const second = resolved[1];
  const margin = second ? best.score - second.score : best.score;
  const confidence = Math.max(0, Math.min(1, best.score * (0.55 + 0.45 * Math.min(margin / 0.25, 1))));

  return {
    label: best.label,
    confidence,
    engine: 'signbridge',
    alternatives: resolved.slice(1, 3).map((s) => ({
      label: s.label, confidence: Math.min(1, s.score),
    })),
    latencyMs: performance.now() - started,
    note: best.note,
    ambiguous: Boolean(second && margin < 0.08),
  };
}

/**
 * Break ties between templates that share a handshape.
 *
 *   HELLO vs STOP  an open palm is identical in both; a raised hand (above the
 *                  shoulder line) reads as a greeting, at chest height as stop.
 *   NAME vs PEACE  the same two-finger shape; NAME is two-handed in ISL.
 *
 * Without pose or a second hand, both stay in the list and the margin collapses,
 * which is what marks the result ambiguous.
 */
function disambiguate(scored, { handCount, pose, hands }) {
  const out = scored.map((s) => ({ ...s }));

  const openPalm = out.filter((s) => s.label === 'HELLO' || s.label === 'STOP');
  if (openPalm.length === 2 && pose && pose.length > 12 && hands?.[0]?.landmarks) {
    const shoulderY = ((pose[11]?.y ?? 0) + (pose[12]?.y ?? 0)) / 2;
    const handY = hands[0].landmarks[WRIST]?.y ?? 1;
    // Image space: y grows downward, so a smaller y is higher in frame.
    const raised = handY < shoulderY;
    for (const s of out) {
      if (s.label === 'HELLO') s.score *= raised ? 1.15 : 0.55;
      if (s.label === 'STOP') s.score *= raised ? 0.6 : 1.15;
    }
  }

  for (const s of out) {
    if (s.label === 'NAME') s.score *= handCount >= 2 ? 1.2 : 0.4;
    if (s.label === 'PEACE') s.score *= handCount >= 2 ? 0.75 : 1.1;
  }

  out.sort((a, b) => b.score - a.score);
  return out;
}

/** Labels this engine can produce, for the UI to describe honestly. */
export const SIGNBRIDGE_LABELS = [...new Set(TEMPLATES.map((t) => t.label))];

export default {
  extractHandFeature, describeHand, classifySignBridgeFrame,
  SIGNBRIDGE_LABELS, HAND_FEATURE_DIM,
};
