import { useState } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import {
  isEnabled, setEnabled, queued, flush, clearQueue,
} from '../services/contributions.js';
import { isConfigured } from '../services/account.js';

/**
 * Settings > Help improve recognition. OFF by default; when on, you still
 * confirm every single sample (in Demo mode, after a practice attempt).
 */
export default function ContributeSettings({ onNavigate }) {
  const [on, setOn] = useState(isEnabled());
  const [count, setCount] = useState(queued().length);
  const [msg, setMsg] = useState(null);

  const toggle = () => { setEnabled(!on); setOn(!on); };
  const upload = async () => {
    const r = await flush();
    setCount(r.left);
    setMsg(r.sent ? `Uploaded ${r.sent} sample(s) for review.` : `Nothing uploaded${r.reason ? `: ${r.reason}` : ''}.`);
  };

  return (
    <section className="mt-4 surface-card p-4">
      <p className="eyebrow">Help improve recognition</p>
      <label className="mt-2 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={on} onChange={toggle} aria-label="Help improve recognition" />
        Offer my practice attempts as training examples
      </label>
      <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
        Off by default. When on, Demo mode asks after each practice attempt whether to share
        <b> that one</b>. Shared: hand and body points (the model&apos;s input numbers), the sign&apos;s
        name, which model and version, your sign language and your device type. <b>Never video.</b>
        Samples wait on this phone until you are online and signed in, and are reviewed before any
        use.
      </p>
      {count > 0 && (
        <div className="mt-2 flex items-center gap-2 text-[11px]">
          <span>{count} waiting on this device</span>
          <button type="button" onClick={upload} className="btn-quiet ml-auto flex items-center gap-1 px-2 py-1 text-[11px]"><Upload size={12} /> Upload now</button>
          <button type="button" onClick={() => { clearQueue(); setCount(0); }} className="flex items-center gap-1 text-ink-dim" aria-label="Delete waiting samples"><Trash2 size={12} /></button>
        </div>
      )}
      {isConfigured() && onNavigate && (
        <button type="button" onClick={() => onNavigate('review')} className="mt-2 text-[11px] text-primary underline">Review contributions (admins)</button>
      )}
      {msg && <p className="mt-1 text-[11px] text-ink-dim">{msg}</p>}
    </section>
  );
}
