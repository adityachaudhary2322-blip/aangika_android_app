import { useCallback, useMemo, useRef, useState } from 'react';
import useLandmarkLoop from './useLandmarkLoop.js';
import cameraManager from '../services/cameraManager.js';
import { frameFeatures, describeFeatures, HAND_DIM } from '../services/isl/islFeatures.js';
import { createSpotter, SAMPLE_MS } from '../services/isl/islSpotter.js';
import { translateStudio } from '../services/isl/islTranslate.js';
import landmarker from '../services/landmarker.js';

/** "Start with FULL STOP": after this long with no sign, wait for FULL STOP again. */
export const START_IDLE_MS = 10000;

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
 * @param startWithStop  demos: nothing is read until the signer signs FULL STOP;
 *                    each FULL STOP then ends a sentence; START_IDLE_MS without a
 *                    sign and it waits for FULL STOP again
 */
export default function useIslSentence({ signs, active, language, mode, onSentence, autoSend = null, startWithStop = false }) {
  const [sentence, setSentence] = useState([]);           // signs of the current sentence
  const [analysis, setAnalysis] = useState([]);
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState([]);                 // why each sign was chosen (latest first)
  // Live demos: talking to people with the hands moving makes stray signs.
  // Paused, the camera keeps running but nothing is recognised.
  const [paused, setPausedState] = useState(false);
  const pausedRef = useRef(false);
  const [started, setStartedState] = useState(false);     // startWithStop: FULL STOP seen
  const startedRef = useRef(false);
  const setStarted = (v) => { startedRef.current = v; setStartedState(v); };
  const [focusInfo, setFocusInfo] = useState(null);       // people in view (landmarker focus)
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
  /** Take out a stray sign (by position), before the sentence is said. */
  const removeAt = useCallback((i) => { sentenceRef.current = sentenceRef.current.filter((_, k) => k !== i); setSentence(sentenceRef.current); }, []);
  const undo = useCallback(() => { sentenceRef.current = sentenceRef.current.slice(0, -1); setSentence(sentenceRef.current); }, []);

  const onFrame = useCallback((result, ts) => {
    if (ts - lastSample.current < SAMPLE_MS) return;
    lastSample.current = ts;
    const f = frameFeatures({ hands: result.hands, pose: result.pose, mirrored: cameraManager.isFrontCamera() });
    if (ts - lastAnalysis.current > 250) {
      lastAnalysis.current = ts;
      setAnalysis(describeFeatures(f));
      const fi = landmarker.getFocusInfo?.();
      setFocusInfo(fi && (fi.people > 1 || fi.ignoredHands || fi.raising) ? { ...fi } : null);
    }
    if (pausedRef.current) return;                        // paused: watch, recognise nothing
    const hands = f[0] > 0.5 || f[HAND_DIM] > 0.5;
    if (hands) handsGoneAt.current = 0; else if (!handsGoneAt.current) handsGoneAt.current = ts;
    for (const hit of spotter.push(f)) {
      const sign = byId.get(hit.id);
      if (!sign) continue;
      setTrace((t) => [{ at: Date.now() + Math.random(), word: sign.word, cost: hit.cost, next: byId.get(hit.runnerUp)?.word, nextCost: hit.runnerCost }, ...t].slice(0, 8));
      if (startWithStop && !startedRef.current) {
        // Waiting: only FULL STOP counts, and it starts the sentence.
        if (sign.type === 'full-stop') { setStarted(true); lastSignAt.current = ts; }
        continue;
      }
      if (sign.type === 'full-stop') { finish(); lastSignAt.current = ts; continue; }
      sentenceRef.current = [...sentenceRef.current, sign];
      lastSignAt.current = ts;
      setSentence(sentenceRef.current);
    }
    if (startWithStop && startedRef.current && !sentenceRef.current.length && ts - lastSignAt.current >= START_IDLE_MS) {
      setStarted(false);                                  // idle: wait for FULL STOP again
    }
    if (autoSend && shouldAutoSend({ pending: sentenceRef.current.length > 0, handsGoneAt: handsGoneAt.current, lastSignAt: lastSignAt.current, now: ts }, autoSend)) {
      finish();
    }
  }, [spotter, byId, finish, autoSend, startWithStop]);

  const { ready, error } = useLandmarkLoop(active, onFrame);
  const reset = useCallback(() => spotter.reset(), [spotter]);
  const setPaused = useCallback((p) => {
    pausedRef.current = p;
    setPausedState(p);
    spotter.reset();                                      // nothing half-matched carries over
    handsGoneAt.current = 0;
  }, [spotter]);

  return {
    sentence, analysis, busy, trace, ready, error, finish, clear, reset, removeAt, undo, paused, setPaused,
    waitingForStart: startWithStop && !started, focusInfo,
    hasStop: signs.some((s) => s.type === 'full-stop'),
  };
}
