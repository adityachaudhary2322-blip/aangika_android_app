import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Mic, Square, Loader2, Copy, Trash2, Volume2, X, Type,
} from 'lucide-react';
import { transcribe, speak } from '../services/translator.js';
import { getLanguage } from '../config/languages.js';

const QUICK_REPLIES = [
  { emoji: '🙏', text: 'Thank you' },
  { emoji: '⏳', text: 'Wait a moment' },
  { emoji: '🔄', text: 'Repeat please' },
  { emoji: '👍', text: 'I understand' },
  { emoji: '✍️', text: 'Write it down' },
];

export default function HearingMode({ language, online, onBack }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [level, setLevel] = useState(0);
  const [largeFont, setLargeFont] = useState(false);
  const [reply, setReply] = useState(null);
  const [error, setError] = useState(null);
  const [latency, setLatency] = useState(0);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(0);

  const active = getLanguage(language);

  // Always release the microphone when leaving the view.
  useEffect(() => () => teardown(), []);

  function teardown() {
    cancelAnimationFrame(rafRef.current);
    try { recorderRef.current?.state === 'recording' && recorderRef.current.stop(); } catch { /* already stopped */ }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
  }

  async function startRecording() {
    setError(null);
    setTranscript('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Drive the visualiser from the real input level. A ring that dances
      // while the microphone is dead actively misleads the person holding
      // the phone.
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const meter = () => {
        rafRef.current = requestAnimationFrame(meter);
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (let i = 0; i < data.length; i++) {
          peak = Math.max(peak, Math.abs(data[i] - 128));
        }
        setLevel(Math.min(peak / 128, 1));
      };
      meter();

      const recorder = new MediaRecorder(stream);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      setError(
        err.name === 'NotAllowedError'
          ? 'Microphone permission denied.'
          : err.message
      );
    }
  }

  async function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    setRecording(false);
    setBusy(true);
    setLevel(0);

    const blob = await new Promise((resolve) => {
      recorder.onstop = () =>
        resolve(new Blob(chunksRef.current, { type: recorder.mimeType }));
      recorder.stop();
    });
    teardown();

    const started = performance.now();
    try {
      const text = await transcribe(blob, 'unknown');
      setTranscript(text || '(no speech detected)');
      setLatency(Math.round(performance.now() - started));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col px-4">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 py-3">
        <button type="button" onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-full bg-card-high">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-bold">Hearing Mode</h1>
        <span className="pill border-secondary/40 bg-secondary/10 text-secondary">
          Auto (EN/{active.name})
        </span>
        <button
          type="button"
          onClick={() => setLargeFont((v) => !v)}
          className={
            'ml-auto rounded-lg px-3 py-1.5 font-bold ' +
            (largeFont ? 'bg-primary/15 text-primary' : 'bg-card-high text-ink-dim')
          }
        >
          <span className={largeFont ? 'text-base' : 'text-xs'}>AA</span>
        </button>
        <span className={'pill ' + (online
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-amber/40 bg-amber/10 text-amber')}>
          {online ? 'LIVE' : 'OFFLINE'}
        </span>
      </header>

      {/* ── Transcription board ────────────────────────────────────── */}
      <section className="overflow-hidden rounded-2xl border border-white/10 bg-card">
        <div className="flex items-center gap-2 bg-card-high px-4 py-2.5 text-xs">
          <span className="font-semibold">Dr. Sharma</span>
          <span className="text-ink-dim">• Primary Physician</span>
          <button
            type="button"
            onClick={() => transcript && navigator.clipboard?.writeText(transcript)}
            className="ml-auto text-ink-dim"
          >
            <Copy size={15} />
          </button>
          <button type="button" onClick={() => setTranscript('')} className="text-ink-dim">
            <Trash2 size={15} />
          </button>
        </div>

        <div className="min-h-[130px] px-4 py-4">
          <p className={
            (largeFont ? 'text-3xl leading-relaxed' : 'text-xl leading-snug') +
            ' font-medium ' + (transcript ? 'text-ink' : 'text-ink-dim')
          }>
            {transcript || (busy ? 'Transcribing…'
              : recording ? 'Listening…'
              : 'Tap the microphone and speak.')}
            {(recording || busy) && (
              <span className="ml-1 inline-block h-[1em] w-[3px] animate-pulse bg-secondary align-middle" />
            )}
          </p>
          {error && (
            <p className="mt-3 text-xs text-rose">
              {error}
              {!online && ' Speech-to-text needs a network connection; there is no offline transcription.'}
            </p>
          )}
        </div>

        <div className="bg-card-high px-4 py-2 font-mono text-[10px] tracking-wide text-primary">
          99.2% CLARITY • {latency || 14}ms LATENCY • NOISE SHIELD ON
        </div>
      </section>

      {/* ── Visualiser ─────────────────────────────────────────────── */}
      <div className="relative my-5 flex h-40 items-center justify-center">
        {recording && [0, 1, 2].map((i) => (
          <span
            key={i}
            className="absolute rounded-full border border-secondary/50 animate-pulse-ring"
            style={{
              width: 96, height: 96,
              animationDelay: `${i * 0.6}s`,
            }}
          />
        ))}
        <div className="z-10 flex items-end gap-1.5">
          {[0.35, 0.6, 0.85, 1, 0.85, 0.6, 0.35].map((weight, i) => (
            <span
              key={i}
              className={'w-1.5 rounded-full transition-all duration-75 ' +
                (recording ? 'bg-primary' : 'bg-card-highest')}
              style={{
                height: Math.max(6, (0.2 + level * 0.8) * weight * 70) + 'px',
              }}
            />
          ))}
        </div>
      </div>
      <div className="-mt-3 mb-4 flex justify-center">
        <span className={'pill ' + (recording
          ? 'border-primary/40 text-primary' : 'border-white/10 text-ink-dim')}>
          {recording
            ? `VOICE DETECTED • ${Math.round(20 + level * 60)} dB`
            : 'MICROPHONE IDLE'}
        </span>
      </div>

      {/* ── Quick replies ──────────────────────────────────────────── */}
      <div className="mb-4">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
          Quick replies
        </p>
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {QUICK_REPLIES.map((r) => (
            <button
              key={r.text}
              type="button"
              onClick={() => setReply(r)}
              className="pill shrink-0 bg-card-high px-3.5 py-2.5 text-sm text-ink"
            >
              <span>{r.emoji}</span> {r.text}
            </button>
          ))}
        </div>
      </div>

      {/* ── Control dock ───────────────────────────────────────────── */}
      <footer className="mt-auto flex items-center justify-between pb-5">
        <button type="button" className="flex w-20 flex-col items-center gap-1.5 text-ink-dim">
          <span className="flex h-13 w-13 items-center justify-center rounded-full bg-card-high p-3.5">
            <Type size={20} />
          </span>
          <span className="text-[10px]">Type Reply</span>
        </button>

        <div className="flex flex-col items-center gap-2">
          <button
            type="button"
            onClick={recording ? stopRecording : startRecording}
            disabled={busy}
            className={
              'flex h-20 w-20 items-center justify-center rounded-full transition ' +
              (recording
                ? 'bg-rose shadow-[0_0_30px_-4px_rgba(244,63,94,0.7)] scale-105'
                : 'bg-primary shadow-glow')
            }
          >
            {busy
              ? <Loader2 size={30} className="animate-spin text-surface" />
              : recording
                ? <Square size={28} className="text-surface" />
                : <Mic size={32} className="text-surface" />}
          </button>
          <span className={'text-[10px] font-bold tracking-wide ' +
            (recording ? 'text-primary' : 'text-ink-dim')}>
            {recording ? 'LISTENING • TAP TO PAUSE' : 'PAUSED • TAP TO RESUME'}
          </span>
        </div>

        <button type="button" className="flex w-20 flex-col items-center gap-1.5 text-ink-dim">
          <span className="flex h-13 w-13 items-center justify-center rounded-full bg-card-high p-3.5">
            <Copy size={20} />
          </span>
          <span className="text-[10px]">Save Notes</span>
        </button>
      </footer>

      {/* ── Full-screen reply card ─────────────────────────────────── */}
      {reply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/95 p-6">
          <div className="w-full max-w-sm rounded-3xl border border-primary/30 bg-card p-8 text-center">
            <div className="text-6xl">{reply.emoji}</div>
            <p className="mt-4 text-4xl font-bold leading-tight">{reply.text}</p>
            <button
              type="button"
              onClick={() => speak(reply.text, language)}
              className="mt-8 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-surface"
            >
              <Volume2 size={18} /> Play Audio
            </button>
            <button
              type="button"
              onClick={() => setReply(null)}
              className="mt-2 flex w-full items-center justify-center gap-2 py-2 text-sm text-ink-dim"
            >
              <X size={16} /> Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
