import { useEffect, useRef, useState } from 'react';
import { Send, X } from 'lucide-react';
import { useTheme } from '../context/ThemeContext.jsx';
import { answer, topicById, CONTEXT, TOPICS } from '../config/guide.js';

const INTRO_KEY = 'isl.mascot.introduced';

/**
 * Mudra, the guide.
 *
 * A small character in the corner. Its eyes follow the pointer, it blinks and
 * bobs, waves when hovered, and giggles if poked a few times. Tapping it opens
 * the guide: a tip for the current screen, suggested questions, and a box to
 * ask anything. Answers come from config/guide.js, so they are instant, work
 * offline and can take the user straight to the right screen.
 *
 * `raised` lifts it above the phone tab bar. On a phone screen without the
 * tab bar it peeks in from the edge instead, so it never covers a button.
 */
export default function Mascot({ view, onNavigate, raised, hidden }) {
  const { mascotOn, setMascot, setPalette } = useTheme();
  const [open, setOpen] = useState(false);
  const [intro, setIntro] = useState(false);

  useEffect(() => {
    if (!mascotOn) return undefined;
    let seen = true;
    try { seen = localStorage.getItem(INTRO_KEY) === '1'; } catch { /* private mode */ }
    if (seen) return undefined;
    const id = setTimeout(() => setIntro(true), 1800);
    return () => clearTimeout(id);
  }, [mascotOn]);

  const dismissIntro = () => {
    setIntro(false);
    try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* private mode */ }
  };

  useEffect(() => { if (hidden) setOpen(false); }, [hidden]);

  if (!mascotOn || hidden) return null;

  const peek = !raised;
  const position = raised
    ? 'bottom-[5.75rem] right-4 lg:bottom-6 lg:right-6'
    : 'bottom-40 -right-5 lg:bottom-6 lg:right-6';

  return (
    <div className={'fixed z-40 ' + position}>
      {open && (
        <GuidePanel
          peek={peek}
          view={view}
          onClose={() => setOpen(false)}
          onNavigate={(v) => { setOpen(false); onNavigate(v); }}
          onPalette={setPalette}
          onHide={() => { setOpen(false); setMascot(false); }}
        />
      )}
      {intro && !open && (
        <div className={(peek ? 'right-9 ' : 'right-6 ') + 'animate-pop-in absolute bottom-full mb-2 w-52 rounded-2xl rounded-br-md border border-subtle bg-card px-3.5 py-2.5 text-xs shadow-card lg:right-2'}>
          <p className="font-semibold">Hi, I’m Mudra!</p>
          <p className="mt-0.5 text-ink-dim">Tap me any time you need a hand.</p>
          <button type="button" onClick={dismissIntro} className="mt-1.5 font-semibold text-primary">
            Got it
          </button>
        </div>
      )}
      <MascotButton
        peek={peek}
        onClick={() => { dismissIntro(); setOpen((v) => !v); }}
        open={open}
      />
    </div>
  );
}

// ── The character ───────────────────────────────────────────────────────────

function MascotButton({ onClick, open, peek }) {
  const ref = useRef(null);
  const [look, setLook] = useState({ x: 0, y: 0 });
  const [blink, setBlink] = useState(false);
  const [waving, setWaving] = useState(false);
  const [happy, setHappy] = useState(false);
  const pokes = useRef([]);

  // Eyes follow the pointer, up to two units inside the eye.
  useEffect(() => {
    const onMove = (e) => {
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / 200);
      setLook({ x: (dx / d) * 1.8 * k, y: (dy / d) * 1.6 * k });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Blink at uneven intervals, like something alive.
  useEffect(() => {
    let t;
    const loop = () => {
      t = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 140);
        loop();
      }, 2500 + Math.random() * 3500);
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  const press = () => {
    const now = Date.now();
    pokes.current = [...pokes.current.filter((t) => now - t < 1200), now];
    if (pokes.current.length >= 3) {
      setHappy(true);
      pokes.current = [];
      setTimeout(() => setHappy(false), 1600);
      return;             // a tickle, not a request for help
    }
    onClick();
  };

  const smiling = happy || open;

  return (
    <button
      ref={ref}
      type="button"
      onClick={press}
      onMouseEnter={() => { setWaving(true); setTimeout(() => setWaving(false), 1800); }}
      aria-label={open ? 'Close the guide' : 'Open the guide'}
      aria-expanded={open}
      className={
        'group relative block transition-transform duration-300 '
        + (peek ? '-rotate-12 hover:rotate-0 hover:-translate-x-4 lg:rotate-0 lg:hover:translate-x-0' : '')
      }
    >
      {happy && (
        <span className="animate-pop-in absolute -top-7 right-2 whitespace-nowrap rounded-full bg-card px-2 py-0.5 text-[10px] font-bold text-primary shadow-card">
          hehe, that tickles!
        </span>
      )}
      <svg
        viewBox="0 0 72 72"
        width="60"
        height="60"
        className={'drop-shadow-lg ' + (open ? '' : 'animate-bob')}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="mudra-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgb(var(--fill-a))" />
            <stop offset="1" stopColor="rgb(var(--fill-b))" />
          </linearGradient>
        </defs>
        {/* Waving hand */}
        <g className={waving ? 'animate-wave' : ''} style={{ transformBox: 'fill-box' }}>
          <ellipse cx="60" cy="30" rx="7" ry="8" fill="url(#mudra-body)" />
          <ellipse cx="57.5" cy="23" rx="1.8" ry="3.2" fill="url(#mudra-body)" />
          <ellipse cx="61" cy="22" rx="1.8" ry="3.4" fill="url(#mudra-body)" />
          <ellipse cx="64.5" cy="23.5" rx="1.8" ry="3" fill="url(#mudra-body)" />
        </g>
        {/* Body */}
        <path
          d="M36 10c14 0 24 10 24 24 0 15-9 28-24 28S12 49 12 34c0-14 10-24 24-24z"
          fill="url(#mudra-body)"
        />
        {/* Face plate */}
        <ellipse cx="36" cy="38" rx="17" ry="14" fill="white" opacity="0.14" />
        {/* Eyes */}
        {smiling ? (
          <g stroke="white" strokeWidth="2.4" strokeLinecap="round" fill="none">
            <path d="M25.5 35q3-3.5 6 0" />
            <path d="M40.5 35q3-3.5 6 0" />
          </g>
        ) : (
          <g>
            <ellipse cx="28.5" cy="34" rx="4.2" ry={blink ? 0.5 : 4.6} fill="white" />
            <ellipse cx="43.5" cy="34" rx="4.2" ry={blink ? 0.5 : 4.6} fill="white" />
            {!blink && (
              <>
                <circle cx={28.5 + look.x} cy={34.5 + look.y} r="2.2" fill="#1c1530" />
                <circle cx={43.5 + look.x} cy={34.5 + look.y} r="2.2" fill="#1c1530" />
                <circle cx={29.4 + look.x} cy={33.4 + look.y} r="0.7" fill="white" />
                <circle cx={44.4 + look.x} cy={33.4 + look.y} r="0.7" fill="white" />
              </>
            )}
          </g>
        )}
        {/* Cheeks */}
        <ellipse cx="22.5" cy="42" rx="3.4" ry="2" fill="#FDA4AF" opacity="0.7" />
        <ellipse cx="49.5" cy="42" rx="3.4" ry="2" fill="#FDA4AF" opacity="0.7" />
        {/* Mouth */}
        {smiling ? (
          <path d="M31.5 43q4.5 5.5 9 0z" fill="#1c1530" />
        ) : (
          <path d="M32.5 43.5q3.5 3 7 0" stroke="#1c1530" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        )}
      </svg>
    </button>
  );
}

// ── The guide panel ─────────────────────────────────────────────────────────

function GuidePanel({ peek, view, onClose, onNavigate, onPalette, onHide }) {
  const ctx = CONTEXT[view] || CONTEXT.dashboard;
  const [thread, setThread] = useState(() => [{ from: 'mudra', text: ctx.tip }]);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reply = (question, topic) => {
    const t = topic || answer(question);
    setThread((list) => [
      ...list,
      { from: 'me', text: question },
      t
        ? { from: 'mudra', text: t.answer, actions: t.actions }
        : {
          from: 'mudra',
          text: 'I’m not sure about that one. These are the things I know best:',
          actions: [],
          suggest: TOPICS.slice(0, 6).map((x) => x.id),
        },
    ]);
  };

  const ask = (e) => {
    e.preventDefault();
    const q = draft.trim();
    if (!q) return;
    setDraft('');
    reply(q);
  };

  const runAction = (a) => {
    if (a.go) onNavigate(a.go);
    else if (a.palette) {
      onPalette(a.palette);
      setThread((list) => [...list, { from: 'mudra', text: `Done! ${a.label} it is. 🌸` }]);
    } else if (a.hideMascot) onHide();
  };

  const suggestions = ctx.suggest.map(topicById).filter(Boolean);

  return (
    <div
      role="dialog"
      aria-label="Guide"
      className={(peek ? 'right-9 ' : 'right-4 ') + 'animate-pop-in absolute bottom-full mb-3 flex max-h-[min(32rem,70vh)] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-subtle bg-card shadow-card lg:right-0'}
    >
      <header className="flex items-center gap-2 border-b border-subtle px-4 py-3">
        <span className="display text-base">Mudra</span>
        <span className="text-[11px] text-ink-dim">your guide</span>
        <button type="button" onClick={onClose} aria-label="Close" className="btn-icon ml-auto h-8 w-8">
          <X size={15} />
        </button>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-2.5 overflow-y-auto px-4 py-3 no-scrollbar">
        {thread.map((m, i) => (
          <div key={i} className={m.from === 'me' ? 'flex justify-end' : ''}>
            <div
              className={
                'max-w-[88%] rounded-2xl px-3.5 py-2 text-[13px] leading-relaxed animate-fade-up '
                + (m.from === 'me'
                  ? 'rounded-br-md bg-gradient-to-br from-fill-a to-fill-b text-white'
                  : 'rounded-bl-md bg-card-high text-ink')
              }
            >
              {m.text}
            </div>
            {m.actions?.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {m.actions.map((a) => (
                  <button
                    key={a.label}
                    type="button"
                    onClick={() => runAction(a)}
                    className="pill border-primary/30 bg-primary/10 py-1 text-primary transition hover:bg-primary/15"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            )}
            {m.suggest && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {m.suggest.map(topicById).map((t) => (
                  <button key={t.id} type="button" onClick={() => reply(t.title, t)} className="pill border-subtle bg-card py-1 text-ink hover:border-strong">
                    {t.title}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        {thread.length === 1 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {suggestions.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => reply(t.title, t)}
                className="pill border-subtle bg-card py-1.5 text-ink transition hover:border-strong"
              >
                {t.title}
              </button>
            ))}
          </div>
        )}
      </div>

      <form onSubmit={ask} className="flex items-center gap-2 border-t border-subtle p-2.5">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask me anything…"
          aria-label="Ask the guide"
          className="min-w-0 flex-1 rounded-full bg-card-high px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          aria-label="Ask"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fill-a to-fill-b text-white transition active:scale-90 disabled:opacity-40"
        >
          <Send size={15} />
        </button>
      </form>
    </div>
  );
}
