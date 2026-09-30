/**
 * Developer overrides for the 20 built-in SignBridge signs, shared with every
 * user through the community dictionary (server: POST /dictionary/override).
 *
 *   { HELLO: { token: 'HI', text_en: 'Hi there!', texts: {'hi-IN': ...} },
 *     BAD:   { disabled: true } }
 *
 *   disabled  the handshape is no longer recognised at all
 *   token     the word the handshape now produces (reassign)
 *   text_en / texts   what a single sign says (the spoken sentence)
 *
 * Kept in localStorage so they apply offline and from the first frame.
 */

const KEY = 'aangika.builtinOverrides';
const listeners = new Set();

let overrides = (() => {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
})();
let byNewToken = index(overrides);

function index(o) {
  const m = new Map();
  for (const [orig, ov] of Object.entries(o)) if (ov?.token) m.set(ov.token, { orig, ...ov });
  return m;
}

export const getOverrides = () => overrides;
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Replace all overrides (from the dictionary). */
export function setOverrides(next) {
  overrides = next && typeof next === 'object' ? next : {};
  byNewToken = index(overrides);
  try { localStorage.setItem(KEY, JSON.stringify(overrides)); } catch { /* private mode */ }
  listeners.forEach((fn) => { try { fn(overrides); } catch { /* listener bug */ } });
}

export const isDisabled = (token) => Boolean(overrides[token]?.disabled);

/** The token a built-in rule's result should carry (reassigned or not). */
export const effectiveToken = (token) => overrides[token]?.token || token;

/**
 * The override speaking for a token reaching the grammar: by its original
 * name, or by the new name it was reassigned to.
 */
export function overrideFor(token) {
  const t = String(token || '').toUpperCase();
  if (overrides[t] && !overrides[t].token) return { orig: t, ...overrides[t] };
  return byNewToken.get(t) || (overrides[t] ? { orig: t, ...overrides[t] } : null);
}

/** Apply to one classifyFrame() rule result. */
export function applyToRule(hit) {
  if (!hit?.token) return hit;
  if (isDisabled(hit.token)) return { ...hit, token: null, confidence: 0, disabledRule: hit.token };
  const t = effectiveToken(hit.token);
  return t === hit.token ? hit : { ...hit, token: t, originalToken: hit.token };
}

export default {
  getOverrides, setOverrides, isDisabled, effectiveToken, overrideFor, applyToRule, subscribe,
};
