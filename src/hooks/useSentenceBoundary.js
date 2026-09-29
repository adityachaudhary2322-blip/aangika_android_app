import { useEffect, useRef } from 'react';
import { LETTER_GAP_MS } from './useTokenStream.js';

/** No new sign for this long ends the sentence. */
export const PAUSE_MS = 1200;
/** Hands down for this long ends it sooner (a lowered hand is a clear stop). */
export const HANDS_DOWN_MS = 400;

/**
 * Pure rule: should the signs collected since the last sentence be sent now?
 *
 * @param {{pending:number, lastAt:number, now:number, handsUp:boolean,
 *          handsDownAt:number|null, pauseMs?:number, handsDownMs?:number}} s
 * @returns {boolean} true = send the pending signs now
 */
export function boundaryDue({
  pending, lastAt, now, handsUp, handsDownAt, pauseMs = PAUSE_MS, handsDownMs = HANDS_DOWN_MS,
}) {
  if (!pending) return false;
  if (!handsUp && handsDownAt && handsDownAt >= lastAt && now - handsDownAt >= handsDownMs) return true;
  return now - lastAt >= pauseMs;
}

/**
 * Calls onSentence(tokens) once per sentence: the signs added to `stream`
 * since the previous sentence, when the signer pauses or lowers their hands.
 *
 * @param {Array<{token:string, at:number}>} stream  from useTokenStream
 */
export default function useSentenceBoundary(stream, {
  enabled = true, handsUp = true, onSentence, pauseMs = PAUSE_MS,
} = {}) {
  const sentUpToRef = useRef(0);          // stream index already sent
  const lastSeenAtRef = useRef(0);        // `at` of the newest entry already counted
  const handsDownAtRef = useRef(null);
  const cbRef = useRef(onSentence);
  cbRef.current = onSentence;

  // A reset stream (Clear) starts a fresh sentence.
  useEffect(() => {
    if (stream.length < sentUpToRef.current) sentUpToRef.current = 0;
  }, [stream.length]);

  useEffect(() => {
    if (!handsUp) handsDownAtRef.current = Date.now();
  }, [handsUp]);

  useEffect(() => {
    if (!enabled) return undefined;
    const check = () => {
      const pendingEntries = stream.slice(sentUpToRef.current);
      const last = stream[stream.length - 1];
      // An entry updated in place (a fingerspelled word growing) moves `at`.
      if (last) lastSeenAtRef.current = Math.max(lastSeenAtRef.current, last.at);
      const due = boundaryDue({
        pending: pendingEntries.length,
        lastAt: lastSeenAtRef.current,
        now: Date.now(),
        handsUp,
        handsDownAt: handsDownAtRef.current,
        // Mid-fingerspelling, letters may be further apart than a pause.
        pauseMs: last?.spelled ? Math.max(pauseMs, LETTER_GAP_MS) : pauseMs,
      });
      if (!due) return;
      sentUpToRef.current = stream.length;
      cbRef.current?.(pendingEntries.map((e) => e.token));
    };
    const id = setInterval(check, 150);
    return () => clearInterval(id);
  }, [stream, handsUp, enabled, pauseMs]);
}
