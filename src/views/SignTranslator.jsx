import { useState } from 'react';
import {
  ArrowLeft, Volume2, Copy, Eraser, SwitchCamera, Waypoints, Loader2,
} from 'lucide-react';
import CameraStage from '../components/CameraStage.jsx';
import LandmarkCanvas from '../components/LandmarkCanvas.jsx';
import LanguageSelect from '../components/LanguageSelect.jsx';
import useSignPipeline from '../hooks/useSignPipeline.js';
import cameraManager from '../services/cameraManager.js';
import { getKeys } from '../services/translator.js';
import { speak } from '../services/ttsService.js';
import { translate, describeMode } from '../services/translationService.js';
import { getLanguage } from '../config/languages.js';

export default function SignTranslator({
  language, setLanguage, online, onBack, cameraError, mode, togglePipeline,
}) {
  const [mirrored, setMirrored] = useState(true);
  const [showMesh, setShowMesh] = useState(true);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [note, setNote] = useState(null);
  const [manualTags, setManualTags] = useState(null);

  const { status, progress, words, closest, stats, error, frameRef, clear } =
    useSignPipeline({ enabled: true, mirrored });

  const active = getLanguage(language);
  const badge = describeMode(mode, {
    online,
    hasKey: Boolean(getKeys().gemini),
  });
  const confidence = words.length
    ? (words.reduce((a, w) => a + w.confidence, 0) / words.length) * 100
    : 0;

  const activeTags = manualTags || words.map((w) => w.word);

  const build = async (tags = activeTags) => {
    if (!tags.length) return;
    setBusy(true);
    const r = await translate(tags, language, { mode });
    setResult(r);
    setBusy(false);
  };

  // NAMASTE and ADITYA are not among the model's 1500 output channels, so the
  // greeting rules can only be reached through explicit entry.
  const runDemo = (tags) => {
    setManualTags(tags);
    build(tags);
  };

  const play = async () => {
    const text = result?.translated || result?.english;
    if (!text) return;
    setSpeaking(true);
    const outcome = await speak(text, language);
    setSpeaking(false);
    if (outcome.warning) {
      setNote(outcome.warning);
      setTimeout(() => setNote(null), 4000);
    }
  };

  const copy = () => {
    const text = [result?.english, result?.translated]
      .filter(Boolean).join('\n');
    if (text) navigator.clipboard?.writeText(text);
  };

  return (
    <div className="relative flex h-full flex-col">
      {/* ── Camera ─────────────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-hidden">
        <CameraStage mirrored={mirrored} className="absolute inset-0" />
        {showMesh && <LandmarkCanvas frameRef={frameRef} mirrored={mirrored} />}

        {/* Top chrome */}
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 backdrop-blur"
          >
            <ArrowLeft size={18} />
          </button>
          <span className="pill bg-black/55 text-ink backdrop-blur">
            {stats.fps} FPS · {stats.latencyMs} ms
          </span>
          <button
            type="button"
            onClick={togglePipeline}
            title="Switch translation engine"
            className={
              'pill bg-black/55 backdrop-blur ' +
              (badge.tone === 'primary'
                ? 'border-primary/50 text-primary'
                : 'border-amber/50 text-amber')
            }
          >
            {badge.icon} {badge.short}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <LanguageSelect
              value={language}
              onChange={setLanguage}
              variant="overlay"
            />
            <button
              type="button"
              onClick={() => setShowMesh((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 backdrop-blur"
            >
              <Waypoints size={16} className={showMesh ? 'text-primary' : 'text-ink-dim'} />
            </button>
            <button
              type="button"
              onClick={() => {
                cameraManager.flip();
                setMirrored((v) => !v);
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-black/55 backdrop-blur"
            >
              <SwitchCamera size={16} />
            </button>
          </div>
        </div>

        {/* Loading / error */}
        {(status === 'loading' || status === 'error' || cameraError) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/85 px-6 text-center">
            {status === 'loading' && (
              <>
                <Loader2 size={26} className="animate-spin text-primary" />
                <p className="text-sm">{progress || 'Loading…'}</p>
                <p className="text-[11px] text-ink-dim">
                  First run downloads a 21 MB model; it is cached afterwards.
                </p>
              </>
            )}
            {(status === 'error' || cameraError) && (
              <p className="text-sm text-rose">{cameraError || error}</p>
            )}
          </div>
        )}

        {/* Token chips */}
        <div className="absolute inset-x-0 bottom-0 p-3">
          {stats.handCoverage > 0 && stats.handCoverage < 70 && (
            <p className="mb-2 text-[11px] text-amber">
              Hands often lost — move closer and keep them in frame.
            </p>
          )}
          <div className="flex gap-2 overflow-x-auto no-scrollbar">
            {(words.length ? words : closest.slice(0, 3)).map((w) => (
              <span
                key={w.index}
                className={
                  'pill shrink-0 bg-black/60 backdrop-blur ' +
                  (words.length ? 'border-primary/50' : 'border-white/10 opacity-60')
                }
              >
                <b className="text-ink">{w.word.toUpperCase()}</b>
                <span className={words.length ? 'text-primary' : 'text-ink-dim'}>
                  {(w.confidence * 100).toFixed(1)}%
                </span>
              </span>
            ))}
            {!words.length && !closest.length && (
              <span className="text-[11px] text-ink-dim">
                Sign to begin…
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Glass interpretation card ──────────────────────────────── */}
      <section className="glass rounded-t-3xl p-4">
        <div className="flex items-center">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
            Live Interpretation
          </span>
          <span className="ml-auto text-xs font-semibold text-primary">
            {confidence.toFixed(1)}% confidence
          </span>
        </div>

        <div className="mt-2 h-1 overflow-hidden rounded-full bg-card-highest">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.min(confidence, 100)}%` }}
          />
        </div>

        <p className="mt-3 text-sm text-ink-dim">
          {result?.english || 'Sign, then press Build.'}
        </p>
        {result?.translated && (
          <p className="mt-1 text-2xl font-bold leading-snug">
            {result.translated}
          </p>
        )}

        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-dim">
            Demo
          </span>
          {[['NAMASTE'], ['NAME', 'ADITYA'], ['I', 'WANT', 'WATER']].map((tags) => (
            <button
              key={tags.join('-')}
              type="button"
              onClick={() => runDemo(tags)}
              className="pill shrink-0 border-white/10 bg-card-high text-[10px] text-ink-dim"
            >
              {tags.join(' ')}
            </button>
          ))}
          {manualTags && (
            <button
              type="button"
              onClick={() => { setManualTags(null); setResult(null); }}
              className="pill shrink-0 border-amber/40 text-[10px] text-amber"
            >
              using demo · clear
            </button>
          )}
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => build()}
            disabled={!activeTags.length || busy}
            className="rounded-lg bg-card-highest px-3 py-2 text-xs font-semibold disabled:opacity-40"
          >
            {busy ? 'Building…' : 'Build'}
          </button>
          <button
            type="button"
            onClick={copy}
            disabled={!result}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-card-high disabled:opacity-40"
          >
            <Copy size={15} />
          </button>
          <button
            type="button"
            onClick={() => { clear(); setResult(null); setManualTags(null); }}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-card-high"
          >
            <Eraser size={15} />
          </button>

          <button
            type="button"
            onClick={play}
            disabled={!result || speaking}
            className="ml-auto flex h-13 w-13 items-center justify-center rounded-full bg-gradient-to-br from-primary to-secondary p-4 disabled:opacity-40"
          >
            {speaking
              ? <Loader2 size={20} className="animate-spin text-surface" />
              : <Volume2 size={20} className="text-surface" />}
          </button>
        </div>

        {result && (
          <p className="mt-2 text-[10px] text-ink-dim">
            {result.source === 'offline'
              ? `${badge.icon} ${result.engine} · ${result.latencyMs} ms · ${result.note || 'English only, no network used.'}`
              : `${badge.icon} ${result.engine} · ${result.latencyMs} ms · speaking ${active.name}`}
          </p>
        )}
        {note && <p className="mt-2 text-[11px] text-amber">{note}</p>}
        {error && <p className="mt-2 text-[11px] text-rose">{error}</p>}
      </section>
    </div>
  );
}
