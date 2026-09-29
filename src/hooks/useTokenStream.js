import { useCallback, useEffect, useRef, useState } from 'react';

/** How many tokens the stream keeps. */
const MAX = 24;
/** A token gone for less than this and then back is flicker, not a repeat. */
const GAP_MS = 1500;
/** Letters signed within this gap of each other spell one word. */
const LETTER_GAP_MS = 2500;

/** A single letter A-Z: a fingerspelled character (from taught letter signs). */
const isLetter = (t) => /^[A-Z]$/.test(t);

/**
 * Add one recognised token to the stream. Letters join the fingerspelled word
 * being built (FS-ADITYA, the ASL gloss convention the grammar keeps as a
 * name); anything else is its own entry.
 */
function append(next, token, now, goneAt) {
  if (isLetter(token)) {
    const last = next[next.length - 1];
    if (last?.spelled && now - last.at <= LETTER_GAP_MS) {
      const repeat = last.letters.endsWith(token) && goneAt && now - goneAt < GAP_MS;
      if (repeat) return next;                                   // flicker
      const letters = last.letters + token;
      return [...next.slice(0, -1), { token: `FS-${letters}`, letters, spelled: true, at: now }];
    }
    return [...next, { token: `FS-${token}`, letters: token, spelled: true, at: now }].slice(-MAX);
  }
  return [...next, { token, at: now }].slice(-MAX);
}

/**
 * Turns the recogniser's per-window word sets into one running sequence.
 *
 * The pipeline reports "what is visible now" several times a second, and the
 * Aangika windows overlap, so the same sign shows up in several results in a
 * row. A token is appended when it APPEARS, not while it stays visible, and a
 * token that vanished for less than GAP_MS is treated as flicker: holding a
 * sign counts once, signing it again after a pause counts twice.
 *
 * Returns [{ token, at, spelled? }], oldest first. Consecutive single letters
 * become one fingerspelled entry, e.g. A, D, I, T, Y, A -> FS-ADITYA.
 */
/** How a token reads on screen: FS-ADITYA -> "Aditya", THANK_YOU -> "thank you". */
export function tokenLabel(token) {
  const t = String(token || '');
  if (/^FS[-_]/i.test(t)) {
    const w = t.slice(3).toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1);
  }
  return t.replace(/_+/g, ' ').toLowerCase();
}

export { append as appendToken, isLetter, LETTER_GAP_MS };

export default function useTokenStream(words, { enabled = true } = {}) {
  const [stream, setStream] = useState([]);
  const ref = useRef([]);
  const presentRef = useRef(new Set());   // tokens visible in the last report
  const goneAtRef = useRef(new Map());    // token -> when it last disappeared

  useEffect(() => {
    if (!enabled) return;
    const now = Date.now();
    // Set keeps the report's order; Aangika orders by peak frame.
    const current = new Set(
      (words || []).map((w) => String(w.word || '').toUpperCase()).filter(Boolean)
    );
    for (const t of presentRef.current) {
      if (!current.has(t)) goneAtRef.current.set(t, now);
    }
    let next = ref.current;
    let changed = false;
    for (const token of current) {
      if (presentRef.current.has(token)) continue;          // still held
      const goneAt = goneAtRef.current.get(token);
      if (!isLetter(token)) {
        const inTail = next.slice(-2).some((e) => e.token === token);
        if (inTail && goneAt && now - goneAt < GAP_MS) continue;   // flicker
      }
      const before = next;
      next = append(next, token, now, goneAt);
      changed = changed || next !== before;
    }
    presentRef.current = current;
    if (changed) {
      ref.current = next;
      setStream(next);
    }
  }, [words, enabled]);

  const reset = useCallback(() => {
    ref.current = [];
    presentRef.current = new Set();
    goneAtRef.current.clear();
    setStream([]);
  }, []);

  const removeAt = useCallback((i) => {
    ref.current = ref.current.filter((_, j) => j !== i);
    setStream(ref.current);
  }, []);

  return { stream, reset, removeAt };
}
