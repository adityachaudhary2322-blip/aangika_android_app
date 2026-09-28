import { useEffect, useState } from 'react';
import {
  Wifi, WifiOff, Hand, Mic, MessageCircle, CloudOff, Users, Languages,
  FileVideo, Sparkles, BookOpen, Quote, ArrowUpRight, ChevronDown, Check,
} from 'lucide-react';
import { LANGUAGES, getLanguage } from '../config/languages.js';
import { PALETTES } from '../config/themes.js';
import { describeMode, MODE_OFFLINE } from '../services/translationService.js';
import { getKeys } from '../services/translator.js';
import { listPhrases, subscribe as subscribePhrases } from '../services/phrases.js';
import { useCall } from '../context/CallContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import BrandMark from '../components/BrandMark.jsx';

/** Secondary tools, below the two primary actions. */
const TOOLS = [
  { id: 'phrases', label: 'Phrases', hint: 'Several signs, one sentence', Icon: Quote },
  { id: 'messenger', label: 'Messages', hint: 'Chat and video call', Icon: MessageCircle },
  { id: 'mysigns', label: 'My signs', hint: 'Teach your own', Icon: Sparkles },
  { id: 'words', label: 'Word list', hint: 'What it understands', Icon: BookOpen },
  { id: 'recorded', label: 'Recorded video', hint: 'File to subtitles', Icon: FileVideo },
  { id: 'offline', label: 'Offline engine', hint: 'Toggle pipeline', Icon: CloudOff },
  { id: 'group', label: 'Group room', hint: 'Multi-party', Icon: Users },
];

/** Tiles with no view behind them yet. Saying so beats a dead tap. */
const UNBUILT = new Set(['group']);

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

export default function Dashboard({
  language, setLanguage, online, onNavigate, mode, togglePipeline,
}) {
  const { profile } = useCall();
  const { palette, setPalette } = useTheme();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [note, setNote] = useState(null);
  const [phrases, setPhrases] = useState(() => listPhrases());

  useEffect(() => subscribePhrases(setPhrases), []);

  useEffect(() => {
    if (!note) return undefined;
    const id = setTimeout(() => setNote(null), 2600);
    return () => clearTimeout(id);
  }, [note]);

  const active = getLanguage(language);
  const badge = describeMode(mode, {
    online,
    hasKey: Boolean(getKeys().gemini),
  });
  const offlineSelected = mode === MODE_OFFLINE;
  const firstName = profile?.name?.split(/\s+/)[0];

  const handleTile = (id) => {
    if (id === 'offline') {
      togglePipeline();
      return;
    }
    if (UNBUILT.has(id)) {
      setNote(`${TOOLS.find((t) => t.id === id).label} is coming soon.`);
      return;
    }
    onNavigate(id);
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── Top bar (the desktop rail carries the brand) ───────────── */}
      <header className="flex items-center gap-2 px-5 pb-2 pt-4 lg:px-8 lg:pt-6">
        <span className="flex items-center gap-2 lg:hidden">
          <BrandMark size={32} />
          <span className="display text-lg">Aangika</span>
        </span>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={
              'pill ' + (online
                ? 'border-subtle bg-card text-ink-dim'
                : 'border-amber/30 bg-amber/10 text-amber')
            }
          >
            {online ? <Wifi size={12} className="text-secondary" /> : <WifiOff size={12} />}
            {online ? 'Online' : 'Offline'}
          </span>
          <span className="lg:hidden"><ThemeToggle /></span>
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-6 no-scrollbar lg:px-8">
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_18rem] lg:gap-8">
          <div>
            {/* ── Greeting ─────────────────────────────────────────── */}
            <section className="animate-fade-up pt-2 lg:pt-4">
              <p className="text-sm text-ink-dim">
                {greeting()}{firstName ? `, ${firstName}` : ''}.
              </p>
              <h1 className="display mt-1 text-[2rem] leading-[1.1] lg:text-[2.6rem]">
                Say it in sign.
                <br />
                <span className="text-ink-dim">Hear it in words.</span>
              </h1>
            </section>

            {/* ── Quick settings row ───────────────────────────────── */}
            <section className="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPickerOpen((v) => !v)}
                aria-expanded={pickerOpen}
                className="pill border-subtle bg-card py-1.5 text-ink transition hover:border-strong"
              >
                <Languages size={13} className="text-primary" />
                Speaking {active.name}
                <ChevronDown size={12} className={'transition ' + (pickerOpen ? 'rotate-180' : '')} />
              </button>
              <button
                type="button"
                onClick={togglePipeline}
                className={
                  'pill py-1.5 transition ' +
                  (badge.tone === 'primary'
                    ? 'border-subtle bg-card text-ink hover:border-strong'
                    : 'border-amber/30 bg-amber/10 text-amber')
                }
              >
                {badge.icon} {badge.short}
              </button>
            </section>

            {pickerOpen && (
              <div className="surface-card mt-3 grid animate-fade-up grid-cols-2 gap-1 p-2 sm:grid-cols-3">
                {LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => { setLanguage(l.code); setPickerOpen(false); }}
                    className={
                      'flex items-center gap-2 rounded-2xl px-3 py-2 text-left text-xs transition ' +
                      (l.code === language ? 'bg-primary/10 text-primary' : 'text-ink hover:bg-card-high')
                    }
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{l.script}</span>
                      <span className="block truncate text-[10px] text-ink-dim">{l.name}</span>
                    </span>
                    {l.code === language && <Check size={14} />}
                  </button>
                ))}
              </div>
            )}

            {/* ── Primary actions ──────────────────────────────────── */}
            <section className="mt-5 grid gap-3 sm:grid-cols-2">
              <HeroCard
                onClick={() => onNavigate('sign')}
                Icon={Hand}
                eyebrow="Camera"
                title="Sign to speech"
                detail="Sign in front of the camera and it is spoken aloud."
                fill="from-fill-a to-fill-b"
                delay="60ms"
              />
              <HeroCard
                onClick={() => onNavigate('hearing')}
                Icon={Mic}
                eyebrow="Microphone"
                title="Speech to text"
                detail="Live captions, with typed replies read aloud."
                fill="from-fill-c to-fill-d"
                delay="120ms"
              />
            </section>

            {/* ── Tools ────────────────────────────────────────────── */}
            <h2 className="eyebrow mt-8">Everything else</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {TOOLS.map(({ id, label, hint, Icon }) => {
                const soon = UNBUILT.has(id);
                const on = id === 'offline' && offlineSelected;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => handleTile(id)}
                    className={
                      'tile group relative ' +
                      (soon ? 'opacity-60 ' : '') +
                      (on ? '!border-primary/40 !bg-primary/5' : '')
                    }
                  >
                    <span className="icon-well bg-card-high text-primary transition group-hover:bg-primary/10">
                      <Icon size={18} />
                    </span>
                    <span className="mt-1 text-sm font-semibold leading-tight">{label}</span>
                    <span className="text-[11px] leading-snug text-ink-dim">
                      {id === 'offline'
                        ? (offlineSelected ? 'On · local rules' : `Off · using ${badge.short}`)
                        : hint}
                    </span>
                    {soon && (
                      <span className="absolute right-3 top-3 rounded-full border border-subtle px-2 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-ink-dim">
                        Soon
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {note && (
              <p className="mt-3 animate-fade-up rounded-2xl border border-amber/30 bg-amber/10 px-4 py-2.5 text-xs text-amber">
                {note}
              </p>
            )}
          </div>

          {/* ── Side column (below on phones) ────────────────────── */}
          <aside className="mt-8 space-y-4 lg:mt-4">
            <section className="surface-card p-4">
              <p className="eyebrow">Engine</p>
              <p className="mt-2 text-sm font-semibold">{badge.icon} {badge.label}</p>
              <p className="mt-1 text-xs leading-relaxed text-ink-dim">{badge.detail}</p>
              <p className="mt-3 border-t border-subtle pt-3 text-xs leading-relaxed text-ink-dim">
                The recogniser gets roughly one word in four right. Trust the
                word chips; treat the sentence as a guess.
              </p>
            </section>

            <section className="surface-card p-4">
              <div className="flex items-center">
                <p className="eyebrow">Your phrases</p>
                <button type="button" onClick={() => onNavigate('phrases')} className="ml-auto text-xs font-semibold text-primary">
                  {phrases.length ? 'All' : 'Create'}
                </button>
              </div>
              {phrases.length === 0 ? (
                <p className="mt-2 text-xs leading-relaxed text-ink-dim">
                  Sign a few words in a row and give them one meaning, like an
                  introduction you make every day.
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {phrases.slice(0, 3).map((p) => (
                    <li key={p.id} className="text-sm">
                      <p className="font-medium leading-snug">“{p.text_en}”</p>
                      <p className="font-mono text-[10px] text-ink-dim">{p.tokens.join(' · ')}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="surface-card p-4">
              <div className="flex items-center">
                <p className="eyebrow">Theme</p>
                <button type="button" onClick={() => onNavigate('settings')} className="ml-auto text-xs font-semibold text-primary">
                  More
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {PALETTES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setPalette(p.id)}
                    title={p.name}
                    aria-label={`${p.name} theme`}
                    aria-pressed={palette === p.id}
                    className={
                      'h-8 w-8 rounded-full ring-offset-2 ring-offset-card transition hover:scale-110 '
                      + (palette === p.id ? 'ring-2 ring-primary' : '')
                    }
                    style={{ background: `linear-gradient(135deg, ${p.swatch[0]} 50%, ${p.swatch[1]} 50%)` }}
                  />
                ))}
              </div>
            </section>
          </aside>
        </div>
      </main>
    </div>
  );
}

function HeroCard({ onClick, Icon, eyebrow, title, detail, fill, delay }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ animationDelay: delay }}
      className={
        'group relative flex min-h-[9.5rem] animate-fade-up flex-col justify-between overflow-hidden rounded-3xl '
        + 'bg-gradient-to-br p-5 text-left text-white shadow-card transition duration-300 '
        + 'hover:-translate-y-0.5 active:scale-[0.98] ' + fill
      }
    >
      {/* A large, faint glyph rather than decoration for its own sake. */}
      <Icon
        aria-hidden="true"
        strokeWidth={1.2}
        className="pointer-events-none absolute -bottom-6 -right-4 h-36 w-36 text-white/10 transition duration-500 group-hover:-rotate-6 group-hover:text-white/15"
      />
      <span className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/70">{eyebrow}</span>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15 transition group-hover:bg-white/25">
          <ArrowUpRight size={16} />
        </span>
      </span>
      <span className="relative mt-6 block">
        <span className="display block text-2xl text-white">{title}</span>
        <span className="mt-1 block max-w-[16rem] text-[13px] leading-snug text-white/80">{detail}</span>
      </span>
    </button>
  );
}
