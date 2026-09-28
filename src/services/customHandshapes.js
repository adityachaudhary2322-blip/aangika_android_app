/**
 * k-NN classifier for the user's own handshape signs.
 *
 * SCORING. A sign's distance to a query frame is the mean of the k (=5)
 * smallest distances between the query and that sign's stored frames.
 *
 * ACCEPTANCE is two tests, both required:
 *   1. radius: the distance is inside the sign's own acceptance radius,
 *      calibrated from its samples (95th percentile of leave-one-CAPTURE-out
 *      distances x MARGIN). Leaving a whole capture out, not one frame, matters:
 *      neighbouring frames of one capture are near-duplicates and would
 *      calibrate an impossibly tight radius.
 *   2. ratio: best / second-best sign distance <= RATIO, so two similar taught
 *      signs never trade places on noise.
 *
 * SPEED. Frames are scored exactly, but signs are visited in order of a lower
 * bound (distance to the sign's centroid minus its spread; triangle inequality
 * on the per-frame distance, hence on their mean). Scoring stops once the
 * bound exceeds the second-best exact score, so most signs are never scanned.
 */

import {
  oneHandFeature, twoHandFeature, handsBySide, unpackSample, dimsFor,
  otherSide, locationBucket, isFullHand,
} from './handshapeFeatures.js';
import { listSigns, getVersion } from './customSigns.js';

export const K = 5;
export const MARGIN = 1.6;
export const RATIO = 0.8;
export const MIN_RADIUS = 0.08;
/** A match this far inside its radius and this clear of the runner-up "wins"
 *  over a built-in rule match outright. */
export const CONFIDENT_FRACTION = 0.8;
export const CONFIDENT_RATIO = 0.65;

// ── Distances ───────────────────────────────────────────────────────────────

function dist(a, aOff, b, bOff, n) {
  let s = 0;
  for (let i = 0; i < n; i++) {
    const d = a[aOff + i] - b[bOff + i];
    s += d * d;
  }
  return Math.sqrt(s);
}

/** Mean of the k smallest values of `row` (length n), k clipped to n. */
function meanKSmallest(dists, k) {
  const kk = Math.min(k, dists.length);
  if (kk === 0) return Infinity;
  // k is tiny: partial selection beats a full sort.
  const best = new Float64Array(kk).fill(Infinity);
  for (let i = 0; i < dists.length; i++) {
    const d = dists[i];
    if (d >= best[kk - 1]) continue;
    let j = kk - 1;
    while (j > 0 && best[j - 1] > d) { best[j] = best[j - 1]; j -= 1; }
    best[j] = d;
  }
  let s = 0;
  for (let i = 0; i < kk; i++) s += best[i];
  return s / kk;
}

// ── Feature extraction from stored samples ──────────────────────────────────

/** Stored sample -> feature vector for its sign, or null if unusable. */
export function sampleFeature(sign, sample) {
  const u = unpackSample(sample);
  if (sign.hands === 'two') {
    if (!u.left || !u.right) return null;
    return twoHandFeature(u.left, u.right, u.pose, false);
  }
  const lm = sign.side === 'left' ? u.left : sign.side === 'right' ? u.right : (u.right || u.left);
  if (!lm) return null;
  return oneHandFeature(lm, sign.side, u.pose, false);
}

// ── Calibration ─────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[i];
}

/**
 * Leave-one-capture-out calibration.
 * -> { radius, median, p95, captures, frames, consistency: 'good'|'fair'|'poor' }
 */
export function calibrate(features, captures, { k = K, margin = MARGIN } = {}) {
  const n = features.length;
  if (n < 2) return { radius: MIN_RADIUS * 2, median: NaN, p95: NaN, captures: 1, frames: n, consistency: 'poor' };
  const dim = features[0].vec.length;
  const distinct = new Set(captures);
  const byCapture = distinct.size >= 2;
  const scores = [];
  for (let i = 0; i < n; i++) {
    const row = [];
    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      if (byCapture && captures[j] === captures[i]) continue;
      const len = features[i].hasLoc && features[j].hasLoc ? dim : dim - 2;
      row.push(dist(features[i].vec, 0, features[j].vec, 0, len));
    }
    scores.push(meanKSmallest(row, k));
  }
  scores.sort((a, b) => a - b);
  const median = percentile(scores, 0.5);
  const p95 = percentile(scores, 0.95);
  const radius = Math.max(MIN_RADIUS, p95 * margin);
  // Captures that disagree by far more than frames within one capture mean the
  // handshape itself changed between takes.
  const consistency = p95 < 0.35 ? 'good' : p95 < 0.6 ? 'fair' : 'poor';
  return { radius, median, p95, captures: distinct.size, frames: n, consistency };
}

// ── Index ───────────────────────────────────────────────────────────────────

/**
 * Build a searchable index from sign records (defaults to the live library).
 * Each entry holds a flat Float32Array of its frames plus centroid/spread for
 * pruning.
 */
export function buildIndex(signs = listSigns()) {
  const entries = [];
  for (const sign of signs) {
    if (sign.kind !== 'handshape' || !sign.samples?.length) continue;
    const feats = [];
    const caps = [];
    for (const s of sign.samples) {
      const f = sampleFeature(sign, s);
      if (f) { feats.push(f); caps.push(s.capture || 0); }
    }
    if (!feats.length) continue;
    const { total, shape } = dimsFor(sign.hands);
    const n = feats.length;
    const data = new Float32Array(n * total);
    const hasLoc = feats.every((f) => f.hasLoc);
    feats.forEach((f, i) => data.set(f.vec, i * total));

    const centroid = new Float32Array(total);
    for (let i = 0; i < n; i++) for (let d = 0; d < total; d++) centroid[d] += data[i * total + d] / n;
    let spreadFull = 0;
    let spreadShape = 0;
    for (let i = 0; i < n; i++) {
      spreadFull = Math.max(spreadFull, dist(data, i * total, centroid, 0, total));
      spreadShape = Math.max(spreadShape, dist(data, i * total, centroid, 0, shape));
    }
    const cal = calibrate(feats, caps);
    entries.push({
      sign, token: sign.token, id: sign.id, hands: sign.hands, side: sign.side,
      eitherHand: Boolean(sign.eitherHand), n, total, shape, hasLoc, data,
      centroid, spreadFull, spreadShape, calibration: cal,
      location: locationBucket(feats[0].loc),
    });
  }
  return { entries, version: getVersion(), builtAt: Date.now() };
}

let liveIndex = null;
/** The index for the current library, rebuilt only when the library changes. */
export function currentIndex() {
  if (!liveIndex || liveIndex.version !== getVersion()) liveIndex = buildIndex();
  return liveIndex;
}

// ── Query ───────────────────────────────────────────────────────────────────

/**
 * Query variants for one frame. A one-handed sign can be matched by either
 * detected hand; an "either hand" sign also by the mirror image of the other
 * side. Returns {one: {left, right, leftMirror, rightMirror}, two, twoMirror}.
 */
export function queryVariants(hands, pose, mirrored) {
  const bySide = handsBySide(hands, mirrored);
  const v = { one: {}, two: null, twoMirror: null };
  for (const side of ['left', 'right']) {
    const lm = bySide[side];
    if (!lm) continue;
    v.one[side] = oneHandFeature(lm, side, pose, false);
    const m = oneHandFeature(lm, side, pose, true);        // reports otherSide(side)
    v.one[`${m.side}Mirror`] = m;
  }
  if (bySide.left && bySide.right) {
    v.two = twoHandFeature(bySide.left, bySide.right, pose, false);
    v.twoMirror = twoHandFeature(bySide.left, bySide.right, pose, true);
  }
  return v;
}

/** The query vectors an index entry may be compared against. */
function candidatesFor(entry, v) {
  if (entry.hands === 'two') {
    return [v.two, entry.eitherHand ? v.twoMirror : null].filter(Boolean);
  }
  const side = entry.side;
  const out = [];
  if (!side) {
    for (const s of ['left', 'right']) if (v.one[s]) out.push(v.one[s]);
  } else {
    if (v.one[side]) out.push(v.one[side]);
    // Mirror of the opposite hand stands in for this side when allowed.
    if (entry.eitherHand && v.one[`${side}Mirror`]) out.push(v.one[`${side}Mirror`]);
  }
  return out;
}

function scoreEntry(entry, q) {
  const len = entry.hasLoc && q.hasLoc ? entry.total : entry.shape;
  const row = new Float64Array(entry.n);
  for (let i = 0; i < entry.n; i++) row[i] = dist(entry.data, i * entry.total, q.vec, 0, len);
  return meanKSmallest(row, K);
}

/**
 * Classify one frame against the user's signs.
 *
 * @returns {null | {token, id, confidence, distance, radius, ratio, accepted,
 *                   confident, second, latencyMs, engine: 'custom'}}
 *   null when no taught sign is comparable with what is visible.
 */
export function classifyCustom(hands, pose, { mirrored = false, index = currentIndex() } = {}) {
  const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (!index.entries.length || !hands?.length || !hands.some((h) => isFullHand(h?.landmarks))) {
    return null;
  }
  const v = queryVariants(hands, pose, mirrored);

  // Lower bounds first, then exact scores in bound order.
  const order = [];
  for (const entry of index.entries) {
    for (const q of candidatesFor(entry, v)) {
      const useLoc = entry.hasLoc && q.hasLoc;
      const len = useLoc ? entry.total : entry.shape;
      const spread = useLoc ? entry.spreadFull : entry.spreadShape;
      const lb = Math.max(0, dist(entry.centroid, 0, q.vec, 0, len) - spread);
      order.push({ entry, q, lb });
    }
  }
  if (!order.length) return null;
  order.sort((a, b) => a.lb - b.lb);

  const bestBySign = new Map();       // id -> {entry, d}
  let first = Infinity;
  let second = Infinity;
  for (const c of order) {
    if (c.lb > second) break;           // cannot enter the top two
    const d = scoreEntry(c.entry, c.q);
    const prev = bestBySign.get(c.entry.id);
    if (prev && prev.d <= d) continue;
    bestBySign.set(c.entry.id, { entry: c.entry, d });
    const top = [...bestBySign.values()].map((x) => x.d).sort((a, b) => a - b);
    first = top[0];
    second = top.length > 1 ? top[1] : Infinity;
  }

  const ranked = [...bestBySign.values()].sort((a, b) => a.d - b.d);
  const best = ranked[0];
  const runner = ranked[1] || null;
  const radius = best.entry.calibration.radius;
  const ratio = runner ? best.d / Math.max(runner.d, 1e-9) : 0;
  const inRadius = best.d <= radius;
  const clear = ratio <= RATIO;
  const accepted = inRadius && clear;
  const confident = accepted && best.d <= radius * CONFIDENT_FRACTION && ratio <= CONFIDENT_RATIO;

  // Confidence from evidence: how far inside the radius, and how clear of the
  // runner-up. Never a constant.
  const closeness = Math.max(0, 1 - best.d / radius);
  const clarity = runner ? Math.max(0, 1 - ratio) : 1;
  const confidence = accepted
    ? Math.max(0.5, Math.min(0.97, 0.55 + 0.3 * closeness + 0.12 * clarity))
    : 0;

  return {
    token: accepted ? best.entry.token : null,
    nearestToken: best.entry.token,
    id: best.entry.id,
    engine: 'custom',
    confidence,
    distance: best.d,
    radius,
    ratio,
    accepted,
    confident,
    second: runner ? { token: runner.entry.token, distance: runner.d } : null,
    alternatives: ranked.slice(1, 3).map((r) => r.entry.token),
    latencyMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - started,
    firstSeen: first,
  };
}

/** How strongly a frame matches ONE sign, 0..1, for the "Try it" meter. */
export function matchMeter(hands, pose, signId, { mirrored = false, index = currentIndex() } = {}) {
  const entry = index.entries.find((e) => e.id === signId);
  if (!entry || !hands?.length) return { level: 0, distance: Infinity, radius: entry?.calibration.radius ?? 0 };
  const v = queryVariants(hands, pose, mirrored);
  let d = Infinity;
  for (const q of candidatesFor(entry, v)) d = Math.min(d, scoreEntry(entry, q));
  const radius = entry.calibration.radius;
  return { level: Number.isFinite(d) ? Math.max(0, Math.min(1, 1 - d / (2 * radius))) : 0, distance: d, radius };
}

export { otherSide };

export default {
  classifyCustom, buildIndex, currentIndex, calibrate, matchMeter,
  sampleFeature, queryVariants, K, MARGIN, RATIO,
};
