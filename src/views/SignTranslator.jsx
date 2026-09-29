import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Volume2, Copy, Eraser, FlipHorizontal, Waypoints, Loader2, Play, Hand,
  BookmarkPlus, Languages as LanguagesIcon, X, Quote,
} from 'lucide-react';
import CameraStage from '../components/CameraStage.jsx';
import LandmarkCanvas from '../components/LandmarkCanvas.jsx';
import LanguageSelect from '../components/LanguageSelect.jsx';
import EngineToggle from '../components/EngineToggle.jsx';
import EngineBadge from '../components/EngineBadge.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import useSignPipeline from '../hooks/useSignPipeline.js';
import useTokenStream from '../hooks/useTokenStream.js';
import { matchPhrase, phraseText, setDraft } from '../services/phrases.js';
import cameraManager from '../services/cameraManager.js';
import landmarker from '../services/landmarker.js';
import { getKeys } from '../services/translator.js';
import { speak, unlockAudio } from '../services/ttsService.js';
import { translate, describeMode } from '../services/translationService.js';
import { getLanguage } from '../config/languages.js';

export default function SignTranslator({
  language, setLanguage, online, onBack, cameraError, mode, togglePipeline,
  visionEngine, chooseVision, onNavigate,
}) {
  const [mirrored, setMirrored] = useState(() => cameraManager.isFrontCamera());
  const [started, setStarted] = useState(false);
  const [flipping, setFlipping] = useState(false);

  // Single source of truth: the manager tells us which camera is live, so the
  // overlay can never mirror while the back camera is running.
  useEffect(() => cameraManager.subscribe((s) => setMirrored(s.isFrontCamera)), []);
  const [showMesh, setShowMesh] = useState(true);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [note, setNote] = useState(null);
  const [manualTags, setManualTags] = useState(null);

  const {
    status, progress, words, closest, stats, error, frameRef, clear, spoken,
  } = useSignPipeline({
    enabled: started,
    mirrored,
    visionEngine,
    autoSpeak: true,     // speak the moment a sign is held; no button press
    language,
    mode,
  });

  // ── Continuous signing ────────────────────────────────────────────────
  // Every recognised sign joins a running sentence. A saved phrase that the
  // sentence completes is spoken as the user's own meaning.
  const { stream, reset: resetStream, removeAt } = useTokenStream(words, { enabled: started });
  const [phraseHit, setPhraseHit] = useState(null);
  const firedRef = useRef(0);
  useEffect(() => {
    const last = stream[stream.length - 1];
    if (!last || last.at === firedRef.current) return;
    const hit = matchPhrase(stream);
    if (!hit) return;
    firedRef.current = last.at;
    phraseText(hit, language).then((text) => {
      setPhraseHit({ phrase: hit, text });
      speak(text, language);
    });
  }, [stream, language]);

  const sentenceTokens = stream.map((e) => e.token);
  const translateSentence = () => {
    setManualTags(null);
    build(sentenceTokens);
  };
  const saveAsPhrase = () => {
    setDraft(sentenceTokens);
    onNavigate?.('phrases');
  };

  /**
   * The one gesture that unlocks audio for the session.
   *
   * Mobile browsers refuse programmatic playback until the user has interacted
   * with the page, and they only count the interaction synchronously inside the
   * handler -- so unlockAudio() is called here, first, before any await.
   */
  const startTranslating = async () => {
    await unlockAudio();
    setStarted(true);
    cameraManager.start().catch(() => {});
  };

  const flipCamera = async () => {
    setFlipping(true);
    try {
      await cameraManager.flip();
    } finally {
      setFlipping(false);
    }
  };

  // Which delegate and resolution the device ACTUALLY gave us. A phone that
  // silently fell back to the CPU delegate, or ignored the 480x360 request and
  // handed back 1080p, is the first thing to check when the frame rate is low.
  const [runtime, setRuntime] = useState({
    delegate: "unknown", width: null, height: null,
  });
  useEffect(() => {
    const id = setInterval(() => {
      const res = cameraManager.getResolution();
      setRuntime({
        delegate: landmarker.getDelegate(),
        width: res.width,
        height: res.height,
      });
    }, 1000);
    return () => clearInterval(id);
  }, []);

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
    <div className="relative flex h-full flex-col lg:flex-row lg:gap-4 lg:p-4">
      {/* ── Camera ─────────────────────────────────────────────────── */}
      <div className="relative flex-1 overflow-hidden lg:rounded-3xl lg:border lg:border-subtle lg:shadow-card">
        <CameraStage className="absolute inset-0" />
        {showMesh && <LandmarkCanvas frameRef={frameRef} mirrored={mirrored} />}

        {/* Top chrome */}
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 p-3">
          <button
            type="button"
            onClick={onBack}
            className="flex h-9 w-9 items-center justify-center rounded-full chrome-plate"
          >
            <ArrowLeft size={18} />
          </button>
          <span className="pill chrome-plate text-ink backdrop-blur">
            {stats.fps} FPS · {stats.latencyMs} ms{stats.detectMs ? ` · landmarks ${stats.detectMs} ms` : ''}
            {runtime.delegate !== "unknown" && (
              <span className={runtime.delegate === "GPU" ? "text-primary" : "text-amber"}>
                {runtime.delegate}
              </span>
            )}
            {runtime.width && (
              <span className="text-ink-dim">{runtime.width}x{runtime.height}</span>
            )}
          </span>
          <button
            type="button"
            onClick={togglePipeline}
            title="Switch translation engine"
            className={
              'pill chrome-plate ' +
              (badge.tone === 'primary'
                ? 'border-primary/50 text-primary'
                : 'border-amber/50 text-amber')
            }
          >
            {badge.icon} {badge.short}
          </button>
          <div className="ml-auto flex items-center gap-2">
            <EngineToggle value={visionEngine} onChange={chooseVision} compact />
            <LanguageSelect
              value={language}
              onChange={setLanguage}
              variant="overlay"
            />
            <ThemeToggle variant="overlay" />
            {onNavigate && (
              <button
                type="button"
                onClick={() => onNavigate('mysigns')}
                title="My signs"
                aria-label="My signs: teach your own signs"
                className="flex h-9 w-9 items-center justify-center rounded-full chrome-plate"
              >
                <Hand size={16} className="text-amber" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowMesh((v) => !v)}
              className="flex h-9 w-9 items-center justify-center rounded-full chrome-plate"
            >
              <Waypoints size={16} className={showMesh ? 'text-primary' : 'text-ink-dim'} />
            </button>
            <button
              type="button"
              onClick={flipCamera}
              disabled={flipping}
              aria-label={mirrored ? 'Switch to back camera' : 'Switch to front camera'}
              className="flex h-9 w-9 items-center justify-center rounded-full chrome-plate disabled:opacity-50"
            >
              {flipping
                ? <Loader2 size={16} className="animate-spin" />
                : <FlipHorizontal size={16} />}
            </button>
          </div>
        </div>

        {/* Start gate: one tap unlocks audio AND starts the camera. */}
        {!started && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 bg-surface/90 px-8 text-center">
            <button
              type="button"
              onClick={startTranslating}
              aria-label="Start translating"
              className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-fill-a to-fill-b shadow-glow active:scale-95"
            >
              <Play size={38} className="ml-1 text-white" />
            </button>
            <p className="text-sm font-semibold">Start translating</p>
            <p className="max-w-xs text-[11px] leading-relaxed text-ink-dim">
              Hold a sign for about a third of a second and it is spoken
              automatically. No buttons to press while signing.
            </p>
          </div>
        )}

        {/* Loading / error */}
        {started && (status === 'loading' || status === 'error' || cameraError) && (
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
                  'pill shrink-0 chrome-plate ' +
                  (words.length ? 'border-primary/50' : 'border-subtle opacity-60')
                }
              >
                <span className="flex flex-col leading-tight">
                  <b className="text-ink">{w.word.toUpperCase()}</b>
                  <EngineBadge engine={w.engine} confidence={w.confidence} />
                </span>
                {w.ambiguous && (
                  <span className="text-[9px] text-amber">ambiguous</span>
                )}
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
      <section className="glass max-h-[55%] overflow-y-auto rounded-t-3xl p-4 no-scrollbar lg:max-h-none lg:w-[400px] lg:shrink-0 lg:rounded-3xl lg:p-5">
        <div className="flex items-center">
          <span className="eyebrow">Live interpretation</span>
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

        {/* Continuous signing: the sentence being built, sign by sign. */}
        {started && (
          <div className="mt-3 rounded-2xl border border-subtle bg-card/70 p-3">
            <div className="flex items-center gap-2">
              <span className="eyebrow">Sentence so far</span>
              {stream.length > 0 && (
                <button
                  type="button"
                  onClick={() => { resetStream(); setPhraseHit(null); }}
                  className="ml-auto text-[11px] font-semibold text-ink-dim hover:text-ink"
                >
                  Clear
                </button>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {stream.length === 0 && (
                <span className="text-xs text-ink-dim">Sign several words in a row.</span>
              )}
              {stream.map((e, i) => (
                <button
                  key={`${e.token}-${e.at}`}
                  type="button"
                  onClick={() => removeAt(i)}
                  title="Remove this sign"
                  className="pill animate-fade-up border-subtle bg-card-high text-ink"
                >
                  {e.token.replace(/_+/g, ' ').toLowerCase()} <X size={10} className="text-ink-dim" />
                </button>
              ))}
            </div>
            {stream.length > 1 && (
              <div className="mt-3 flex gap-2">
                <button type="button" onClick={translateSentence} disabled={busy} className="btn-quiet flex-1 py-2 text-xs">
                  <LanguagesIcon size={14} /> Translate sentence
                </button>
                {onNavigate && (
                  <button type="button" onClick={saveAsPhrase} className="btn-quiet flex-1 py-2 text-xs">
                    <BookmarkPlus size={14} /> Save as phrase
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {phraseHit && (
          <div className="mt-3 animate-fade-up rounded-2xl border border-primary/40 bg-primary/10 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Quote size={11} /> Your phrase
            </p>
            <p className="mt-0.5 text-lg font-bold leading-snug">{phraseHit.text}</p>
            <p className="text-[11px] text-ink-dim">
              {phraseHit.phrase.tokens.join(' · ')}
            </p>
          </div>
        )}

        {/* Auto-speech: what the app said aloud, without being asked. */}
        {spoken && (
          <div className="mt-3 rounded-xl border border-primary/40 bg-primary/10 px-3 py-2">
            <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-primary">
              <Volume2 size={11} /> Spoken automatically
            </p>
            <p className="mt-0.5 text-lg font-bold leading-snug">{spoken.text}</p>
            {spoken.english !== spoken.text && (
              <p className="text-[11px] text-ink-dim">{spoken.english}</p>
            )}
          </div>
        )}

        <p className="mt-3 text-sm text-ink-dim">
          {result?.english
            || (started ? 'Hold a sign — it will be spoken automatically.' : 'Tap start to begin.')}
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
              className="pill shrink-0 border-subtle bg-card-high text-[10px] text-ink-dim"
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
            onClick={() => {
              clear(); setResult(null); setManualTags(null); resetStream(); setPhraseHit(null);
            }}
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-card-high"
          >
            <Eraser size={15} />
          </button>

          <button
            type="button"
            onClick={play}
            disabled={!result || speaking}
            className="ml-auto flex h-13 w-13 items-center justify-center rounded-full bg-gradient-to-br from-fill-a to-fill-b p-4 disabled:opacity-40"
          >
            {speaking
              ? <Loader2 size={20} className="animate-spin text-white" />
              : <Volume2 size={20} className="text-white" />}
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
