import { useEffect, useState } from 'react';
import {
  KeyRound, ShieldAlert, Check, Sun, Moon, Wand2, Palette, Download, CloudOff, Loader2, Smartphone,
} from 'lucide-react';
import {
  subscribe as subscribePwa, canInstall, promptInstall, isStandalone, isIOS, offlineStatus, prepareOffline,
} from '../services/pwa.js';
import { getKeys, setKey } from '../services/translator.js';
import { getTurnCredentials, setTurnCredentials } from '../services/iceConfig.js';
import {
  GRAMMAR_ENGINES,
  GRAMMAR_QWEN_OFFLINE, GRAMMAR_GEMINI_ONLINE, GRAMMAR_RAW_GLOSS, GRAMMAR_SARVAM_ONLINE,
} from '../services/engineState.js';
import RecognitionSettings from '../components/RecognitionSettings.jsx';
import GloveSettings from '../components/GloveSettings.jsx';
import { LANGUAGES, VOICES, getVoice, setVoice } from '../config/languages.js';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { PALETTES, CUSTOM } from '../config/themes.js';

export default function Settings({
  language, setLanguage, onBack, online,
  visionEngine, chooseVision, grammarEngine, chooseGrammar, onNavigate,
}) {
  const initial = getKeys();
  const [gemini, setGemini] = useState(initial.gemini);
  const [sarvam, setSarvam] = useState(initial.sarvam);
  const [saved, setSaved] = useState(false);
  const initialTurn = getTurnCredentials();
  const [turnUser, setTurnUser] = useState(
    initialTurn.source === 'custom' ? initialTurn.username : ''
  );
  const [turnKey, setTurnKey] = useState(
    initialTurn.source === 'custom' ? initialTurn.credential : ''
  );

  const save = () => {
    setKey('gemini', gemini);
    setKey('sarvam', sarvam);
    setTurnCredentials(turnUser, turnKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 no-scrollbar">
      <header className="flex items-center gap-2 pb-3 pt-4 lg:pt-6">
        <h1 className="display text-3xl">Settings</h1>
        <div className="ml-auto lg:hidden">
          <ThemeToggle />
        </div>
      </header>

      <Appearance />

      <AppAndOffline />

      <RecognitionSettings visionEngine={visionEngine} chooseVision={chooseVision} />

      <GloveSettings />

      {onNavigate && (
        <section className="mt-4 surface-card p-4">
          <p className="eyebrow">Demo</p>
          <p className="mt-1 text-[11px] text-ink-dim">
            Live confidence per word, practice attempts that measure which signs
            the current model recognises reliably for you, and example sentences
            built only from those signs.
          </p>
          <button type="button" onClick={() => onNavigate('demo')} className="btn-quiet mt-3 w-full">
            Open demo mode
          </button>
        </section>
      )}

      {onNavigate && (
        <section className="mt-4 surface-card p-4">
          <p className="eyebrow">
            My signs
          </p>
          <p className="mt-1 text-[11px] text-ink-dim">
            Teach your own handshapes (words, names or whole sentences). They work
            at once in SignBridge mode, next to the 20 built-in signs.
          </p>
          <button
            type="button"
            onClick={() => onNavigate('mysigns')}
            className="btn-quiet mt-3 w-full"
          >
            Open My signs
          </button>
        </section>
      )}

      <section className="mt-4 surface-card p-4" data-tour="grammar">
        <p className="eyebrow">
          Grammar engine
        </p>
        <p className="mt-1 text-[11px] text-ink-dim">
          How words become a sentence.
        </p>
        <div className="mt-3 space-y-2">
          {[GRAMMAR_SARVAM_ONLINE, GRAMMAR_GEMINI_ONLINE, GRAMMAR_QWEN_OFFLINE, GRAMMAR_RAW_GLOSS].map((id) => (
            <EngineCard
              key={id}
              engine={GRAMMAR_ENGINES[id]}
              selected={grammarEngine === id}
              onSelect={() => chooseGrammar(id)}
            />
          ))}
        </div>
      </section>

      <section className="mt-4 surface-card p-4" data-tour="keys">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-ink-dim">
          <KeyRound size={14} /> API keys
        </p>

        <label className="mt-3 block text-xs text-ink-dim">Gemini API key</label>
        <input
          type="password"
          value={gemini}
          onChange={(e) => setGemini(e.target.value)}
          placeholder="Sentence reconstruction + translation"
          className="field mt-1"
        />

        <label className="mt-3 block text-xs text-ink-dim">Sarvam API key</label>
        <input
          type="password"
          value={sarvam}
          onChange={(e) => setSarvam(e.target.value)}
          placeholder="Sentences, translation, speech in and out"
          className="field mt-1"
        />
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-dim">
          One Sarvam key covers the Sarvam grammar engine, translation into all
          11 languages (Mayura), the voice (Bulbul) and speech-to-text (Saaras).
        </p>

        <p className="mt-4 text-xs text-ink-dim">Sarvam voice</p>
        <VoicePick />

        <button
          type="button"
          onClick={save}
          className="btn-primary mt-4 w-full"
        >
          {saved ? 'Saved' : 'Save keys'}
        </button>

        <label className="mt-3 block text-xs text-ink-dim">
          TURN username <span className="opacity-60">(video calling)</span>
        </label>
        <input
          value={turnUser}
          onChange={(e) => setTurnUser(e.target.value)}
          placeholder="Leave blank for the shared open relay"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="field mt-1"
        />

        <label className="mt-3 block text-xs text-ink-dim">TURN credential</label>
        <input
          type="password"
          value={turnKey}
          onChange={(e) => setTurnKey(e.target.value)}
          placeholder="Metered API key"
          className="field mt-1"
        />
        <p className="mt-1.5 text-[10px] leading-relaxed text-ink-dim">
          Without valid TURN credentials the relay silently fails to allocate
          and calls between two mobile-data connections will not connect. The
          shared open-relay defaults are rate-limited; the call lobby has a test
          button that reports whether a relay candidate was actually obtained.
        </p>

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

      <section className="mt-4 surface-card p-4">
        <p className="eyebrow">
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
                  : 'border-subtle text-ink')
              }
            >
              <div className="text-sm font-medium">{l.script}</div>
              <div className="text-[10px] text-ink-dim">{l.name} · {l.code}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="my-4 surface-card p-4 text-[11px] leading-relaxed text-ink-dim">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider">
          What to expect
        </p>
        <p>
          Measured the way this app runs it (live 40-frame windows) on 996 news
          clips the model never saw: 0.44 precision and 0.22 recall. That is
          about four correct words in every nine shown, and roughly one in five
          of the words actually signed. It is real recognition, but it is not a
          reliable translator. Trust the word list; treat the sentence as a
          language model&apos;s guess. Your own taught signs (My signs) are
          matched separately and are usually far more reliable for you.
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
    ink: 'border-strong bg-card-high',
  }[engine.tone] || 'border-strong bg-card-high';

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={
        'w-full rounded-xl border p-3 text-left transition ' +
        (selected ? tone : 'border-subtle')
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

const CUSTOM_PRESETS = ['#E11D48', '#0EA5E9', '#16A34A', '#F59E0B', '#8B5CF6', '#64748B'];

/** Mode, palette (including animated seasons), custom colour, mascot. */
function Appearance() {
  const {
    isDark, setTheme, palette, setPalette, customAccent, setCustomAccent,
    ambientOn, setAmbient, mascotOn, setMascot,
  } = useTheme();

  return (
    <section className="surface-card p-4" data-tour="appearance">
      <div className="flex items-center gap-2">
        <Palette size={15} className="text-primary" />
        <p className="eyebrow">Appearance</p>
      </div>

      {/* Mode */}
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-2xl bg-card-high p-1">
        {[
          { dark: false, label: 'Light', Icon: Sun },
          { dark: true, label: 'Dark', Icon: Moon },
        ].map(({ dark, label, Icon }) => (
          <button
            key={label}
            type="button"
            onClick={() => setTheme(dark ? 'dark' : 'light')}
            aria-pressed={isDark === dark}
            className={
              'flex items-center justify-center gap-2 rounded-xl py-2 text-sm font-semibold transition '
              + (isDark === dark ? 'bg-card text-ink shadow-card' : 'text-ink-dim hover:text-ink')
            }
          >
            <Icon size={15} /> {label}
          </button>
        ))}
      </div>

      {/* Palettes */}
      <p className="mt-5 text-sm font-semibold">Palette</p>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PALETTES.map((p) => {
          const on = palette === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPalette(p.id)}
              aria-pressed={on}
              className={
                'relative overflow-hidden rounded-2xl border p-2.5 text-left transition '
                + (on ? 'border-primary ring-2 ring-primary/20' : 'border-subtle hover:border-strong')
              }
            >
              <span
                className="block h-10 rounded-xl"
                style={{ background: `linear-gradient(135deg, ${p.swatch[0]}, ${p.swatch[1]})` }}
              />
              <span className="mt-2 flex items-center gap-1 text-xs font-semibold">
                {p.name}
                {on && <Check size={12} className="ml-auto text-primary" />}
              </span>
              {p.ambient && (
                <span className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-dim">
                  <Wand2 size={10} /> Animated
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Custom */}
      <p className="mt-5 text-sm font-semibold">Your own colour</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {CUSTOM_PRESETS.map((hex) => (
          <button
            key={hex}
            type="button"
            onClick={() => setCustomAccent(hex)}
            aria-label={`Use ${hex}`}
            className={
              'h-8 w-8 rounded-full ring-offset-2 ring-offset-card transition hover:scale-110 '
              + (palette === CUSTOM && customAccent.toLowerCase() === hex.toLowerCase() ? 'ring-2 ring-primary' : '')
            }
            style={{ background: hex }}
          />
        ))}
        <label
          className={
            'relative flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-semibold transition '
            + (palette === CUSTOM ? 'border-primary text-primary' : 'border-subtle text-ink-dim hover:border-strong')
          }
        >
          <span className="h-4 w-4 rounded-full border border-subtle" style={{ background: customAccent }} />
          Pick…
          <input
            type="color"
            value={customAccent}
            onChange={(e) => setCustomAccent(e.target.value)}
            className="absolute inset-0 cursor-pointer opacity-0"
            aria-label="Pick a custom colour"
          />
        </label>
      </div>
      <p className="mt-1.5 text-[11px] text-ink-dim">
        The shade is adjusted automatically so text stays readable in both modes.
      </p>

      {/* Switches */}
      <div className="mt-5 divide-y divide-subtle rounded-2xl border border-subtle">
        <Switch
          label="Seasonal animations"
          detail="Petals, leaves, snow or fireflies on animated palettes."
          on={ambientOn}
          onChange={setAmbient}
        />
        <Switch
          label="Mudra, the guide"
          detail="The little helper in the corner. Tap it and ask anything."
          on={mascotOn}
          onChange={setMascot}
        />
      </div>
    </section>
  );
}

function Switch({ label, detail, on, onChange }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 px-3.5 py-3">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-[11px] text-ink-dim">{detail}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={on}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className="relative h-6 w-11 shrink-0 rounded-full bg-card-highest transition peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40"
      >
        <span className={'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ' + (on ? 'left-[1.375rem]' : 'left-0.5')} />
      </span>
    </label>
  );
}

function VoicePick() {
  const [voice, pick] = useState(() => getVoice());
  return (
    <div className="mt-1.5 grid grid-cols-2 gap-1 rounded-2xl bg-card-high p-1">
      {VOICES.map((v) => (
        <button
          key={v.id}
          type="button"
          onClick={() => pick(setVoice(v.id))}
          aria-pressed={voice === v.id}
          className={
            'rounded-xl py-2 text-sm font-semibold transition '
            + (voice === v.id ? 'bg-card text-ink shadow-card' : 'text-ink-dim hover:text-ink')
          }
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}

/** Install state and offline preparation for the recognition models. */
function AppAndOffline() {
  const [pwa, setPwa] = useState({});
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [err, setErr] = useState(null);

  useEffect(() => subscribePwa(setPwa), []);
  useEffect(() => { offlineStatus().then(setStatus).catch(() => {}); }, []);

  const prepare = async () => {
    setBusy(true);
    setErr(null);
    try {
      setStatus(await prepareOffline(setProgress));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  const installed = isStandalone() || pwa.installed;
  const ready = status?.tagger && status?.landmarks;
  const mb = status ? (status.bytes / 1e6).toFixed(0) : 0;

  return (
    <section className="mt-4 surface-card p-4" data-tour="offline">
      <div className="flex items-center gap-2">
        <Smartphone size={15} className="text-primary" />
        <p className="eyebrow">App &amp; offline</p>
      </div>

      <div className="mt-3 flex items-center gap-3 rounded-2xl border border-subtle p-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{installed ? 'Installed' : 'Install Aangika'}</p>
          <p className="text-[11px] text-ink-dim">
            {installed
              ? 'Running as an app from your home screen.'
              : isIOS()
                ? 'In Safari: Share → Add to Home Screen.'
                : 'Full screen, from your home screen, works offline.'}
          </p>
        </div>
        {!installed && canInstall() && !isIOS() && (
          <button type="button" onClick={promptInstall} className="btn-primary px-3 py-2 text-xs">
            <Download size={14} /> Install
          </button>
        )}
        {installed && <Check size={18} className="text-secondary" />}
      </div>

      <div className="mt-2 flex items-center gap-3 rounded-2xl border border-subtle p-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">Sign recognition offline</p>
          <p className="text-[11px] text-ink-dim">
            {busy
              ? (progress || 'Downloading models…')
              : ready
                ? `Ready. ${mb} MB of models saved on this device.`
                : status?.supported === false
                  ? 'This browser cannot store files for offline use.'
                  : 'Downloads the models once (about 50 MB) so the camera works without internet.'}
          </p>
          {err && <p className="mt-1 text-[11px] text-rose">{err}</p>}
        </div>
        {ready ? (
          <CloudOff size={18} className="text-secondary" />
        ) : (
          <button type="button" onClick={prepare} disabled={busy || status?.supported === false} className="btn-quiet px-3 py-2 text-xs">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Prepare
          </button>
        )}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
        Offline, these keep working: sign recognition (once prepared), the
        offline grammar, phrases, My signs, the word list and your saved
        conversations. Speech-to-text, Sarvam and Gemini, voices and calls need
        a connection.
      </p>
    </section>
  );
}
