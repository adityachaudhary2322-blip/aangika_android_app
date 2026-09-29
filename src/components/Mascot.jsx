import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, X, ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import { useTheme } from '../context/ThemeContext.jsx';
import {
  answer, topicById, CONTEXT, TOPICS, TOURS, TIPS, guideFacts,
} from '../config/guide.js';
import { sarvamChat, hasSarvam, isOnline } from '../services/translator.js';

const INTRO_KEY = 'isl.mascot.introduced';
const SIZE = 60;

const reducedMotion = () =>
  typeof window !== 'undefined'
  && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** The first element for a tour target that is actually on screen. */
function findTarget(id) {
  for (const el of document.querySelectorAll(`[data-tour="${id}"]`)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && el.offsetParent !== null) return el;
  }
  return null;
}

/**
 * Mudra, the guide.
 *
 * Lives in a corner; its eyes follow the pointer, it blinks, bobs, waves and
 * giggles if poked. It also MOVES: it runs (feet and all) to each feature
 * during a tour, spotlighting it and explaining it in a speech bubble, and
 * every so often it jogs across the screen to drop a tip. Tapping it opens
 * the guide: a tip for the screen, suggested questions, a free-text box
 * (answered locally, or by Sarvam when a key is set and nothing local fits),
 * and "Show me around".
 *
 * `raised` lifts it above the phone tab bar; on a phone screen without the tab
 * bar it peeks in from the edge so it never covers a button.
 */
export default function Mascot({ view, onNavigate, raised, hidden }) {
  const { mascotOn, setMascot, setPalette } = useTheme();
  const [open, setOpen] = useState(false);
  const [intro, setIntro] = useState(false);
  const peek = !raised;

  // ── Position ──────────────────────────────────────────────────────────
  const homeFor = useCallback(() => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (W >= 1024) return { x: W - 24 - SIZE, y: H - 24 - SIZE };
    if (raised) return { x: W - 16 - SIZE, y: H - 92 - SIZE };
    return { x: W - SIZE + 20, y: H - 160 - SIZE };
  }, [raised]);

  const [pos, setPos] = useState(() => homeFor());
  const [facing, setFacing] = useState(-1);          // -1 looks left (home default)
  const [run, setRun] = useState({ on: false, ms: 0 });
  const [mode, setMode] = useState('home');          // home | tour | wander
  const posRef = useRef(pos);
  posRef.current = pos;

  useEffect(() => {
    if (mode !== 'home') return undefined;
    const place = () => setPos(homeFor());
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [homeFor, mode]);

  /** Run to (x, y). Resolves on arrival. */
  const runTo = useCallback(async (x, y) => {
    const from = posRef.current;
    const dist = Math.hypot(x - from.x, y - from.y);
    if (dist < 4) return;
    const ms = reducedMotion() ? 0 : Math.max(450, Math.min(1400, dist * 1.6));
    if (Math.abs(x - from.x) > 4) setFacing(x > from.x ? 1 : -1);
    setRun({ on: true, ms });
    setPos({ x, y });
    await sleep(ms + 30);
    setRun({ on: false, ms: 0 });
  }, []);

  const goHome = useCallback(async () => {
    const h = homeFor();
    await runTo(h.x, h.y);
    setFacing(-1);
    setMode('home');
  }, [homeFor, runTo]);

  // ── Intro bubble, once ────────────────────────────────────────────────
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

  // ── Tour ──────────────────────────────────────────────────────────────
  const [tour, setTour] = useState(null);   // { steps, i, rect }
  const tourToken = useRef(0);

  const showStep = useCallback(async (steps, i) => {
    const token = ++tourToken.current;
    const step = steps[i];
    const el = step.target ? findTarget(step.target) : null;
    let rect = null;
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
      await sleep(380);
      if (token !== tourToken.current) return;
      rect = el.getBoundingClientRect();
      const W = window.innerWidth;
      const H = window.innerHeight;
      let x = rect.right + 6;
      if (x + SIZE > W - 6) x = rect.left - SIZE - 6;
      if (x < 6) x = Math.min(W - SIZE - 6, Math.max(6, rect.right - SIZE - 6));
      const y = Math.min(H - SIZE - 6, Math.max(6, rect.top + rect.height / 2 - SIZE / 2));
      setTour({ steps, i, rect: null });
      await runTo(x, y);
      if (token !== tourToken.current) return;
      rect = el.getBoundingClientRect();
    } else {
      setTour({ steps, i, rect: null });
      const W = window.innerWidth;
      const H = window.innerHeight;
      await runTo(W / 2 - SIZE / 2, H / 2 - SIZE / 2);
      if (token !== tourToken.current) return;
    }
    setTour({ steps, i, rect });
  }, [runTo]);

  const startTour = useCallback(() => {
    const steps = (TOURS[view] || TOURS.dashboard)
      .filter((s) => !s.target || findTarget(s.target));
    if (!steps.length) return;
    setOpen(false);
    dismissIntro();
    setMode('tour');
    showStep(steps, 0);
  }, [view, showStep]);

  const endTour = useCallback(() => {
    tourToken.current += 1;
    setTour(null);
    goHome();
  }, [goHome]);

  // A new screen ends any tour in progress.
  useEffect(() => { if (tour) endTour(); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Wandering tips ────────────────────────────────────────────────────
  const [tip, setTip] = useState(null);
  const busyRef = useRef(false);
  busyRef.current = open || intro || mode !== 'home' || Boolean(tour);

  useEffect(() => {
    if (!mascotOn || hidden || peek || reducedMotion()) return undefined;
    let timer;
    let cancelled = false;
    const schedule = () => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        if (busyRef.current || document.visibilityState !== 'visible') { schedule(); return; }
        setMode('wander');
        const H = homeFor();
        const W = window.innerWidth;
        const x = Math.max(12, Math.min(W - SIZE - 12, W * (0.15 + Math.random() * 0.4)));
        await runTo(x, H.y);
        if (cancelled) return;
        setTip(TIPS[Math.floor(Math.random() * TIPS.length)]);
        await sleep(5200);
        if (cancelled) return;
        setTip(null);
        await goHome();
        schedule();
      }, 45000 + Math.random() * 45000);
    };
    schedule();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [mascotOn, hidden, peek, homeFor, runTo, goHome]);

  useEffect(() => {
    if (hidden) { setOpen(false); if (tour) endTour(); }
  }, [hidden]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!mascotOn || hidden) return null;

  const atHome = mode === 'home';
  const W = typeof window !== 'undefined' ? window.innerWidth : 400;

  return (
    <>
      {/* Spotlight on the feature being explained. */}
      {tour?.rect && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-40 rounded-3xl ring-2 ring-primary transition-all duration-300"
          style={{
            left: tour.rect.left - 6,
            top: tour.rect.top - 6,
            width: tour.rect.width + 12,
            height: tour.rect.height + 12,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.35)',
          }}
        />
      )}

      <div
        className="fixed z-50"
        style={{
          left: pos.x,
          top: pos.y,
          width: SIZE,
          height: SIZE,
          transition: run.ms ? `left ${run.ms}ms ease-in-out, top ${run.ms}ms ease-in-out` : 'none',
        }}
      >
        {atHome && open && (
          <GuidePanel
            peek={peek && W < 1024}
            view={view}
            onClose={() => setOpen(false)}
            onNavigate={(v) => { setOpen(false); onNavigate(v); }}
            onPalette={setPalette}
            onHide={() => { setOpen(false); setMascot(false); }}
            onTour={startTour}
          />
        )}
        {atHome && intro && !open && (
          <div className={(peek && W < 1024 ? 'right-9 ' : 'right-6 ') + 'float-pane animate-pop-in absolute bottom-full mb-2 w-56 rounded-2xl rounded-br-md border border-subtle bg-card px-3.5 py-2.5 text-xs shadow-card lg:right-2'}>
            <p className="font-semibold">Hi, I’m Mudra!</p>
            <p className="mt-0.5 text-ink-dim">Want me to show you around?</p>
            <div className="mt-2 flex gap-3">
              <button type="button" onClick={startTour} className="font-semibold text-primary">
                Show me around
              </button>
              <button type="button" onClick={dismissIntro} className="text-ink-dim">
                Later
              </button>
            </div>
          </div>
        )}
        {tip && (
          <div className="float-pane animate-pop-in absolute bottom-full left-1/2 mb-2 w-56 -translate-x-1/2 rounded-2xl border border-subtle bg-card px-3.5 py-2.5 text-xs shadow-card">
            <p className="flex items-center gap-1 font-semibold text-primary"><Sparkles size={12} /> Tip</p>
            <p className="mt-0.5 leading-relaxed">{tip.text}</p>
            {tip.go && (
              <button
                type="button"
                onClick={() => { setTip(null); onNavigate(tip.go); goHome(); }}
                className="mt-1.5 font-semibold text-primary"
              >
                Show me
              </button>
            )}
          </div>
        )}
        <MascotSprite
          peek={peek && atHome}
          open={open}
          running={run.on}
          facing={facing}
          onClick={() => {
            if (tour) return;
            if (mode === 'wander') { setTip(null); goHome().then(() => setOpen(true)); return; }
            dismissIntro();
            setOpen((v) => !v);
          }}
        />
      </div>

      {tour && !run.on && (
        <TourBubble
          tour={tour}
          mascot={pos}
          onBack={() => showStep(tour.steps, tour.i - 1)}
          onNext={() => (tour.i + 1 < tour.steps.length ? showStep(tour.steps, tour.i + 1) : endTour())}
          onClose={endTour}
          onGo={(v) => { endTour(); onNavigate(v); }}
        />
      )}
    </>
  );
}

// ── Tour bubble ─────────────────────────────────────────────────────────────

function TourBubble({ tour, mascot, onBack, onNext, onClose, onGo }) {
  const step = tour.steps[tour.i];
  const last = tour.i === tour.steps.length - 1;
  const W = window.innerWidth;
  const H = window.innerHeight;
  const width = Math.min(300, W - 24);
  const left = Math.max(12, Math.min(W - width - 12, mascot.x + SIZE / 2 - width / 2));
  const above = mascot.y > H / 2;
  const style = above
    ? { left, width, bottom: H - mascot.y + 8 }
    : { left, width, top: mascot.y + SIZE + 8 };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') onNext();
      if (e.key === 'ArrowLeft' && tour.i > 0) onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, onNext, onBack, tour.i]);

  return (
    <div
      role="dialog"
      aria-label="Tour"
      className="float-pane animate-pop-in fixed z-50 rounded-3xl border border-subtle bg-card p-4 shadow-card"
      style={style}
    >
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-dim">
          {tour.i + 1} of {tour.steps.length}
        </span>
        <button type="button" onClick={onClose} aria-label="End tour" className="btn-icon ml-auto h-7 w-7">
          <X size={13} />
        </button>
      </div>
      <p className="display mt-1 text-lg leading-tight">{step.title}</p>
      <p className="mt-1 text-[13px] leading-relaxed text-ink-dim">{step.text}</p>
      <div className="mt-3 flex items-center gap-2">
        {tour.i > 0 && (
          <button type="button" onClick={onBack} className="btn-quiet px-3 py-2 text-xs">
            <ArrowLeft size={13} /> Back
          </button>
        )}
        {step.go && (
          <button type="button" onClick={() => onGo(step.go)} className="text-xs font-semibold text-primary">
            Try it
          </button>
        )}
        <button type="button" onClick={onNext} className="btn-primary ml-auto px-4 py-2 text-xs">
          {last ? 'Done' : <>Next <ArrowRight size={13} /></>}
        </button>
      </div>
    </div>
  );
}

// ── The character ───────────────────────────────────────────────────────────

function MascotSprite({ onClick, open, peek, running, facing }) {
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
  // While running it looks where it is going; the art is drawn facing left.
  const eye = running ? { x: -1.6, y: 0 } : { x: look.x * -facing, y: look.y };

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
        <span className="float-pane animate-pop-in absolute -top-7 right-2 whitespace-nowrap rounded-full bg-card px-2 py-0.5 text-[10px] font-bold text-primary shadow-card">
          hehe, that tickles!
        </span>
      )}
      <svg
        viewBox="0 0 72 72"
        width={SIZE}
        height={SIZE}
        className={'drop-shadow-lg ' + (running ? 'mudra-hop' : open ? '' : 'animate-bob')}
        style={{ transform: `scaleX(${-facing})` }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="mudra-body" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="rgb(var(--fill-a))" />
            <stop offset="1" stopColor="rgb(var(--fill-b))" />
          </linearGradient>
        </defs>
        {/* Feet: they only move when it runs. */}
        <ellipse className={running ? 'mudra-foot' : ''} cx="27" cy="63" rx="6" ry="3.2" fill="rgb(var(--fill-b))" />
        <ellipse className={running ? 'mudra-foot mudra-foot-late' : ''} cx="45" cy="63" rx="6" ry="3.2" fill="rgb(var(--fill-b))" />
        {/* Waving hand */}
        <g className={waving || running ? 'animate-wave' : ''} style={{ transformBox: 'fill-box' }}>
          <ellipse cx="60" cy="30" rx="7" ry="8" fill="url(#mudra-body)" />
          <ellipse cx="57.5" cy="23" rx="1.8" ry="3.2" fill="url(#mudra-body)" />
          <ellipse cx="61" cy="22" rx="1.8" ry="3.4" fill="url(#mudra-body)" />
          <ellipse cx="64.5" cy="23.5" rx="1.8" ry="3" fill="url(#mudra-body)" />
        </g>
        {/* Body */}
        <path
          d="M36 10c14 0 24 10 24 24 0 15-9 26-24 26S12 49 12 34c0-14 10-24 24-24z"
          fill="url(#mudra-body)"
        />
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
                <circle cx={28.5 + eye.x} cy={34.5 + eye.y} r="2.2" fill="#1c1530" />
                <circle cx={43.5 + eye.x} cy={34.5 + eye.y} r="2.2" fill="#1c1530" />
                <circle cx={29.4 + eye.x} cy={33.4 + eye.y} r="0.7" fill="white" />
                <circle cx={44.4 + eye.x} cy={33.4 + eye.y} r="0.7" fill="white" />
              </>
            )}
          </g>
        )}
        <ellipse cx="22.5" cy="42" rx="3.4" ry="2" fill="#FDA4AF" opacity="0.7" />
        <ellipse cx="49.5" cy="42" rx="3.4" ry="2" fill="#FDA4AF" opacity="0.7" />
        {smiling || running ? (
          <path d="M31.5 43q4.5 5.5 9 0z" fill="#1c1530" />
        ) : (
          <path d="M32.5 43.5q3.5 3 7 0" stroke="#1c1530" strokeWidth="1.8" strokeLinecap="round" fill="none" />
        )}
      </svg>
    </button>
  );
}

// ── The guide panel ─────────────────────────────────────────────────────────

function GuidePanel({ peek, view, onClose, onNavigate, onPalette, onHide, onTour }) {
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

  /**
   * Local answers first: instant, offline, and they can open the right
   * screen. Only a question nothing local covers goes to Sarvam, and even
   * then it is told to answer from the same facts, so it cannot invent
   * features the app does not have.
   */
  const reply = async (question, topic) => {
    const t = topic || answer(question);
    if (t) {
      setThread((list) => [
        ...list,
        { from: 'me', text: question },
        { from: 'mudra', text: t.answer, actions: t.actions },
      ]);
      return;
    }
    const canAsk = hasSarvam() && isOnline();
    if (!canAsk) {
      setThread((list) => [
        ...list,
        { from: 'me', text: question },
        {
          from: 'mudra',
          text: 'I’m not sure about that one. These are the things I know best:',
          suggest: TOPICS.slice(0, 6).map((x) => x.id),
        },
      ]);
      return;
    }
    const pendingId = Date.now();
    setThread((list) => [
      ...list,
      { from: 'me', text: question },
      { from: 'mudra', text: 'Let me think…', pendingId },
    ]);
    let text;
    try {
      const out = await sarvamChat([
        {
          role: 'system',
          content:
            'You are Mudra, the small friendly guide inside Aangika, an Indian Sign Language app. '
            + 'Answer in at most three short, warm sentences. Use ONLY the facts below; if they do '
            + 'not cover the question, say you are not sure and suggest the closest feature. '
            + 'Never invent features.\n\nFacts:\n' + guideFacts(),
        },
        { role: 'user', content: question },
      ], { temperature: 0.3, maxTokens: 300 });
      text = out.text;
    } catch {
      text = 'I couldn’t reach Sarvam just now. Try one of the questions below?';
    }
    setThread((list) => list.map((m) => (m.pendingId === pendingId ? { from: 'mudra', text, ai: true } : m)));
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
    else if (a.tour) onTour();
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
      className={(peek ? 'right-9 ' : 'right-4 ') + 'float-pane animate-pop-in absolute bottom-full mb-3 flex max-h-[min(32rem,70vh)] w-[min(22rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-subtle bg-card shadow-card lg:right-0'}
    >
      <header className="flex items-center gap-2 border-b border-subtle px-4 py-3">
        <span className="display text-base">Mudra</span>
        <span className="text-[11px] text-ink-dim">your guide</span>
        <button type="button" onClick={onTour} className="pill ml-auto border-primary/30 bg-primary/10 py-1 text-primary">
          Show me around
        </button>
        <button type="button" onClick={onClose} aria-label="Close" className="btn-icon h-8 w-8">
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
                + (m.pendingId ? ' animate-pulse' : '')
              }
            >
              {m.text}
              {m.ai && <span className="mt-1 block text-[10px] text-ink-dim">Answered with Sarvam</span>}
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
