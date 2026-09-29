import { useEffect, useState } from 'react';
import { ArrowLeft, Check, X, Loader2 } from 'lucide-react';
import { listForReview, review, isConfigured } from '../services/account.js';

/**
 * A simple review queue for contributed samples. Only admins (public.admins)
 * can see other people's samples or change their status: Row Level Security
 * enforces it, this page only presents it.
 */
export default function ReviewContributions({ onBack }) {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState(null);

  const load = () => {
    setRows(null);
    listForReview(status).then(setRows).catch((e) => { setErr(e.message); setRows([]); });
  };
  useEffect(() => { if (isConfigured()) load(); }, [status]);

  const decide = async (id, s) => {
    try { await review(id, s); setRows((r) => r.filter((x) => x.id !== id)); } catch (e) { setErr(e.message); }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto px-4 pb-6 no-scrollbar">
      <header className="flex items-center gap-2 py-3">
        <button type="button" onClick={onBack} aria-label="Back" className="flex h-9 w-9 items-center justify-center rounded-full bg-card-high"><ArrowLeft size={18} /></button>
        <h1 className="text-lg font-bold">Review contributions</h1>
      </header>
      {!isConfigured() && <p className="text-sm text-ink-dim">Accounts are not configured in this build.</p>}
      <div className="flex gap-2">
        {['pending', 'approved', 'rejected'].map((s) => (
          <button key={s} type="button" onClick={() => setStatus(s)} aria-pressed={status === s}
            className={'pill text-xs ' + (status === s ? 'border-primary/50 text-primary' : 'border-subtle')}>{s}</button>
        ))}
      </div>
      {err && <p className="mt-2 text-[11px] text-rose">{err}</p>}
      {rows === null && <Loader2 size={18} className="mt-4 animate-spin text-primary" />}
      {rows?.length === 0 && <p className="mt-3 text-sm text-ink-dim">Nothing {status}.</p>}
      <ul className="mt-3 space-y-2">
        {rows?.map((r) => (
          <li key={r.id} className="surface-card flex items-center gap-3 p-3 text-[12px]">
            <div className="min-w-0 flex-1">
              <p><b>{r.label}</b> <span className="text-ink-dim">· {r.sign_language} · {r.model_id} v{r.model_version}</span></p>
              <p className="text-[10px] text-ink-dim">{r.frames} frames × {r.feature_dim} · {new Date(r.created_at).toLocaleString()}</p>
            </div>
            {status === 'pending' && (
              <>
                <button type="button" onClick={() => decide(r.id, 'approved')} aria-label="Approve" className="rounded-lg bg-primary/15 p-2 text-primary"><Check size={14} /></button>
                <button type="button" onClick={() => decide(r.id, 'rejected')} aria-label="Reject" className="rounded-lg bg-rose/15 p-2 text-rose"><X size={14} /></button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
