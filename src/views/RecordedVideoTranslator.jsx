import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Upload, Play, Pause, Download, Loader2, FileVideo, AlertTriangle,
} from 'lucide-react';
import LanguageSelect from '../components/LanguageSelect.jsx';
import landmarker from '../services/landmarker.js';
import { classifySignBridgeFrame } from '../services/signbridgeEngine.js';
import { translate } from '../services/translationService.js';
import {
  buildCues, toSrt, toVtt, formatSrtTime, downloadText,
} from '../services/srt.js';

/**
 * Translate a recorded video file.
 *
 * Frame-synchronised rather than time-sampled: requestVideoFrameCallback fires
 * once per DECODED frame with the exact media timestamp, so a cue lands on the
 * frame the sign was actually made on. A setInterval sampler would drift and
 * would double-count or miss frames whenever playback stuttered.
 *
 * SCOPE, honestly: this runs the SignBridge STATIC classifier, one frame at a
 * time. It reads handshapes, so it cannot see any sign defined by movement --
 * the same limitation as live SignBridge mode, and the reason cues are labelled
 * with the confidence the classifier actually reported.
 */
export default function RecordedVideoTranslator({ language, setLanguage, mode, onBack }) {
  const [file, setFile] = useState(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [status, setStatus] = useState('idle');   // idle|loading|ready|scanning|done|error
  const [progress, setProgress] = useState(0);
  const [cues, setCues] = useState([]);
  const [sentences, setSentences] = useState({});   // token -> translated line
  const [activeCue, setActiveCue] = useState(null);
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(false);

  const videoRef = useRef(null);
  const samplesRef = useRef([]);
  const timestampRef = useRef(0);
  const cancelRef = useRef(false);
  const trackRef = useRef(null);

  // requestVideoFrameCallback is Chromium + Safari. Firefox has no equivalent,
  // so the whole frame-accurate path is unavailable there and the UI says so
  // rather than silently producing drifting timestamps.
  const hasRVFC = typeof HTMLVideoElement !== 'undefined' &&
    'requestVideoFrameCallback' in HTMLVideoElement.prototype;

  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { cancelRef.current = true; }, []);

  // ── File selection ────────────────────────────────────────────────────────

  const onPick = (event) => {
    const picked = event.target.files?.[0];
    if (!picked) return;
    if (videoUrl) URL.revokeObjectURL(videoUrl);

    setFile(picked);
    setVideoUrl(URL.createObjectURL(picked));
    setCues([]);
    setSentences({});
    setActiveCue(null);
    setError(null);
    setProgress(0);
    samplesRef.current = [];
    timestampRef.current = 0;
    setStatus('ready');
  };

  // ── Scan ──────────────────────────────────────────────────────────────────

  const scan = useCallback(async () => {
    const video = videoRef.current;
    if (!video || !hasRVFC) return;

    setStatus('loading');
    setError(null);
    try {
      await landmarker.load((m) => setProgress(0));
    } catch (err) {
      setStatus('error');
      setError(`Could not load the landmark models: ${err.message}`);
      return;
    }

    samplesRef.current = [];
    timestampRef.current = 0;
    cancelRef.current = false;
    setCues([]);
    setStatus('scanning');

    video.currentTime = 0;
    video.muted = true;         // scanning at speed; audio would be noise
    await video.play().catch(() => {});

    const onFrame = (_now, meta) => {
      if (cancelRef.current || video.ended) return finishScan();

      // MediaPipe rejects a non-increasing timestamp. Media time is the right
      // clock for a file, but two frames can share a millisecond after
      // rounding, so it is forced monotonic.
      const mediaMs = Math.round((meta.mediaTime ?? video.currentTime) * 1000);
      const ts = Math.max(mediaMs, timestampRef.current + 1);
      timestampRef.current = ts;

      const result = landmarker.detect(video, ts);
      if (result) {
        const hit = classifySignBridgeFrame(result.hands, result.pose);
        samplesRef.current.push({
          timeMs: mediaMs,
          token: hit?.token || null,
          confidence: hit?.confidence || 0,
        });
      }

      if (video.duration) setProgress(video.currentTime / video.duration);
      video.requestVideoFrameCallback(onFrame);
      return undefined;
    };

    const finishScan = async () => {
      video.pause();
      setPlaying(false);
      setProgress(1);

      const built = buildCues(samplesRef.current);
      setCues(built);

      // Resolve each distinct token to a sentence once, not per cue.
      const unique = [...new Set(built.map((c) => c.token))];
      const resolved = {};
      for (const token of unique) {
        // eslint-disable-next-line no-await-in-loop
        const r = await translate([token], language, { mode });
        resolved[token] = r.translated || r.english || token;
      }
      setSentences(resolved);
      attachTextTrack(built, resolved);
      setStatus('done');
      video.currentTime = 0;
      video.muted = false;
    };

    video.requestVideoFrameCallback(onFrame);
  }, [hasRVFC, language, mode]);

  // ── VTTCue overlay ────────────────────────────────────────────────────────

  /**
   * Push the cues into a real TextTrack so the browser drives the overlay.
   *
   * A React timer comparing currentTime would drift and would keep re-rendering
   * during playback; the browser's own cue scheduler is frame-accurate and free.
   */
  function attachTextTrack(list, resolved) {
    const video = videoRef.current;
    if (!video || typeof VTTCue === 'undefined') return;

    // Remove any track from a previous scan.
    if (trackRef.current) {
      trackRef.current.mode = 'disabled';
      [...(trackRef.current.cues || [])].forEach((c) => trackRef.current.removeCue(c));
    }
    const track = trackRef.current || video.addTextTrack('captions', 'ISL', 'en');
    trackRef.current = track;
    track.mode = 'hidden';        // hidden: we render the overlay ourselves

    for (const c of list) {
      const cue = new VTTCue(c.startMs / 1000, c.endMs / 1000,
        resolved[c.token] || c.token);
      cue.onenter = () => setActiveCue({ ...c, text: resolved[c.token] || c.token });
      cue.onexit = () => setActiveCue((cur) => (cur?.startMs === c.startMs ? null : cur));
      track.addCue(cue);
    }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  const baseName = (file?.name || 'transcript').replace(/\.[^.]+$/, '');
  const textFor = (c) => sentences[c.token] || c.token;

  const exportSrt = () => downloadText(`${baseName}.srt`, toSrt(cues, textFor), 'text/plain');
  const exportVtt = () => downloadText(`${baseName}.vtt`, toVtt(cues, textFor), 'text/vtt');

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); } else { v.pause(); setPlaying(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 no-scrollbar">
      <header className="flex items-center gap-2 py-3">
        <button type="button" onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-full bg-card-high">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-bold">Recorded Video</h1>
        <div className="ml-auto">
          <LanguageSelect value={language} onChange={setLanguage} />
        </div>
      </header>

      {!hasRVFC && (
        <div className="mb-3 flex gap-2 rounded-xl border border-amber/40 bg-amber/10 px-3 py-2.5 text-xs text-amber">
          <AlertTriangle size={15} className="mt-0.5 shrink-0" />
          <span>
            This browser has no <code>requestVideoFrameCallback</code>, so
            frame-accurate scanning is unavailable. Chrome, Edge or Safari will
            work; Firefox will not.
          </span>
        </div>
      )}

      {/* Picker */}
      <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-dashed border-white/20 bg-card p-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-card-high">
          <Upload size={20} className="text-primary" />
        </span>
        <span className="flex-1">
          <span className="block text-sm font-semibold">
            {file ? file.name : 'Choose a video'}
          </span>
          <span className="block text-[11px] text-ink-dim">
            {file
              ? `${(file.size / 1048576).toFixed(1)} MB · processed entirely on this device`
              : 'MP4 or WebM. Nothing is uploaded.'}
          </span>
        </span>
        <input
          type="file"
          accept="video/mp4,video/webm,.mp4,.webm"
          onChange={onPick}
          className="hidden"
        />
      </label>

      {/* Player + overlay */}
      {videoUrl && (
        <div className="relative mt-3 overflow-hidden rounded-2xl border border-white/10 bg-black">
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            controls={status === 'done'}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            className="w-full"
          />

          {/* Live VTT overlay */}
          {activeCue && (
            <div className="pointer-events-none absolute inset-x-3 bottom-14 rounded-xl bg-black/70 px-3 py-2 backdrop-blur">
              <p className="text-center text-base font-semibold leading-snug text-ink">
                {activeCue.text}
              </p>
              <p className="text-center text-[10px] text-ink-dim">
                {activeCue.token} · {(activeCue.confidence * 100).toFixed(0)}%
              </p>
            </div>
          )}

          {status === 'scanning' && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
              <div
                className="h-full bg-primary transition-all"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {videoUrl && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={scan}
            disabled={!hasRVFC || status === 'scanning' || status === 'loading'}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-surface disabled:opacity-40"
          >
            {(status === 'scanning' || status === 'loading') && (
              <Loader2 size={15} className="animate-spin" />
            )}
            {status === 'scanning'
              ? `Scanning ${(progress * 100).toFixed(0)}%`
              : status === 'loading' ? 'Loading models…'
              : status === 'done' ? 'Scan again' : 'Scan for signs'}
          </button>

          {status === 'done' && (
            <button
              type="button"
              onClick={togglePlay}
              className="flex h-10 w-10 items-center justify-center rounded-xl bg-card-high"
            >
              {playing ? <Pause size={16} /> : <Play size={16} />}
            </button>
          )}

          {cues.length > 0 && (
            <>
              <button
                type="button"
                onClick={exportSrt}
                className="flex items-center gap-2 rounded-xl bg-card-high px-3 py-2.5 text-xs font-semibold"
              >
                <Download size={14} /> .SRT
              </button>
              <button
                type="button"
                onClick={exportVtt}
                className="flex items-center gap-2 rounded-xl bg-card-high px-3 py-2.5 text-xs font-semibold"
              >
                <Download size={14} /> .VTT
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-xl border border-rose/40 bg-rose/10 px-3 py-2 text-xs text-rose">
          {error}
        </p>
      )}

      {/* Transcript */}
      {cues.length > 0 && (
        <section className="my-4 rounded-2xl border border-white/10 bg-card p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">
            Transcript · {cues.length} cue{cues.length === 1 ? '' : 's'}
          </p>
          <div className="mt-3 space-y-2">
            {cues.map((c, i) => (
              <button
                key={`${c.startMs}-${c.token}`}
                type="button"
                onClick={() => {
                  const v = videoRef.current;
                  if (v) { v.currentTime = c.startMs / 1000; v.play(); }
                }}
                className="flex w-full gap-3 rounded-lg bg-card-high px-3 py-2 text-left"
              >
                <span className="shrink-0 font-mono text-[10px] text-ink-dim">
                  {formatSrtTime(c.startMs).slice(3, 12)}
                </span>
                <span className="flex-1">
                  <span className="block text-sm">{sentences[c.token] || c.token}</span>
                  <span className="block text-[10px] text-ink-dim">
                    {c.token} · {(c.confidence * 100).toFixed(0)}% · {c.frames} frames
                  </span>
                </span>
                <span className="text-[10px] text-ink-dim">#{i + 1}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {status === 'done' && cues.length === 0 && (
        <div className="my-4 flex gap-2 rounded-xl border border-amber/40 bg-amber/10 px-3 py-2.5 text-xs text-amber">
          <FileVideo size={15} className="mt-0.5 shrink-0" />
          <span>
            No signs were recognised. The static classifier reads handshapes
            only — signs defined by movement will not register, and hands need
            to be clearly in frame.
          </span>
        </div>
      )}
    </div>
  );
}
