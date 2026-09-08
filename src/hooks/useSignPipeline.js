import { useCallback, useEffect, useRef, useState } from 'react';
import cameraManager from '../services/cameraManager.js';
import landmarker from '../services/landmarker.js';
import recognizer from '../services/signRecognizer.js';
import { classifySignBridgeFrame } from '../services/signbridgeEngine.js';
import { VISION_SIGNBRIDGE } from '../services/engineState.js';

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
export default function useSignPipeline({
  enabled = true, mirrored = true, visionEngine = 'aangika',
} = {}) {
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState('');
  const [words, setWords] = useState([]);
  const [closest, setClosest] = useState([]);
  const [stats, setStats] = useState({ fps: 0, latencyMs: 0, handCoverage: 0 });
  const [error, setError] = useState(null);

  const frameRef = useRef(null);      // latest raw frame, for the canvas
  const bufferRef = useRef([]);       // rolling window of normalised frames
  // Mutex: true while an inference is in flight. A frame that arrives during
  // one is DROPPED, never queued -- a queue would report gestures the user
  // finished seconds ago and would grow without bound on a slow phone.
  const isProcessingRef = useRef(false);
  const seenRef = useRef(0);
  const handFramesRef = useRef(0);
  const timestampRef = useRef(0);
  const fpsRef = useRef({ start: 0, count: 0 });

  // rAF runs at display rate (often 60 Hz) while the camera delivers 30 fps,
  // so half of all callbacks would re-run both detectors on a frame already
  // processed. Skipping those is close to a free doubling of throughput.
  const lastVideoTimeRef = useRef(-1);

  // Telemetry is written here every frame and copied into React state at most
  // once a second. Putting FPS in state directly re-rendered the whole screen
  // at camera rate, which cost far more than it measured.
  const telemetryRef = useRef({ fps: 0, latencyMs: 0, handCoverage: 0 });
  const lastStatsPushRef = useRef(0);

  // Last emitted token set, so an unchanged classification does not allocate a
  // new array and force a render.
  const lastTokenKeyRef = useRef('');

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
  // SignBridge classifies a single frame geometrically, so it only needs the
  // landmarker -- not the 21 MB ONNX graph. Gating it on the tagger's load
  // would make an "ultra-low latency" engine wait on the slow one.
  const usingSignBridge = visionEngine === VISION_SIGNBRIDGE;
  const pipelineReady = usingSignBridge
    ? status === 'ready' || status === 'landmarker-ready'
    : status === 'ready';

  useEffect(() => {
    if (!enabled || !pipelineReady) return undefined;
    let raf = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      raf = requestAnimationFrame(tick);

      const video = cameraManager.getVideoElement();
      if (!video || video.readyState < 2) return;

      // Same decoded frame as last time: nothing new to see.
      if (video.currentTime === lastVideoTimeRef.current) return;
      lastVideoTimeRef.current = video.currentTime;

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

      // FPS over a one-second window; a per-frame estimate jitters unreadably.
      const fps = fpsRef.current;
      if (!fps.start) fps.start = now;
      fps.count += 1;
      if (now - fps.start >= 1000) {
        telemetryRef.current.fps = fps.count;
        telemetryRef.current.handCoverage = seenRef.current
          ? Math.round((handFramesRef.current * 100) / seenRef.current)
          : 0;
        fps.count = 0;
        fps.start = now;
      }

      // One telemetry render per second, whatever the frame rate.
      if (now - lastStatsPushRef.current >= 1000) {
        lastStatsPushRef.current = now;
        setStats({ ...telemetryRef.current });
      }

      // ── SignBridge: classify this frame alone, then stop ─────────────
      if (usingSignBridge) {
        const hit = classifySignBridgeFrame(result.hands, result.pose);
        // classifySignBridgeFrame returns `token`, not `label`. Reading the
        // wrong field made every frame look like a miss, which then called
        // setWords([]) with a fresh array 30x/second -- a full re-render per
        // frame that also guaranteed nothing was ever detected.
        const token = hit?.token || null;

        telemetryRef.current.latencyMs = hit
          ? Number(hit.latencyMs.toFixed(3))
          : 0;

        // Only touch React state when the classification actually changes.
        const key = token ? `${token}:${hit.confidence.toFixed(2)}` : '';
        if (key !== lastTokenKeyRef.current) {
          lastTokenKeyRef.current = key;
          if (token) {
            setWords([{
              word: token,
              index: token,
              confidence: hit.confidence,
              peakFrame: 0,
              engine: 'signbridge',
              ambiguous: hit.ambiguous,
              motionAssumed: hit.motionAssumed,
            }]);
            setClosest((hit.alternatives || []).map((label) => ({
              word: label, index: label, confidence: 0, engine: 'signbridge',
            })));
          } else {
            setWords([]);
            setClosest([]);
          }
        }
        return;
      }

      // ── Aangika: accumulate a temporal window ────────────────────────
      const buffer = bufferRef.current;
      buffer.push(recognizer.bodyNormalise(raw));
      if (buffer.length > WINDOW) buffer.shift();

      if (buffer.length < WINDOW) return;
      if (seenRef.current % STRIDE !== 0) return;
      if (isProcessingRef.current) return;   // drop this frame, never queue
      isProcessingRef.current = true;

      recognizer
        .recognize(buffer.slice())
        .then((r) => {
          setWords(r.words.map((w) => ({ ...w, engine: 'aangika' })));
          setClosest(r.closest.map((w) => ({ ...w, engine: 'aangika' })));
          telemetryRef.current.latencyMs = r.latencyMs;
          setError(null);
        })
        .catch((err) => setError(err.message))
        .finally(() => { isProcessingRef.current = false; });
    };

    raf = requestAnimationFrame(tick);
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
    };
  }, [enabled, pipelineReady, mirrored, usingSignBridge]);

  const clear = useCallback(() => {
    bufferRef.current = [];
    frameRef.current = null;
    seenRef.current = 0;
    handFramesRef.current = 0;
    lastTokenKeyRef.current = '';
    lastVideoTimeRef.current = -1;
    telemetryRef.current = { fps: 0, latencyMs: 0, handCoverage: 0 };
    setWords([]);
    setClosest([]);
    setStats({ fps: 0, latencyMs: 0, handCoverage: 0 });
  }, []);

  return {
    status, progress, words, closest, stats, error, frameRef, clear,
    visionEngine,
  };
}
