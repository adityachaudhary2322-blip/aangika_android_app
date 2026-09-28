import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Search, BookOpen, Sparkles, Volume2 } from 'lucide-react';
import { listSigns, subscribe } from '../services/customSigns.js';
import { speak } from '../services/ttsService.js';

/**
 * Every word the camera can recognise, searchable.
 *
 * The recogniser only ever outputs words from vocab.json plus the user's own
 * taught signs, so this is the honest answer to "will it understand me?".
 * Words are shown A–Z; tapping one reads it out, which doubles as a quick way
 * to say a single word to a hearing person.
 */
export default function WordList({ onBack, onNavigate }) {
  const [words, setWords] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState(() => listSigns());

  useEffect(() => subscribe(setCustom), []);

  useEffect(() => {
    let live = true;
    fetch('/models/vocab.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((v) => {
        if (!live) return;
        // Drop tokenisation debris ("th", single letters) that is not a word
        // anyone would sign on its own.
        const clean = (v.words || [])
          .filter((w) => /^[a-z][a-z'-]+$/i.test(w) && !['th', 'st', 'nd', 'rd'].includes(w))
          .sort((a, b) => a.localeCompare(b));
        setWords(clean);
      })
      .catch((err) => live && setError(err.message));
    return () => { live = false; };
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () => (words || []).filter((w) => !q || w.includes(q)),
    [words, q]
  );
  const customFiltered = custom.filter(
    (s) => !q || String(s.token).toLowerCase().includes(q)
  );

  // Group by first letter for scanning.
  const groups = useMemo(() => {
    const out = new Map();
    for (const w of filtered) {
      const k = w[0].toUpperCase();
      if (!out.has(k)) out.set(k, []);
      out.get(k).push(w);
    }
    return [...out.entries()];
  }, [filtered]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-2 px-5 pb-2 pt-4">
        <button type="button" onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full border border-subtle bg-card">
          <ArrowLeft size={18} />
        </button>
        <h1 className="text-lg font-extrabold tracking-tight">Word list</h1>
        {words && (
          <span className="pill ml-auto border-subtle bg-card text-ink-dim">
            {words.length + custom.length} signs
          </span>
        )}
      </header>

      <div className="px-5 pb-3">
        <div className="flex items-center gap-2 rounded-2xl border border-subtle bg-card px-4 py-2.5 shadow-card transition focus-within:border-primary">
          <Search size={15} className="text-ink-dim" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Can it recognise…"
            autoCapitalize="off"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <p className="mt-2 text-[11px] text-ink-dim">
          The camera only ever outputs these words. Tap one to hear it.
        </p>
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 no-scrollbar">
        {/* Taught signs first: they are the user's own. */}
        <section className="surface-card mb-4 p-4">
          <div className="flex items-center gap-2">
            <span className="icon-well h-8 w-8 rounded-xl bg-primary/10 text-primary">
              <Sparkles size={15} />
            </span>
            <h2 className="text-sm font-bold">My signs</h2>
            <button
              type="button"
              onClick={() => onNavigate('mysigns')}
              className="ml-auto text-xs font-semibold text-primary"
            >
              {custom.length ? 'Manage' : 'Teach one'}
            </button>
          </div>
          {customFiltered.length > 0 ? (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {customFiltered.map((s) => (
                <span key={s.id} className="pill border-primary/30 bg-primary/10 text-primary">
                  {s.token}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-2 text-xs text-ink-dim">
              {custom.length
                ? 'None of your signs match.'
                : 'Teach a handshape for a name or a phrase the model does not know.'}
            </p>
          )}
        </section>

        {error && (
          <p className="rounded-2xl border border-rose/30 bg-rose/10 px-4 py-3 text-xs text-rose">
            Could not load the vocabulary ({error}).
          </p>
        )}
        {!words && !error && (
          <p className="py-10 text-center text-sm text-ink-dim">Loading…</p>
        )}
        {words && filtered.length === 0 && (
          <div className="flex flex-col items-center py-10 text-center">
            <span className="icon-well h-14 w-14 rounded-3xl bg-card-high text-ink-dim">
              <BookOpen size={22} />
            </span>
            <p className="mt-3 text-sm font-semibold">“{query}” is not in the model</p>
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
                  key={w}
                  type="button"
                  onClick={() => speak(w, 'en-IN')}
                  className="group inline-flex items-center gap-1 rounded-full border border-subtle bg-card px-3 py-1.5 text-sm transition hover:border-primary/40 hover:text-primary"
                >
                  {w}
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
