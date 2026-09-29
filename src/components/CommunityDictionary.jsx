import { useEffect, useState } from 'react';
import {
  RefreshCw, Globe2, KeyRound, Loader2, Check, Trash2, Upload, ChevronDown, Lock,
} from 'lucide-react';
import dictionary, { publishable } from '../services/sharedDictionary.js';
import { listSharedSigns, subscribe as subscribeSigns } from '../services/customSigns.js';

const ago = (t) => {
  if (!t) return 'never';
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(t).toLocaleDateString();
};

function useDictionaryState() {
  const [st, setSt] = useState(() => dictionary.getState());
  useEffect(() => dictionary.subscribe(setSt), []);
  useEffect(() => subscribeSigns(() => setSt(dictionary.getState())), []);
  return st;
}

/**
 * "Community dictionary: N signs, updated … [Update]". Shown in My signs and
 * the Word list. Updates also happen by themselves when the app starts or
 * comes online.
 */
export function DictionaryPanel({ compact = false }) {
  const st = useDictionaryState();
  const busy = st.status === 'checking';

  if (!dictionary.isAvailable()) {
    return (
      <p className="rounded-2xl border border-subtle px-3 py-2 text-[11px] text-ink-dim">
        <Globe2 size={12} className="mr-1 inline" /> Community dictionary: not connected in this build.
      </p>
    );
  }

  const message = {
    updated: st.last ? `Updated: ${st.last.added} new, ${st.last.updated} changed, ${st.last.removed} removed.` : 'Updated.',
    current: 'Up to date.',
    offline: 'Offline: using the signs already on this device.',
    error: `Could not update (${st.error}). The signs on this device still work.`,
  }[st.status];

  return (
    <section className={'surface-card ' + (compact ? 'p-3' : 'p-4')} aria-live="polite">
      <div className="flex items-center gap-3">
        <span className="icon-well bg-secondary/15 text-secondary"><Globe2 size={18} /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Community dictionary</p>
          <p className="text-[11px] text-ink-dim">
            {st.count} shared sign{st.count === 1 ? '' : 's'} on this device · checked {ago(st.checkedAt)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => dictionary.checkForUpdates({ force: true })}
          disabled={busy}
          className="btn-quiet shrink-0 px-3 py-2 text-xs"
        >
          <RefreshCw size={13} className={busy ? 'animate-spin' : ''} /> {busy ? 'Updating' : 'Update'}
        </button>
      </div>
      {message && (
        <p className={'mt-2 text-[11px] ' + (st.status === 'error' ? 'text-amber' : 'text-ink-dim')}>{message}</p>
      )}
    </section>
  );
}

/** Read-only list of the shared signs, each with Try. */
export function SharedSignList({ onTry }) {
  const [shared, setShared] = useState(() => listSharedSigns());
  useEffect(() => subscribeSigns(() => setShared(listSharedSigns())), []);
  if (!shared.length) return null;
  return (
    <section className="mt-4">
      <p className="eyebrow mb-2">From the community dictionary ({shared.length})</p>
      <ul className="space-y-1.5">
        {shared.map((s) => (
          <li key={s.id} className="flex items-center gap-3 rounded-2xl border border-subtle bg-card px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{s.output?.text_en || s.token}</p>
              <p className="text-[10px] text-ink-dim">{s.token} · {s.output?.type} · shared</p>
            </div>
            {onTry && !String(s.kind).startsWith('glove') && (
              <button type="button" onClick={() => onTry(s)} className="btn-quiet px-3 py-1.5 text-xs">Try</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * For developers: enter the developer code to publish taught signs to every
 * user, or remove shared ones. The code is checked by the server (never in
 * the app) and kept only in this component's memory.
 */
export function DeveloperPublish() {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  // Every taught sign is ticked unless the developer unticks it (signs taught
  // after this panel opened are included too).
  const [unpicked, setUnpicked] = useState(() => new Set());
  const picked = { has: (id) => !unpicked.has(id) };
  const [onServer, setOnServer] = useState([]);    // [{id, token, text}] from the server
  const mine = publishable();
  const published = new Set(onServer.map((s) => s.id));

  const refreshServer = async () => setOnServer(await dictionary.fetchSummary());
  useEffect(() => () => setCode(''), []);           // forget the code when leaving

  if (!dictionary.isAvailable()) return null;

  const run = async (fn) => {
    setBusy(true); setMsg(null);
    try { await fn(); } catch (err) { setMsg({ tone: 'rose', text: err.message }); }
    setBusy(false);
  };

  const unlock = () => run(async () => {
    const ok = await dictionary.verifyCode(code.trim());
    if (!ok) { setMsg({ tone: 'rose', text: 'Wrong developer code.' }); return; }
    setUnlocked(true);
    await refreshServer();
    setMsg({ tone: 'primary', text: 'Unlocked for this screen.' });
  });

  const doPublish = () => run(async () => {
    const chosen = mine.filter((s) => picked.has(s.id));
    const r = await dictionary.publish(code.trim(), chosen);
    await refreshServer();
    setMsg({
      tone: 'primary',
      text: `Published: ${r.added} new, ${r.updated} updated. Every user gets them on their next update.`
        + (r.rejected?.length ? ` Not published: ${r.rejected.join('; ')}.` : ''),
    });
  });

  const doRemove = (s) => run(async () => {
    await dictionary.removeShared(code.trim(), [s.id]);
    await refreshServer();
    setMsg({ tone: 'primary', text: `${s.token} removed for everyone.` });
  });

  return (
    <section className="surface-card mt-4 p-4">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="flex w-full items-center gap-2 text-left">
        <KeyRound size={15} className="text-ink-dim" />
        <span className="flex-1">
          <span className="block text-sm font-semibold">For developers</span>
          <span className="block text-[11px] text-ink-dim">Add your taught signs to the dictionary for every user.</span>
        </span>
        <ChevronDown size={15} className={'transition ' + (open ? 'rotate-180' : '')} />
      </button>

      {open && !unlocked && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (code.trim()) unlock(); }}>
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Developer code"
            aria-label="Developer code"
            className="field flex-1 py-2"
          />
          <button type="submit" disabled={busy || !code.trim()} className="btn-primary px-4 py-2 text-sm">
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />} Unlock
          </button>
        </form>
      )}

      {open && unlocked && (
        <div className="mt-3 space-y-3">
          <div>
            <p className="text-xs font-semibold">Your taught signs</p>
            {!mine.length && <p className="mt-1 text-[11px] text-ink-dim">No recorded signs yet. Teach one above first.</p>}
            <ul className="mt-1.5 space-y-1">
              {mine.map((s) => (
                <li key={s.id}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={picked.has(s.id)}
                      onChange={(e) => setUnpicked((p) => {
                        const n = new Set(p);
                        if (e.target.checked) n.delete(s.id); else n.add(s.id);
                        return n;
                      })}
                    />
                    <span className="font-medium">{s.output?.text_en || s.token}</span>
                    <span className="text-[10px] text-ink-dim">{s.token} · {s.samples.length} samples</span>
                    {published.has(s.id) && <span className="text-[10px] font-semibold text-primary">published</span>}
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={doPublish}
              disabled={busy || !mine.some((s) => picked.has(s.id))}
              className="btn-primary mt-2 w-full py-2.5 text-sm"
            >
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              Publish {mine.filter((s) => picked.has(s.id)).length} to everyone
            </button>
          </div>

          {onServer.length > 0 && (
            <div>
              <p className="text-xs font-semibold">In the dictionary now ({onServer.length})</p>
              <ul className="mt-1.5 space-y-1">
                {onServer.map((s) => (
                  <li key={s.id} className="flex items-center gap-2 text-sm">
                    <Check size={12} className="text-primary" />
                    <span className="flex-1 truncate">{s.text} <span className="text-[10px] text-ink-dim">{s.token}</span></span>
                    <button type="button" onClick={() => doRemove(s)} disabled={busy} className="flex items-center gap-1 text-[11px] text-rose disabled:opacity-40">
                      <Trash2 size={11} /> Remove for everyone
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {msg && <p className={'mt-2 text-[11px] ' + (msg.tone === 'rose' ? 'text-rose' : 'text-primary')}>{msg.text}</p>}
    </section>
  );
}

export default { DictionaryPanel, SharedSignList, DeveloperPublish };
