/**
 * Practice log: how reliably the ACTIVE model recognises each sign when this
 * user signs it. Every number comes from a real attempt (target sign, what
 * the model actually reported, its confidence) -- nothing is estimated.
 *
 * Stored per model id in localStorage: {modelId: {TOKEN: {n, ok, conf}}}.
 */

const KEY = 'aangika.practice.v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function save(all) {
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ }
}

/** Record one attempt. `recognised` = tokens the model reported in the window. */
export function recordAttempt(modelId, target, { recognised = [], confidence = 0 } = {}) {
  const all = load();
  const m = all[modelId] || (all[modelId] = {});
  const r = m[target] || (m[target] = { n: 0, ok: 0, conf: 0, last: [] });
  const ok = recognised.includes(target);
  r.n += 1;
  r.ok += ok ? 1 : 0;
  r.conf += ok ? confidence : 0;
  r.last = [...(r.last || []), { ok, got: recognised.slice(0, 3), at: Date.now() }].slice(-5);
  save(all);
  return { ok, stats: r };
}

/** [{token, n, ok, rate, meanConf}] for a model, most reliable first. */
export function reliability(modelId) {
  const m = load()[modelId] || {};
  return Object.entries(m)
    .map(([token, r]) => ({
      token, n: r.n, ok: r.ok, rate: r.n ? r.ok / r.n : 0, meanConf: r.ok ? r.conf / r.ok : 0, last: r.last || [],
    }))
    .sort((a, b) => b.rate - a.rate || b.n - a.n);
}

/** Signs measured often enough and recognised often enough to demo. */
/** At least two of every three attempts recognised. */
export const RELIABLE_RATE = 2 / 3;
export const RELIABLE_MIN_ATTEMPTS = 3;
export const isReliable = (r) => r.n >= RELIABLE_MIN_ATTEMPTS && r.rate >= RELIABLE_RATE - 1e-9;

export function reliableSigns(modelId) {
  return reliability(modelId).filter(isReliable).map((r) => r.token);
}

export function resetPractice(modelId) {
  const all = load();
  delete all[modelId];
  save(all);
}

/**
 * Example sentences built ONLY from reliable signs, as gloss in signing
 * order. Each template names the roles it needs; a template is used only if
 * every role can be filled from `signs`.
 */
const ROLES = {
  greeting: ['HELLO', 'THANK_YOU', 'PLEASE', 'BYE', 'YES', 'NO'],
  pronoun: ['I', 'YOU', 'HE_SHE_IT', 'WE', 'MY'],
  person: ['MOM', 'DAD', 'GRANDMA', 'GRANDPA', 'BROTHER', 'SISTER', 'AUNT', 'UNCLE', 'BOY', 'GIRL', 'MOTHER', 'FATHER'],
  state: ['HUNGRY', 'THIRSTY', 'SICK', 'HAPPY', 'SAD', 'SLEEPY', 'MAD', 'FINE', 'HOT'],
  time: ['TOMORROW', 'YESTERDAY', 'NOW', 'LATER', 'MORNING', 'NIGHT'],
  place: ['HOME', 'STORE', 'SCHOOL', 'BED', 'OUTSIDE', 'FARM', 'POOL'],
  thing: ['WATER', 'MILK', 'FOOD', 'PIZZA', 'APPLE', 'BOOK', 'CEREAL', 'ICE_CREAM'],
  move: ['GO', 'COME'],
  want: ['LIKE', 'DRINK', 'HAVE', 'WANT', 'FIND', 'SEE'],
  wh: ['WHERE', 'WHO', 'WHY'],
};
const TEMPLATES = [
  ['greeting'],
  ['pronoun', 'state'],
  ['person', 'state'],
  ['time', 'place', 'move'],
  ['person', 'wh'],
  ['thing', 'want'],
  ['thing', 'want', 'NOT'],
  ['greeting', 'pronoun', 'state'],
  ['time', 'person', 'place', 'move'],
];

export function practiceSentences(signs, limit = 6) {
  const have = new Set(signs);
  const out = [];
  for (const tpl of TEMPLATES) {
    const pick = [];
    for (const role of tpl) {
      const options = ROLES[role] ? ROLES[role].filter((t) => have.has(t)) : (have.has(role) ? [role] : []);
      const choice = options.find((t) => !pick.includes(t));
      if (!choice) { pick.length = 0; break; }
      pick.push(choice);
    }
    if (pick.length === tpl.length) out.push(pick);
    if (out.length >= limit) break;
  }
  return out;
}

export default { recordAttempt, reliability, reliableSigns, resetPractice, practiceSentences };
