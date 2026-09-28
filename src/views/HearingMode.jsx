import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Mic, Square, Loader2, Copy, Trash2, Volume2, X, Type, Download,
  Send, Check,
} from 'lucide-react';
import { transcribe } from '../services/translator.js';
import { speak } from '../services/ttsService.js';

const QUICK_REPLIES = [
  { emoji: '🙏', text: 'Thank you' },
  { emoji: '⏳', text: 'Wait a moment' },
  { emoji: '🔄', text: 'Repeat please' },
  { emoji: '👍', text: 'I understand' },
  { emoji: '✍️', text: 'Write it down' },
];

const LOG_KEY = 'isl.hearing.log';

function loadLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function timeOf(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Plain-text export, one line per turn. */
function logAsText(log) {
  return log
    .map((e) => `[${timeOf(e.at)}] ${e.who === 'me' ? 'Me' : 'Them'}: ${e.text}`)
    .join('\n');
}

/**
 * Speech to text, as a conversation.
 *
 * Every transcription is appended to a running log instead of replacing the
 * last one, and typed or quick replies land in the same log, so the screen
 * reads like the exchange it records. The log survives a reload (it is only
 * ever stored on this device) and can be copied or saved as a text file.
 */
export default function HearingMode({ language, online, onBack }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState(loadLog);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const [level, setLevel] = useState(0);
  const [largeFont, setLargeFont] = useState(false);
  const [reply, setReply] = useState(null);
  const [error, setError] = useState(null);
  const [latency, setLatency] = useState(0);

  const recorderRef = useRef(null);
  const logRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const audioCtxRef = useRef(null);
  const rafRef = useRef(0);


  useEffect(() => {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log.slice(-200))); } catch { /* private mode */ }
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log]);

  const append = (who, text) =>
    setLog((l) => [...l, { id: `${Date.now()}-${l.length}`, who, text, at: Date.now() }]);

  function sayReply(r) {
    setReply(r);
    append('me', r.text);
    speak(r.text, language);
  }

  function submitDraft(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    sayReply({ emoji: '💬', text });
    setDraft('');
    setTyping(false);
  }

  async function copyLog() {
    if (!log.length) return;
    try {
      await navigator.clipboard.writeText(logAsText(log));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked */ }
  }

  function saveLog() {
    if (!log.length) return;
    const blob = new Blob([logAsText(log)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aangika-notes-${new Date().toISOString().slice(0, 16).replace(':', '')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

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
      const text = (await transcribe(blob, 'unknown') || '').trim();
      if (text) append('them', text);
      else setError('No speech detected. Try again a little closer.');
      setLatency(Math.round(performance.now() - started));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex h-full flex-col px-5">
      {/* ── Header ─────────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 pb-3 pt-4">
        <button type="button" onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full border border-subtle bg-card">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-extrabold tracking-tight">Speech to text</h1>
        <button
          type="button"
          onClick={() => setLargeFont((v) => !v)}
          aria-pressed={largeFont}
          aria-label="Large captions"
          className={
            'ml-auto flex h-9 items-center rounded-full border px-3 font-bold transition ' +
            (largeFont ? 'border-primary/40 bg-primary/10 text-primary' : 'border-subtle bg-card text-ink-dim')
          }
        >
          <span className="text-xs">A</span><span className="text-base">A</span>
        </button>
        <span className={'pill ' + (online
          ? 'border-secondary/30 bg-secondary/10 text-secondary'
          : 'border-amber/30 bg-amber/10 text-amber')}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {online ? 'Live' : 'Offline'}
        </span>
      </header>

      {/* ── Conversation log ───────────────────────────────────────── */}
      <section className="surface-card flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b border-subtle px-4 py-2.5 text-xs">
          <span className="font-semibold">Conversation</span>
          <span className="text-ink-dim">
            · {log.length} {log.length === 1 ? 'line' : 'lines'}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <IconBtn label="Copy all" onClick={copyLog} disabled={!log.length}>
              {copied ? <Check size={15} className="text-secondary" /> : <Copy size={15} />}
            </IconBtn>
            <IconBtn label="Save as text file" onClick={saveLog} disabled={!log.length}>
              <Download size={15} />
            </IconBtn>
            <IconBtn label="Clear conversation" onClick={() => setLog([])} disabled={!log.length}>
              <Trash2 size={15} />
            </IconBtn>
          </div>
        </div>

        <div ref={logRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4 no-scrollbar">
          {log.length === 0 && !recording && !busy && (
            <p className="py-6 text-center text-sm text-ink-dim">
              Tap the microphone and let the other person speak.
              Their words appear here, and your replies are read out loud.
            </p>
          )}
          {log.map((e) => (
            <div key={e.id} className={e.who === 'me' ? 'text-right' : ''}>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-dim">
                {e.who === 'me' ? 'You' : 'They said'} · {timeOf(e.at)}
              </p>
              <p
                className={
                  'mt-0.5 font-medium ' +
                  (largeFont ? 'text-3xl leading-relaxed ' : 'text-xl leading-snug ') +
                  (e.who === 'me' ? 'text-primary' : 'text-ink')
                }
              >
                {e.text}
              </p>
            </div>
          ))}
          {(recording || busy) && (
            <p className={(largeFont ? 'text-3xl' : 'text-xl') + ' font-medium text-ink-dim'}>
              {busy ? 'Transcribing…' : 'Listening…'}
              <span className="ml-1 inline-block h-[1em] w-[3px] animate-pulse bg-secondary align-middle" />
            </p>
          )}
          {error && (
            <p className="rounded-2xl border border-rose/30 bg-rose/10 px-3 py-2 text-xs text-rose">
              {error}
              {!online && ' Speech-to-text needs a network connection; there is no offline transcription.'}
            </p>
          )}
        </div>

        {latency > 0 && (
          <div className="border-t border-subtle px-4 py-1.5 text-[10px] text-ink-dim">
            Last transcription took {(latency / 1000).toFixed(1)} s
          </div>
        )}
      </section>

      {/* ── Quick replies ──────────────────────────────────────────── */}
      <div className="mt-4">
        <p className="eyebrow mb-2">Quick replies · tap to speak</p>
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 no-scrollbar">
          {QUICK_REPLIES.map((r) => (
            <button
              key={r.text}
              type="button"
              onClick={() => sayReply(r)}
              className="pill shrink-0 bg-card px-3.5 py-2.5 text-sm text-ink shadow-card"
            >
              <span>{r.emoji}</span> {r.text}
            </button>
          ))}
        </div>
      </div>

      {/* ── Type-back composer ─────────────────────────────────────── */}
      {typing && (
        <form onSubmit={submitDraft} className="mt-3 flex animate-fade-up items-center gap-2">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Type a reply to read out loud"
            autoFocus
            className="field rounded-full"
          />
          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Speak reply"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[rgb(124_58_237)] to-[rgb(79_70_229)] text-white shadow-glow transition active:scale-90 disabled:opacity-40"
          >
            <Send size={17} />
          </button>
        </form>
      )}

      {/* ── Control dock ───────────────────────────────────────────── */}
      <footer className="flex items-center justify-between pb-5 pt-4">
        <DockBtn label="Type reply" active={typing} onClick={() => setTyping((v) => !v)}>
          <Type size={20} />
        </DockBtn>

        <div className="flex flex-col items-center gap-2">
          <div className="relative flex items-center justify-center">
            {recording && [0, 1, 2].map((i) => (
              <span
                key={i}
                className="absolute h-20 w-20 rounded-full border border-rose/50 animate-pulse-ring"
                style={{ animationDelay: `${i * 0.6}s` }}
              />
            ))}
            <button
              type="button"
              onClick={recording ? stopRecording : startRecording}
              disabled={busy}
              aria-label={recording ? 'Stop and transcribe' : 'Start listening'}
              className={
                'relative flex h-20 w-20 items-center justify-center rounded-full text-white transition ' +
                (recording
                  ? 'scale-105 bg-rose shadow-[0_0_30px_-4px_rgba(244,63,94,0.7)]'
                  : 'bg-gradient-to-br from-[rgb(13_148_136)] to-[rgb(14_116_144)] shadow-glow-cyan')
              }
              style={recording ? { transform: `scale(${1.05 + level * 0.15})` } : undefined}
            >
              {busy
                ? <Loader2 size={30} className="animate-spin" />
                : recording
                  ? <Square size={26} />
                  : <Mic size={30} />}
            </button>
          </div>
          <span className={'text-[10px] font-bold tracking-wide ' +
            (recording ? 'text-rose' : 'text-ink-dim')}>
            {busy ? 'TRANSCRIBING' : recording ? 'LISTENING · TAP TO STOP' : 'TAP TO LISTEN'}
          </span>
        </div>

        <DockBtn label="Save notes" onClick={saveLog} disabled={!log.length}>
          <Download size={20} />
        </DockBtn>
      </footer>

      {/* ── Full-screen reply card ─────────────────────────────────── */}
      {reply && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface/95 p-6 backdrop-blur">
          <div className="w-full max-w-sm animate-fade-up rounded-[2rem] border border-primary/30 bg-card p-8 text-center shadow-card">
            <div className="text-6xl">{reply.emoji}</div>
            <p className="mt-4 text-4xl font-extrabold leading-tight">{reply.text}</p>
            <p className="mt-2 text-xs text-ink-dim">Show this screen, or play it aloud.</p>
            <button
              type="button"
              onClick={() => speak(reply.text, language)}
              className="btn-primary mt-8 w-full"
            >
              <Volume2 size={18} /> Play again
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

function IconBtn({ label, onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="flex h-8 w-8 items-center justify-center rounded-full text-ink-dim transition hover:bg-card-high hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function DockBtn({ label, onClick, disabled, active, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={'flex w-20 flex-col items-center gap-1.5 transition disabled:opacity-40 ' + (active ? 'text-primary' : 'text-ink-dim')}
    >
      <span className={'flex h-12 w-12 items-center justify-center rounded-full border ' + (active ? 'border-primary/40 bg-primary/10' : 'border-subtle bg-card')}>
        {children}
      </span>
      <span className="text-[10px] font-semibold">{label}</span>
    </button>
  );
}
