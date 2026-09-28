import { useEffect, useState } from 'react';
import {
  Wifi, WifiOff, Hand, Mic, MessageCircle, CloudOff, Users, Database,
  Languages, FileVideo, Sparkles, ArrowRight, ChevronDown, Check, Info,
} from 'lucide-react';
import { LANGUAGES, getLanguage } from '../config/languages.js';
import { describeMode, MODE_OFFLINE } from '../services/translationService.js';
import { getKeys } from '../services/translator.js';
import { useCall } from '../context/CallContext.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';

/** Secondary tools, below the two hero actions. */
const TOOLS = [
  { id: 'messenger', label: 'Messages', hint: 'Chat & video call', Icon: MessageCircle, tone: 'amber' },
  { id: 'recorded', label: 'Recorded video', hint: 'File to subtitles', Icon: FileVideo, tone: 'rose' },
  { id: 'mysigns', label: 'My signs', hint: 'Teach your own', Icon: Sparkles, tone: 'primary' },
  { id: 'offline', label: 'Offline engine', hint: 'Toggle pipeline', Icon: CloudOff, tone: 'secondary' },
  { id: 'group', label: 'Group room', hint: 'Multi-party', Icon: Users, tone: 'secondary' },
  { id: 'models', label: 'Models & data', hint: '21 MB tagger', Icon: Database, tone: 'primary' },
];

/** Tiles with no view behind them yet. Saying so beats a dead tap. */
const UNBUILT = new Set(['group', 'models']);

const WELL = {
  primary: 'bg-primary/10 text-primary',
  secondary: 'bg-secondary/10 text-secondary',
  amber: 'bg-amber/10 text-amber',
  rose: 'bg-rose/10 text-rose',
};

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
  const [pickerOpen, setPickerOpen] = useState(false);
  const [note, setNote] = useState(null);

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
      setNote(`"${TOOLS.find((t) => t.id === id).label}" is coming soon.`);
      return;
    }
    onNavigate(id);
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── Top bar ────────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 px-5 pb-2 pt-4">
        <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-secondary text-lg shadow-glow">
          <span aria-hidden="true">🤟</span>
        </span>
        <span className="text-base font-extrabold tracking-tight">Aangika</span>
        <div className="ml-auto flex items-center gap-2">
          <span
            className={
              'pill ' + (online
                ? 'border-secondary/30 bg-secondary/10 text-secondary'
                : 'border-amber/30 bg-amber/10 text-amber')
            }
          >
            {online ? <Wifi size={12} /> : <WifiOff size={12} />}
            {online ? 'Online' : 'Offline'}
          </span>
          <ThemeToggle />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 no-scrollbar">
        {/* ── Greeting ─────────────────────────────────────────────── */}
        <section className="animate-fade-up pt-3">
          <p className="text-sm text-ink-dim">
            {greeting()}{firstName ? `, ${firstName}` : ''} 👋
          </p>
          <h1 className="mt-1 text-[28px] font-extrabold leading-tight tracking-tight">
            Talk in{' '}
            <span className="bg-gradient-to-r from-primary to-secondary bg-clip-text text-transparent">
              Indian Sign Language
            </span>
            , both ways.
          </h1>
        </section>

        {/* ── Quick settings row ───────────────────────────────────── */}
        <section className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            aria-expanded={pickerOpen}
            className="pill border-subtle bg-card py-1.5 text-ink shadow-card"
          >
            <Languages size={13} className="text-secondary" />
            {active.name}
            <ChevronDown
              size={12}
              className={'transition ' + (pickerOpen ? 'rotate-180' : '')}
            />
          </button>
          <button
            type="button"
            onClick={togglePipeline}
            className={
              'pill py-1.5 shadow-card ' +
              (badge.tone === 'primary'
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-amber/30 bg-amber/10 text-amber')
            }
          >
            {badge.icon} {badge.short}
          </button>
        </section>

        {pickerOpen && (
          <div className="surface-card mt-3 grid animate-fade-up grid-cols-2 gap-1 p-2">
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

        {/* ── Hero actions ─────────────────────────────────────────── */}
        <section className="mt-5 grid gap-3">
          <HeroCard
            onClick={() => onNavigate('sign')}
            Icon={Hand}
            title="Sign to speech"
            detail="Point the camera at a signer and hear it in words."
            gradient="from-[rgb(124_58_237)] to-[rgb(67_56_202)]"
            delay="60ms"
          />
          <HeroCard
            onClick={() => onNavigate('hearing')}
            Icon={Mic}
            title="Speech to text"
            detail="Live captions for anything said out loud."
            gradient="from-[rgb(13_148_136)] to-[rgb(14_116_144)]"
            delay="120ms"
          />
        </section>

        {/* ── Tools ────────────────────────────────────────────────── */}
        <h2 className="eyebrow mt-7">More tools</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {TOOLS.map(({ id, label, hint, Icon, tone }) => {
            const soon = UNBUILT.has(id);
            const on = id === 'offline' && offlineSelected;
            return (
              <button
                key={id}
                type="button"
                onClick={() => handleTile(id)}
                className={
                  'tile relative ' +
                  (soon ? 'opacity-60 ' : '') +
                  (on ? '!border-secondary/50 !bg-secondary/10' : '')
                }
              >
                <span className={'icon-well ' + WELL[tone]}>
                  <Icon size={19} />
                </span>
                <span className="mt-1 text-sm font-bold leading-tight">{label}</span>
                <span className="text-[11px] text-ink-dim">
                  {id === 'offline'
                    ? (offlineSelected ? 'On · local rules' : 'Off · using Gemini')
                    : hint}
                </span>
                {soon && (
                  <span className="absolute right-3 top-3 rounded-full bg-card-highest px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-ink-dim">
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

        {/* ── Engine status ────────────────────────────────────────── */}
        <div className="surface-card mt-5 flex gap-3 p-4">
          <span className="icon-well bg-card-high text-ink-dim">
            <Info size={18} />
          </span>
          <p className="text-[12px] leading-relaxed text-ink-dim">
            <span className="block font-semibold text-ink">
              {badge.icon} {badge.label}
            </span>
            {badge.detail}
            <span className="mt-2 block">
              The recogniser gets roughly one word in four right. Trust the
              word list; treat the sentence as a guess.
            </span>
          </p>
        </div>
      </main>
    </div>
  );
}

function HeroCard({ onClick, Icon, title, detail, gradient, delay }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ animationDelay: delay }}
      className={
        'group relative flex animate-fade-up items-center gap-4 overflow-hidden rounded-3xl '
        + 'bg-gradient-to-br p-5 text-left text-white shadow-card transition '
        + 'active:scale-[0.98] ' + gradient
      }
    >
      {/* Decorative rings */}
      <span aria-hidden="true" className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full border-[18px] border-white/10" />
      <span aria-hidden="true" className="pointer-events-none absolute -bottom-10 right-10 h-24 w-24 rounded-full bg-white/10 blur-xl" />

      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/20 backdrop-blur">
        <Icon size={26} />
      </span>
      <span className="relative min-w-0 flex-1">
        <span className="block text-lg font-extrabold leading-tight">{title}</span>
        <span className="mt-0.5 block text-xs text-white/85">{detail}</span>
      </span>
      <ArrowRight
        size={20}
        className="relative shrink-0 transition group-hover:translate-x-1"
      />
    </button>
  );
}
