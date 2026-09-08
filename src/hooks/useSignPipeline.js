import { useCallback, useEffect, useRef, useState } from 'react';
import cameraManager from '../services/cameraManager.js';
import landmarker from '../services/landmarker.js';
import recognizer from '../services/signRecognizer.js';

/** Frames retained. The model was trained at 192; see MODEL_CARD.md. */
const WINDOW = 40;
/** Run inference every N frames -- roughly 1.5x/second at 30 fps. */
const STRIDE = 20;

/**
 * The camera -> landmarks -> ONNX pipeline, as a hook.
 *
 * Landmarks arrive ~30x/second. They are written into refs, never into React
 * state, because 30 renders/second would make the whole view unresponsive and
 * (on the Android build, where the same mistake was made) tore the camera down
 * on every frame. Only inference RESULTS reach state, at ~1.5 Hz.
 */
export default function useSignPipeline({ enabled = true, mirrored = true } = {}) {
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState('');
  const [words, setWords] = useState([]);
  const [closest, setClosest] = useState([]);
  const [stats, setStats] = useState({ fps: 0, latencyMs: 0, handCoverage: 0 });
  const [error, setError] = useState(null);

  const frameRef = useRef(null);      // latest raw frame, for the canvas
  const bufferRef = useRef([]);       // rolling window of normalised frames
  const busyRef = useRef(false);
  const seenRef = useRef(0);
  const handFramesRef = useRef(0);
  const timestampRef = useRef(0);
  const fpsRef = useRef({ start: 0, count: 0 });

  // ── Load models once ─────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        await landmarker.load((m) => !cancelled && setProgress(m));
        await recognizer.load((m) => !cancelled && setProgress(m));
        if (!cancelled) {
          setStatus('ready');
          setProgress('');
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError(err.message);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ── Detection loop ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!enabled || status !== 'ready') return undefined;
    let raf = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);

      const video = cameraManager.getVideoElement();
      if (!video || video.readyState < 2) return;

      // MediaPipe rejects a non-increasing timestamp, and rAF can fire twice
      // inside one millisecond.
      const now = performance.now();
      const ts = Math.max(now, timestampRef.current + 1);
      timestampRef.current = ts;

      const result = landmarker.detect(video, ts);
      if (!result) return;

      const raw = recognizer.packFrame(result.pose, result.hands, mirrored);
      frameRef.current = raw;

      const hasHand = result.hands && result.hands.length > 0;
      seenRef.current += 1;
      if (hasHand) handFramesRef.current += 1;

      const buffer = bufferRef.current;
      buffer.push(recognizer.bodyNormalise(raw));
      if (buffer.length > WINDOW) buffer.shift();

      // FPS over a one-second window; a per-frame estimate jitters unreadably.
      const fps = fpsRef.current;
      if (!fps.start) fps.start = now;
      fps.count += 1;
      if (now - fps.start >= 1000) {
        const measured = fps.count;
        fps.count = 0;
        fps.start = now;
        setStats((s) => ({
          ...s,
          fps: measured,
          handCoverage: seenRef.current
            ? Math.round((handFramesRef.current * 100) / seenRef.current)
            : 0,
        }));
      }

      if (buffer.length < WINDOW) return;
      if (seenRef.current % STRIDE !== 0) return;
      if (busyRef.current) return;   // drop, never queue: a backlog reports
      busyRef.current = true;        // gestures the user finished seconds ago

      recognizer
        .recognize(buffer.slice())
        .then((r) => {
          setWords(r.words);
          setClosest(r.closest);
          setStats((s) => ({ ...s, latencyMs: r.latencyMs }));
          setError(null);
        })
        .catch((err) => setError(err.message))
        .finally(() => { busyRef.current = false; });
    };

    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [enabled, status, mirrored]);

  const clear = useCallback(() => {
    bufferRef.current = [];
    frameRef.current = null;
    seenRef.current = 0;
    handFramesRef.current = 0;
    setWords([]);
    setClosest([]);
    setStats({ fps: 0, latencyMs: 0, handCoverage: 0 });
  }, []);

  return { status, progress, words, closest, stats, error, frameRef, clear };
}
