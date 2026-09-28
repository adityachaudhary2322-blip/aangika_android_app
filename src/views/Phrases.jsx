import { useEffect, useState } from 'react';
import {
  ArrowLeft, Plus, Trash2, Pencil, Video, Square, X, Loader2, Keyboard,
  ArrowRight, Volume2, Check,
} from 'lucide-react';
import CameraStage from '../components/CameraStage.jsx';
import LandmarkCanvas from '../components/LandmarkCanvas.jsx';
import useSignPipeline from '../hooks/useSignPipeline.js';
import useTokenStream from '../hooks/useTokenStream.js';
import cameraManager from '../services/cameraManager.js';
import { unlockAudio, speak } from '../services/ttsService.js';
import {
  listPhrases, savePhrase, deletePhrase, subscribe, takeDraft, normaliseToken,
  phraseText,
} from '../services/phrases.js';
import { getLanguage } from '../config/languages.js';

const human = (t) => String(t).replace(/_+/g, ' ').toLowerCase();

/**
 * Phrases: sign several words in a row, then say what the whole sequence
 * means. The translator watches for the sequence and speaks the meaning.
 *
 * Screens: list -> record (camera) -> edit (tokens + meaning) -> list.
 * The translator can also hand over a sequence it just saw ("Save as phrase"),
 * which opens straight on the edit screen.
 */
export default function Phrases({
  onBack, language, visionEngine, cameraError,
}) {
  const [phrases, setPhrases] = useState(() => listPhrases());
  const [screen, setScreen] = useState(() => {
    const draft = takeDraft();
    return draft ? { name: 'edit', draft: { tokens: draft, text_en: '' } } : { name: 'list' };
  });

  useEffect(() => subscribe(setPhrases), []);

  const back = () => (screen.name === 'list' ? onBack() : setScreen({ name: 'list' }));
  const title = { list: 'Phrases', record: 'Sign your phrase', edit: 'What does it mean?' }[screen.name];

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 px-5 pb-2 pt-4 lg:pt-6">
        <button
          type="button"
          onClick={back}
          aria-label="Back"
          className={'btn-icon ' + (screen.name === 'list' ? 'lg:hidden' : '')}
        >
          <ArrowLeft size={18} />
        </button>
        <h1 className="display text-2xl">{title}</h1>
      </header>

      {screen.name === 'list' && (
        <PhraseList
          phrases={phrases}
          language={language}
          onNew={() => setScreen({ name: 'record' })}
          onType={() => setScreen({ name: 'edit', draft: { tokens: [], text_en: '' } })}
          onEdit={(p) => setScreen({ name: 'edit', draft: { ...p } })}
        />
      )}
      {screen.name === 'record' && (
        <Recorder
          visionEngine={visionEngine}
          language={language}
          cameraError={cameraError}
          onDone={(tokens) => setScreen({ name: 'edit', draft: { tokens, text_en: '' } })}
        />
      )}
      {screen.name === 'edit' && (
        <Editor
          draft={screen.draft}
          language={language}
          onRecord={() => setScreen({ name: 'record' })}
          onSaved={() => setScreen({ name: 'list' })}
        />
      )}
    </div>
  );
}

// ── List ────────────────────────────────────────────────────────────────────

function PhraseList({ phrases, language, onNew, onType, onEdit }) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 no-scrollbar">
      <p className="max-w-prose text-sm text-ink-dim">
        Sign a few words in a row and give the whole sequence one meaning. When
        the translator sees that sequence, it says your sentence instead of
        the separate words.
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button type="button" onClick={onNew} className="btn-primary" data-tour="phrase-record">
          <Video size={16} /> Record signs
        </button>
        <button type="button" onClick={onType} className="btn-quiet" data-tour="phrase-type">
          <Keyboard size={16} /> Type signs
        </button>
      </div>

      {phrases.length === 0 ? (
        <div className="surface-card mt-6 p-6 text-center">
          <p className="display text-lg">No phrases yet</p>
          <p className="mx-auto mt-1 max-w-xs text-xs text-ink-dim">
            Try HELLO · NAME · your name, meaning “Hi, I’m …”. Handy for
            introductions you make every day.
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-2">
          {phrases.map((p) => (
            <li key={p.id} className="surface-card flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1">
                  {p.tokens.map((t, i) => (
                    <span key={i} className="flex items-center gap-1">
                      {i > 0 && <ArrowRight size={11} className="text-ink-dim" />}
                      <span className="rounded-md bg-card-high px-1.5 py-0.5 font-mono text-[11px] font-semibold">
                        {t}
                      </span>
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-base font-semibold leading-snug">“{p.text_en}”</p>
              </div>
              <button
                type="button"
                aria-label="Play"
                onClick={async () => speak(await phraseText(p, language), language)}
                className="btn-icon"
              >
                <Volume2 size={16} />
              </button>
              <button type="button" aria-label="Edit" onClick={() => onEdit(p)} className="btn-icon">
                <Pencil size={15} />
              </button>
              <button
                type="button"
                aria-label="Delete"
                onClick={() => deletePhrase(p.id)}
                className="btn-icon hover:text-rose"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-6 text-[11px] text-ink-dim">
        Recording uses {getLanguage(language).name} for playback. Meanings are
        translated once when online, then work offline.
      </p>
    </main>
  );
}

// ── Recorder ────────────────────────────────────────────────────────────────

function Recorder({ visionEngine, language, cameraError, onDone }) {
  const [recording, setRecording] = useState(false);
  const [started, setStarted] = useState(false);
  const mirrored = cameraManager.isFrontCamera();

  const { status, progress, words, frameRef, error } = useSignPipeline({
    enabled: started,
    mirrored,
    visionEngine,
    autoSpeak: false,
    language,
  });
  const { stream, reset, removeAt } = useTokenStream(words, { enabled: recording });

  const begin = async () => {
    await unlockAudio();
    await cameraManager.start().catch(() => {});
    setStarted(true);
    reset();
    setRecording(true);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 pb-5">
      <div className="relative min-h-[240px] flex-1 overflow-hidden rounded-3xl border border-subtle bg-surface-low">
        {started && <CameraStage className="absolute inset-0" />}
        {started && <LandmarkCanvas frameRef={frameRef} mirrored={mirrored} />}
        {!started && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
            <p className="display text-lg">Sign the whole phrase, in order</p>
            <p className="max-w-xs text-xs text-ink-dim">
              Pause briefly between signs. You can fix the sequence afterwards.
            </p>
          </div>
        )}
        {started && status === 'loading' && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-surface/80 text-sm">
            <Loader2 size={18} className="animate-spin text-primary" /> {progress || 'Loading model…'}
          </div>
        )}
        {recording && (
          <span className="pill chrome-plate absolute left-3 top-3 text-rose">
            <span className="h-2 w-2 animate-pulse rounded-full bg-rose" /> Recording
          </span>
        )}
      </div>

      <div className="surface-card p-4">
        <p className="eyebrow">Sequence so far</p>
        <div className="mt-2 flex min-h-[34px] flex-wrap gap-1.5">
          {stream.length === 0 && (
            <span className="text-xs text-ink-dim">
              {recording ? 'Watching for signs…' : 'Nothing recorded yet.'}
            </span>
          )}
          {stream.map((e, i) => (
            <button
              key={`${e.token}-${e.at}`}
              type="button"
              onClick={() => removeAt(i)}
              className="pill animate-fade-up border-primary/30 bg-primary/10 text-primary"
              title="Remove"
            >
              {human(e.token)} <X size={11} />
            </button>
          ))}
        </div>
        {(error || cameraError) && <p className="mt-2 text-xs text-rose">{cameraError || error}</p>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        {recording ? (
          <button type="button" onClick={() => setRecording(false)} className="btn-quiet">
            <Square size={15} /> Pause
          </button>
        ) : (
          <button type="button" onClick={started ? () => setRecording(true) : begin} className="btn-quiet">
            <Video size={15} /> {started ? 'Resume' : 'Start camera'}
          </button>
        )}
        <button
          type="button"
          disabled={stream.length < 2}
          onClick={() => onDone(stream.map((e) => e.token))}
          className="btn-primary"
        >
          Next <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

// ── Editor ──────────────────────────────────────────────────────────────────

function Editor({ draft, language, onRecord, onSaved }) {
  const [tokens, setTokens] = useState(draft.tokens || []);
  const [meaning, setMeaning] = useState(draft.text_en || '');
  const [local, setLocal] = useState(draft.texts?.[language] || '');
  const [word, setWord] = useState('');
  const [error, setError] = useState(null);
  const lang = getLanguage(language);

  const addWord = (e) => {
    e.preventDefault();
    const t = normaliseToken(word);
    if (!t) return;
    setTokens((list) => [...list, t]);
    setWord('');
  };

  const move = (i, d) => setTokens((list) => {
    const j = i + d;
    if (j < 0 || j >= list.length) return list;
    const next = [...list];
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });

  const save = () => {
    try {
      savePhrase({
        id: draft.id,
        tokens,
        text_en: meaning,
        texts: language !== 'en-IN' && local.trim() ? { [language]: local.trim() } : undefined,
      });
      onSaved();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 no-scrollbar">
      <section className="surface-card p-4">
        <div className="flex items-center">
          <p className="eyebrow">Signs, in order</p>
          <button type="button" onClick={onRecord} className="ml-auto text-xs font-semibold text-primary">
            Record again
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {tokens.length === 0 && <span className="text-xs text-ink-dim">Add at least two signs.</span>}
          {tokens.map((t, i) => (
            <span key={`${t}-${i}`} className="group inline-flex items-center gap-1 rounded-full border border-subtle bg-card-high py-1 pl-3 pr-1 text-sm font-medium">
              <button type="button" onClick={() => move(i, -1)} aria-label="Move earlier" className="text-ink-dim hover:text-ink">‹</button>
              {human(t)}
              <button type="button" onClick={() => move(i, 1)} aria-label="Move later" className="text-ink-dim hover:text-ink">›</button>
              <button
                type="button"
                onClick={() => setTokens((list) => list.filter((_, j) => j !== i))}
                aria-label={`Remove ${t}`}
                className="flex h-6 w-6 items-center justify-center rounded-full text-ink-dim hover:bg-card-highest hover:text-rose"
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
        <form onSubmit={addWord} className="mt-3 flex gap-2">
          <input
            value={word}
            onChange={(e) => setWord(e.target.value)}
            placeholder="Add a sign by name, e.g. water"
            autoCapitalize="off"
            className="field"
          />
          <button type="submit" disabled={!word.trim()} aria-label="Add sign" className="btn-icon h-auto w-12 shrink-0 rounded-2xl">
            <Plus size={16} />
          </button>
        </form>
      </section>

      <section className="surface-card mt-3 p-4">
        <label htmlFor="phrase-meaning" className="eyebrow">Meaning of the whole phrase (English)</label>
        <textarea
          id="phrase-meaning"
          value={meaning}
          onChange={(e) => { setMeaning(e.target.value); setError(null); }}
          rows={2}
          placeholder="Hi, I'm Aditya. Nice to meet you."
          className="field mt-2 resize-none"
        />
        {language !== 'en-IN' && (
          <>
            <label htmlFor="phrase-local" className="eyebrow mt-4 block">
              In {lang.name} <span className="normal-case tracking-normal text-ink-dim">(optional)</span>
            </label>
            <textarea
              id="phrase-local"
              value={local}
              onChange={(e) => setLocal(e.target.value)}
              rows={2}
              placeholder="Leave empty to translate automatically"
              className="field mt-2 resize-none"
            />
          </>
        )}
      </section>

      {error && (
        <p className="mt-3 rounded-2xl border border-rose/30 bg-rose/10 px-4 py-2.5 text-xs text-rose">{error}</p>
      )}

      <button type="button" onClick={save} className="btn-primary mt-4 w-full py-3.5">
        <Check size={16} /> Save phrase
      </button>
    </main>
  );
}
