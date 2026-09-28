import { useCallback, useEffect, useRef, useState } from 'react';

/** How many tokens the stream keeps. */
const MAX = 24;
/** A token gone for less than this and then back is flicker, not a repeat. */
const GAP_MS = 1500;

/**
 * Turns the recogniser's per-window word sets into one running sequence.
 *
 * The pipeline reports "what is visible now" several times a second, and the
 * Aangika windows overlap, so the same sign shows up in several results in a
 * row. A token is appended when it APPEARS, not while it stays visible, and a
 * token that vanished for less than GAP_MS is treated as flicker: holding a
 * sign counts once, signing it again after a pause counts twice.
 *
 * Returns [{ token, at }], oldest first.
 */
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
      const inTail = next.slice(-2).some((e) => e.token === token);
      if (inTail && goneAt && now - goneAt < GAP_MS) continue;   // flicker
      next = [...next, { token, at: now }].slice(-MAX);
      changed = true;
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
