import { useEffect, useRef, useState } from 'react';
import glove from '../services/glove/glove.js';
import {
  buildGloveIndex, classifyStatic, classifyMotion,
} from '../services/glove/recognizer.js';
import { listSigns, subscribe as subscribeSigns, getVersion } from '../services/customSigns.js';

/** A static glove sign must hold this many frames (~120 ms at 50 Hz). */
const STABLE_FRAMES = 6;
/** Motion signs are checked every N frames (DTW is the costlier match). */
const MOTION_EVERY = 5;

/**
 * Recognised glove signs as a word list shaped like the camera pipeline's
 * ([{word, confidence, engine: 'glove'}]), so it can be fused with it.
 * State only changes when the recognised set changes.
 */
export default function useGloveWords({ enabled = true } = {}) {
  const [words, setWords] = useState([]);
  const [connected, setConnected] = useState(glove.isConnected());
  const indexRef = useRef({ version: -1, index: { statics: [], motions: [] } });
  const candRef = useRef({ token: null, count: 0 });
  const keyRef = useRef('');
  const nRef = useRef(0);
  const motionRef = useRef(null);

  useEffect(() => glove.subscribe((s) => setConnected(s.status === 'connected')), []);

  useEffect(() => {
    const rebuild = () => {
      indexRef.current = { version: getVersion(), index: buildGloveIndex(listSigns()) };
    };
    rebuild();
    return subscribeSigns(rebuild);
  }, []);

  useEffect(() => {
    if (!enabled) { setWords([]); keyRef.current = ''; return undefined; }
    return glove.onFrame((frame) => {
      const { index } = indexRef.current;
      nRef.current += 1;
      if (index.motions.length && nRef.current % MOTION_EVERY === 0) {
        const m = classifyMotion(index, glove.getHistory());
        motionRef.current = m?.token ? { ...m, at: Date.now() } : motionRef.current;
      }
      const s = classifyStatic(index, frame);
      const cand = candRef.current;
      if (s?.token && s.token === cand.token) cand.count += 1;
      else { cand.token = s?.token || null; cand.count = s?.token ? 1 : 0; }

      const out = [];
      if (cand.token && cand.count >= STABLE_FRAMES) {
        out.push({ word: cand.token, index: `glove:${cand.token}`, confidence: s.confidence, engine: 'glove', peakFrame: 0 });
      }
      const m = motionRef.current;
      if (m && Date.now() - m.at < 700 && !out.some((w) => w.word === m.token)) {
        out.push({ word: m.token, index: `glove-motion:${m.token}`, confidence: m.confidence, engine: 'glove', peakFrame: 0 });
      }
      const key = out.map((w) => w.word).join('|');
      if (key !== keyRef.current) {
        keyRef.current = key;
        setWords(out);
      }
    });
  }, [enabled]);

  return { words, connected };
}
