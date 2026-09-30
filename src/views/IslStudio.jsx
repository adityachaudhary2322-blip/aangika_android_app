import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Play, Square, Volume2, Eraser, Plus, Pencil, Trash2, Upload, Video, Lock,
  Loader2, Search, RefreshCw, CircleStop, Check, AlertTriangle,
} from 'lucide-react';
import CameraStage from '../components/CameraStage.jsx';
import cameraManager from '../services/cameraManager.js';
import useLandmarkLoop from '../hooks/useLandmarkLoop.js';
import { frameFeatures, describeFeatures } from '../services/isl/islFeatures.js';
import { createSpotter, calibrate, toTemplate, dtwCost, SAMPLE_MS } from '../services/isl/islSpotter.js';
import isl, { tokenFor } from '../services/isl/islDictionary.js';
import { translateStudio, matchStudioRules } from '../services/isl/islTranslate.js';
import devSession from '../services/sharedDictionary.js';
import { speak, unlockAudio } from '../services/ttsService.js';

const CATEGORIES = ['pronoun', 'person', 'action', 'thing', 'place', 'time', 'describing', 'question', 'negation', 'other'];
const TYPES = [
  ['word', 'Word'], ['name', 'Name'], ['sentence', 'Whole sentence'], ['full-stop', 'FULL STOP (ends the sentence)'],
];
const TABS = [['translate', 'Translate'], ['dictionary', 'Dictionary'], ['rules', 'Rules']];

/**
 * ISL Studio: the team's own Indian Sign Language dictionary and translator.
 * Signs are recorded by the team (upper-body features: both hands, every
 * finger joint, where the hands are on the body), each assigned a word.
 * Signing continuously builds a sentence; the FULL STOP sign speaks it and
 * starts the next one. Separate from SignBridge and the word model.
 */
export default function IslStudio({ onBack, language, mode }) {
  const [tab, setTab] = useState('translate');
  const [signs, setSigns] = useState(() => isl.listSigns());
  const [syncState, setSyncState] = useState(null);
  const [unlocked, setUnlocked] = useState(() => devSession.isUnlocked());

  useEffect(() => devSession.onDevChange(setUnlocked), []);
  useEffect(() => {
    const refresh = () => setSigns(isl.listSigns());
    const off = isl.subscribe(refresh);
    isl.init().then(refresh).then(() => isl.sync().then(setSyncState).catch((e) => setSyncState(e.message)));
    return off;
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={onBack} aria-label="Back" className="btn-icon"><ArrowLeft size={18} /></button>
        <div className="min-w-0">
          <h1 className="display text-2xl leading-none">ISL Studio</h1>
          <p className="text-[11px] text-ink-dim">Indian Sign Language · your team's dictionary · {signs.length} signs</p>
        </div>
      </header>
      <div role="tablist" className="mx-4 flex gap-1 rounded-2xl bg-card-high p-1">
        {TABS.map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            className={'flex-1 rounded-xl py-2 text-xs font-semibold transition ' + (tab === id ? 'bg-card text-ink shadow-card' : 'text-ink-dim')}>
            {label}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-6 pt-3 no-scrollbar">
        {tab === 'translate' && <TranslateTab signs={signs} language={language} mode={mode} onDictionary={() => setTab('dictionary')} />}
        {tab === 'dictionary' && <DictionaryTab signs={signs} unlocked={unlocked} syncState={syncState} onSync={() => isl.sync({ force: true }).then(setSyncState).catch((e) => setSyncState(e.message))} />}
        {tab === 'rules' && <RulesTab signs={signs} unlocked={unlocked} />}
      </div>
    </div>
  );
}

// ── Translate: continuous signing, FULL STOP speaks ─────────────────────────

function TranslateTab({ signs, language, mode, onDictionary }) {
  const [running, setRunning] = useState(false);
  const [sentence, setSentence] = useState([]);           // signs of the current sentence
  const [history, setHistory] = useState([]);             // finished sentences
  const [analysis, setAnalysis] = useState([]);
  const [busy, setBusy] = useState(false);
  const sentenceRef = useRef([]);
  const lastSample = useRef(0);
  const lastAnalysis = useRef(0);
  const byId = useMemo(() => new Map(signs.map((s) => [s.id, s])), [signs]);
  const spotter = useMemo(() => createSpotter(signs.map((s) => ({
    id: s.id, token: s.token, takes: s.takes, tau: s.tau, eitherHand: s.hands === 'either',
  }))), [signs]);
  const hasStop = signs.some((s) => s.type === 'full-stop');

  const finish = useCallback(async () => {
    const words = sentenceRef.current;
    if (!words.length) return;
    sentenceRef.current = [];
    setSentence([]);
    setBusy(true);
    try {
      const r = await translateStudio(words, language, { mode });
      const text = r.translated || r.english;
      setHistory((h) => [{ signs: words, english: r.english, translated: r.translated, engine: r.engine, at: Date.now() }, ...h].slice(0, 20));
      if (text) speak(text, language);
    } finally {
      setBusy(false);
    }
  }, [language, mode]);

  const onFrame = useCallback((result, ts) => {
    if (ts - lastSample.current < SAMPLE_MS) return;
    lastSample.current = ts;
    const f = frameFeatures({ hands: result.hands, pose: result.pose, mirrored: cameraManager.isFrontCamera() });
    if (ts - lastAnalysis.current > 250) { lastAnalysis.current = ts; setAnalysis(describeFeatures(f)); }
    for (const hit of spotter.push(f)) {
      const sign = byId.get(hit.id);
      if (!sign) continue;
      if (sign.type === 'full-stop') { finish(); continue; }
      sentenceRef.current = [...sentenceRef.current, sign];
      setSentence(sentenceRef.current);
    }
  }, [spotter, byId, finish]);

  const { ready, error } = useLandmarkLoop(running, onFrame);

  const start = async () => {
    await unlockAudio();
    await cameraManager.start().catch(() => {});
    spotter.reset();
    setRunning(true);
  };

  if (!signs.length) {
    return (
      <div className="surface-card p-5 text-center text-sm">
        <p className="font-semibold">No ISL Studio signs yet</p>
        <p className="mt-1 text-[12px] text-ink-dim">Your team records each sign and gives it its word. Include a FULL STOP sign to end sentences.</p>
        <button type="button" onClick={onDictionary} className="btn-primary mt-3">Open the dictionary</button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-3xl border border-subtle bg-black">
        <CameraStage className="absolute inset-0" />
        {!running && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface/85 px-6 text-center">
            <button type="button" onClick={start} aria-label="Start ISL Studio" className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-fill-a to-fill-b text-white shadow-glow">
              <Play size={26} className="ml-1" />
            </button>
            <p className="text-sm font-semibold">Sign whole sentences without stopping</p>
            <p className="max-w-xs text-[11px] text-ink-dim">
              Keep your upper body in view: hands, face and shoulders. {hasStop ? 'Sign FULL STOP to speak the sentence.' : 'No FULL STOP sign recorded yet: use "Say it now".'}
            </p>
          </div>
        )}
        {running && (!ready || error) && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/85 text-sm">{error || <Loader2 className="animate-spin" />}</div>
        )}
        {running && ready && (
          <div className="absolute inset-x-2 bottom-2 space-y-1">
            {analysis.length === 0 && <span className="pill chrome-plate text-[11px]">No hands in view</span>}
            {analysis.map((a) => <span key={a.side} className="pill chrome-plate mr-1 text-[11px]">{a.text}</span>)}
          </div>
        )}
      </div>

      <section className="surface-card p-3">
        <div className="flex items-center gap-2">
          <p className="eyebrow">Sentence so far</p>
          {busy && <Loader2 size={13} className="animate-spin text-primary" />}
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={finish} disabled={!sentence.length} className="btn-quiet px-3 py-1.5 text-xs"><CircleStop size={13} /> Say it now</button>
            <button type="button" onClick={() => { sentenceRef.current = []; setSentence([]); }} disabled={!sentence.length} aria-label="Clear sentence" className="btn-icon"><Eraser size={14} /></button>
            {running && <button type="button" onClick={() => setRunning(false)} aria-label="Stop camera" className="btn-icon"><Square size={13} /></button>}
          </div>
        </div>
        <div className="mt-2 flex min-h-[2rem] flex-wrap gap-1.5">
          {!sentence.length && <span className="text-xs text-ink-dim">Signs appear here as you sign.</span>}
          {sentence.map((s, i) => <span key={`${s.id}-${i}`} className="pill animate-fade-up border-subtle bg-card-high text-ink">{s.word}</span>)}
        </div>
      </section>

      {history.map((h) => (
        <section key={h.at} className="surface-card animate-fade-up p-3">
          <p className="text-lg font-bold leading-snug">{h.translated || h.english}</p>
          {h.translated && <p className="text-xs text-ink-dim">{h.english}</p>}
          <div className="mt-1 flex items-center gap-2 text-[10px] text-ink-dim">
            <span>{h.signs.map((s) => s.word).join(' · ')} · {h.engine}</span>
            <button type="button" onClick={() => speak(h.translated || h.english, language)} aria-label="Play again" className="ml-auto text-primary"><Volume2 size={14} /></button>
          </div>
        </section>
      ))}
    </div>
  );
}

// ── Dictionary: record, assign, edit, delete, publish ───────────────────────

function DictionaryTab({ signs, unlocked, syncState, onSync }) {
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);           // sign draft being edited / recorded
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const code = devSession.getDevCode();
  const q = query.trim().toLowerCase();

  const run = async (fn, text) => {
    setBusy(true); setMsg(null);
    try { await fn(); if (text) setMsg({ tone: 'primary', text }); } catch (err) {
      setMsg({ tone: 'rose', text: err.rejected?.length ? `${err.message} ${err.rejected.join('; ')}` : err.message });
    }
    setBusy(false);
  };

  if (editing) {
    return (
      <SignEditor
        sign={editing}
        others={signs.filter((s) => s.id !== editing.id)}
        onCancel={() => setEditing(null)}
        onSaved={(d) => { setEditing(null); setMsg({ tone: 'primary', text: `“${d.word}” saved on this device. Publish it to share it with everyone.` }); }}
      />
    );
  }

  const drafts = signs.filter((s) => s.status !== 'published');
  return (
    <div className="space-y-3">
      {!unlocked && <UnlockCard />}
      <div className="flex items-center gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-2xl border border-subtle bg-card px-3 py-2">
          <Search size={14} className="text-ink-dim" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a word" className="w-full bg-transparent text-sm outline-none" />
        </div>
        <button type="button" onClick={onSync} aria-label="Update dictionary" className="btn-icon"><RefreshCw size={14} /></button>
      </div>
      {syncState && <p className="text-[10px] text-ink-dim">Dictionary: {syncState === 'current' ? 'up to date' : syncState === 'updated' ? 'updated' : syncState}</p>}
      {unlocked && (
        <div className="flex gap-2">
          <button type="button" onClick={() => setEditing({ word: '', type: 'word', category: 'other', hands: 'one', texts: {}, takes: [] })} className="btn-primary flex-1"><Plus size={15} /> Record a new sign</button>
          {drafts.length > 0 && (
            <button type="button" disabled={busy} onClick={() => run(() => isl.publish(code, drafts.map((d) => d.id)), `${drafts.length} sign(s) published for everyone.`)} className="btn-quiet px-3 text-xs">
              <Upload size={13} /> Publish {drafts.length}
            </button>
          )}
        </div>
      )}
      {msg && <p className={'text-[11px] ' + (msg.tone === 'rose' ? 'text-rose' : 'text-primary')}>{msg.text}</p>}
      {!signs.some((s) => s.type === 'full-stop') && (
        <p className="flex items-start gap-1.5 rounded-2xl border border-amber/30 bg-amber/10 px-3 py-2 text-[11px] text-amber">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> No FULL STOP sign yet. Record one (type “FULL STOP”) so signers can end a sentence.
        </p>
      )}
      <ul className="space-y-2">
        {signs.filter((s) => !q || s.word.toLowerCase().includes(q) || s.token.toLowerCase().includes(q)).map((s) => (
          <li key={s.id} className="rounded-2xl border border-subtle bg-card p-3">
            <p className="text-sm font-semibold">
              {s.word}
              {s.type === 'full-stop' && <span className="ml-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">FULL STOP</span>}
              <span className={'ml-2 text-[10px] ' + (s.status === 'published' ? 'text-primary' : 'text-amber')}>{s.status}</span>
            </p>
            <p className="text-[10px] text-ink-dim">{s.token} · {s.type} · {s.category} · {s.hands === 'two' ? 'two hands' : s.hands === 'either' ? 'either hand' : 'one hand'} · {s.takes.length} takes
              {s.texts?.['hi-IN'] ? ` · ${s.texts['hi-IN']}` : ''}{s.texts?.hinglish ? ` · ${s.texts.hinglish}` : ''}</p>
            {unlocked && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => setEditing({ ...s })} className="btn-quiet px-3 py-1.5 text-xs"><Pencil size={12} /> Edit / reassign</button>
                <button type="button" onClick={() => setEditing({ ...s, takes: [], rerecord: true })} className="btn-quiet px-3 py-1.5 text-xs"><Video size={12} /> Re-record</button>
                {s.status !== 'published' && (
                  <button type="button" onClick={() => run(() => isl.discardDraft(s.id), 'Draft discarded.')} className="btn-quiet px-3 py-1.5 text-xs">Discard draft</button>
                )}
                {s.status !== 'draft' && (
                  <button type="button" disabled={busy} onClick={() => run(() => isl.removeSigns(code, [s.id]), `“${s.word}” deleted for everyone.`)} className="btn-quiet px-3 py-1.5 text-xs text-rose"><Trash2 size={12} /> Delete for everyone</button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function UnlockCard() {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="surface-card flex items-center gap-2 p-3" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setMsg(null);
      try { if (!(await devSession.unlock(code))) setMsg('Wrong developer code.'); } catch (err) { setMsg(err.message); }
      setBusy(false);
    }}>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">For developers: record and edit signs</p>
        <input type="password" inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Developer code" aria-label="Developer code" className="field mt-1 py-2 text-sm" />
        {msg && <p className="mt-1 text-[11px] text-rose">{msg}</p>}
      </div>
      <button type="submit" disabled={busy || !code.trim()} className="btn-primary px-4 py-2 text-sm"><Lock size={14} /> Unlock</button>
    </form>
  );
}

/** Word, meaning and category; then (re)record the takes. */
function SignEditor({ sign, others, onCancel, onSaved }) {
  const [v, setV] = useState({
    word: sign.word || '', type: sign.type || 'word', category: sign.category || 'other', hands: sign.hands || 'one',
    hi: sign.texts?.['hi-IN'] || '', hinglish: sign.texts?.hinglish || '',
  });
  const [takes, setTakes] = useState(sign.takes || []);
  const [recording, setRecording] = useState(Boolean(sign.rerecord) || !(sign.takes || []).length);
  const [error, setError] = useState(null);

  const save = async () => {
    setError(null);
    try {
      const d = await isl.saveDraft({
        id: sign.id, word: v.word, type: v.type, category: v.category, hands: v.hands,
        token: tokenFor(v.word), texts: { ...(v.hi ? { 'hi-IN': v.hi } : {}), ...(v.hinglish ? { hinglish: v.hinglish } : {}) },
        takes,
      });
      onSaved(d);
    } catch (err) { setError(err.message); }
  };

  return (
    <div className="space-y-3">
      <section className="surface-card space-y-2 p-3">
        <p className="text-sm font-semibold">{sign.id ? `Edit “${sign.word}”` : 'New sign'}</p>
        <label className="block text-[11px] text-ink-dim">Word this sign means
          <input value={v.word} onChange={(e) => setV({ ...v, word: e.target.value })} placeholder="e.g. water, Rahul, full stop" className="field mt-1 py-2 text-sm" />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-[11px] text-ink-dim">Type
            <select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} className="field mt-1 py-2 text-sm">
              {TYPES.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          <label className="block text-[11px] text-ink-dim">Category (for rules)
            <select value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} className="field mt-1 py-2 text-sm">
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-[11px] text-ink-dim">Hands
          <select value={v.hands} onChange={(e) => setV({ ...v, hands: e.target.value })} className="field mt-1 py-2 text-sm">
            <option value="one">One hand (as recorded)</option>
            <option value="either">One hand, either side</option>
            <option value="two">Two hands</option>
          </select>
        </label>
        <label className="block text-[11px] text-ink-dim">Hindi (optional, used offline)
          <input value={v.hi} onChange={(e) => setV({ ...v, hi: e.target.value })} className="field mt-1 py-2 text-sm" />
        </label>
        <label className="block text-[11px] text-ink-dim">Hinglish (optional)
          <input value={v.hinglish} onChange={(e) => setV({ ...v, hinglish: e.target.value })} className="field mt-1 py-2 text-sm" />
        </label>
      </section>

      {recording ? (
        <Recorder others={others} onDone={(t) => { setTakes(t); setRecording(false); }} onCancel={() => (takes.length ? setRecording(false) : onCancel())} />
      ) : (
        <section className="surface-card p-3 text-[12px]">
          <p><Check size={13} className="mr-1 inline text-primary" />{takes.length} takes recorded.</p>
          <button type="button" onClick={() => setRecording(true)} className="btn-quiet mt-2 px-3 py-1.5 text-xs"><Video size={12} /> Record again</button>
        </section>
      )}
      {error && <p className="text-[11px] text-rose">{error}</p>}
      {!recording && (
        <div className="flex gap-2">
          <button type="button" onClick={save} disabled={!v.word.trim() || !takes.length} className="btn-primary flex-1">Save sign</button>
          <button type="button" onClick={onCancel} className="btn-quiet px-4">Cancel</button>
        </div>
      )}
    </div>
  );
}

const TAKES = 3;
const DURATIONS = [[1.5, 'Short (1.5 s)'], [2.5, 'Normal (2.5 s)'], [4, 'Long (4 s)']];

/** Three takes with a countdown; checks quality and similarity to other signs. */
function Recorder({ others, onDone, onCancel }) {
  const [duration, setDuration] = useState(2.5);
  const [takes, setTakesState] = useState([]);
  // The frame callback outlives renders: read takes through a ref, never a stale copy.
  const takesRef = useRef([]);
  const setTakes = (t) => { takesRef.current = t; setTakesState(t); };
  const [phase, setPhase] = useState('idle');     // idle | countdown | recording
  const [count, setCount] = useState(0);
  const [analysis, setAnalysis] = useState([]);
  const [notes, setNotes] = useState([]);
  const frames = useRef([]);
  const until = useRef(0);
  const lastSample = useRef(0);

  const onFrame = useCallback((result, ts) => {
    if (ts - lastSample.current < SAMPLE_MS) return;
    lastSample.current = ts;
    const f = frameFeatures({ hands: result.hands, pose: result.pose, mirrored: cameraManager.isFrontCamera() });
    setAnalysis(describeFeatures(f));
    if (phase === 'recording') {
      frames.current.push(Array.from(f));
      if (ts >= until.current) finishTake();
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  const { ready, error } = useLandmarkLoop(true, onFrame);
  useEffect(() => { cameraManager.start().catch(() => {}); }, []);

  function finishTake() {
    const take = frames.current;
    frames.current = [];
    setPhase('idle');
    const hands = take.filter((f) => f[0] > 0.5 || f[48] > 0.5).length / Math.max(1, take.length);
    const body = take.filter((f) => f[99] > 0.5).length / Math.max(1, take.length);
    const note = hands < 0.5 ? 'Hands were missing in much of this take: try again.'
      : body < 0.5 ? 'Shoulders were not visible: step back so your upper body is in view.' : null;
    if (note) { setNotes([note]); return; }
    const next = [...takesRef.current, take];
    setTakes(next);
    if (next.length === TAKES) review(next);
  }

  function review(all) {
    const templates = all.map((t) => toTemplate(t)).filter((t) => t.length);
    const tau = calibrate(templates);
    const out = [`Consistency between takes: ${tau < 0.09 ? 'good' : tau < 0.15 ? 'fair' : 'low (sign it the same way each time)'}.`];
    for (const o of others) {
      const ot = (o.takes || []).map((t) => toTemplate(t)).filter((t) => t.length);
      if (!ot.length) continue;
      const otau = o.tau || calibrate(ot);
      const c = Math.min(...ot.map((tpl) => dtwCost(tpl, templates[0])));
      if (c <= otau) out.push(`Looks like “${o.word}”: make them more different (hand shape, place or movement).`);
    }
    setNotes(out);
  }

  const startTake = () => {
    setNotes([]);
    setPhase('countdown');
    let n = 3;
    setCount(n);
    const id = setInterval(() => {
      n -= 1;
      setCount(n);
      if (n === 0) {
        clearInterval(id);
        frames.current = [];
        until.current = performance.now() + duration * 1000;
        setPhase('recording');
      }
    }, 800);
  };

  return (
    <section className="surface-card space-y-2 p-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-2xl bg-black">
        <CameraStage className="absolute inset-0" />
        {(!ready || error) && <div className="absolute inset-0 flex items-center justify-center bg-surface/85 text-sm">{error || 'Loading hand and body tracking…'}</div>}
        {phase === 'countdown' && <div className="absolute inset-0 flex items-center justify-center text-6xl font-bold text-white drop-shadow">{count}</div>}
        {phase === 'recording' && <div className="absolute left-2 top-2 rounded-full bg-rose px-3 py-1 text-xs font-bold text-white">● Sign now</div>}
        <div className="absolute inset-x-2 bottom-2">
          {analysis.map((a) => <span key={a.side} className="pill chrome-plate mr-1 text-[11px]">{a.text}</span>)}
        </div>
      </div>
      <p className="text-[12px]">Take {Math.min(takes.length + 1, TAKES)} of {TAKES}. Start in rest position, sign once, return to rest. Keep face, shoulders and both hands in view.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Take length" className="field w-auto py-1.5 text-xs">
          {DURATIONS.map(([d, label]) => <option key={d} value={d}>{label}</option>)}
        </select>
        {takes.length < TAKES ? (
          <button type="button" onClick={startTake} disabled={!ready || phase !== 'idle'} className="btn-primary px-4 py-2 text-sm">
            <Video size={14} /> {phase === 'idle' ? `Record take ${takes.length + 1}` : 'Recording…'}
          </button>
        ) : (
          <button type="button" onClick={() => onDone(takes)} className="btn-primary px-4 py-2 text-sm"><Check size={14} /> Use these takes</button>
        )}
        {takes.length > 0 && <button type="button" onClick={() => { setTakes([]); setNotes([]); }} className="btn-quiet px-3 py-2 text-xs">Start over</button>}
        <button type="button" onClick={onCancel} className="btn-quiet px-3 py-2 text-xs">Cancel</button>
      </div>
      {notes.map((n) => <p key={n} className="text-[11px] text-amber">{n}</p>)}
    </section>
  );
}

// ── Rules: this dictionary's own grammar ────────────────────────────────────

function RulesTab({ signs, unlocked }) {
  const [rules, setRules] = useState(() => isl.getRules());
  const [test, setTest] = useState('');
  const [draft, setDraft] = useState(null);
  const [msg, setMsg] = useState(null);
  useEffect(() => isl.subscribe(() => setRules(isl.getRules())), []);

  const find = (w) => signs.find((s) => s.token === tokenFor(w) || s.word.toLowerCase() === w.toLowerCase());
  const testSigns = test.trim() ? test.trim().split(/[\s,+]+/).map(find) : [];
  const unknown = test.trim().split(/[\s,+]+/).filter((w, i) => w && !testSigns[i]);
  const toRule = (d) => ({
    id: (d.english || 'rule').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'rule',
    pattern: d.pattern.trim().split(/[\s,+]+/).map((p) => (p.startsWith('@') ? p.toLowerCase() : p.toUpperCase())),
    english: d.english.trim(),
    texts: { ...(d.hi ? { 'hi-IN': d.hi.trim() } : {}), ...(d.hinglish ? { hinglish: d.hinglish.trim() } : {}) },
  });
  const preview = testSigns.length && !unknown.length
    ? matchStudioRules(testSigns, draft?.pattern && draft?.english ? [toRule(draft), ...rules] : rules)
    : null;
  const save = async (next, text) => {
    setMsg(null);
    try { await isl.saveRules(devSession.getDevCode(), next); setMsg({ tone: 'primary', text }); } catch (err) { setMsg({ tone: 'rose', text: err.message }); }
  };

  return (
    <div className="space-y-3">
      <section className="surface-card p-3">
        <p className="text-xs font-semibold">Try a sentence (words of your signs)</p>
        <input value={test} onChange={(e) => setTest(e.target.value)} placeholder="e.g. I hospital go" aria-label="Signs to try" className="field mt-1 py-2 text-sm" />
        {unknown.length > 0 && <p className="mt-1 text-[11px] text-amber">Not in the dictionary: {unknown.join(', ')}</p>}
        {preview && <p className="mt-2 text-[12px]"><b>{preview.english}</b> {preview.texts['hi-IN'] && `· ${preview.texts['hi-IN']}`} {preview.texts.hinglish && `· ${preview.texts.hinglish}`} <span className="text-[10px] text-ink-dim">({preview.rule})</span></p>}
        {testSigns.length > 0 && !unknown.length && !preview && <p className="mt-2 text-[11px] text-ink-dim">No rule of this dictionary matches: the app's general grammar will make the sentence.</p>}
      </section>

      <p className="text-[11px] text-ink-dim">
        Rules match a whole sentence. Pattern items: a sign's word (WATER), a category (@pronoun @person @action @thing @place @time @describing @question @negation @other) or @name; add ? for optional.
        In the text, {'{'}place{'}'}, {'{'}name{'}'} … insert the matched sign's word (its Hindi / Hinglish in those texts).
      </p>
      {unlocked && (
        <button type="button" onClick={() => setDraft(draft ? null : { pattern: '', english: '', hi: '', hinglish: '' })} className="btn-quiet w-full py-2 text-xs"><Plus size={12} /> New rule</button>
      )}
      {draft && (
        <form className="surface-card space-y-2 p-3" onSubmit={(e) => { e.preventDefault(); const r = toRule(draft); save([...rules.filter((x) => x.id !== r.id), r], `Rule “${r.english}” saved for everyone.`); setDraft(null); }}>
          <input value={draft.pattern} onChange={(e) => setDraft({ ...draft, pattern: e.target.value })} placeholder="@pronoun @place GO" aria-label="Rule pattern" className="field py-2 text-sm" />
          <input value={draft.english} onChange={(e) => setDraft({ ...draft, english: e.target.value })} placeholder="I am going to the {place}." aria-label="Rule English" className="field py-2 text-sm" />
          <input value={draft.hi} onChange={(e) => setDraft({ ...draft, hi: e.target.value })} placeholder="मुझे {place} जाना है।" aria-label="Rule Hindi" className="field py-2 text-sm" />
          <input value={draft.hinglish} onChange={(e) => setDraft({ ...draft, hinglish: e.target.value })} placeholder="Mujhe {place} jaana hai." aria-label="Rule Hinglish" className="field py-2 text-sm" />
          <button type="submit" disabled={!draft.pattern.trim() || !draft.english.trim()} className="btn-primary w-full py-2 text-sm">Save rule for everyone</button>
        </form>
      )}
      {msg && <p className={'text-[11px] ' + (msg.tone === 'rose' ? 'text-rose' : 'text-primary')}>{msg.text}</p>}
      <ul className="space-y-1.5">
        {!rules.length && <li className="text-[11px] text-ink-dim">No rules yet. Without rules, the app's built-in phrase rules and grammar are used.</li>}
        {rules.map((r) => (
          <li key={r.id} className="flex items-start gap-2 rounded-2xl border border-subtle bg-card px-3 py-2 text-[12px]">
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[11px] text-primary">{r.pattern.join(' + ')}</p>
              <p>{r.english}</p>
              {r.texts?.['hi-IN'] && <p className="text-ink-dim">{r.texts['hi-IN']}</p>}
              {r.texts?.hinglish && <p className="text-ink-dim">{r.texts.hinglish}</p>}
            </div>
            {unlocked && <button type="button" onClick={() => save(rules.filter((x) => x.id !== r.id), 'Rule deleted for everyone.')} aria-label="Delete rule" className="text-rose"><Trash2 size={14} /></button>}
          </li>
        ))}
      </ul>
    </div>
  );
}
