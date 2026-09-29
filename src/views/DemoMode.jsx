import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Play, Loader2, Trash2, Check, X } from 'lucide-react';
import CameraStage from '../components/CameraStage.jsx';
import LandmarkCanvas from '../components/LandmarkCanvas.jsx';
import useSignPipeline from '../hooks/useSignPipeline.js';
import cameraManager from '../services/cameraManager.js';
import { unlockAudio } from '../services/ttsService.js';
import { getModel } from '../config/models.js';
import { modelIdFor } from '../services/engineState.js';
import { GESTURE_TOKENS } from '../config/gestureSentences.js';
import { listSigns } from '../services/customSigns.js';
import { translate } from '../services/translationService.js';
import { tokenLabel } from '../hooks/useTokenStream.js';
import {
  recordAttempt, reliability, reliableSigns, resetPractice, practiceSentences, isReliable,
} from '../services/practice.js';

const ATTEMPT_MS = 3000;
const toToken = (label, display) => String(display?.[label] || label).toUpperCase()
  .replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/**
 * Demo mode. Everything here is real recognition by the active model:
 *  - live top-5 confidence per word, straight from the pipeline;
 *  - practice attempts, each recorded with what the model actually said;
 *  - "reliable for you" = signed >= 3 times, recognised at least 2 in 3;
 *  - practice sentences built only from those signs, translated by the same
 *    offline grammar the app uses.
 */
export default function DemoMode({ onBack, visionEngine, cameraError, language }) {
  const model = getModel(modelIdFor(visionEngine));
  const [started, setStarted] = useState(false);
  const [mirrored, setMirrored] = useState(() => cameraManager.isFrontCamera());
  useEffect(() => cameraManager.subscribe((s) => setMirrored(s.isFrontCamera)), []);

  const { status, progress, words, closest, frameRef, stats } = useSignPipeline({
    enabled: started, mirrored, visionEngine, autoSpeak: false, language,
  });

  // The signs this model can output, as tokens.
  const [signs, setSigns] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (model?.engine === 'signbridge') {
        const own = listSigns().filter((s) => s.samples?.length).map((s) => s.token);
        if (!cancelled) setSigns([...GESTURE_TOKENS, ...own]);
        return;
      }
      if (!model?.vocabUrl) return;
      const v = await fetch(model.vocabUrl).then((r) => r.json()).catch(() => null);
      if (!v || cancelled) return;
      const list = v.labels ? v.labels.map((l) => toToken(l, v.display)) : (v.words || []).map((w) => w.toUpperCase());
      setSigns(list);
    })();
    return () => { cancelled = true; };
  }, [model?.id]);

  // â”€â”€ Practice attempt â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const [target, setTarget] = useState('');
  const [phase, setPhase] = useState('idle');           // idle | countdown | recording
  const [count, setCount] = useState(3);
  const [lastResult, setLastResult] = useState(null);
  const [table, setTable] = useState(() => reliability(model?.id));
  const seenRef = useRef({ tokens: new Set(), conf: 0 });
  const recordingRef = useRef(false);

  useEffect(() => {
    if (!recordingRef.current) return;
    for (const w of words) {
      seenRef.current.tokens.add(w.word);
      if (w.word === target) seenRef.current.conf = Math.max(seenRef.current.conf, w.confidence);
    }
  }, [words, target]);

  const attempt = async () => {
    if (!target) return;
    await unlockAudio();
    setLastResult(null);
    setPhase('countdown');
    for (let n = 3; n > 0; n -= 1) {
      setCount(n);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 700));
    }
    seenRef.current = { tokens: new Set(), conf: 0 };
    recordingRef.current = true;
    setPhase('recording');
    await new Promise((r) => setTimeout(r, ATTEMPT_MS));
    recordingRef.current = false;
    const recognised = [...seenRef.current.tokens];
    const { ok } = recordAttempt(model.id, target, { recognised, confidence: seenRef.current.conf });
    setLastResult({ ok, recognised, conf: seenRef.current.conf });
    setTable(reliability(model.id));
    setPhase('idle');
  };

  // â”€â”€ Sentences from reliable signs only â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const reliable = useMemo(() => reliableSigns(model?.id), [table, model?.id]);
  const [sentences, setSentences] = useState([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const out = [];
      for (const gloss of practiceSentences(reliable)) {
        // eslint-disable-next-line no-await-in-loop
        const r = await translate(gloss, 'en-IN', { mode: 'offline', signLanguage: model?.language });
        out.push({ gloss, english: r.english });
      }
      if (!cancelled) setSentences(out);
    })();
    return () => { cancelled = true; };
  }, [reliable.join(','), model?.language]);

  if (!model) return null;

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 pb-6 no-scrollbar">
      <header className="flex items-center gap-2 py-3">
        <button type="button" onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full bg-card-high">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-lg font-bold">Demo mode</h1>
          <p className="text-[11px] text-ink-dim">{model.name} Â· everything below is live recognition</p>
        </div>
      </header>

      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl">
        <CameraStage className="absolute inset-0" />
        <LandmarkCanvas frameRef={frameRef} mirrored={mirrored} />
        {!started && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/85">
            <button type="button" onClick={async () => { await unlockAudio(); setStarted(true); cameraManager.start().catch(() => {}); }}
              aria-label="Start demo camera" className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-surface">
              <Play size={26} className="ml-0.5" />
            </button>
            <p className="text-sm">Start camera</p>
          </div>
        )}
        {started && status !== 'ready' && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-surface/80 text-sm">
            <Loader2 size={18} className="animate-spin text-primary" /> {cameraError || progress || 'Loadingâ€¦'}
          </div>
        )}
        {phase === 'countdown' && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/40 text-6xl font-bold text-primary">{count}</div>
        )}
        {phase === 'recording' && (
          <div className="absolute inset-x-0 bottom-0 bg-rose/80 py-1 text-center text-xs font-semibold text-surface">
            Sign {tokenLabel(target)} now
          </div>
        )}
        <span className="pill chrome-plate absolute left-2 top-2 text-[10px]">{stats.fps} FPS</span>
      </div>

      {/* Live confidence per word */}
      <section className="mt-3 surface-card p-3">
        <p className="eyebrow">Live confidence (top 5)</p>
        {!closest.length && <p className="mt-1 text-[11px] text-ink-dim">Sign to see what the model thinks.</p>}
        <ul className="mt-2 space-y-1">
          {closest.slice(0, 5).map((w) => {
            const accepted = words.some((x) => x.word === w.word);
            return (
              <li key={`${w.word}-${w.index}`} className="text-[11px]">
                <div className="flex justify-between">
                  <span className={accepted ? 'font-semibold text-primary' : ''}>{tokenLabel(w.word)}</span>
                  <span className="tabular-nums text-ink-dim">{Math.round((w.confidence || 0) * 100)}%</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-card-highest">
                  <div className={'h-full ' + (accepted ? 'bg-primary' : 'bg-ink-dim/40')} style={{ width: `${Math.round((w.confidence || 0) * 100)}%` }} />
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Practice */}
      <section className="mt-3 surface-card p-3">
        <p className="eyebrow">Practice a sign</p>
        <div className="mt-2 flex gap-2">
          <input
            list="demo-signs"
            value={target}
            onChange={(e) => setTarget(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
            placeholder={`One of ${signs.length} signs, e.g. ${signs.includes('HELLO') ? 'HELLO' : signs[0] || ''}`}
            aria-label="Sign to practise"
            className="min-w-0 flex-1 rounded-lg border border-subtle bg-surface px-3 py-2 text-sm"
          />
          <datalist id="demo-signs">{signs.map((s) => <option key={s} value={s} />)}</datalist>
          <button type="button" onClick={attempt} disabled={!started || status !== 'ready' || !signs.includes(target) || phase !== 'idle'}
            className="rounded-lg bg-primary px-3 text-sm font-semibold text-surface disabled:opacity-40">
            Record 3 s
          </button>
        </div>
        {lastResult && (
          <p className={'mt-2 flex items-center gap-1 text-[12px] ' + (lastResult.ok ? 'text-primary' : 'text-amber')}>
            {lastResult.ok ? <Check size={13} /> : <X size={13} />}
            {lastResult.ok
              ? `Recognised (${Math.round(lastResult.conf * 100)}%).`
              : `Not recognised. The model said: ${lastResult.recognised.map(tokenLabel).join(', ') || 'nothing'}.`}
          </p>
        )}
      </section>

      {/* Measured reliability */}
      <section className="mt-3 surface-card p-3">
        <div className="flex items-center">
          <p className="eyebrow">Measured on you</p>
          {table.length > 0 && (
            <button type="button" onClick={() => { resetPractice(model.id); setTable([]); }} className="ml-auto flex items-center gap-1 text-[11px] text-ink-dim">
              <Trash2 size={12} /> Reset
            </button>
          )}
        </div>
        {!table.length && <p className="mt-1 text-[11px] text-ink-dim">No attempts yet. Practise a few signs 3 times each.</p>}
        <table className="mt-2 w-full text-[11px]">
          <tbody>
            {table.map((r) => (
              <tr key={r.token} className={isReliable(r) ? 'text-primary' : ''}>
                <td className="py-0.5">{tokenLabel(r.token)}</td>
                <td className="text-right tabular-nums">{r.ok}/{r.n}</td>
                <td className="w-16 text-right tabular-nums">{Math.round(r.rate * 100)}%</td>
                <td className="w-20 text-right text-ink-dim">{r.n < 3 ? 'needs 3 tries' : isReliable(r) ? 'reliable' : 'unreliable'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Practice sentences */}
      <section className="mt-3 surface-card p-3">
        <p className="eyebrow">Sentences to demo</p>
        {!sentences.length && (
          <p className="mt-1 text-[11px] text-ink-dim">
            Built only from signs marked reliable above. {reliable.length} reliable so far.
          </p>
        )}
        <ul className="mt-2 space-y-2">
          {sentences.map((s) => (
            <li key={s.gloss.join('-')} className="rounded-lg border border-subtle p-2">
              <p className="font-mono text-[11px] text-ink-dim">{s.gloss.join(' ')}</p>
              <p className="text-sm font-semibold">{s.english}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
