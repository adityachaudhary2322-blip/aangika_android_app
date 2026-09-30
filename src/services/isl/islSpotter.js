/**
 * Continuous sign spotting for ISL Studio.
 *
 * Signs are recorded as short sequences of islFeatures frames (a few takes
 * each). While someone signs a whole sentence without stopping, every take is
 * matched against the live stream with SPRING (Sakurai et al., ICDE 2007):
 * streaming subsequence DTW that finds where, in an endless stream, a stretch
 * best matches a template, speed differences allowed, in O(template length)
 * per frame. Candidates that overlap are arbitrated (the clearest match
 * against its own sign's threshold wins) and each winner is emitted once, in
 * order: that is the sentence.
 *
 * Guards against false matches: a minimum match duration, a penalty for
 * stretching/compressing time, hands present in most of the matched stretch,
 * and a per-sign threshold learned from how much its own takes differ.
 */

import { FEATURE_DIM, HAND_DIM, GROUPS, mirrorFeatures } from './islFeatures.js';

// Shown in ISL Studio, so the team can tell which recogniser a device runs.
export const SPOTTER_VERSION = 2;
export const TEMPLATE_LEN = 16;        // typical take length (takes keep their natural length)
export const SAMPLE_MS = 66;           // ~15 frames per second into the spotter
// Per non-diagonal DTW step. Kept well below a typical frame difference so
// a slowly or quickly signed sign still matches in full (0.04 made every
// match exactly template-length and split slow signs into duplicates).
const STEP_PENALTY = 0.015;
const HOLD_W = 0.3;                    // weight of a live frame spent holding one template frame
const LOOKAHEAD = 4;                   // frames to wait for a better overlapping match
const DEFAULT_TAU = 0.12;              // per-frame threshold for single-take signs
const MIN_PRESENCE = 0.6;
// Every sign's threshold is kept inside this band. Takes recorded one after
// another agree more than live signing does, so a very tight threshold missed
// real signs (FULL STOP never ended the sentence); a very loose one let that
// sign match everything.
export const TAU_MIN = 0.075;
export const TAU_MAX = 0.12;
export const clampTau = (tau) => Math.max(TAU_MIN, Math.min(TAU_MAX, tau));
const GAP_FLUSH = 3;                   // hands out of view this many frames: signing paused, decide now
const STILL_MAX = 0.03;                // frame change below this: hands held still

// ── Weighted frame distance ─────────────────────────────────────────────────
const W = new Float32Array(FEATURE_DIM);
for (const off of [0, HAND_DIM]) {
  for (const g of GROUPS) for (let i = g.from; i < g.to; i++) W[off + i] = g.weight;
}
for (let i = 2 * HAND_DIM; i < FEATURE_DIM; i++) W[i] = 0.8;
const W_SUM = W.reduce((a, b) => a + b, 0);

/** Weighted mean absolute difference, about 0 (same) .. 1 (opposite). */
export function frameDistance(a, b) {
  let s = 0;
  for (let i = 0; i < FEATURE_DIM; i++) s += W[i] * Math.abs(a[i] - b[i]);
  return s / W_SUM;
}

const handsIn = (f) => f[0] > 0.5 || f[HAND_DIM] > 0.5;

/**
 * Trim frames without hands at both ends; keep the take's NATURAL length
 * (resampled only outside MIN..MAX frames). Squashing every take to one fixed
 * length made long signs spill over their template and be spotted twice.
 */
export function toTemplate(frames, { min = 6, max = 40 } = {}) {
  let a = 0;
  let b = frames.length - 1;
  while (a < b && !handsIn(frames[a])) a++;
  while (b > a && !handsIn(frames[b])) b--;
  const active = frames.slice(a, b + 1);
  if (!active.length || !handsIn(active[0])) return [];
  const len = Math.max(min, Math.min(max, active.length));
  if (len === active.length) return active;
  return Array.from({ length: len }, (_, i) => active[Math.min(active.length - 1, Math.round((i * (active.length - 1)) / (len - 1)))]);
}

/** Full DTW cost per template frame between a template and a whole sequence. */
export function dtwCost(template, seq) {
  const m = template.length;
  const n = seq.length;
  let prev = new Float64Array(m + 1).fill(Infinity);
  prev[0] = 0;
  for (let t = 0; t < n; t++) {
    const cur = new Float64Array(m + 1).fill(Infinity);
    for (let i = 1; i <= m; i++) {
      const c = frameDistance(seq[t], template[i - 1]);
      // Same slope constraint as the spotter: advance 0, 1 or 2 template frames per frame.
      // Weighted by how much of the TEMPLATE each step covers (see the spotter).
      cur[i] = Math.min(prev[i - 1] + c, prev[i] + HOLD_W * c + STEP_PENALTY, i >= 2 ? prev[i - 2] + 2 * c + STEP_PENALTY : Infinity);
    }
    prev = cur;
  }
  return prev[m] / m;
}

/**
 * Per-sign threshold from its own takes: how far apart the takes are, with
 * a margin. One take: a default. -> tau (per-frame cost)
 */
export function calibrate(takes) {
  if (takes.length < 2) return DEFAULT_TAU;
  let worst = 0;
  for (let i = 0; i < takes.length; i++) {
    for (let j = 0; j < takes.length; j++) {
      if (i !== j) worst = Math.max(worst, dtwCost(takes[i], takes[j]));
    }
  }
  return Math.min(0.3, Math.max(0.05, worst * 1.5 + 0.02));
}

/**
 * The spotter. `signs`: [{ id, token, takes: [frames[]], eitherHand }].
 * Feed frames with push(features); it returns the signs completed by then.
 */
export function createSpotter(signs, { minLen = 5 } = {}) {
  const templates = [];
  for (const s of signs) {
    // One bad recording skips that sign; it never stops the others.
    try {
      const takes = (s.takes || []).map((t) => toTemplate(t)).filter((t) => t.length);
      if (!takes.length) continue;
      const tau = clampTau(s.tau || calibrate(takes));
      const built = takes.flatMap((t) => [
        state(s, t, tau, false),
        ...(s.eitherHand ? [state(s, t.map(mirrorFeatures), tau, true)] : []),
      ]);
      templates.push(...built);
    } catch (err) {
      console.warn(`[isl] sign ${s.token || s.id} skipped:`, err);
    }
  }

  function state(sign, frames, tau, mirrored) {
    const m = frames.length;
    const d = new Float64Array(m + 1).fill(Infinity);
    d[0] = 0;                          // a match may start at any frame
    return {
      sign, frames, tau, mirrored, m, d,
      s: new Int32Array(m + 1),
      dmin: Infinity, ts: 0, te: 0,
    };
  }

  let t = 0;
  const presence = [];                  // per stream frame: hands present
  let pending = [];                     // candidates waiting for LOOKAHEAD
  let blockedUntil = -1;                // frames <= this are already used
  let lastEmitted = null;
  const RING = 512;
  const recent = new Array(RING);       // last frames, for "was there movement?"
  // Hands held still (and in view) between two frames: no new sign started.
  const stillBetween = (a, b) => {
    if (b - a >= RING || !recent[a % RING]) return false;
    for (let k = a + 1; k <= b; k++) if (!presence[k] || frameDistance(recent[k % RING], recent[a % RING]) > STILL_MAX) return false;
    return true;
  };

  function report(tp) {
    const len = tp.te - tp.ts + 1;
    // At least ~45% of the take's own length (signed at most about twice as
    // fast), at most three times as long.
    if (len < Math.max(minLen, Math.round(tp.m * 0.45)) || len > 3 * tp.m || tp.ts <= blockedUntil) return;
    let present = 0;
    for (let k = tp.ts; k <= tp.te; k++) present += presence[k] ? 1 : 0;
    if (present / len < MIN_PRESENCE) return;
    const cost = tp.dmin / tp.m;
    // Ranked by how well it matched, NOT by cost / own threshold: that ratio
    // made the sign with the loosest threshold win against every other sign.
    pending.push({ sign: tp.sign, cost, score: cost / TAU_MAX, ts: tp.ts, te: tp.te, mirrored: tp.mirrored, tp });
  }


  let gap = 0;
  function push(f) {
    t += 1;
    presence[t] = handsIn(f);
    recent[t % RING] = f;
    gap = presence[t] ? 0 : gap + 1;
    for (const tp of templates) {
      const { m, frames } = tp;
      const d = new Float64Array(m + 1);
      const s = new Int32Array(m + 1);
      d[0] = 0; s[0] = t;
      for (let i = 1; i <= m; i++) {
        const c = frameDistance(f, frames[i - 1]);
        // Slope-constrained steps, one live frame each: the template advances
        // by 1 (diagonal), 0 (signed slower: frame held) or 2 (signed up to
        // twice as fast). No step advances the template WITHOUT a live frame:
        // otherwise, when frames match cheaply, the best "match" squeezes the
        // whole sign into a couple of frames and is then rejected as too short.
        // Each step is weighted by how much of the TEMPLATE it covers (1, 0
        // or 2 frames), so the total measures how well the whole sign
        // matched at any speed; unweighted, the shortest allowed match always
        // won, whatever the real sign length.
        let best = tp.d[i - 1] + c; let bs = tp.s[i - 1];
        if (tp.d[i] + HOLD_W * c + STEP_PENALTY < best) { best = tp.d[i] + HOLD_W * c + STEP_PENALTY; bs = tp.s[i]; }
        if (i >= 2 && tp.d[i - 2] + 2 * c + STEP_PENALTY < best) { best = tp.d[i - 2] + 2 * c + STEP_PENALTY; bs = tp.s[i - 2]; }
        d[i] = best; s[i] = bs;
      }
      // SPRING: report the best match once no overlapping path can beat it.
      const eps = tp.tau * m;
      if (tp.dmin <= eps) {
        let done = true;
        // Compared per template frame: a partial path's TOTAL is almost
        // always below a full match's, so comparing totals kept every sign
        // waiting (about a whole sign late, and the last sign never came).
        for (let i = 1; i <= m; i++) if (d[i] / i < tp.dmin / m && s[i] <= tp.te) { done = false; break; }
        if (done) {
          report(tp);
          tp.dmin = Infinity;
          for (let i = 1; i <= m; i++) if (s[i] <= tp.te) d[i] = Infinity;
        }
      }
      if (d[m] <= eps && d[m] < tp.dmin) { tp.dmin = d[m]; tp.ts = s[m]; tp.te = t; }
      tp.d = d; tp.s = s;
    }
    if (gap === GAP_FLUSH) {                   // hands dropped: finish what was signed
      for (const tp of templates) if (tp.dmin < Infinity) { report(tp); tp.dmin = Infinity; }
      const out = arbitrate(true);
      for (const tp of templates) { tp.d.fill(Infinity); tp.d[0] = 0; }
      return out;
    }
    return arbitrate(false);
  }

  /** Emit candidates old enough that no better overlapping one can come. */
  function arbitrate(flush) {
    const out = [];
    pending.sort((a, b) => a.te - b.te);
    for (;;) {
      const ready = pending.filter((c) => flush || c.te <= t - LOOKAHEAD);
      if (!ready.length) break;
      const first = ready[0];
      // Everything overlapping the first ready candidate competes with it.
      // Wait while ANY template still has a viable match in progress that
      // overlaps this candidate (its cost so far within its threshold): a
      // longer, better sign may not have finished yet.
      if (!flush && templates.some((tp) => {
        if (tp.dmin < Infinity && tp.ts <= first.te) return true;          // found, not yet reported
        for (let i = 1; i <= tp.m; i++) {
          // Viable: on track so far (cost per frame covered within threshold).
          if (tp.d[i] <= tp.tau * i && tp.s[i] <= first.te && tp.s[i] > blockedUntil) return true;
        }
        return false;
      })) break;
      const rivals = pending.filter((c) => c.ts <= first.te && c.te >= first.ts);
      // Prefer the candidate that explains MORE of the signing: a short take
      // can always find a cheap little stretch inside a longer, different
      // sign, so a match much shorter than its rivals needs a much better fit.
      const longest = Math.max(...rivals.map((c) => c.te - c.ts + 1));
      const rank = (c) => c.score * (longest / (c.te - c.ts + 1));
      const win = rivals.reduce((a, b) => (rank(b) < rank(a) ? b : a));
      if (!flush && win.te > t - LOOKAHEAD) break;         // winner still settling
      // The same sign again with no gap, or with only still hands in
      // between, is the tail of the first, not a repeat: a real repeat has a
      // movement in between.
      const prev = lastEmitted;
      if (!(prev && prev.id === win.sign.id && (win.ts - prev.te <= 1 || stillBetween(prev.te, win.ts)))) {
        // Runner-up (a different sign): shown in ISL Studio to explain mix-ups.
        const next = rivals.filter((c) => c.sign.id !== win.sign.id).sort((a, b) => a.cost - b.cost)[0];
        out.push({
          id: win.sign.id, token: win.sign.token, confidence: Math.max(0, Math.min(1, 1 - win.score / 2)), ts: win.ts, te: win.te, cost: win.cost,
          ...(next ? { runnerUp: next.sign.id, runnerCost: next.cost } : {}),
        });
        lastEmitted = { id: win.sign.id, te: win.te };
      } else {
        lastEmitted.te = win.te;
      }
      blockedUntil = Math.max(blockedUntil, win.te);
      pending = pending.filter((c) => c.ts > win.te);
      // Forget partial matches that started inside the used stretch.
      for (const tp of templates) {
        for (let i = 1; i <= tp.m; i++) if (tp.s[i] <= win.te) tp.d[i] = Infinity;
        if (tp.ts <= win.te) tp.dmin = Infinity;
      }
    }
    return out;
  }

  return {
    push,
    /** End of stream: emit whatever is pending. */
    flush: () => {
      // Let each template report its current best before flushing.
      for (const tp of templates) if (tp.dmin < Infinity) { report(tp); tp.dmin = Infinity; }
      return arbitrate(true);
    },
    reset() {
      t = 0; presence.length = 0; pending = []; blockedUntil = -1; lastEmitted = null;
      for (const tp of templates) { tp.d.fill(Infinity); tp.d[0] = 0; tp.dmin = Infinity; }
    },
    size: () => templates.length,
  };
}

export default { createSpotter, calibrate, toTemplate, dtwCost, frameDistance, TEMPLATE_LEN, SAMPLE_MS };
