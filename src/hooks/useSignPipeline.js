import { useCallback, useEffect, useRef, useState } from 'react';
import cameraManager from '../services/cameraManager.js';
import landmarker from '../services/landmarker.js';
import recognizer from '../services/signRecognizer.js';
import engines from '../services/engines/manager.js';
import { modelIdFor } from '../services/engineState.js';
import { translate } from '../services/translationService.js';
import { speak } from '../services/ttsService.js';

/*
 * The engine comes from the model registry (src/config/models.js) through the
 * engine manager, which frees the previous model on a switch. Each adapter
 * declares how it wants to be fed:
 *
 *   mode 'frame'   classify every frame on its own (SignBridge + My signs);
 *                  holdTarget = consecutive agreeing FRAMES (9 ~ 300 ms)
 *   mode 'window'  a rolling window of `window` normalised frames, inference
 *                  every `stride` frames (Aangika: 40 / 20);
 *                  holdTarget = consecutive agreeing RESULTS (2)
 *
 * Two agreeing window results are the equivalent evidence of nine agreeing
 * frames: a window result only arrives every stride frames (~1.5/second).
 */

/** Do not repeat the same phrase inside this window. */
const PHRASE_COOLDOWN_MS = 2500;

/**
 * The camera -> landmarks -> ONNX pipeline, as a hook.
 *
 * Landmarks arrive ~30x/second. They are written into refs, never into React
 * state, because 30 renders/second would make the whole view unresponsive and
 * (on the Android build, where the same mistake was made) tore the camera down
 * on every frame. Only inference RESULTS reach state, at ~1.5 Hz.
 */
export default function useSignPipeline({
  enabled = true,
  mirrored = true,
  visionEngine = 'aangika',
  /** Speak automatically once a sign is held. No button press required. */
  autoSpeak = false,
  language = 'hi-IN',
  mode = 'offline',
} = {}) {
  const [status, setStatus] = useState('idle');
  const [progress, setProgress] = useState('');
  const [words, setWords] = useState([]);
  const [closest, setClosest] = useState([]);
  const [stats, setStats] = useState({ fps: 0, latencyMs: 0, handCoverage: 0 });
  const [error, setError] = useState(null);
  /** The phrase most recently spoken aloud, for the UI to display. */
  const [spoken, setSpoken] = useState(null);

  const [handsUp, setHandsUp] = useState(false);
  const handsUpRef = useRef(false);
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

  // ── Auto-speech state ─────────────────────────────────────────────────────
  // Which token set is currently being held, and for how many agreeing reads.
  const holdKeyRef = useRef('');
  const holdCountRef = useRef(0);
  // Phrase -> timestamp last spoken, so holding a pose does not stutter.
  const spokenAtRef = useRef(new Map());
  const speakingRef = useRef(false);
  // Latest option values, read inside the rAF loop without restarting it.
  const optionsRef = useRef({ autoSpeak, language, mode });
  optionsRef.current = { autoSpeak, language, mode };

  // ── Load the landmarker and the chosen model ────────────────────────────
  // Switching models goes through the manager, which frees the old one. If
  // the chosen model fails to load, the manager falls back to the default and
  // says so; the pipeline then runs whatever it actually got.
  const modelId = modelIdFor(visionEngine);
  const engineRef = useRef(null);
  const [engineMode, setEngineMode] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setStatus('loading');
        engineRef.current = null;
        setEngineMode(null);
        bufferRef.current = [];
        await landmarker.load((m) => !cancelled && setProgress(m));
        const res = await engines.activate(modelId, {
          onProgress: ({ message, loaded, total }) => {
            if (cancelled) return;
            setProgress(total
              ? `${message || 'Downloading model'} ${Math.round((loaded / total) * 100)}%`
              : message || '');
          },
        });
        if (!cancelled) {
          engineRef.current = res.engine;
          setEngineMode(res.engine.mode);
          setStatus('ready');
          setProgress('');
          setError(res.fellBack ? `Could not load that model (${res.error}); using ${res.modelId}.` : null);
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setError(err.message);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [modelId]);

  /**
   * Called on every classification. Counts agreeing reads and, once a sign has
   * been held long enough, translates and speaks it.
   *
   * Deliberately fire-and-forget: the rAF loop must never await translation or
   * audio, or the camera stalls behind the network.
   */
  const considerSpeaking = useCallback((tokens, holdTarget) => {
    const { autoSpeak: on, language: lang, mode: pipelineMode } = optionsRef.current;
    if (!on) return;

    const key = tokens.join('|');
    if (!key) {
      holdKeyRef.current = '';
      holdCountRef.current = 0;
      return;
    }

    if (key === holdKeyRef.current) {
      holdCountRef.current += 1;
    } else {
      holdKeyRef.current = key;
      holdCountRef.current = 1;
    }

    if (holdCountRef.current !== holdTarget) return;   // fire once, on the edge
    if (speakingRef.current) return;

    const now = Date.now();
    const lastSpoken = spokenAtRef.current.get(key) || 0;
    if (now - lastSpoken < PHRASE_COOLDOWN_MS) return;

    speakingRef.current = true;
    spokenAtRef.current.set(key, now);

    translate(tokens, lang, { mode: pipelineMode })
      .then((result) => {
        const text = result.translated || result.english;
        if (!text) return null;
        setSpoken({ text, english: result.english, tokens, at: now });
        return speak(text, lang);
      })
      .catch((err) => setError(err.message))
      .finally(() => { speakingRef.current = false; });
  }, []);

  // ── Detection loop ───────────────────────────────────────────────────────
  // Only the chosen model is loaded: a frame engine never waits on the 21 MB
  // ONNX graph, and switching frees whatever ran before.
  const pipelineReady = status === 'ready' && Boolean(engineMode);

  useEffect(() => {
    if (!enabled || !pipelineReady) return undefined;
    const engine = engineRef.current;
    if (!engine) return undefined;
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

      const detectStart = performance.now();
      const result = landmarker.detect(video, ts);
      fpsRef.current.detectMs = (fpsRef.current.detectMs || 0) + (performance.now() - detectStart);
      if (!result) return;

      const raw = recognizer.packFrame(result.pose, result.hands, mirrored);
      frameRef.current = raw;

      const hasHand = result.hands && result.hands.length > 0;
      seenRef.current += 1;
      if (hasHand) handFramesRef.current += 1;
      // Hands up / down, pushed to state only when it flips (sentence boundary).
      if (hasHand !== handsUpRef.current) {
        handsUpRef.current = hasHand;
        setHandsUp(hasHand);
      }

      // FPS over a one-second window; a per-frame estimate jitters unreadably.
      const fps = fpsRef.current;
      if (!fps.start) fps.start = now;
      fps.count += 1;
      if (now - fps.start >= 1000) {
        telemetryRef.current.fps = fps.count;
        // Mean landmark-detection time per frame (hands + pose [+ face]).
        telemetryRef.current.detectMs = Math.round((fps.detectMs || 0) / fps.count);
        telemetryRef.current.handCoverage = seenRef.current
          ? Math.round((handFramesRef.current * 100) / seenRef.current)
          : 0;
        fps.count = 0;
        fps.detectMs = 0;
        fps.start = now;
      }

      // One telemetry render per second, whatever the frame rate.
      if (now - lastStatsPushRef.current >= 1000) {
        lastStatsPushRef.current = now;
        setStats({ ...telemetryRef.current });
      }

      // ── Frame engines: classify this frame alone, then stop ──────────
      if (engine.mode === 'frame') {
        // SignBridge: built-in rules and the user's own signs together.
        const hit = engine.classify({ hands: result.hands, pose: result.pose, mirrored });
        // classifyFrame returns `token`, not `label`. Reading the
        // wrong field made every frame look like a miss, which then called
        // setWords([]) with a fresh array 30x/second -- a full re-render per
        // frame that also guaranteed nothing was ever detected.
        const token = hit?.token || null;

        telemetryRef.current.latencyMs = hit
          ? Number(hit.latencyMs.toFixed(3))
          : 0;

        // Stability is counted per FRAME here: SignBridge classifies every one.
        considerSpeaking(token ? [token] : [], engine.holdTarget);

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
              engine: hit.engine === 'custom' ? 'custom' : engine.chipEngine,
              ambiguous: hit.ambiguous,
              motionAssumed: hit.motionAssumed,
            }]);
            setClosest((hit.alternatives || []).map((label) => ({
              word: label, index: label, confidence: 0, engine: engine.chipEngine,
            })));
          } else {
            setWords([]);
            setClosest([]);
          }
        }
        return;
      }

      // ── Window engines: accumulate a temporal window ─────────────────
      const buffer = bufferRef.current;
      // Each model decides its own per-frame input (ISL: 225 normalised
      // features; ASL ISLR: the 543-point Holistic layout).
      buffer.push(engine.frameFromLandmarks
        ? engine.frameFromLandmarks(result, mirrored)
        : recognizer.bodyNormalise(raw));
      if (buffer.length > engine.window) buffer.shift();

      if (buffer.length < engine.window) return;
      if (seenRef.current % engine.stride !== 0) return;
      if (isProcessingRef.current) return;   // drop this frame, never queue
      isProcessingRef.current = true;

      engine
        .recognizeDetailed(buffer.slice())
        .then((r) => {
          setWords(r.words.map((w) => ({ ...w, engine: engine.chipEngine })));
          setClosest(r.closest.map((w) => ({ ...w, engine: engine.chipEngine })));
          // Stability is counted per RESULT here, not per frame -- a window
          // engine only produces one every `stride` frames.
          considerSpeaking(r.words.map((w) => w.word), engine.holdTarget);
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
  }, [enabled, pipelineReady, engineMode, modelId, mirrored, considerSpeaking]);

  const clear = useCallback(() => {
    bufferRef.current = [];
    frameRef.current = null;
    seenRef.current = 0;
    handFramesRef.current = 0;
    lastTokenKeyRef.current = '';
    lastVideoTimeRef.current = -1;
    holdKeyRef.current = '';
    holdCountRef.current = 0;
    spokenAtRef.current.clear();
    setSpoken(null);
    telemetryRef.current = { fps: 0, latencyMs: 0, handCoverage: 0 };
    setWords([]);
    setClosest([]);
    setStats({ fps: 0, latencyMs: 0, handCoverage: 0 });
  }, []);

  return {
    status, progress, words, closest, stats, error, frameRef, clear,
    visionEngine, spoken, handsUp,
  };
}
