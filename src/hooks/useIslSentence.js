import { useCallback, useMemo, useRef, useState } from 'react';
import useLandmarkLoop from './useLandmarkLoop.js';
import cameraManager from '../services/cameraManager.js';
import { frameFeatures, describeFeatures, HAND_DIM } from '../services/isl/islFeatures.js';
import { createSpotter, SAMPLE_MS } from '../services/isl/islSpotter.js';
import { translateStudio } from '../services/isl/islTranslate.js';

/**
 * When to send a sentence without a FULL STOP (calls): the hands have been
 * out of view for `handsDownMs` (the natural end of a sentence), or no new
 * sign for `idleMs`. A pause with the hands still up does NOT end it: rules
 * need the whole sentence (a split sentence matches none of them).
 */
export function shouldAutoSend({ pending, handsGoneAt, lastSignAt, now }, { handsDownMs = 1500, idleMs = 6000 } = {}) {
  if (!pending) return false;
  if (handsGoneAt && now - handsGoneAt >= handsDownMs) return true;
  return now - lastSignAt >= idleMs;
}

/**
 * ISL Studio's continuous signing, shared by its Translate tab and the video
 * call: signs are spotted as they are made; the FULL STOP sign (or finish())
 * turns the sentence into words and hands them to onSentence.
 *
 * @param signs       the ISL Studio dictionary (useIslSigns)
 * @param active      camera loop running
 * @param onSentence  ({ english, translated, engine, signs }) => void
 * @param autoSend    calls: { handsDownMs, idleMs } (see shouldAutoSend); off when omitted
 */
export default function useIslSentence({ signs, active, language, mode, onSentence, autoSend = null }) {
  const [sentence, setSentence] = useState([]);           // signs of the current sentence
  const [analysis, setAnalysis] = useState([]);
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState([]);                 // why each sign was chosen (latest first)
  const sentenceRef = useRef([]);
  const lastSample = useRef(0);
  const lastAnalysis = useRef(0);
  const lastSignAt = useRef(0);
  const handsGoneAt = useRef(0);
  const cb = useRef(onSentence);
  cb.current = onSentence;

  const byId = useMemo(() => new Map(signs.map((s) => [s.id, s])), [signs]);
  const spotter = useMemo(() => createSpotter(signs.map((s) => ({
    id: s.id, token: s.token, takes: s.takes, tau: s.tau, eitherHand: s.hands === 'either',
  }))), [signs]);

  const finish = useCallback(async () => {
    const words = sentenceRef.current;
    if (!words.length) return;
    sentenceRef.current = [];
    setSentence([]);
    setBusy(true);
    try {
      const r = await translateStudio(words, language, { mode });
      cb.current?.({ ...r, signs: words });
    } finally {
      setBusy(false);
    }
  }, [language, mode]);

  const clear = useCallback(() => { sentenceRef.current = []; setSentence([]); }, []);

  const onFrame = useCallback((result, ts) => {
    if (ts - lastSample.current < SAMPLE_MS) return;
    lastSample.current = ts;
    const f = frameFeatures({ hands: result.hands, pose: result.pose, mirrored: cameraManager.isFrontCamera() });
    if (ts - lastAnalysis.current > 250) { lastAnalysis.current = ts; setAnalysis(describeFeatures(f)); }
    const hands = f[0] > 0.5 || f[HAND_DIM] > 0.5;
    if (hands) handsGoneAt.current = 0; else if (!handsGoneAt.current) handsGoneAt.current = ts;
    for (const hit of spotter.push(f)) {
      const sign = byId.get(hit.id);
      if (!sign) continue;
      setTrace((t) => [{ at: Date.now() + Math.random(), word: sign.word, cost: hit.cost, next: byId.get(hit.runnerUp)?.word, nextCost: hit.runnerCost }, ...t].slice(0, 8));
      if (sign.type === 'full-stop') { finish(); continue; }
      sentenceRef.current = [...sentenceRef.current, sign];
      lastSignAt.current = ts;
      setSentence(sentenceRef.current);
    }
    if (autoSend && shouldAutoSend({ pending: sentenceRef.current.length > 0, handsGoneAt: handsGoneAt.current, lastSignAt: lastSignAt.current, now: ts }, autoSend)) {
      finish();
    }
  }, [spotter, byId, finish, autoSend]);

  const { ready, error } = useLandmarkLoop(active, onFrame);
  const reset = useCallback(() => spotter.reset(), [spotter]);

  return {
    sentence, analysis, busy, trace, ready, error, finish, clear, reset,
    hasStop: signs.some((s) => s.type === 'full-stop'),
  };
}
