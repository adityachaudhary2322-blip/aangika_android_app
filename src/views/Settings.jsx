import { useState } from 'react';
import { ArrowLeft, KeyRound, ShieldAlert, Cloud, CloudOff } from 'lucide-react';
import { getKeys, setKey } from '../services/translator.js';
import {
  describeMode, MODE_OFFLINE, MODE_ONLINE,
} from '../services/translationService.js';
import { LANGUAGES } from '../config/languages.js';

export default function Settings({
  language, setLanguage, onBack, online, mode, togglePipeline,
}) {
  const initial = getKeys();
  const [gemini, setGemini] = useState(initial.gemini);
  const [sarvam, setSarvam] = useState(initial.sarvam);
  const [saved, setSaved] = useState(false);
  const badge = describeMode(mode, { online, hasKey: Boolean(gemini) });

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
          Translation engine
        </p>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => mode !== MODE_ONLINE && togglePipeline()}
            className={
              'flex flex-col items-start gap-1 rounded-xl border p-3 text-left ' +
              (mode === MODE_ONLINE
                ? 'border-primary/50 bg-primary/10'
                : 'border-white/10')
            }
          >
            <Cloud size={18} className={mode === MODE_ONLINE ? 'text-primary' : 'text-ink-dim'} />
            <span className="text-sm font-semibold">Online</span>
            <span className="text-[10px] text-ink-dim">Gemini Flash</span>
          </button>

          <button
            type="button"
            onClick={() => mode !== MODE_OFFLINE && togglePipeline()}
            className={
              'flex flex-col items-start gap-1 rounded-xl border p-3 text-left ' +
              (mode === MODE_OFFLINE
                ? 'border-amber/50 bg-amber/10'
                : 'border-white/10')
            }
          >
            <CloudOff size={18} className={mode === MODE_OFFLINE ? 'text-amber' : 'text-ink-dim'} />
            <span className="text-sm font-semibold">Offline</span>
            <span className="text-[10px] text-ink-dim">Local ISL rules</span>
          </button>
        </div>

        <p className="mt-3 rounded-lg border border-white/10 bg-surface p-3 text-[11px] leading-relaxed">
          <span className="font-semibold text-ink">{badge.icon} {badge.label}</span>
          <br />
          <span className="text-ink-dim">{badge.detail}</span>
        </p>

        <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
          The offline engine runs the ISL grammar rules — pro-drop recovery,
          SOV→SVO reordering, tense from the time word, kinship possessives — as
          plain code in this tab. No model weights are downloaded and no request
          is made. It produces English only; other languages need the online
          engine.
        </p>
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
