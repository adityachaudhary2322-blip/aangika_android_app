import { useEffect, useState } from 'react';
import {
  BatteryMedium, Wifi, WifiOff, Hand, Mic, MessageSquare, CloudOff,
  ArrowLeft, Users, Database, Settings as SettingsIcon, Languages, FileVideo,
} from 'lucide-react';
import { LANGUAGES, getLanguage } from '../config/languages.js';
import { describeMode, MODE_OFFLINE } from '../services/translationService.js';
import { getKeys } from '../services/translator.js';
import { clockString } from '../lib/utils.js';
import ThemeToggle from '../components/ThemeToggle.jsx';

const TILES = [
  { id: 'sign', label: 'Sign Translator', hint: 'Camera → words', Icon: Hand, tint: 'text-primary' },
  { id: 'hearing', label: 'Hearing Mode', hint: 'Speech → text', Icon: Mic, tint: 'text-secondary' },
  { id: 'messenger', label: 'Messages', hint: 'Chat & call', Icon: MessageSquare, tint: 'text-amber' },
  { id: 'offline', label: 'Offline Engine', hint: 'Toggle pipeline', Icon: CloudOff, tint: 'text-amber' },
  { id: 'recorded', label: 'Recorded Video', hint: 'File to subtitles', Icon: FileVideo, tint: 'text-rose' },
  { id: 'group', label: 'Group Room', hint: 'Multi-party', Icon: Users, tint: 'text-secondary' },
  { id: 'models', label: 'Models & Data', hint: '21 MB tagger', Icon: Database, tint: 'text-primary' },
  { id: 'settings', label: 'Settings', hint: 'Keys & voice', Icon: SettingsIcon, tint: 'text-ink-dim' },
];

/** Tiles with no view behind them yet. Saying so beats a dead tap. */
const UNBUILT = new Set(['group', 'models']);

export default function Dashboard({
  language, setLanguage, online, onNavigate, mode, togglePipeline,
}) {
  const [clock, setClock] = useState(clockString());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [note, setNote] = useState(null);
  const [battery, setBattery] = useState(null);

  useEffect(() => {
    const id = setInterval(() => setClock(clockString()), 15000);
    return () => clearInterval(id);
  }, []);

  // Battery Status API is Chromium-only; the pill hides itself elsewhere
  // rather than inventing a number.
  useEffect(() => {
    let mounted = true;
    if (!navigator.getBattery) return undefined;
    navigator.getBattery().then((b) => {
      if (!mounted) return;
      const update = () => setBattery(Math.round(b.level * 100));
      update();
      b.addEventListener('levelchange', update);
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  const active = getLanguage(language);
  const badge = describeMode(mode, {
    online,
    hasKey: Boolean(getKeys().gemini),
  });
  const offlineSelected = mode === MODE_OFFLINE;

  const handleTile = (id) => {
    if (id === 'offline') {
      togglePipeline();
      return;
    }
    if (UNBUILT.has(id)) {
      setNote(`"${TILES.find((t) => t.id === id).label}" is not built yet.`);
      setTimeout(() => setNote(null), 2600);
      return;
    }
    onNavigate(id);
  };

  return (
    <div className="flex h-full flex-col">
      {/* ── Status bar ─────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 px-4 py-3 text-[11px] text-ink-dim">
        <button
          type="button"
          onClick={() => onNavigate('messenger')}
          aria-label="Back to messages"
          className="flex h-7 w-7 items-center justify-center rounded-full bg-card-high text-ink"
        >
          <ArrowLeft size={14} />
        </button>
        <span className="font-mono text-ink">{clock}</span>
        <span className="pill border-subtle">
          {online ? (
            <><Wifi size={12} className="text-primary" /> Online</>
          ) : (
            <><WifiOff size={12} className="text-amber" /> Offline</>
          )}
        </span>
        {battery !== null && (
          <span className="pill border-subtle">
            <BatteryMedium size={12} className="text-primary" /> {battery}%
          </span>
        )}
        <button
          type="button"
          onClick={togglePipeline}
          className={
            'ml-auto pill ' +
            (badge.tone === 'primary'
              ? 'border-primary/40 bg-primary/10 text-primary'
              : 'border-amber/40 bg-amber/10 text-amber')
          }
        >
          {badge.icon} {badge.short}
        </button>
        <button
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          className="pill border-secondary/40 bg-secondary/10 text-secondary"
        >
          <Languages size={12} /> {active.script}
        </button>
        <ThemeToggle compact />
      </header>

      {pickerOpen && (
        <div className="mx-4 mb-2 grid grid-cols-2 gap-1 rounded-xl border border-subtle bg-card-high p-2">
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => { setLanguage(l.code); setPickerOpen(false); }}
              className={
                'rounded-lg px-2 py-2 text-left text-xs ' +
                (l.code === language ? 'bg-primary/15 text-primary' : 'text-ink')
              }
            >
              <div className="font-medium">{l.script}</div>
              <div className="text-[10px] text-ink-dim">{l.name}</div>
            </button>
          ))}
        </div>
      )}

      {/* ── Title ──────────────────────────────────────────────────── */}
      <div className="px-4 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">ISL Connect</h1>
        <p className="text-xs text-ink-dim">
          Indian Sign Language, both directions.
        </p>
      </div>

      {/* ── Feature grid ───────────────────────────────────────────── */}
      <main className="flex-1 overflow-y-auto px-4 no-scrollbar">
        <div className="grid grid-cols-2 gap-3">
          {TILES.map(({ id, label, hint, Icon, tint }) => (
            <button
              key={id}
              type="button"
              onClick={() => handleTile(id)}
              className={
                'tile ' +
                (UNBUILT.has(id) ? 'opacity-55 ' : '') +
                (id === 'offline' && offlineSelected
                  ? 'border-amber/50 bg-amber/10'
                  : '')
              }
            >
              <Icon size={22} className={tint} />
              <span className="text-sm font-semibold leading-tight">{label}</span>
              <span className="text-[11px] text-ink-dim">
                {id === 'offline'
                  ? (offlineSelected ? 'ON · local rules' : 'OFF · using Gemini')
                  : hint}
              </span>
            </button>
          ))}
        </div>

        {note && (
          <p className="mt-3 rounded-lg border border-amber/30 bg-amber/10 px-3 py-2 text-xs text-amber">
            {note}
          </p>
        )}

        <p className="mt-4 surface-card rounded-xl p-3 text-[11px] leading-relaxed text-ink-dim">
          <span className="font-semibold text-ink">
            {badge.icon} {badge.label}
          </span>
          <br />
          {badge.detail}
        </p>

        <p className="mt-3 text-[11px] leading-relaxed text-ink-dim">
          The recogniser finds roughly one correct word per phrase out of about
          four. Trust the word list; treat the sentence as a guess.
        </p>
      </main>

      {/* ── Dual dock ──────────────────────────────────────────────── */}
      <footer className="flex items-center justify-center gap-6 px-4 py-4">
        <button
          type="button"
          onClick={() => onNavigate('hearing')}
          className="flex flex-col items-center gap-1"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-rose shadow-[0_0_24px_-4px_rgba(244,63,94,0.6)]">
            <Mic size={26} className="text-surface" />
          </span>
          <span className="text-[10px] font-semibold tracking-wide text-ink-dim">
            VOICE IN
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate('sign')}
          className="flex flex-col items-center gap-1"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-secondary shadow-glow-cyan">
            <Hand size={26} className="text-surface" />
          </span>
          <span className="text-[10px] font-semibold tracking-wide text-ink-dim">
            SIGN IN
          </span>
        </button>
      </footer>
    </div>
  );
}
