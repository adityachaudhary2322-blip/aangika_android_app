/**
 * Dictionary health: which ISL Studio signs the spotter will struggle with,
 * found BEFORE they cause wrong sentences.
 *
 * Leave one take out: each recorded take plays the part of someone signing
 * live; it is compared (DTW, islSpotter.dtwCost) with the sign's OTHER takes
 * and with every take of every other sign. If another sign fits better, that
 * take would be read as the other sign.
 *
 * Also: takes that disagree with each other (the sign is signed differently
 * each time), which is what made one sign "win" everything before the
 * threshold band was introduced.
 */

import { toTemplate, calibrate, dtwCost, TAU_MAX } from './islSpotter.js';

const CLOSE = 1.25;           // another sign within 25% of the sign's own fit: at risk
const LOOSE = 0.15;           // takes disagree this much: re-record (above TAU_MAX: worth a look)

const templatesOf = (s) => (s.takes || []).map((t) => toTemplate(t)).filter((t) => t.length);

/**
 * One sign's takes against the others. -> { consistency, misread, close, confusedWith, status, notes }
 *   consistency  0..1-ish per-frame cost between its own takes (lower is better)
 *   misread      how many of its takes fit another sign better
 */
export function checkSign(takes, others) {
  const own = takes.map((t) => (Array.isArray(t[0]) || t[0] instanceof Float32Array ? toTemplate(t) : t)).filter((t) => t.length);
  const rivals = others.map((o) => ({ sign: o, tpls: templatesOf(o) })).filter((o) => o.tpls.length);
  const consistency = own.length > 1 ? calibrate(own) : 0;
  let misread = 0; let close = 0;
  const hits = new Map();
  own.forEach((live, i) => {
    const mine = own.length > 1 ? Math.min(...own.filter((_, j) => j !== i).map((t) => dtwCost(t, live))) : 0;
    let best = null;
    for (const r of rivals) {
      const c = Math.min(...r.tpls.map((t) => dtwCost(t, live)));
      if (!best || c < best.cost) best = { sign: r.sign, cost: c };
    }
    if (!best || own.length < 2) return;
    if (best.cost < mine) { misread++; hits.set(best.sign.word, (hits.get(best.sign.word) || 0) + 1); }
    else if (best.cost < mine * CLOSE) { close++; hits.set(best.sign.word, (hits.get(best.sign.word) || 0) + 1); }
  });
  const confusedWith = [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([w]) => w);
  const notes = [];
  if (own.length < 2) notes.push('Only one take: record at least 3.');
  if (consistency > LOOSE) notes.push('Takes disagree: re-record, signing it the same way each time (same start, speed and end).');
  else if (consistency > TAU_MAX) notes.push('Takes differ a little: fine, but a re-record would make it more reliable.');
  if (misread) notes.push(`${misread} of ${own.length} takes look more like “${confusedWith[0]}”: make them more different (hand shape, place or movement).`);
  else if (close) notes.push(`Close to “${confusedWith[0]}”: may be mixed up when signed quickly.`);
  const status = misread || consistency > LOOSE || own.length < 2 ? 'bad' : close || consistency > TAU_MAX ? 'warn' : 'ok';
  return { consistency, misread, close, takes: own.length, confusedWith, status, notes };
}

/**
 * Every sign in the dictionary. Yields to the page between signs.
 * -> [{ id, word, token, ...checkSign }] worst first
 */
export async function checkDictionary(signs, { onProgress } = {}) {
  const out = [];
  for (let k = 0; k < signs.length; k++) {
    const s = signs[k];
    out.push({ id: s.id, word: s.word, token: s.token, ...checkSign(s.takes || [], signs.filter((o) => o.id !== s.id)) });
    onProgress?.(k + 1, signs.length);
    await new Promise((r) => setTimeout(r, 0));
  }
  const rank = { bad: 0, warn: 1, ok: 2 };
  return out.sort((a, b) => rank[a.status] - rank[b.status] || b.consistency - a.consistency);
}

export default { checkSign, checkDictionary };
