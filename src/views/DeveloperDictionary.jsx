import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, KeyRound, Loader2, Lock, Search, Plus, Pencil, RotateCcw, Trash2, Upload,
  Ban, CheckCircle2, Video, Globe2, Hand,
} from 'lucide-react';
import dictionary from '../services/sharedDictionary.js';
import {
  init as initSigns, listOwnSigns, listSharedSigns, subscribe as subscribeSigns, saveSign, getSign,
} from '../services/customSigns.js';
import { describeBuiltinSigns } from '../services/signbridgeEngine.js';
import { sentenceFor } from '../config/gestureSentences.js';
import { getOverrides, subscribe as subscribeOverrides } from '../services/builtinOverrides.js';
import { setIntent } from '../services/navIntent.js';

/**
 * Developer section: the whole SignBridge dictionary in one place.
 *
 *   Built-in   the 20 rule-based handshapes: which shape makes which word,
 *              and a developer can reassign the word / meaning or disable it
 *   Community  signs published for every user: edit meaning or name,
 *              re-record, delete
 *   Yours      signs taught on this device: publish, edit, re-record
 *
 * Every change here goes to the community dictionary (server), so it reaches
 * every user on the website and in the app. Unlocked with the developer code,
 * which the server checks; the code is held in memory for this session only.
 */
export default function DeveloperDictionary({ onBack, onNavigate }) {
  const [unlocked, setUnlocked] = useState(() => dictionary.isUnlocked());
  useEffect(() => dictionary.onDevChange(setUnlocked), []);

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 px-4 py-3">
        <button type="button" onClick={onBack} aria-label="Back" className="btn-icon"><ArrowLeft size={18} /></button>
        <h1 className="display text-2xl">Developer section</h1>
        {unlocked && (
          <button type="button" onClick={dictionary.lock} className="btn-quiet ml-auto px-3 py-1.5 text-xs">
            <Lock size={13} /> Lock
          </button>
        )}
      </header>
      <div className="flex-1 overflow-y-auto px-4 pb-6 no-scrollbar">
        {!dictionary.isAvailable() && (
          <p className="surface-card p-4 text-sm text-ink-dim">
            The dictionary server is not connected in this build, so there is nothing to manage.
          </p>
        )}
        {dictionary.isAvailable() && !unlocked && <UnlockForm />}
        {dictionary.isAvailable() && unlocked && <Manager onNavigate={onNavigate} />}
      </div>
    </div>
  );
}

function UnlockForm() {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(null);
    try {
      if (!(await dictionary.unlock(code))) setMsg('Wrong developer code.');
    } catch (err) { setMsg(err.message); }
    setBusy(false);
  };
  return (
    <form onSubmit={submit} className="surface-card mx-auto mt-6 max-w-sm p-5 text-center">
      <KeyRound size={26} className="mx-auto text-primary" />
      <p className="mt-2 text-sm font-semibold">For developers</p>
      <p className="mt-1 text-[11px] text-ink-dim">
        Changes here reach every user of the website and the app. The code is checked by the server.
      </p>
      <input
        type="password" inputMode="numeric" autoComplete="off" value={code}
        onChange={(e) => setCode(e.target.value)} placeholder="Developer code" aria-label="Developer code"
        className="field mt-4 text-center"
      />
      <button type="submit" disabled={busy || !code.trim()} className="btn-primary mt-3 w-full">
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />} Unlock
      </button>
      {msg && <p className="mt-2 text-[11px] text-rose">{msg}</p>}
    </form>
  );
}

const TABS = [
  { id: 'builtin', label: 'Built-in' },
  { id: 'community', label: 'Community' },
  { id: 'yours', label: 'Your signs' },
];

function Manager({ onNavigate }) {
  const [tab, setTab] = useState('builtin');
  const [query, setQuery] = useState('');
  const [dict, setDict] = useState(() => dictionary.getLastDict());
  const [overrides, setOv] = useState(() => getOverrides());
  const [own, setOwn] = useState(() => listOwnSigns());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const code = dictionary.getDevCode();

  const refresh = useCallback(async () => {
    try { setDict(await dictionary.fetchFull()); } catch (err) { setMsg({ tone: 'rose', text: err.message }); }
  }, []);
  useEffect(() => { initSigns().then(() => setOwn(listOwnSigns())); refresh(); }, [refresh]);
  useEffect(() => subscribeSigns(() => setOwn(listOwnSigns())), []);
  useEffect(() => subscribeOverrides(setOv), []);

  const run = async (fn, done) => {
    setBusy(true); setMsg(null);
    try {
      await fn();
      await refresh();
      if (done) setMsg({ tone: 'primary', text: done });
    } catch (err) {
      setMsg({ tone: 'rose', text: err.rejected?.length ? `${err.message} ${err.rejected.join('; ')}` : err.message });
    }
    setBusy(false);
  };

  const open = (intent) => { setIntent(intent); onNavigate?.('mysigns'); };
  const q = query.trim().toLowerCase();
  const match = (...fields) => !q || fields.some((f) => String(f || '').toLowerCase().includes(q));
  const serverSigns = dict?.signs || [];
  const counts = { builtin: 20, community: serverSigns.length, yours: own.length };

  return (
    <div>
      <div className="flex items-center gap-2 rounded-2xl border border-subtle bg-card px-3 py-2">
        <Search size={15} className="text-ink-dim" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search a sign or word" className="w-full bg-transparent text-sm outline-none" />
      </div>
      <div role="tablist" className="mt-3 flex gap-1 rounded-2xl bg-card-high p-1">
        {TABS.map((t) => (
          <button
            key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
            className={'flex-1 rounded-xl py-2 text-xs font-semibold transition ' + (tab === t.id ? 'bg-card text-ink shadow-card' : 'text-ink-dim')}
          >
            {t.label} ({counts[t.id]})
          </button>
        ))}
      </div>
      {msg && <p className={'mt-2 text-[11px] ' + (msg.tone === 'rose' ? 'text-rose' : 'text-primary')}>{msg.text}</p>}
      {busy && <p className="mt-2 flex items-center gap-1.5 text-[11px] text-ink-dim"><Loader2 size={12} className="animate-spin" /> Saving for everyone…</p>}

      {tab === 'builtin' && (
        <BuiltinList
          overrides={overrides} match={match} busy={busy}
          onSave={(token, ov, text) => run(() => dictionary.setOverride(code, token, ov), text)}
        />
      )}
      {tab === 'community' && (
        <CommunityList
          signs={serverSigns} own={own} match={match} busy={busy}
          onEdit={(sign, changes) => run(async () => {
            const source = getSign(sign.id) || getSign(`shared:${sign.id}`) || sign;
            const { shared: _s, sharedId: _i, publishedAt: _p, ...rest } = source;
            await dictionary.publish(code, [{ ...rest, ...sign, ...changes, id: sign.id, output: { ...sign.output, ...changes.output } }]);
          }, `${changes.token || sign.token} updated for everyone.`)}
          onRecord={(sign) => run(async () => {
            // A working copy under the published id, so publishing it replaces the old recording.
            if (!getSign(sign.id)) {
              await saveSign({
                id: sign.id, token: sign.token, kind: sign.kind, hands: sign.hands,
                eitherHand: sign.eitherHand, output: sign.output, samples: [],
              });
            }
            open({ action: 'record', signId: sign.id });
          })}
          onDelete={(sign) => run(() => dictionary.removeShared(code, [sign.id]), `${sign.token} deleted for everyone.`)}
        />
      )}
      {tab === 'yours' && (
        <YourList
          own={own} serverSigns={serverSigns} match={match} busy={busy}
          onNew={() => open({ action: 'new' })}
          onEdit={(s) => open({ action: 'edit', signId: s.id })}
          onRecord={(s) => open({ action: 'record', signId: s.id })}
          onPublish={(s) => run(() => dictionary.publish(code, [s]), `${s.token} published: every user gets it on their next update.`)}
        />
      )}
    </div>
  );
}

// ── Built-in signs ──────────────────────────────────────────────────────────

function BuiltinList({ overrides, match, busy, onSave }) {
  const signs = useMemo(() => describeBuiltinSigns(), []);
  const [editing, setEditing] = useState(null);
  return (
    <ul className="mt-3 space-y-2">
      {signs.filter((s) => match(s.token, sentenceFor(s.token), overrides[s.token]?.text_en, overrides[s.token]?.token)).map((s) => {
        const ov = overrides[s.token] || {};
        const meaning = ov.text_en || sentenceFor(s.token, 'en-IN');
        return (
          <li key={s.token} className={'rounded-2xl border border-subtle bg-card p-3 ' + (ov.disabled ? 'opacity-60' : '')}>
            <div className="flex items-start gap-2">
              <Hand size={16} className="mt-0.5 text-primary" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {s.token}
                  {ov.token && <span className="text-primary"> → {ov.token}</span>}
                  {ov.disabled && <span className="ml-2 text-[10px] font-semibold text-rose">DISABLED</span>}
                  {(ov.text_en || ov.token) && !ov.disabled && <span className="ml-2 text-[10px] font-semibold text-amber">EDITED</span>}
                </p>
                <p className="text-[12px]">Says: “{meaning}”</p>
                <p className="mt-0.5 text-[10px] leading-snug text-ink-dim">
                  Handshape: {s.conditions.join(' · ')}{s.motion ? ` (movement not checked: ${s.motion})` : ''}
                </p>
              </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => setEditing(editing === s.token ? null : s.token)} className="btn-quiet px-3 py-1.5 text-xs">
                <Pencil size={12} /> Reassign
              </button>
              <button
                type="button" disabled={busy}
                onClick={() => onSave(s.token, { ...ov, disabled: !ov.disabled }, `${s.token} ${ov.disabled ? 'enabled' : 'disabled'} for everyone.`)}
                className="btn-quiet px-3 py-1.5 text-xs"
              >
                {ov.disabled ? <><CheckCircle2 size={12} /> Enable</> : <><Ban size={12} /> Disable</>}
              </button>
              {Object.keys(ov).length > 0 && (
                <button type="button" disabled={busy} onClick={() => onSave(s.token, null, `${s.token} back to its default.`)} className="btn-quiet px-3 py-1.5 text-xs">
                  <RotateCcw size={12} /> Reset
                </button>
              )}
            </div>
            {editing === s.token && (
              <MeaningForm
                initial={{ token: ov.token || s.token, text_en: meaning, hi: ov.texts?.['hi-IN'] || sentenceFor(s.token, 'hi-IN') || '', hinglish: ov.texts?.hinglish || '' }}
                tokenLabel="Word this handshape produces"
                onCancel={() => setEditing(null)}
                onSave={(v) => {
                  setEditing(null);
                  const next = {
                    ...(ov.disabled ? { disabled: true } : {}),
                    ...(v.token && v.token !== s.token ? { token: v.token } : {}),
                    ...(v.text_en && v.text_en !== sentenceFor(s.token, 'en-IN') ? { text_en: v.text_en } : {}),
                    texts: { ...(v.hi ? { 'hi-IN': v.hi } : {}), ...(v.hinglish ? { hinglish: v.hinglish } : {}) },
                  };
                  if (!next.text_en && !next.token) delete next.texts;
                  onSave(s.token, next, `${s.token} reassigned for everyone.`);
                }}
              />
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ── Community signs ─────────────────────────────────────────────────────────

function CommunityList({ signs, own, match, busy, onEdit, onRecord, onDelete }) {
  const [editing, setEditing] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const ownIds = new Set(own.map((s) => s.id));
  const list = signs.filter((s) => match(s.token, s.output?.text_en));
  if (!signs.length) return <p className="mt-4 text-center text-sm text-ink-dim">No community signs yet. Publish from “Your signs”.</p>;
  return (
    <ul className="mt-3 space-y-2">
      {list.map((s) => (
        <li key={s.id} className="rounded-2xl border border-subtle bg-card p-3">
          <div className="flex items-start gap-2">
            <Globe2 size={16} className="mt-0.5 text-secondary" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{s.token} {ownIds.has(s.id) && <span className="text-[10px] font-semibold text-primary">yours on this device</span>}</p>
              <p className="text-[12px]">Means: “{s.output?.text_en}” <span className="text-ink-dim">({s.output?.type})</span></p>
              <p className="text-[10px] text-ink-dim">
                {s.kind} · {s.hands === 'two' ? 'two hands' : 'one hand'} · {s.samples?.length || 0} samples · published {s.publishedAt ? new Date(s.publishedAt).toLocaleDateString() : ''}
              </p>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => setEditing(editing === s.id ? null : s.id)} className="btn-quiet px-3 py-1.5 text-xs"><Pencil size={12} /> Edit meaning</button>
            {!String(s.kind).startsWith('glove') && (
              <button type="button" disabled={busy} onClick={() => onRecord(s)} className="btn-quiet px-3 py-1.5 text-xs"><Video size={12} /> Re-record</button>
            )}
            {confirm === s.id ? (
              <>
                <button type="button" disabled={busy} onClick={() => { setConfirm(null); onDelete(s); }} className="rounded-full bg-rose px-3 py-1.5 text-xs font-semibold text-white">Delete for everyone</button>
                <button type="button" onClick={() => setConfirm(null)} className="btn-quiet px-3 py-1.5 text-xs">Cancel</button>
              </>
            ) : (
              <button type="button" disabled={busy} onClick={() => setConfirm(s.id)} className="btn-quiet px-3 py-1.5 text-xs text-rose"><Trash2 size={12} /> Delete</button>
            )}
          </div>
          {editing === s.id && (
            <MeaningForm
              initial={{ token: s.token, text_en: s.output?.text_en || '', hi: s.output?.texts?.['hi-IN'] || '', hinglish: s.output?.texts?.hinglish || '', type: s.output?.type }}
              tokenLabel="Sign name (token)"
              withType
              onCancel={() => setEditing(null)}
              onSave={(v) => {
                setEditing(null);
                onEdit(s, {
                  token: v.token,
                  output: {
                    type: v.type || s.output?.type, text_en: v.text_en,
                    texts: { ...(s.output?.texts || {}), ...(v.hi ? { 'hi-IN': v.hi } : {}), ...(v.hinglish ? { hinglish: v.hinglish } : {}) },
                  },
                });
              }}
            />
          )}
        </li>
      ))}
    </ul>
  );
}

// ── This device's signs ─────────────────────────────────────────────────────

function YourList({ own, serverSigns, match, busy, onNew, onEdit, onRecord, onPublish }) {
  const byId = new Map(serverSigns.map((s) => [s.id, s]));
  const status = (s) => {
    const pub = byId.get(s.id);
    if (!pub) return { text: 'not published', tone: 'text-ink-dim' };
    const changed = s.updatedAt && pub.publishedAt && s.updatedAt > Date.parse(pub.publishedAt);
    return changed ? { text: 'changed since publishing', tone: 'text-amber' } : { text: 'published', tone: 'text-primary' };
  };
  return (
    <div className="mt-3">
      <button type="button" onClick={onNew} className="btn-primary w-full"><Plus size={15} /> Add a new sign</button>
      <p className="mt-1 text-center text-[10px] text-ink-dim">Opens My signs to record it; come back here to publish.</p>
      <ul className="mt-3 space-y-2">
        {own.filter((s) => match(s.token, s.output?.text_en)).map((s) => {
          const st = status(s);
          const ready = s.samples?.length > 0;
          return (
            <li key={s.id} className="rounded-2xl border border-subtle bg-card p-3">
              <p className="text-sm font-semibold">{s.token} <span className={`text-[10px] font-semibold ${st.tone}`}>{st.text}</span></p>
              <p className="text-[12px]">Means: “{s.output?.text_en}” <span className="text-ink-dim">({s.output?.type}, {s.samples?.length || 0} samples)</span></p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={busy || !ready || st.text === 'published'} onClick={() => onPublish(s)} className="btn-quiet px-3 py-1.5 text-xs">
                  <Upload size={12} /> {st.text === 'not published' ? 'Publish' : 'Publish update'}
                </button>
                <button type="button" onClick={() => onEdit(s)} className="btn-quiet px-3 py-1.5 text-xs"><Pencil size={12} /> Edit</button>
                <button type="button" onClick={() => onRecord(s)} className="btn-quiet px-3 py-1.5 text-xs"><Video size={12} /> Re-record</button>
              </div>
              {!ready && <p className="mt-1 text-[10px] text-amber">Record it before publishing.</p>}
            </li>
          );
        })}
      </ul>
      {!own.length && <p className="mt-4 text-center text-sm text-ink-dim">No signs taught on this device yet.</p>}
    </div>
  );
}

// ── Shared form ─────────────────────────────────────────────────────────────

function MeaningForm({ initial, tokenLabel, withType = false, onSave, onCancel }) {
  const [v, setV] = useState(initial);
  const tokenOk = /^[A-Z0-9_]{1,32}$/.test(String(v.token || '').toUpperCase());
  return (
    <form
      className="mt-3 space-y-2 rounded-2xl border border-subtle p-3"
      onSubmit={(e) => { e.preventDefault(); if (tokenOk && v.text_en.trim()) onSave({ ...v, token: v.token.toUpperCase() }); }}
    >
      <label className="block text-[11px] text-ink-dim">{tokenLabel}
        <input value={v.token} onChange={(e) => setV({ ...v, token: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '_') })} className="field mt-1 py-2 text-sm" />
      </label>
      {withType && (
        <label className="block text-[11px] text-ink-dim">Kind of meaning
          <select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })} className="field mt-1 py-2 text-sm">
            <option value="word">word</option><option value="name">name</option><option value="sentence">sentence</option>
          </select>
        </label>
      )}
      <label className="block text-[11px] text-ink-dim">Meaning (English)
        <input value={v.text_en} onChange={(e) => setV({ ...v, text_en: e.target.value })} className="field mt-1 py-2 text-sm" />
      </label>
      <label className="block text-[11px] text-ink-dim">Hindi (optional, used offline)
        <input value={v.hi} onChange={(e) => setV({ ...v, hi: e.target.value })} className="field mt-1 py-2 text-sm" />
      </label>
      <label className="block text-[11px] text-ink-dim">Hinglish (optional, e.g. “Mujhe paani chahiye”)
        <input value={v.hinglish} onChange={(e) => setV({ ...v, hinglish: e.target.value })} className="field mt-1 py-2 text-sm" />
      </label>
      <div className="flex gap-2">
        <button type="submit" disabled={!tokenOk || !v.text_en.trim()} className="btn-primary flex-1 py-2 text-sm">Save for everyone</button>
        <button type="button" onClick={onCancel} className="btn-quiet px-4 py-2 text-sm">Cancel</button>
      </div>
    </form>
  );
}
