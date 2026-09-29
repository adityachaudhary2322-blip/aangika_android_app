import {
  useEffect, useMemo, useRef, useState,
} from 'react';
import {
  ArrowLeft, Volume2, Copy, Eraser, FlipHorizontal, Waypoints, Loader2, Play, Hand,
  BookmarkPlus, Languages as LanguagesIcon, X, Quote, Circle, Square, RotateCcw, Check,
} from 'lucide-react';
import CameraStage from '../components/CameraStage.jsx';
import LandmarkCanvas from '../components/LandmarkCanvas.jsx';
import LanguageSelect from '../components/LanguageSelect.jsx';
import EngineToggle from '../components/EngineToggle.jsx';
import EngineBadge from '../components/EngineBadge.jsx';
import useSignPipeline from '../hooks/useSignPipeline.js';
import useTokenStream, { tokenLabel } from '../hooks/useTokenStream.js';
import useSentenceBoundary from '../hooks/useSentenceBoundary.js';
import useGloveWords from '../hooks/useGloveWords.js';
import { fuseWords } from '../services/glove/recognizer.js';
import { listSigns } from '../services/customSigns.js';
import { VISION_SIGNBRIDGE } from '../services/engineState.js';

const AUTO_SENTENCE_KEY = 'isl.autoSentence';
const readAuto = () => {
  try { return localStorage.getItem(AUTO_SENTENCE_KEY) !== 'off'; } catch { return true; }
};
import { matchPhrase, phraseText, setDraft } from '../services/phrases.js';
import cameraManager from '../services/cameraManager.js';
import landmarker from '../services/landmarker.js';
import { getKeys } from '../services/translator.js';
import { speak, unlockAudio } from '../services/ttsService.js';
import { translate, describeMode } from '../services/translationService.js';
import { getLanguage } from '../config/languages.js';
import {
  getSigner, setSigner as saveSigner, getCapture, setCapture as saveCapture, facingFor,
} from '../services/signerPrefs.js';

/** A recording stops by itself after this long. */
const MAX_RECORD_MS = 60_000;

/** Point the shared camera at whoever signs (waits out any start in flight). */
const aimCamera = async (signer) => {
  await cameraManager.start().catch(() => {});
  return cameraManager.start({ facingMode: facingFor(signer) });
};

const clock = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

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

  // Who signs (front or back camera) and how: live, or record-then-translate.
  const [signer, setSignerState] = useState(() => getSigner() || 'me');
  const [capture, setCaptureState] = useState(() => getCapture());
  const live = capture === 'live';
  const chooseSigner = (v) => {
    setSignerState(saveSigner(v));
    if (started) aimCamera(v).catch(() => {});
  };
  // Record mode: idle -> recording -> translating -> done | empty.
  const [rec, setRec] = useState({ phase: 'idle', startedAt: 0 });
  const [elapsed, setElapsed] = useState(0);

  // Sentence mode: signs collect into a sentence that is sent and spoken when
  // the signer pauses (~1.2 s) or lowers their hands. When it is on, single
  // signs are not also spoken one by one.
  const [autoSentence, setAutoSentence] = useState(readAuto);
  const toggleAutoSentence = () => setAutoSentence((v) => {
    try { localStorage.setItem(AUTO_SENTENCE_KEY, v ? 'off' : 'on'); } catch { /* private mode */ }
    return !v;
  });

  // Fingerspelling: letters come from taught letter handshapes (My signs),
  // which the SignBridge engine matches. Spell mode switches to it and back.
  const [spellFrom, setSpellFrom] = useState(null);     // engine to return to
  const taughtLetters = listSigns().filter((s) => /^[A-Z]$/.test(s.token) && s.samples?.length).length;
  const toggleSpell = () => {
    if (spellFrom) { chooseVision(spellFrom); setSpellFrom(null); return; }
    setSpellFrom(visionEngine);
    chooseVision(VISION_SIGNBRIDGE);
  };

  const {
    status, progress, words: cameraWords, closest, stats, error, frameRef, clear, spoken,
    handsUp: cameraHandsUp,
  } = useSignPipeline({
    enabled: started,
    mirrored,
    visionEngine,
    autoSpeak: live && !autoSentence,   // per-sign speech: live mode, sentences off
    language,
    mode,
  });

  // ── Glove (optional): fused with the camera per token ──────────────────
  // Same token from both sources: combined confidence. When the camera loses
  // the hand, the glove's signs still reach the sentence.
  const { words: gloveWords, connected: gloveOn } = useGloveWords({ enabled: started });
  const words = useMemo(
    () => (gloveOn ? fuseWords(cameraWords, gloveWords) : cameraWords),
    [gloveOn, cameraWords, gloveWords],
  );
  // "Hands down" ends a sentence early, but a glove cannot tell a lowered hand
  // from the gap between two signs, so with a glove on only the pause counts.
  const handsUp = cameraHandsUp || gloveOn;

  // ── Continuous signing ────────────────────────────────────────────────
  // Every recognised sign joins a running sentence. A saved phrase that the
  // sentence completes is spoken as the user's own meaning.
  // In record mode only signs made while recording count.
  const recording = rec.phase === 'recording';
  const { stream, reset: resetStream, removeAt } = useTokenStream(words, {
    enabled: started && (live || recording),
  });
  const [phraseHit, setPhraseHit] = useState(null);
  const firedRef = useRef(0);
  useEffect(() => {
    if (!live) return;                  // record mode speaks once, after stopping
    const last = stream[stream.length - 1];
    if (!last || last.at === firedRef.current) return;
    const hit = matchPhrase(stream);
    if (!hit) return;
    firedRef.current = last.at;
    phraseText(hit, language).then((text) => {
      setPhraseHit({ phrase: hit, text });
      speak(text, language);
    });
  }, [stream, language, live]);

  const sentenceTokens = stream.map((e) => e.token);
  const translateSentence = () => {
    setManualTags(null);
    build(sentenceTokens);
  };

  // Automatic sentence boundary: pause or hands down -> sentence -> speech.
  useSentenceBoundary(stream, {
    enabled: started && live && autoSentence,
    handsUp,
    onSentence: async (tags) => {
      setManualTags(null);
      const r = await build(tags);
      const text = r?.translated || r?.english;
      if (text && text !== 'UNCLEAR') speak(text, language);
    },
  });
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
    saveSigner(signer);
    setStarted(true);
    aimCamera(signer).catch(() => {});
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
    return r;
  };

  // NAMASTE and ADITYA are not among the model's 1500 output channels, so the
  // greeting rules can only be reached through explicit entry.
  const runDemo = async (tags) => {
    setManualTags(tags);
    await build(tags);
    if (!live) setRec({ phase: 'done', tags });
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

  // ── Record, then translate (like Google Translate's conversation mic) ───
  const chooseCapture = (v) => {
    setCaptureState(saveCapture(v));
    setRec({ phase: 'idle', startedAt: 0 });
    resetStream();
    setPhraseHit(null);
  };

  const startRecording = async () => {
    await unlockAudio();
    clear(); resetStream(); setResult(null); setManualTags(null); setPhraseHit(null);
    setElapsed(0);
    setRec({ phase: 'recording', startedAt: Date.now() });
  };

  const stopRecording = async () => {
    const tags = stream.map((e) => e.token);
    if (!tags.length) { setRec({ phase: 'empty' }); return; }
    setRec({ phase: 'translating', tags });
    const r = await build(tags);
    setRec({ phase: 'done', tags });
    const text = r?.translated || r?.english;
    if (text && text !== 'UNCLEAR') {
      setSpeaking(true);
      await speak(text, language);
      setSpeaking(false);
    }
  };

  useEffect(() => {
    if (rec.phase !== 'recording') return undefined;
    const id = setInterval(() => setElapsed(Date.now() - rec.startedAt), 250);
    return () => clearInterval(id);
  }, [rec]);
  // Hard stop so a forgotten recording does not run on.
  const stopRef = useRef(stopRecording);
  stopRef.current = stopRecording;
  useEffect(() => {
    if (recording && elapsed >= MAX_RECORD_MS) stopRef.current();
  }, [recording, elapsed]);

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
            aria-label="Back"
            className="flex h-9 w-9 items-center justify-center rounded-full chrome-plate"
          >
            <ArrowLeft size={18} />
          </button>
          {/* Performance figures ride with the landmark overlay (a debug view). */}
          {showMesh && started && (
            <span className="pill chrome-plate hidden text-ink backdrop-blur sm:inline-flex">
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
          )}
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
              aria-pressed={showMesh}
              aria-label="Show hand tracking and speed"
              title="Show hand tracking and speed"
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
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-surface/90 px-6 py-16 text-center">
            <Choice
              label="Who is signing?"
              value={signer}
              onChange={chooseSigner}
              options={[
                { id: 'me', title: 'Me', detail: 'front camera' },
                { id: 'friend', title: 'Someone else', detail: 'back camera on them' },
              ]}
            />
            <Choice
              label="How should it translate?"
              value={capture}
              onChange={chooseCapture}
              options={[
                { id: 'live', title: 'Live', detail: 'speaks as they sign' },
                { id: 'record', title: 'Record', detail: 'sign, stop, then play' },
              ]}
            />
            <button
              type="button"
              onClick={startTranslating}
              aria-label="Start translating"
              className="mt-1 flex h-20 w-20 items-center justify-center rounded-full bg-gradient-to-br from-fill-a to-fill-b shadow-glow active:scale-95"
            >
              <Play size={32} className="ml-1 text-white" />
            </button>
            <p className="text-sm font-semibold">Start</p>
            <p className="max-w-xs text-[11px] leading-relaxed text-ink-dim">
              {signer === 'friend'
                ? 'Hold the phone so their hands and shoulders are in view, in good light.'
                : 'Keep both hands and your shoulders in view, in good light.'}
              {' '}
              {live
                ? 'Pause or lower your hands to finish a sentence; it is spoken aloud.'
                : 'Tap record, sign a sentence, tap stop to read and hear it.'}
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
                  The first run downloads the model; after that it works offline.
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
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Translation mode" className="flex rounded-full border border-subtle bg-card p-0.5">
            {[['live', 'Live'], ['record', 'Record']].map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={capture === id}
                onClick={() => chooseCapture(id)}
                disabled={recording}
                className={
                  'rounded-full px-3 py-1 text-[11px] font-semibold transition disabled:opacity-50 '
                  + (capture === id ? 'bg-primary text-surface' : 'text-ink-dim hover:text-ink')
                }
              >
                {label}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs font-semibold text-primary">
            {confidence.toFixed(0)}% sure
          </span>
        </div>

        <div className="mt-2 h-1 overflow-hidden rounded-full bg-card-highest">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${Math.min(confidence, 100)}%` }}
          />
        </div>

        {/* Record mode: record, stop, read and hear it. */}
        {started && !live && (
          <RecordPanel
            rec={rec}
            elapsed={elapsed}
            stream={stream}
            removeAt={removeAt}
            result={result}
            speaking={speaking}
            languageName={active.name}
            onRecord={startRecording}
            onStop={stopRecording}
            onPlay={play}
            onCopy={copy}
          />
        )}

        {/* Continuous signing: the sentence being built, sign by sign. */}
        {started && live && (
          <div className="mt-3 rounded-2xl border border-subtle bg-card/70 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow">Sentence so far</span>
              <button
                type="button"
                onClick={toggleAutoSentence}
                aria-pressed={autoSentence}
                title="Send and speak the sentence when you pause or lower your hands"
                className={'pill text-[10px] ' + (autoSentence ? 'border-primary/50 text-primary' : 'border-subtle text-ink-dim')}
              >
                Auto sentence {autoSentence ? 'on' : 'off'}
              </button>
              <button
                type="button"
                onClick={toggleSpell}
                aria-pressed={Boolean(spellFrom)}
                title="Fingerspell with the letters you taught in My signs"
                className={'pill text-[10px] ' + (spellFrom ? 'border-amber/60 text-amber' : 'border-subtle text-ink-dim')}
              >
                Spell {spellFrom ? 'on' : 'off'}
              </button>
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
            {spellFrom && taughtLetters === 0 && (
              <p className="mt-1 text-[11px] text-amber">
                No letters taught yet. In My signs, teach A-Z as one-letter Word signs; spelled letters then join into a name.
              </p>
            )}
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
                  {e.spelled && <span className="text-[9px] text-amber">spelled</span>}
                  {tokenLabel(e.token)} <X size={10} className="text-ink-dim" />
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

        {live && phraseHit && (
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
        {live && spoken && (
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

        {live && (
          <>
            <p className="mt-3 text-sm text-ink-dim">
              {result?.english
                || (started ? 'Sign a sentence, then pause: it will be spoken.' : 'Tap start to begin.')}
            </p>
            {result?.translated && (
              <p className="mt-1 text-2xl font-bold leading-snug">
                {result.translated}
              </p>
            )}
          </>
        )}

        <div className="mt-3 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <span
            className="shrink-0 text-[10px] uppercase tracking-wider text-ink-dim"
            title="Translate these typed signs without the camera"
          >
            Try (typed)
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

        {live && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => build()}
            disabled={!activeTags.length || busy}
            title="Translate the signs showing now"
            className="rounded-lg bg-card-highest px-3 py-2 text-xs font-semibold disabled:opacity-40"
          >
            {busy ? 'Translating…' : 'Translate now'}
          </button>
          <button
            type="button"
            onClick={copy}
            disabled={!result}
            aria-label="Copy translation"
            title="Copy translation"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-card-high disabled:opacity-40"
          >
            <Copy size={15} />
          </button>
          <button
            type="button"
            onClick={() => {
              clear(); setResult(null); setManualTags(null); resetStream(); setPhraseHit(null);
            }}
            aria-label="Clear everything"
            title="Clear everything"
            className="flex h-9 w-9 items-center justify-center rounded-lg bg-card-high"
          >
            <Eraser size={15} />
          </button>

          <button
            type="button"
            onClick={play}
            disabled={!result || speaking}
            aria-label="Play translation aloud"
            className="ml-auto flex h-13 w-13 items-center justify-center rounded-full bg-gradient-to-br from-fill-a to-fill-b p-4 disabled:opacity-40"
          >
            {speaking
              ? <Loader2 size={20} className="animate-spin text-white" />
              : <Volume2 size={20} className="text-white" />}
          </button>
        </div>
        )}

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

/** Two big choices side by side (start screen). */
function Choice({ label, value, onChange, options }) {
  return (
    <fieldset className="w-full max-w-sm">
      <legend className="mb-1.5 text-xs font-semibold text-ink-dim">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={value === o.id}
            className={
              'relative rounded-2xl border px-3 py-2.5 text-left transition '
              + (value === o.id ? 'border-primary/60 bg-primary/10' : 'border-subtle bg-card hover:border-strong')
            }
          >
            {value === o.id && <Check size={13} className="absolute right-2.5 top-2.5 text-primary" />}
            <span className="block text-sm font-semibold">{o.title}</span>
            <span className="block text-[11px] leading-snug text-ink-dim">{o.detail}</span>
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * Record mode, the Google Translate way: one big button to record, the signs
 * appear as they are recognised, stop gives a translation that is played
 * aloud once and can be replayed.
 */
function RecordPanel({
  rec, elapsed, stream, removeAt, result, speaking, languageName,
  onRecord, onStop, onPlay, onCopy,
}) {
  const { phase } = rec;
  const recording = phase === 'recording';
  const text = result?.translated || result?.english;
  const shown = recording ? stream.map((e) => e.token) : (rec.tags || []);

  return (
    <div className="mt-3 rounded-2xl border border-subtle bg-card/70 p-4" aria-live="polite">
      {/* Recognised signs: removable while recording, a record of the input after. */}
      <div className="flex min-h-[1.75rem] flex-wrap gap-1.5">
        {shown.length === 0 && (
          <span className="text-xs text-ink-dim">
            {recording ? 'Watching… sign your sentence.' : phase === 'idle' ? 'Tap record, then sign.' : ''}
          </span>
        )}
        {shown.map((t, i) => (recording ? (
          <button
            key={`${t}-${i}`}
            type="button"
            onClick={() => removeAt(i)}
            title="Remove this sign"
            className="pill animate-fade-up border-subtle bg-card-high text-ink"
          >
            {tokenLabel(t)} <X size={10} className="text-ink-dim" />
          </button>
        ) : (
          <span key={`${t}-${i}`} className="pill border-subtle bg-card-high text-ink-dim">{tokenLabel(t)}</span>
        )))}
      </div>

      {phase === 'translating' && (
        <p className="mt-3 flex items-center gap-2 text-sm text-ink-dim">
          <Loader2 size={16} className="animate-spin text-primary" /> Translating…
        </p>
      )}

      {phase === 'empty' && (
        <p className="mt-3 text-sm text-amber">
          No signs were recognised. Keep both hands and shoulders in view, sign a little slower, and try again.
        </p>
      )}

      {phase === 'done' && text && (
        <div className="mt-3 animate-fade-up">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-primary">{languageName}</p>
          <p className="mt-0.5 text-2xl font-bold leading-snug">{text === 'UNCLEAR' ? 'Not clear, please sign again.' : text}</p>
          {result?.translated && result?.english && result.english !== result.translated && (
            <p className="mt-1 text-xs text-ink-dim">{result.english}</p>
          )}
        </div>
      )}

      <div className="mt-4 flex items-center justify-center gap-4">
        {phase === 'done' && text && (
          <button
            type="button"
            onClick={onCopy}
            aria-label="Copy translation"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-card-high"
          >
            <Copy size={17} />
          </button>
        )}

        {recording ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop and translate"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-rose text-white shadow-glow active:scale-95"
          >
            <Square size={22} fill="currentColor" />
          </button>
        ) : (
          <button
            type="button"
            onClick={onRecord}
            disabled={phase === 'translating'}
            aria-label={phase === 'idle' ? 'Record signs' : 'Record again'}
            className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-fill-a to-fill-b text-white shadow-glow active:scale-95 disabled:opacity-40"
          >
            {phase === 'idle' ? <Circle size={24} fill="currentColor" /> : <RotateCcw size={22} />}
          </button>
        )}

        {phase === 'done' && text && (
          <button
            type="button"
            onClick={onPlay}
            disabled={speaking}
            aria-label="Play translation aloud"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-card-high disabled:opacity-50"
          >
            {speaking ? <Loader2 size={17} className="animate-spin" /> : <Volume2 size={17} />}
          </button>
        )}
      </div>
      <p className="mt-2 text-center text-[11px] text-ink-dim">
        {recording
          ? <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 animate-pulse rounded-full bg-rose" /> Recording {clock(elapsed)} · tap to stop</span>
          : phase === 'idle' ? 'Record'
            : phase === 'translating' ? '' : 'Record again'}
      </p>
    </div>
  );
}
