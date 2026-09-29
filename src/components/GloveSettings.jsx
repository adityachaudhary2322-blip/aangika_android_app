import { useEffect, useRef, useState } from 'react';
import {
  Bluetooth, Wifi, Volume2, Loader2, Trash2, AlertTriangle, Battery,
} from 'lucide-react';
import glove from '../services/glove/glove.js';
import { webBluetoothTransport, webSocketTransport, webBluetoothBlocker } from '../services/glove/transports.js';
import { FINGERS } from '../services/glove/protocol.js';
import { featureOf, MOTION_FRAMES } from '../services/glove/recognizer.js';
import {
  listSigns, subscribe as subscribeSigns, saveSign, deleteSign, tokenFromText, isReservedToken,
} from '../services/customSigns.js';

const TAKES = 3;
const STATIC_MS = 2000;
const MOTION_MS = 1000;
const PER_TAKE = 20;

/** Evenly keep n items (static takes) / resample to exactly n (motion). */
const pickN = (list, n) => Array.from({ length: n }, (_, i) => list[Math.min(list.length - 1, Math.floor((i * list.length) / n))]);

/**
 * Settings > Glove: connect, calibrate, see the sensors, teach glove signs.
 * The same component works in the Android app, where the transport is the
 * native BLE plugin instead of Web Bluetooth.
 */
export default function GloveSettings() {
  const [s, setS] = useState(glove.getState());
  const [wsUrl, setWsUrl] = useState('ws://192.168.4.1:81');
  const [busy, setBusy] = useState(null);
  const [note, setNote] = useState(null);
  const blocker = webBluetoothBlocker();
  useEffect(() => glove.subscribe(setS), []);

  const run = async (label, fn) => {
    setBusy(label);
    setNote(null);
    try { await fn(); } catch (err) { setNote({ tone: 'rose', text: err.message }); }
    setBusy(null);
  };

  const f = s.frame;
  const connected = s.status === 'connected';

  return (
    <section className="mt-4 surface-card p-4" data-tour="glove">
      <p className="eyebrow">Glove</p>
      <p className="mt-1 text-[11px] text-ink-dim">
        The Aangika one-hand glove: five finger sensors and a motion sensor, over Bluetooth or Wi-Fi.
      </p>

      {!connected && (
        <div className="mt-3 space-y-2">
          <button type="button" disabled={Boolean(blocker) || busy} onClick={() => run('ble', () => glove.connect(webBluetoothTransport()))}
            className="btn-quiet flex w-full items-center justify-center gap-2 disabled:opacity-50">
            {busy === 'ble' ? <Loader2 size={14} className="animate-spin" /> : <Bluetooth size={14} />} Connect over Bluetooth
          </button>
          {blocker && <p className="flex gap-1.5 text-[11px] text-amber"><AlertTriangle size={13} className="shrink-0" /> {blocker}</p>}
          <div className="flex gap-2">
            <input value={wsUrl} onChange={(e) => setWsUrl(e.target.value)} aria-label="Glove Wi-Fi address"
              className="min-w-0 flex-1 rounded-lg border border-subtle bg-surface px-3 py-2 font-mono text-xs" />
            <button type="button" disabled={Boolean(busy)} onClick={() => run('ws', () => glove.connect(webSocketTransport(wsUrl)))}
              className="btn-quiet flex items-center gap-1.5 px-3 text-xs"><Wifi size={13} /> Wi-Fi</button>
          </div>
        </div>
      )}

      {connected && (
        <div className="mt-3">
          <div className="flex items-center gap-2 text-[12px]">
            <span className="font-semibold text-primary">Connected</span>
            <span className="text-ink-dim">{s.name} · {s.kind} · {s.rateHz} Hz</span>
            {f && (
              <span className={'ml-auto flex items-center gap-1 ' + (f.lowBattery ? 'text-rose' : 'text-ink-dim')}>
                <Battery size={13} /> {f.battery}%
              </span>
            )}
          </div>
          {f && !f.calibrated && <p className="mt-1 text-[11px] text-amber">Not calibrated yet: do Open, then Fist.</p>}
          {f && !f.imuOk && <p className="mt-1 text-[11px] text-amber">Motion sensor not responding (check SDA/SCL wiring).</p>}

          <div className="mt-2 space-y-1" aria-label="Finger bend">
            {FINGERS.map((name, i) => (
              <div key={name} className="flex items-center gap-2 text-[10px]">
                <span className="w-12 text-ink-dim">{name}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-card-highest">
                  <div className="h-full bg-primary" style={{ width: `${((f?.flex[i] || 0) / 255) * 100}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums">{f?.flex[i] ?? 0}</span>
              </div>
            ))}
          </div>
          {f && (
            <p className="mt-2 text-[10px] tabular-nums text-ink-dim">
              roll {f.roll.toFixed(0)}° · pitch {f.pitch.toFixed(0)}°{f.extended ? '' : ' (from gravity)'}
            </p>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" onClick={() => run('open', glove.calibrateOpen)} className="btn-quiet text-xs">Calibrate open</button>
            <button type="button" onClick={() => run('fist', glove.calibrateFist)} className="btn-quiet text-xs">Calibrate fist</button>
            <button type="button" onClick={() => run('beep', () => glove.beep(880, 150))} className="btn-quiet flex items-center justify-center gap-1 text-xs"><Volume2 size={13} /> Test beep</button>
            <button type="button" onClick={() => run('wifi', glove.wifiSetup)} className="btn-quiet text-xs">Wi-Fi setup</button>
          </div>
          <button type="button" onClick={() => glove.disconnect()} className="mt-2 w-full text-[11px] text-ink-dim">Disconnect</button>

          <TeachGloveSign />
        </div>
      )}

      {note && <p className={`mt-2 text-[11px] ${note.tone === 'rose' ? 'text-rose' : 'text-primary'}`}>{note.text}</p>}
    </section>
  );
}

function TeachGloveSign() {
  const [text, setText] = useState('');
  const [motion, setMotion] = useState(false);
  const [takes, setTakes] = useState([]);
  const [phase, setPhase] = useState('idle');
  const [count, setCount] = useState(3);
  const [msg, setMsg] = useState(null);
  const [signs, setSigns] = useState(() => listSigns().filter((x) => x.kind?.startsWith('glove')));
  const bufRef = useRef(null);
  useEffect(() => subscribeSigns((l) => setSigns(l.filter((x) => x.kind?.startsWith('glove')))), []);
  useEffect(() => glove.onFrame((fr) => { if (bufRef.current) bufRef.current.push(fr); }), []);

  const token = tokenFromText(text);
  const recordTake = async () => {
    setMsg(null);
    setPhase('countdown');
    for (let n = 3; n > 0; n -= 1) {
      setCount(n);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 600));
    }
    bufRef.current = [];
    setPhase('recording');
    await new Promise((r) => setTimeout(r, motion ? MOTION_MS : STATIC_MS));
    const frames = bufRef.current;
    bufRef.current = null;
    setPhase('idle');
    if (frames.length < (motion ? 20 : 10)) {
      setMsg(`Only ${frames.length} frames arrived. Is the glove still connected?`);
      return;
    }
    const capture = takes.length;
    const sample = motion
      ? [{ capture, seq: pickN(frames, MOTION_FRAMES).map((fr) => Array.from(featureOf(fr))) }]
      : pickN(frames, PER_TAKE).map((fr) => ({ capture, f: Array.from(featureOf(fr)) }));
    setTakes((t) => [...t, sample]);
  };

  const save = async () => {
    try {
      await saveSign({
        token,
        kind: motion ? 'glove-motion' : 'glove',
        output: { type: isReservedToken(token) ? 'gloss' : 'word', text_en: text.trim() },
        samples: takes.flat(),
      });
      setMsg(`Saved ${token}. It is recognised while the glove is connected.`);
      setText(''); setTakes([]);
    } catch (err) {
      setMsg(err.message);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-subtle p-3">
      <p className="text-xs font-semibold">Teach a glove sign</p>
      <p className="mt-0.5 text-[10px] text-ink-dim">
        A word (or a single letter A-Z for fingerspelling). {TAKES} takes: hold a handshape for 2 s, or do a movement for 1 s.
      </p>
      <div className="mt-2 flex gap-2">
        <input value={text} onChange={(e) => { setText(e.target.value); setTakes([]); }} placeholder="e.g. water, or A"
          aria-label="Glove sign word" className="min-w-0 flex-1 rounded-lg border border-subtle bg-surface px-3 py-2 text-sm" />
        <label className="flex items-center gap-1 text-[11px]">
          <input type="checkbox" checked={motion} onChange={(e) => { setMotion(e.target.checked); setTakes([]); }} /> movement
        </label>
      </div>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={!token || phase !== 'idle' || takes.length >= TAKES} onClick={recordTake}
          className="flex-1 rounded-lg bg-primary py-2 text-xs font-semibold text-surface disabled:opacity-40">
          {phase === 'countdown' ? count : phase === 'recording' ? 'Recording…' : `Record take ${takes.length + 1} of ${TAKES}`}
        </button>
        <button type="button" disabled={takes.length < TAKES} onClick={save}
          className="rounded-lg bg-card-highest px-3 text-xs font-semibold disabled:opacity-40">Save</button>
      </div>
      {msg && <p className="mt-1 text-[11px] text-amber">{msg}</p>}
      {signs.length > 0 && (
        <ul className="mt-3 space-y-1">
          {signs.map((x) => (
            <li key={x.id} className="flex items-center gap-2 text-[11px]">
              <b>{x.token}</b>
              <span className="text-ink-dim">{x.kind === 'glove-motion' ? 'movement' : 'handshape'} · {x.samples.length} {x.kind === 'glove-motion' ? 'takes' : 'frames'}</span>
              <button type="button" onClick={() => deleteSign(x.id)} aria-label={`Delete ${x.token}`} className="ml-auto text-ink-dim"><Trash2 size={12} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
