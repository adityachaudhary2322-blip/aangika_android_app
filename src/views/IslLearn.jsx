import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Search, Video, RotateCcw, Check, X, ExternalLink, GraduationCap } from 'lucide-react';
import CameraStage from '../components/CameraStage.jsx';
import cameraManager from '../services/cameraManager.js';
import { isNativeApp } from '../services/platform.js';
import useLandmarkLoop from '../hooks/useLandmarkLoop.js';
import { frameFeatures } from '../services/isl/islFeatures.js';
import { SAMPLE_MS } from '../services/isl/islSpotter.js';
import {
  scoreAttempt, describeSign, takeSeconds, getProgress, recordAttempt,
} from '../services/isl/islLearn.js';

/**
 * ISL Studio → Learn: pick a sign, read how it is made, sign it, and see how
 * closely it matches the team's recording (the standard version), part by
 * part, and whether the translator would read it.
 */
export default function LearnTab({ signs }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);
  const [progress, setProgress] = useState(() => getProgress());
  const learnable = signs.filter((s) => s.takes?.length);
  const q = query.trim().toLowerCase();

  if (open) {
    const sign = signs.find((s) => s.id === open);
    if (sign) return <LearnSign sign={sign} signs={signs} onBack={() => { setOpen(null); setProgress(getProgress()); }} />;
  }

  const done = learnable.filter((s) => (progress[s.id]?.best || 0) >= 80).length;
  return (
    <div className="space-y-3">
      <section className="surface-card flex items-center gap-3 p-3">
        <GraduationCap size={22} className="shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Learn the team's signs</p>
          <p className="text-[11px] text-ink-dim">Sign one and see how closely it matches our recording. {done} of {learnable.length} learned (80%+).</p>
        </div>
      </section>
      <div className="flex items-center gap-2 rounded-2xl border border-subtle bg-card px-3 py-2">
        <Search size={14} className="text-ink-dim" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a sign" aria-label="Search a sign to learn" className="w-full bg-transparent text-sm outline-none" />
      </div>
      <ul className="grid grid-cols-2 gap-2">
        {learnable.filter((s) => !q || s.word.toLowerCase().includes(q)).map((s) => {
          const best = progress[s.id]?.best;
          return (
            <li key={s.id}>
              <button type="button" onClick={() => setOpen(s.id)} className="w-full rounded-2xl border border-subtle bg-card p-3 text-left">
                <p className="truncate text-sm font-semibold">{s.word}</p>
                <p className="text-[10px] text-ink-dim">{s.category}{s.texts?.['hi-IN'] ? ` · ${s.texts['hi-IN']}` : ''}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-card-high">
                  <div className={'h-full rounded-full ' + (best >= 80 ? 'bg-primary' : 'bg-amber')} style={{ width: `${best || 0}%` }} />
                </div>
                <p className="mt-1 text-[10px] text-ink-dim">{best != null ? `Best ${best}%` : 'Not tried yet'}</p>
              </button>
            </li>
          );
        })}
      </ul>
      {!learnable.length && <p className="text-center text-xs text-ink-dim">No recorded signs yet.</p>}
    </div>
  );
}

function LearnSign({ sign, signs, onBack }) {
  const auto = useMemo(() => describeSign(sign), [sign]);
  const seconds = takeSeconds(sign);
  const [phase, setPhase] = useState('idle');            // idle | countdown | recording | done
  const [count, setCount] = useState(0);
  const [result, setResult] = useState(null);
  const [best, setBest] = useState(() => getProgress()[sign.id]?.best ?? null);
  const frames = useRef([]);
  const until = useRef(0);
  const lastSample = useRef(0);
  const phaseRef = useRef('idle');
  const setP = (p) => { phaseRef.current = p; setPhase(p); };

  useEffect(() => { cameraManager.start().catch(() => {}); }, []);

  const finishAttempt = useCallback(() => {
    const take = frames.current;
    frames.current = [];
    const r = scoreAttempt(sign, take, signs);
    setResult(r);
    setBest(recordAttempt(sign.id, r.score).best);
    setP('done');
  }, [sign, signs]);

  const onFrame = useCallback((res, ts) => {
    if (phaseRef.current !== 'recording' || ts - lastSample.current < SAMPLE_MS) return;
    lastSample.current = ts;
    frames.current.push(Array.from(frameFeatures({ hands: res.hands, pose: res.pose, mirrored: cameraManager.isFrontCamera() })));
    if (ts >= until.current) finishAttempt();
  }, [finishAttempt]);

  const { ready, error } = useLandmarkLoop(true, onFrame);

  const go = () => {
    setResult(null);
    setP('countdown');
    let n = 3;
    setCount(n);
    const id = setInterval(() => {
      n -= 1;
      setCount(n);
      if (n === 0) {
        clearInterval(id);
        frames.current = [];
        until.current = performance.now() + (seconds + 0.5) * 1000;
        setP('recording');
      }
    }, 800);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <button type="button" onClick={onBack} aria-label="Back to signs" className="btn-icon"><ArrowLeft size={16} /></button>
        <div className="min-w-0">
          <p className="text-lg font-bold leading-tight">{sign.word}</p>
          <p className="text-[11px] text-ink-dim">{[sign.texts?.['hi-IN'], sign.texts?.hinglish, sign.category].filter(Boolean).join(' · ')}{best != null ? ` · best ${best}%` : ''}</p>
        </div>
      </div>

      <section className="surface-card space-y-1 p-3 text-[12px]">
        <p className="eyebrow">How to sign it</p>
        {sign.description && <p className="text-ink">{sign.description}</p>}
        <p className="text-[11px] text-ink-dim">{sign.description ? 'From our recording: ' : ''}{auto.join(' ')}</p>
        {sign.videoUrl && (
          <a href={sign.videoUrl} target={isNativeApp() ? undefined : '_blank'} rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-primary underline">
            <ExternalLink size={11} /> Watch the reference video
          </a>
        )}
      </section>

      <section className="surface-card space-y-2 p-3">
        <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-black">
          <CameraStage className="absolute inset-0" />
          {(!ready || error) && <div className="absolute inset-0 flex items-center justify-center bg-surface/85 text-sm">{error || 'Loading hand and body tracking…'}</div>}
          {phase === 'countdown' && <div className="absolute inset-0 flex items-center justify-center text-6xl font-bold text-white drop-shadow">{count}</div>}
          {phase === 'recording' && <div className="absolute left-2 top-2 rounded-full bg-rose px-3 py-1 text-xs font-bold text-white">● Sign “{sign.word}” now</div>}
        </div>
        <p className="text-[11px] text-ink-dim">Hands down → at “go”, sign it once ({seconds} s) → hands down. Keep your face and shoulders in view.</p>
        <button type="button" onClick={go} disabled={!ready || phase === 'countdown' || phase === 'recording'} className="btn-primary w-full py-2 text-sm">
          {result ? <><RotateCcw size={14} /> Try again</> : <><Video size={14} /> Sign it</>}
        </button>
      </section>

      {result && (
        <section className="surface-card animate-fade-up space-y-2 p-3" aria-label="Your result">
          <div className="flex items-center gap-3">
            <div className={'flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-lg font-bold '
              + (result.recognised ? 'bg-primary/15 text-primary' : 'bg-amber/15 text-amber')}>{result.score}%</div>
            <p className="text-sm font-semibold">{result.verdict}</p>
          </div>
          <ul className="space-y-1 text-[12px]">
            {result.parts.map((p) => (
              <li key={p.name} className="flex items-start gap-2">
                {p.ok ? <Check size={14} className="mt-0.5 shrink-0 text-primary" /> : <X size={14} className="mt-0.5 shrink-0 text-rose" />}
                <span><span className="font-semibold">{p.name}</span>{p.ok ? ' matches' : `: ${p.tip}`}</span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-ink-dim">Compared with the team's recording. 100% = as close as our own takes are to each other.</p>
        </section>
      )}
    </div>
  );
}
