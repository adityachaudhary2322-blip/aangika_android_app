import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search, BookOpen, Plus, Volume2 } from 'lucide-react';
import { listSigns, subscribe } from '../services/customSigns.js';
import { GESTURE_TOKENS } from '../config/gestureSentences.js';
import { speak } from '../services/ttsService.js';

/** "THANK_YOU" -> "thank you". */
const human = (token) => String(token).replace(/_+/g, ' ').trim().toLowerCase();

/**
 * Every sign Aangika knows, in one A–Z list.
 *
 * Sources, merged without labels so a taught sign reads like any other word:
 *   - the tagger's vocabulary (vocab.json `words`)
 *   - the built-in SignBridge handshapes
 *   - vocab.json `custom_signs` (greetings and names the grammar knows)
 *   - the user's own taught signs
 * Tapping a word reads it out, which doubles as a quick way to say a single
 * word to a hearing person.
 */
export default function WordList({ onBack, onNavigate }) {
  const [vocab, setVocab] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState(() => listSigns());

  useEffect(() => subscribe(setCustom), []);

  useEffect(() => {
    let live = true;
    fetch('/models/vocab.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((v) => live && setVocab(v))
      .catch((err) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  // One entry per spoken form; later sources never duplicate an earlier one.
  const all = useMemo(() => {
    if (!vocab) return null;
    const map = new Map();
    const add = (label, say = label) => {
      const key = label.toLowerCase();
      if (key && !map.has(key)) map.set(key, { label: key, say });
    };
    // Drop tokenisation debris ("th", single letters) nobody signs on its own.
    for (const w of vocab.words || []) {
      if (/^[a-z][a-z'-]+$/i.test(w) && !['th', 'st', 'nd', 'rd'].includes(w)) add(w);
    }
    for (const t of GESTURE_TOKENS) add(human(t));
    for (const e of vocab.custom_signs?.entries || []) add(human(e.token));
    for (const s of custom) add(human(s.token), s.output?.text_en || human(s.token));
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [vocab, custom]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (all || []).filter((w) => !q || w.label.includes(q)),
    [all, q]
  );

  const groups = useMemo(() => {
    const out = new Map();
    for (const w of filtered) {
      const k = w.label[0].toUpperCase();
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(w);
    }
    return [...out.entries()];
  }, [filtered]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 px-5 pb-2 pt-4 lg:pt-6">
        <button type="button" onClick={onBack} aria-label="Back" className="btn-icon lg:hidden">
          <ArrowLeft size={18} />
        </button>
        <h1 className="display text-2xl">Word list</h1>
        {all && (
          <span className="pill ml-auto border-subtle bg-card text-ink-dim">
            {all.length.toLocaleString()} signs
          </span>
        )}
      </header>

      <div className="px-5 pb-3">
        <div data-tour="word-search" className="flex items-center gap-2 rounded-2xl border border-subtle bg-card px-4 py-2.5 shadow-card transition focus-within:border-primary">
          <Search size={15} className="text-ink-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search a word"
            autoCapitalize="off"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <div className="mt-2 flex items-center gap-2 text-[11px] text-ink-dim">
          <span>Tap a word to hear it.</span>
          <button
            type="button"
            onClick={() => onNavigate('mysigns')}
            className="ml-auto inline-flex items-center gap-1 font-semibold text-primary"
          >
            <Plus size={12} /> Teach a sign
          </button>
        </div>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 no-scrollbar">
        {error && (
          <p className="rounded-2xl border border-rose/30 bg-rose/10 px-4 py-3 text-xs text-rose">
            Could not load the vocabulary ({error}).
          </p>
        )}
        {!all && !error && (
          <p className="py-10 text-center text-sm text-ink-dim">Loading…</p>
        )}
        {all && filtered.length === 0 && (
          <div className="flex flex-col items-center py-10 text-center">
            <span className="icon-well h-14 w-14 rounded-3xl bg-card-high text-ink-dim">
              <BookOpen size={22} />
            </span>
            <p className="mt-3 text-sm font-semibold">“{query}” is not known yet</p>
            <p className="mt-1 max-w-xs text-xs text-ink-dim">
              Fingerspell it in SignBridge mode, or teach it as your own sign.
            </p>
          </div>
        )}

        {groups.map(([letter, list]) => (
          <section key={letter} className="mb-4">
            <h3 className="eyebrow sticky top-0 z-10 bg-surface/90 py-1 backdrop-blur">{letter}</h3>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {list.map((w) => (
                <button
                  key={w.label}
                  type="button"
                  onClick={() => speak(w.say, 'en-IN')}
                  className="group inline-flex items-center gap-1 rounded-full border border-subtle bg-card px-3 py-1.5 text-sm transition hover:border-primary/40 hover:text-primary"
                >
                  {w.label}
                  <Volume2 size={11} className="opacity-0 transition group-hover:opacity-60" />
                </button>
              ))}
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
