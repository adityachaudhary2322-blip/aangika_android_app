import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Plus, Download, Upload, Trash2, Pencil, RotateCcw, Activity,
  Loader2, Check, AlertTriangle, Hand,
} from 'lucide-react';
import CameraStage from '../components/CameraStage.jsx';
import FlipCameraButton from '../components/FlipCameraButton.jsx';
import LandmarkCanvas from '../components/LandmarkCanvas.jsx';
import HandSkeleton from '../components/HandSkeleton.jsx';
import cameraManager from '../services/cameraManager.js';
import landmarker from '../services/landmarker.js';
import recognizer from '../services/signRecognizer.js';
import {
  init, listSigns, subscribe, saveSign, deleteSign, exportJSON, importJSON, getSign,
  tokenFromText, validate, isPersistent, OUTPUT_TYPES, WORD_CATEGORIES,
} from '../services/customSigns.js';
import {
  handsBySide, shoulderFrame, packSample, shapeVector, LOCATION_LABELS,
} from '../services/handshapeFeatures.js';
import { matchMeter, currentIndex } from '../services/customHandshapes.js';
import { createSignBridgeTracker } from '../services/signbridgeTracker.js';
import { checkConflicts } from '../services/signConflicts.js';
import { fillSentenceLanguages, missingLanguages } from '../services/customSignTranslations.js';
import { LANGUAGES } from '../config/languages.js';
import {
  DictionaryPanel, SharedSignList, DeveloperPublish,
} from '../components/CommunityDictionary.jsx';
import { takeIntent } from '../services/navIntent.js';

const CAPTURES = 3;
const CAPTURE_MS = 2000;
const MIN_FRAMES_PER_CAPTURE = 8;
const MAX_FRAMES_PER_CAPTURE = 20;
/** Shape change between consecutive frames above this = the hand is moving. */
const STABLE_DELTA = 0.25;

const TYPE_LABEL = { word: 'Word', name: 'Name', sentence: 'Sentence' };
const TYPE_HINT = {
  word: 'One word, used inside sentences (e.g. "tea").',
  name: 'A person or place. Kept as-is, never translated.',
  sentence: 'A whole phrase spoken as saved, in every language.',
};

function emptyDraft() {
  return {
    token: '', tokenTouched: false, kind: 'handshape', hands: 'one', eitherHand: false,
    side: null, samples: [],
    output: { type: 'word', text_en: '', texts: {}, category: 'thing' },
  };
}

/** Evenly keep at most n items. */
function thin(list, n) {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]);
}

/** One detection pass over the shared camera, every animation frame. */
function useLandmarkLoop(active, onFrame) {
  const cb = useRef(onFrame);
  cb.current = onFrame;
  const [ready, setReady] = useState(landmarker.isLoaded());
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!active || ready) return;
    landmarker.load().then(() => setReady(true)).catch((e) => setError(e.message));
  }, [active, ready]);

  useEffect(() => {
    if (!active || !ready) return undefined;
    let raf = 0;
    let lastVideoTime = -1;
    let lastTs = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const video = cameraManager.getVideoElement();
      if (!video || video.readyState < 2 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      const ts = Math.max(performance.now(), lastTs + 1);
      lastTs = ts;
      const result = landmarker.detect(video, ts);
      if (result) cb.current(result);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, ready]);

  return { ready, error };
}

export default function MySigns({ onBack, online, cameraError, onNavigate }) {
  const [signs, setSigns] = useState(() => listSigns());
  // The list shows what THIS user taught; community signs are listed below it.
  const ownSigns = useMemo(() => signs.filter((s) => !s.shared), [signs]);
  // Opened from the developer section on a specific step (navIntent.js).
  const [screen, setScreen] = useState(() => {
    const intent = takeIntent();
    const sign = intent?.signId ? getSign(intent.signId) : null;
    if (intent?.action === 'new') return { name: 'edit', draft: emptyDraft() };
    if (intent?.action === 'edit' && sign) return { name: 'edit', draft: { ...sign, tokenTouched: true } };
    if (intent?.action === 'record' && sign) {
      return { name: 'capture', draft: { ...sign, samples: [], side: null, tokenTouched: true } };
    }
    return { name: 'list' };
  });
  const [notice, setNotice] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    init().then(setSigns);
    return subscribe(setSigns);
  }, []);

  const flash = (text, tone = 'primary') => {
    setNotice({ text, tone });
    setTimeout(() => setNotice(null), 4000);
  };

  const doExport = () => {
    const blob = new Blob([exportJSON()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aangika-my-signs-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const doImport = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const report = await importJSON(await file.text());
      flash(`Imported ${report.added} sign(s)` +
        (report.renamed.length ? `; renamed ${report.renamed.map((r) => r.join(' → ')).join(', ')}` : '') +
        (report.skipped.length ? `; skipped ${report.skipped.length}` : ''));
    } catch (err) {
      flash(err.message, 'rose');
    }
  };

  const back = () => (screen.name === 'list' ? onBack() : setScreen({ name: 'list' }));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={back} aria-label="Back" className="btn-icon">
          <ArrowLeft size={18} />
        </button>
        <h1 className="display text-2xl">
          {screen.name === 'list' ? 'My signs'
            : screen.name === 'try' ? `Try ${screen.sign.token}`
            : screen.name === 'capture' ? 'Record sign'
            : screen.name === 'review' ? 'Check and save'
            : screen.draft?.id ? `Edit ${screen.draft.token}` : 'New sign'}
        </h1>
        {screen.name === 'list' && (
          <div className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} aria-label="Import signs" className="flex h-9 w-9 items-center justify-center rounded-full bg-card-high">
              <Upload size={15} />
            </button>
            <button type="button" onClick={doExport} disabled={!ownSigns.length} aria-label="Export signs" className="flex h-9 w-9 items-center justify-center rounded-full bg-card-high disabled:opacity-40">
              <Download size={15} />
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={doImport} />
          </div>
        )}
      </header>

      {notice && (
        <p className={`mx-4 mb-2 rounded-lg px-3 py-2 text-[11px] ${notice.tone === 'rose' ? 'bg-rose/10 text-rose' : 'bg-primary/10 text-primary'}`}>
          {notice.text}
        </p>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-4 no-scrollbar">
        {screen.name === 'list' && (
          <>
            <SignList
              signs={ownSigns}
              onNew={() => setScreen({ name: 'edit', draft: emptyDraft() })}
              onEdit={(s) => setScreen({ name: 'edit', draft: { ...s, tokenTouched: true } })}
              onRecord={(s) => setScreen({ name: 'capture', draft: { ...s, samples: [], side: null, tokenTouched: true } })}
              onTry={(s) => setScreen({ name: 'try', sign: s })}
              onDelete={async (s) => { await deleteSign(s.id); flash(`Deleted ${s.token}.`); }}
            />
            {/* Signs shared with every user, and (for developers) publishing. */}
            <div className="mt-6">
              <DictionaryPanel />
              <SharedSignList onTry={(s) => setScreen({ name: 'try', sign: s })} />
              <DeveloperPublish onOpenDeveloper={onNavigate ? () => onNavigate('developer') : undefined} />
            </div>
          </>
        )}
        {screen.name === 'edit' && (
          <SignForm
            draft={screen.draft}
            onCancel={() => setScreen({ name: 'list' })}
            onSaveMeta={async (draft) => {
              await saveSign(stripDraft(draft));
              if (draft.output.type === 'sentence') await fillSentenceLanguages(draft.id);
              flash(`Saved ${draft.token}.`);
              setScreen({ name: 'list' });
            }}
            onRecord={(draft) => setScreen({ name: 'capture', draft })}
          />
        )}
        {screen.name === 'capture' && (
          <CaptureFlow
            draft={screen.draft}
            cameraError={cameraError}
            onCancel={() => setScreen({ name: 'list' })}
            onDone={(draft) => setScreen({ name: 'review', draft })}
          />
        )}
        {screen.name === 'review' && (
          <Review
            draft={screen.draft}
            online={online}
            onRerecord={() => setScreen({ name: 'capture', draft: { ...screen.draft, samples: [] } })}
            onSaved={(msg) => { flash(msg); setScreen({ name: 'list' }); }}
          />
        )}
        {screen.name === 'try' && <TryIt sign={screen.sign} cameraError={cameraError} />}
      </div>

      {!isPersistent() && (
        <p className="px-4 pb-3 text-[10px] text-amber">
          This browser is not letting the app store data, so signs last only until the page closes. Export them to keep them.
        </p>
      )}
    </div>
  );
}

/** Draft -> record fields accepted by saveSign(). */
function stripDraft(d) {
  const { tokenTouched, ...rest } = d;
  return rest;
}

// ── List ────────────────────────────────────────────────────────────────────

function SignList({ signs, onNew, onEdit, onRecord, onTry, onDelete }) {
  const [armed, setArmed] = useState(null);
  return (
    <>
      <button type="button" onClick={onNew} className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 font-semibold text-surface">
        <Plus size={16} /> Teach a new sign
      </button>
      <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
        Hold a handshape for two seconds, three times. It works immediately in
        SignBridge mode, alongside the 20 built-in signs. No retraining.
      </p>

      {!signs.length && (
        <p className="mt-6 text-center text-sm text-ink-dim">No signs yet.</p>
      )}

      <ul className="mt-4 space-y-2">
        {signs.map((s) => {
          const mid = s.samples?.[Math.floor((s.samples.length || 1) / 2)];
          const pending = s.output?.type === 'sentence' ? missingLanguages(s).length : 0;
          return (
            <li key={s.id} className="surface-card flex items-center gap-3 p-3">
              <HandSkeleton sample={mid} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5">
                  <b className="truncate text-sm">{s.token}</b>
                  <span className="pill border-subtle px-1.5 py-0 text-[9px] text-ink-dim">
                    {TYPE_LABEL[s.output?.type] || s.output?.type}
                    {s.output?.category ? ` · ${s.output.category}` : ''}
                  </span>
                </p>
                <p className="truncate text-[11px] text-ink-dim">{s.output?.text_en}</p>
                <p className="text-[10px]">
                  {s.untrained || !s.samples?.length
                    ? <span className="text-amber">Not recorded yet</span>
                    : <span className="text-ink-dim">{s.samples.length} frames · {s.hands === 'two' ? 'two hands' : `${s.side || 'one'} hand${s.eitherHand ? ' (either)' : ''}`} · {LOCATION_LABELS[s.location] || ''}</span>}
                  {pending > 0 && <span className="ml-1 text-amber">· {pending} languages pending</span>}
                </p>
              </div>
              <div className="flex shrink-0 flex-col gap-1">
                <div className="flex gap-1">
                  <IconBtn label="Try it" onClick={() => onTry(s)} disabled={!s.samples?.length}><Activity size={14} /></IconBtn>
                  <IconBtn label="Edit" onClick={() => onEdit(s)}><Pencil size={14} /></IconBtn>
                </div>
                <div className="flex gap-1">
                  <IconBtn label="Re-record" onClick={() => onRecord(s)}><RotateCcw size={14} /></IconBtn>
                  <IconBtn
                    label={armed === s.id ? 'Tap again to delete' : 'Delete'}
                    tone={armed === s.id ? 'rose' : undefined}
                    onClick={() => (armed === s.id ? (setArmed(null), onDelete(s)) : setArmed(s.id))}
                  >
                    <Trash2 size={14} />
                  </IconBtn>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function IconBtn({ children, label, onClick, disabled, tone }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={`flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-40 ${tone === 'rose' ? 'bg-rose/20 text-rose' : 'bg-card-high'}`}
    >
      {children}
    </button>
  );
}

// ── Form ────────────────────────────────────────────────────────────────────

function SignForm({ draft: initial, onCancel, onSaveMeta, onRecord }) {
  const [d, setD] = useState(initial);
  const [showLangs, setShowLangs] = useState(false);
  const recorded = Boolean(initial.samples?.length);

  const set = (patch) => setD((cur) => ({ ...cur, ...patch }));
  const setOut = (patch) => setD((cur) => {
    const output = { ...cur.output, ...patch };
    const token = cur.tokenTouched ? cur.token : tokenFromText(output.text_en);
    return { ...cur, output, token };
  });
  const setText = (code, text) => setOut({ texts: { ...d.output.texts, [code]: text } });

  // Changing the number of hands invalidates the recording.
  const handsChanged = recorded && d.hands !== initial.hands;
  const errors = validate({ ...d, samples: [] }, { ignoreId: d.id })
    .filter((e) => !e.startsWith('Unknown sign kind'));

  return (
    <div className="space-y-4">
      <section className="surface-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">What it says</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {OUTPUT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setOut({ type: t, category: t === 'word' ? d.output.category || 'thing' : undefined })}
              className={'rounded-lg border px-2 py-2 text-sm ' + (d.output.type === t ? 'border-primary/50 bg-primary/10 text-primary' : 'border-subtle')}
            >
              {TYPE_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="mt-1.5 text-[10px] text-ink-dim">{TYPE_HINT[d.output.type]}</p>

        <label className="mt-3 block text-xs text-ink-dim">English</label>
        <input
          value={d.output.text_en}
          onChange={(e) => setOut({ text_en: e.target.value })}
          placeholder={d.output.type === 'sentence' ? 'Please speak slowly.' : d.output.type === 'name' ? 'Priya' : 'tea'}
          className="mt-1 w-full rounded-lg border border-subtle bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />

        <label className="mt-3 block text-xs text-ink-dim">Hindi <span className="opacity-60">(optional)</span></label>
        <input
          value={d.output.texts?.['hi-IN'] || ''}
          onChange={(e) => setText('hi-IN', e.target.value)}
          lang="hi"
          className="mt-1 w-full rounded-lg border border-subtle bg-surface px-3 py-2 text-sm outline-none focus:border-primary"
        />

        {d.output.type === 'word' && (
          <>
            <label className="mt-3 block text-xs text-ink-dim">Kind of word <span className="opacity-60">(places it in sentences)</span></label>
            <select
              value={d.output.category || 'thing'}
              onChange={(e) => setOut({ category: e.target.value })}
              className="mt-1 w-full rounded-lg border border-subtle bg-surface px-3 py-2 text-sm"
            >
              {WORD_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        )}

        {d.output.type === 'sentence' && (
          <>
            <button type="button" onClick={() => setShowLangs((v) => !v)} className="mt-3 text-[11px] font-semibold text-primary">
              {showLangs ? 'Hide' : 'Edit'} other languages
            </button>
            {showLangs && (
              <div className="mt-2 space-y-2">
                {LANGUAGES.filter((l) => l.code !== 'en-IN' && l.code !== 'hi-IN').map((l) => (
                  <div key={l.code}>
                    <label className="block text-[10px] text-ink-dim">{l.name} · {l.script}</label>
                    <input
                      value={d.output.texts?.[l.code] || ''}
                      onChange={(e) => setText(l.code, e.target.value)}
                      placeholder="Filled automatically when online"
                      className="mt-0.5 w-full rounded-lg border border-subtle bg-surface px-3 py-1.5 text-sm outline-none focus:border-primary"
                    />
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <label className="mt-3 block text-xs text-ink-dim">Token</label>
        <input
          value={d.token}
          onChange={(e) => set({ token: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''), tokenTouched: true })}
          className="mt-1 w-full rounded-lg border border-subtle bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-primary"
        />
      </section>

      <section className="surface-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">How it is signed</p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {['one', 'two'].map((h) => (
            <button
              key={h}
              type="button"
              onClick={() => set({ hands: h })}
              className={'rounded-lg border px-2 py-2 text-sm ' + (d.hands === h ? 'border-primary/50 bg-primary/10 text-primary' : 'border-subtle')}
            >
              {h === 'one' ? 'One hand' : 'Two hands'}
            </button>
          ))}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={Boolean(d.eitherHand)} onChange={(e) => set({ eitherHand: e.target.checked })} />
          Either hand <span className="text-[10px] text-ink-dim">(also match the mirror image)</span>
        </label>
        <p className="mt-2 text-[10px] text-ink-dim">
          Handshape signs only: the shape and where it is held. Signs defined by
          movement need the Aangika engine.
        </p>
        {handsChanged && (
          <p className="mt-2 text-[11px] text-amber">Changing the number of hands means recording again.</p>
        )}
      </section>

      {errors.length > 0 && d.output.text_en && (
        <p className="text-[11px] text-rose">{errors.join(' ')}</p>
      )}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 rounded-xl bg-card-high py-2.5 text-sm font-semibold">Cancel</button>
        {recorded && !handsChanged && (
          <button type="button" disabled={errors.length > 0} onClick={() => onSaveMeta(d)} className="flex-1 rounded-xl bg-card-highest py-2.5 text-sm font-semibold disabled:opacity-40">
            Save changes
          </button>
        )}
        <button
          type="button"
          disabled={errors.length > 0}
          onClick={() => onRecord({ ...d, samples: [], side: null })}
          className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-surface disabled:opacity-40"
        >
          {recorded ? 'Record again' : 'Record'}
        </button>
      </div>
    </div>
  );
}

// ── Capture ─────────────────────────────────────────────────────────────────

function CaptureFlow({ draft, onDone, onCancel, cameraError }) {
  const [take, setTake] = useState(0);
  const [phase, setPhase] = useState('ready');        // ready | countdown | recording | between
  const [count, setCount] = useState(3);
  const [live, setLive] = useState({ hands: false, shoulders: false, stable: false });
  const [message, setMessage] = useState(null);
  const [mirrored, setMirrored] = useState(() => cameraManager.isFrontCamera());
  const frameRef = useRef(null);
  const takesRef = useRef([]);
  const currentRef = useRef([]);
  const lockedSideRef = useRef(draft.side || null);
  const prevShapeRef = useRef(null);
  const recordUntilRef = useRef(0);

  useEffect(() => cameraManager.subscribe((s) => setMirrored(s.isFrontCamera)), []);

  const onFrame = useCallback((result) => {
    frameRef.current = recognizer.packFrame(result.pose, result.hands, mirrored);
    const bySide = handsBySide(result.hands, mirrored);
    const shoulders = Boolean(shoulderFrame(result.pose));
    let side = null;
    let handsOk;
    if (draft.hands === 'two') {
      handsOk = Boolean(bySide.left && bySide.right);
    } else {
      // Record with one consistent hand even for "either hand" signs: the
      // mirror image is generated at match time, not captured.
      const locked = lockedSideRef.current;
      if (locked) side = bySide[locked] ? locked : null;
      else if (bySide.left && bySide.right) side = null;           // ambiguous: show one hand
      else side = bySide.right ? 'right' : bySide.left ? 'left' : null;
      handsOk = Boolean(side);
    }

    // Stable = the handshape barely changed since the last frame.
    let stable = false;
    if (handsOk) {
      const lm = draft.hands === 'two' ? bySide.right : bySide[side];
      const v = shapeVector(lm);
      const prev = prevShapeRef.current;
      if (prev) {
        let s = 0;
        for (let i = 0; i < v.length; i++) s += (v[i] - prev[i]) ** 2;
        stable = Math.sqrt(s) < STABLE_DELTA;
      }
      prevShapeRef.current = v;
    } else {
      prevShapeRef.current = null;
    }
    setLive((cur) => (cur.hands === handsOk && cur.shoulders === shoulders && cur.stable === stable
      ? cur : { hands: handsOk, shoulders, stable }));

    if (performance.now() < recordUntilRef.current && handsOk && shoulders && stable) {
      if (draft.hands === 'one' && !lockedSideRef.current) lockedSideRef.current = side;
      // A one-handed sign stores only its own hand.
      const keep = draft.hands === 'two'
        ? result.hands
        : result.hands.filter((h) => handsBySide([h], mirrored)[side]);
      currentRef.current.push(packSample(keep, result.pose, mirrored, take));
    }
  }, [draft.hands, draft.eitherHand, mirrored, take]);

  const { ready, error } = useLandmarkLoop(true, onFrame);

  const startTake = () => {
    setMessage(null);
    setPhase('countdown');
    setCount(3);
    let n = 3;
    const id = setInterval(() => {
      n -= 1;
      if (n > 0) { setCount(n); return; }
      clearInterval(id);
      currentRef.current = [];
      recordUntilRef.current = performance.now() + CAPTURE_MS;
      setPhase('recording');
      setTimeout(finishTake, CAPTURE_MS + 50);
    }, 800);
  };

  const finishTake = () => {
    const frames = currentRef.current;
    if (frames.length < MIN_FRAMES_PER_CAPTURE) {
      setMessage(`Only ${frames.length} clear frames. Keep ${draft.hands === 'two' ? 'both hands' : 'the hand'} and your shoulders in view and hold still.`);
      setPhase('ready');
      return;
    }
    takesRef.current[take] = thin(frames, MAX_FRAMES_PER_CAPTURE);
    if (take + 1 < CAPTURES) {
      setTake(take + 1);
      setPhase('between');
      setMessage(`Take ${take + 1} saved (${takesRef.current[take].length} frames). Now tilt your hand slightly and hold it again.`);
      return;
    }
    const samples = takesRef.current.flat();
    onDone({ ...draft, samples, side: draft.hands === 'two' ? null : lockedSideRef.current });
  };

  const Dot = ({ ok, label }) => (
    <span className={'pill chrome-plate text-[10px] ' + (ok ? 'border-primary/50 text-primary' : 'border-amber/50 text-amber')}>
      {ok ? <Check size={11} /> : <AlertTriangle size={11} />} {label}
    </span>
  );

  return (
    <div className="space-y-3">
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl">
        <CameraStage className="absolute inset-0" />
        <FlipCameraButton className="absolute right-2 top-2 z-20" />
        <LandmarkCanvas frameRef={frameRef} mirrored={mirrored} />
        <div className="absolute inset-x-0 top-0 flex flex-wrap gap-1.5 p-2">
          <Dot ok={live.hands} label={draft.hands === 'two' ? 'both hands' : 'hand visible'} />
          <Dot ok={live.shoulders} label="shoulders visible" />
          <Dot ok={live.stable} label="holding still" />
        </div>
        {phase === 'countdown' && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/40 text-7xl font-bold text-primary">{count}</div>
        )}
        {phase === 'recording' && (
          <div className="absolute inset-x-0 bottom-0 bg-rose/80 py-1.5 text-center text-xs font-semibold text-surface">
            Recording take {take + 1} of {CAPTURES}: hold the sign
          </div>
        )}
        {(!ready || cameraError || error) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/85 px-6 text-center">
            {cameraError || error
              ? <p className="text-sm text-rose">{cameraError || error}</p>
              : <><Loader2 size={24} className="animate-spin text-primary" /><p className="text-sm">Loading hand tracking…</p></>}
          </div>
        )}
      </div>

      <div className="flex gap-1.5">
        {Array.from({ length: CAPTURES }, (_, i) => (
          <div key={i} className={'h-1.5 flex-1 rounded-full ' + (i < take || (i === take && phase === 'recording') ? 'bg-primary' : 'bg-card-highest')} />
        ))}
      </div>

      <p className="text-sm">
        <b>{draft.output.text_en || draft.token}</b>{' '}
        <span className="text-ink-dim">
          · {draft.hands === 'two' ? 'two hands' : 'one hand'}
          {draft.hands === 'one' && lockedSideRef.current ? ` (${lockedSideRef.current})` : ''}
        </span>
      </p>
      {message && <p className="text-[12px] text-amber">{message}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel} className="flex-1 rounded-xl bg-card-high py-2.5 text-sm font-semibold">Cancel</button>
        <button
          type="button"
          onClick={startTake}
          disabled={!ready || phase === 'countdown' || phase === 'recording'}
          className="flex-[2] rounded-xl bg-primary py-2.5 text-sm font-semibold text-surface disabled:opacity-40"
        >
          {phase === 'recording' ? 'Recording…' : `Record take ${take + 1} of ${CAPTURES}`}
        </button>
      </div>
      <p className="text-[10px] leading-relaxed text-ink-dim">
        Only still frames with {draft.hands === 'two' ? 'both hands' : 'the hand'} fully
        tracked and your shoulders in view are kept. No video is stored, only hand and body points.
      </p>
    </div>
  );
}

// ── Review ──────────────────────────────────────────────────────────────────

function Review({ draft, online, onRerecord, onSaved }) {
  const report = useMemo(() => checkConflicts({ ...draft, id: draft.id || '__draft__' }), [draft]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const cal = report.calibration;
  const conflicts = report.conflicts;
  const consistencyText = {
    good: 'Consistent: the three takes agree closely.',
    fair: 'Fairly consistent. It should work; recording again with a steadier hand will make it stricter.',
    poor: 'Inconsistent: the takes differ a lot, so the sign will be matched loosely. Consider recording again.',
  }[cal?.consistency] || 'Not enough frames to judge.';

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const saved = await saveSign({ ...stripDraft(draft), location: report.location });
      let msg = `Saved ${saved.token}. It works in SignBridge mode now.`;
      if (saved.output.type === 'sentence') {
        const r = await fillSentenceLanguages(saved);
        msg += r.filled.length ? ` Translated into ${r.filled.length} languages.` : '';
        msg += r.pending.length ? ` ${r.pending.length} languages will be filled next time you are online.` : '';
      }
      onSaved(msg);
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <section className="surface-card flex items-center gap-3 p-4">
        <HandSkeleton sample={draft.samples[Math.floor(draft.samples.length / 2)]} size={64} />
        <div>
          <p className="text-sm font-bold">{draft.token}</p>
          <p className="text-[11px] text-ink-dim">{draft.output.text_en}</p>
          <p className="text-[11px] text-ink-dim">
            {draft.samples.length} frames · {LOCATION_LABELS[report.location]}
          </p>
        </div>
      </section>

      <section className="surface-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">Consistency</p>
        <p className={'mt-1 text-sm ' + (cal?.consistency === 'poor' ? 'text-amber' : '')}>{consistencyText}</p>
        {cal && (
          <p className="mt-1 text-[10px] text-ink-dim">
            acceptance radius {cal.radius.toFixed(3)} · take-to-take distance median {cal.median.toFixed(3)}, 95th {cal.p95.toFixed(3)}
          </p>
        )}
      </section>

      <section className="surface-card p-4">
        <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">Could it be confused?</p>
        {!conflicts.length && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-primary"><Check size={14} /> No clash with the built-in signs or your other signs.</p>
        )}
        {conflicts.map((c) => (
          <div key={`${c.kind}-${c.token}`} className="mt-2 rounded-lg border border-amber/40 bg-amber/10 p-2">
            <p className="text-[12px] font-semibold text-amber">{c.message}</p>
            <p className="text-[11px] text-ink-dim">{c.suggestion}</p>
          </div>
        ))}
      </section>

      {draft.output.type === 'sentence' && !online && (
        <p className="text-[11px] text-ink-dim">
          Offline: English{draft.output.texts?.['hi-IN'] ? ' and Hindi are' : ' is'} saved now; other languages are filled the next time you are online.
        </p>
      )}
      {error && <p className="text-[11px] text-rose">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onRerecord} className="flex-1 rounded-xl bg-card-high py-2.5 text-sm font-semibold">Record again</button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className={'flex-1 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-40 ' + (conflicts.length ? 'bg-amber text-surface' : 'bg-primary text-surface')}
        >
          {saving ? 'Saving…' : conflicts.length ? 'Save anyway' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// ── Try it ──────────────────────────────────────────────────────────────────

function TryIt({ sign, cameraError }) {
  const [mirrored, setMirrored] = useState(() => cameraManager.isFrontCamera());
  const [meter, setMeter] = useState({ level: 0, distance: Infinity, radius: 0 });
  const [overall, setOverall] = useState(null);
  const frameRef = useRef(null);
  const lastPush = useRef(0);
  // Every frame goes through the same smoothing as the translator, so "what
  // the translator sees" here is exactly what it would say.
  const trackerRef = useRef(createSignBridgeTracker());

  useEffect(() => cameraManager.subscribe((s) => setMirrored(s.isFrontCamera)), []);

  const onFrame = useCallback((result) => {
    frameRef.current = recognizer.packFrame(result.pose, result.hands, mirrored);
    const now = performance.now();
    const hit = trackerRef.current.classify(result.hands, result.pose, { mirrored, t: now });
    if (now - lastPush.current < 100) return;          // 10 UI updates / second
    lastPush.current = now;
    setMeter(matchMeter(result.hands, result.pose, sign.id, { mirrored, index: currentIndex() }));
    setOverall(hit?.token ? { token: hit.token, engine: hit.engine, confidence: hit.confidence } : null);
  }, [mirrored, sign.id]);

  const { ready, error } = useLandmarkLoop(true, onFrame);
  const inside = meter.distance <= meter.radius;

  return (
    <div className="space-y-3">
      <div className="relative aspect-[3/4] overflow-hidden rounded-2xl">
        <CameraStage className="absolute inset-0" />
        <FlipCameraButton className="absolute right-2 top-2 z-20" />
        <LandmarkCanvas frameRef={frameRef} mirrored={mirrored} />
        {(!ready || cameraError || error) && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/85 px-6 text-center text-sm">
            {cameraError || error || 'Loading hand tracking…'}
          </div>
        )}
      </div>

      <section className="surface-card p-4">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-ink-dim">
          <Hand size={13} /> Match with {sign.token}
        </p>
        <div className="mt-2 h-3 overflow-hidden rounded-full bg-card-highest">
          <div
            className={'h-full transition-all ' + (inside ? 'bg-primary' : 'bg-amber')}
            style={{ width: `${Math.round(meter.level * 100)}%` }}
          />
        </div>
        <p className="mt-1 text-[11px] text-ink-dim">
          {Number.isFinite(meter.distance)
            ? `${inside ? 'Inside' : 'Outside'} its acceptance radius (${meter.distance.toFixed(3)} / ${meter.radius.toFixed(3)})`
            : 'Show the sign to the camera'}
        </p>
        <p className="mt-2 text-sm">
          Recognised now:{' '}
          {overall
            ? <b className={overall.engine === 'custom' ? 'text-amber' : 'text-primary'}>{overall.token} <span className="text-[10px] font-normal">({overall.engine === 'custom' ? 'my sign' : 'built-in'} {Math.round(overall.confidence * 100)}%)</span></b>
            : <span className="text-ink-dim">nothing</span>}
        </p>
      </section>
    </div>
  );
}
