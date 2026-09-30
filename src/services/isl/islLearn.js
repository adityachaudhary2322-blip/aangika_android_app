/**
 * Learn: how close a learner's attempt is to the team's recording of a sign
 * (ISL Studio's "standard version"), and what to change.
 *
 * Every number is measured, nothing is guessed:
 *   - the match is the same DTW cost the live translator uses (islSpotter),
 *     scored against how much the team's OWN takes differ from each other;
 *   - "would the translator read it?" runs the same decision: within the
 *     sign's threshold and no other sign fitting better;
 *   - per-part feedback compares feature groups (islFeatures GROUPS) after
 *     lining the two up in time, against the team's own take-to-take spread.
 */

import { toTemplate, calibrate, clampTau, dtwCost, frameDistance, SAMPLE_MS } from './islSpotter.js';
import { HAND_DIM, GROUPS, describeFeatures } from './islFeatures.js';

const handsIn = (f) => f[0] > 0.5 || f[HAND_DIM] > 0.5;
const tplOf = (s) => (s.takes || []).map((t) => toTemplate(t)).filter((t) => t.length);

/** n evenly spaced frames of a sequence (speed differences removed). */
const resample = (seq, n = 20) => Array.from({ length: n }, (_, i) => seq[Math.round((i * (seq.length - 1)) / (n - 1))]);

/** Mean weighted difference of one feature group between two same-length sequences. */
function groupDiff(a, b, g) {
  let s = 0; let n = 0;
  for (let k = 0; k < a.length; k++) {
    for (const off of [0, HAND_DIM]) {
      if (!handsIn(a[k]) && !handsIn(b[k])) continue;
      for (let i = g.from; i < g.to; i++) { s += Math.abs(a[k][off + i] - b[k][off + i]); n++; }
    }
  }
  return n ? s / n : 0;
}

const travel = (seq) => { let m = 0; for (const f of seq) m = Math.max(m, frameDistance(f, seq[0]), frameDistance(f, seq[seq.length - 1])); return m; };
const handsUsed = (seq) => {
  const share = (off) => seq.filter((f) => f[off] > 0.5).length / seq.length;
  return { left: share(0) > 0.4, right: share(HAND_DIM) > 0.4 };
};
// Palm height of the hand in use, body units in 0..1 (bigger = lower).
const PLACE_Y = 36;
const palmY = (seq) => {
  const ys = [];
  for (const f of seq) for (const off of [HAND_DIM, 0]) if (f[off] > 0.5) { ys.push(f[off + PLACE_Y]); break; }
  return ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : null;
};

/** Typical length of the sign's takes, in seconds (for the practice timer). */
export function takeSeconds(sign) {
  const lens = (sign.takes || []).map((t) => t.length).sort((a, b) => a - b);
  const mid = lens.length ? lens[lens.length >> 1] : 30;
  return Math.min(4, Math.max(1.5, Math.round(((mid * SAMPLE_MS) / 1000) * 2) / 2));
}

/**
 * Words for how the sign looks in the team's recording, read from its
 * features: hands used, hand shape and place at the start / middle / end,
 * and how much it moves.
 */
export function describeSign(sign) {
  const t = tplOf(sign)[0];
  if (!t) return [];
  const at = (u) => describeFeatures(t[Math.min(t.length - 1, Math.round(u * (t.length - 1)))]);
  const h = handsUsed(t);
  const lines = [h.left && h.right ? 'Both hands.' : 'One hand.'];
  const start = at(0.15); const mid = at(0.5); const end = at(0.9);
  const say = (label, parts) => { for (const p of parts) lines.push(`${label}: ${p.text}.`); };
  const same = JSON.stringify(start.map((p) => p.text)) === JSON.stringify(end.map((p) => p.text));
  if (same) say('Hold', mid);
  else { say('Start', start); say('End', end); }
  const tr = travel(t);
  lines.push(tr < 0.06 ? 'The hands stay still (a held handshape).' : tr < 0.15 ? 'A small movement.' : 'A clear movement.');
  return lines;
}

/**
 * Score one attempt (frames from the camera) against a sign.
 * -> { score 0..100, recognised, looksLike, cost, parts: [{name, ok, tip}], verdict }
 */
export function scoreAttempt(sign, attempt, allSigns = []) {
  const own = tplOf(sign);
  const live = toTemplate(attempt);
  if (!own.length) return { score: 0, recognised: false, parts: [], verdict: 'This sign has no recording yet.' };
  if (!live.length) return { score: 0, recognised: false, parts: [], verdict: 'No hands were seen: keep your hands and shoulders in view.' };

  const tau = clampTau(sign.tau || calibrate(own));
  const costs = own.map((t) => dtwCost(t, live));
  const cost = Math.min(...costs);
  const best = own[costs.indexOf(cost)];
  // How far apart the team's own takes are: matching that well is 100%.
  let ref = 0; let n = 0;
  for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) { ref += dtwCost(own[i], own[j]); n++; }
  ref = n ? ref / n : tau / 2;
  const zero = Math.max(tau * 1.8, ref * 2);
  let score = Math.round(100 * Math.max(0, Math.min(1, (zero - cost) / (zero - Math.min(ref, zero * 0.5)))));

  let rival = null;
  for (const o of allSigns) {
    if (o.id === sign.id || o.type === 'full-stop' && sign.type !== 'full-stop') continue;
    const c = Math.min(...tplOf(o).map((t) => dtwCost(t, live)), Infinity);
    if (c < cost && (!rival || c < rival.cost)) rival = { word: o.word, cost: c };
  }
  const recognised = cost <= tau && !rival;
  // A high number for an attempt the translator would NOT accept misleads:
  // cap it (another sign fits better: at most 40; just outside the threshold: 69).
  score = rival ? Math.min(score, 40) : recognised ? score : Math.min(score, 69);

  // Per part, after lining both up in time; "ok" = within the team's own spread (+ a margin).
  const A = resample(live); const B = resample(best);
  const spread = (g) => {
    if (own.length < 2) return 0.08;
    let s = 0; let k = 0;
    for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) { s += groupDiff(resample(own[i]), resample(own[j]), g); k++; }
    return s / k;
  };
  const parts = [];
  const hA = handsUsed(live); const hB = handsUsed(best);
  const handsOk = hA.left === hB.left && hA.right === hB.right;
  parts.push({ name: 'Hands', ok: handsOk, tip: handsOk ? '' : (hB.left && hB.right ? 'Use both hands.' : 'Use one hand only.') });
  for (const g of GROUPS.filter((x) => x.name !== 'presence' && x.name !== 'arm posture')) {
    const d = groupDiff(A, B, g);
    const ok = d <= spread(g) * 1.6 + 0.02;
    let tip = '';
    if (!ok && g.name === 'finger shape') tip = `Hand shape: ${describeFeatures(B[10]).map((p) => p.text).join('; ') || 'see the description'}.`;
    if (!ok && g.name === 'orientation') tip = 'Turn your palm the way the description shows.';
    if (!ok && g.name === 'placement') {
      const ya = palmY(live); const yb = palmY(best);
      tip = ya != null && yb != null && Math.abs(ya - yb) > 0.03 ? (ya > yb ? 'Raise your hand higher.' : 'Lower your hand.') : 'Move your hand to where the description says.';
    }
    parts.push({ name: { 'finger shape': 'Hand shape', orientation: 'Palm direction', placement: 'Position' }[g.name] || g.name, ok, tip });
  }
  const ta = travel(live); const tb = travel(best);
  const moveOk = tb < 0.06 ? ta < 0.12 : ta > tb * 0.5 && ta < tb * 2;
  parts.push({ name: 'Movement', ok: moveOk, tip: moveOk ? '' : tb < 0.06 ? 'Hold still: this sign has no movement.' : ta < tb ? 'Make the movement bigger.' : 'Make the movement smaller.' });

  const verdict = recognised
    ? (score >= 80 ? 'Great: the translator reads this as the sign.' : 'Good: the translator reads this as the sign. Polish the parts marked below.')
    : rival ? `The translator would read this as “${rival.word}”.` : 'Not close enough yet for the translator to read it.';
  return { score, recognised, looksLike: rival?.word || null, cost, parts, verdict };
}

// ── Progress on this device ─────────────────────────────────────────────────

const KEY = 'aangika-isl-learn';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };

export function getProgress() { return read(); }

export function recordAttempt(signId, score) {
  const all = read();
  const p = all[signId] || { best: 0, tries: 0 };
  all[signId] = { best: Math.max(p.best, score), tries: p.tries + 1, last: score, at: Date.now() };
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* storage blocked: this session only */ }
  return all[signId];
}

export default { scoreAttempt, describeSign, takeSeconds, getProgress, recordAttempt };
