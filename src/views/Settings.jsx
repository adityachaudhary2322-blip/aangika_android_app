import { useState } from 'react';
import { ArrowLeft, KeyRound, ShieldAlert, Check } from 'lucide-react';
import { getKeys, setKey } from '../services/translator.js';
import {
  VISION_ENGINES, GRAMMAR_ENGINES, VISION_AANGIKA, VISION_SIGNBRIDGE,
  GRAMMAR_QWEN_OFFLINE, GRAMMAR_GEMINI_ONLINE, GRAMMAR_RAW_GLOSS,
} from '../services/engineState.js';
import { LANGUAGES } from '../config/languages.js';

export default function Settings({
  language, setLanguage, onBack, online,
  visionEngine, chooseVision, grammarEngine, chooseGrammar,
}) {
  const initial = getKeys();
  const [gemini, setGemini] = useState(initial.gemini);
  const [sarvam, setSarvam] = useState(initial.sarvam);
  const [saved, setSaved] = useState(false);

  const save = () => {
    setKey('gemini', gemini);
    setKey('sarvam', sarvam);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 no-scrollbar">
      <header className="flex items-center gap-2 py-3">
        <button type="button" onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-full bg-card-high">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-bold">Settings</h1>
      </header>

      <section className="rounded-2xl border border-white/10 bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">
          Vision engine
        </p>
        <p className="mt-1 text-[11px] text-ink-dim">
          How landmarks become words.
        </p>
        <div className="mt-3 space-y-2">
          {[VISION_AANGIKA, VISION_SIGNBRIDGE].map((id) => (
            <EngineCard
              key={id}
              engine={VISION_ENGINES[id]}
              selected={visionEngine === id}
              onSelect={() => chooseVision(id)}
            />
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-ink-dim">
          SignBridge sees one frame at a time, so it recognises handshapes and
          fingerspelling but nothing defined by movement. Aangika reads a
          40-frame window and can, but costs ~200x the latency per inference.
        </p>
      </section>

      <section className="mt-4 rounded-2xl border border-white/10 bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">
          Grammar engine
        </p>
        <p className="mt-1 text-[11px] text-ink-dim">
          How words become a sentence.
        </p>
        <div className="mt-3 space-y-2">
          {[GRAMMAR_GEMINI_ONLINE, GRAMMAR_QWEN_OFFLINE, GRAMMAR_RAW_GLOSS].map((id) => (
            <EngineCard
              key={id}
              engine={GRAMMAR_ENGINES[id]}
              selected={grammarEngine === id}
              onSelect={() => chooseGrammar(id)}
            />
          ))}
        </div>
      </section>

      <section className="mt-4 rounded-2xl border border-white/10 bg-card p-4">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-dim">
          <KeyRound size={14} /> API keys
        </p>

        <label className="mt-3 block text-xs text-ink-dim">Gemini API key</label>
        <input
          type="password"
          value={gemini}
          onChange={(e) => setGemini(e.target.value)}
          placeholder="Sentence reconstruction + translation"
          className="mt-1 w-full rounded-lg border border-white/10 bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />

        <label className="mt-3 block text-xs text-ink-dim">Sarvam API key</label>
        <input
          type="password"
          value={sarvam}
          onChange={(e) => setSarvam(e.target.value)}
          placeholder="Speech in and out"
          className="mt-1 w-full rounded-lg border border-white/10 bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />

        <button
          type="button"
          onClick={save}
          className="mt-4 w-full rounded-xl bg-primary py-2.5 font-semibold text-surface"
        >
          {saved ? 'Saved' : 'Save keys'}
        </button>

        <p className="mt-3 flex gap-2 text-[11px] leading-relaxed text-amber">
          <ShieldAlert size={26} className="shrink-0" />
          <span>
            Keys are stored in this browser&apos;s localStorage and sent directly
            from the page to Gemini and Sarvam. Anyone with access to this device
            or its devtools can read them. That is acceptable for your own
            testing; for anything shared, put a backend in front of these calls.
          </span>
        </p>
      </section>

      <section className="mt-4 rounded-2xl border border-white/10 bg-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">
          Output language
        </p>
        <div className="mt-3 grid grid-cols-2 gap-2">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLanguage(l.code)}
              className={
                'rounded-lg border px-3 py-2 text-left ' +
                (l.code === language
                  ? 'border-primary/50 bg-primary/10 text-primary'
                  : 'border-white/10 text-ink')
              }
            >
              <div className="text-sm font-medium">{l.script}</div>
              <div className="text-[10px] text-ink-dim">{l.name} · {l.code}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="my-4 rounded-2xl border border-white/10 bg-card p-4 text-[11px] leading-relaxed text-ink-dim">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider">
          What to expect
        </p>
        <p>
          The recogniser scores 0.49 precision and 0.23 recall on 5,854 held-out
          clips: roughly one correct word and one wrong word per phrase, out of
          about four content words actually signed. It is real recognition —
          53× a frequency baseline — but it is not a reliable translator. Trust
          the word list; treat the sentence as a language model&apos;s guess.
        </p>
      </section>
    </div>
  );
}

/** One selectable engine, with the honest description from engineState. */
function EngineCard({ engine, selected, onSelect }) {
  const tone = {
    primary: 'border-primary/50 bg-primary/10',
    secondary: 'border-secondary/50 bg-secondary/10',
    amber: 'border-amber/50 bg-amber/10',
    ink: 'border-white/25 bg-white/5',
  }[engine.tone] || 'border-white/25 bg-white/5';

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        'w-full rounded-xl border p-3 text-left transition ' +
        (selected ? tone : 'border-white/10')
      }
    >
      <span className="flex items-center gap-2">
        <span className="text-base">{engine.icon}</span>
        <span className="text-sm font-semibold">{engine.name}</span>
        {selected && <Check size={14} className="ml-auto" />}
      </span>
      <span className="mt-0.5 block text-[11px] font-medium text-ink-dim">
        {engine.tagline}
      </span>
      <span className="mt-1.5 block text-[10px] leading-relaxed text-ink-dim">
        {engine.detail}
      </span>
    </button>
  );
}
