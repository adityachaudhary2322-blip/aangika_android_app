import { useEffect, useState } from 'react';
import { Download, Check, Loader2, Trash2, MicOff } from 'lucide-react';
import offlineStt, { SPEECH_MODELS } from '../services/offlineStt.js';
import { formatMB } from '../services/download.js';

/**
 * Offline speech recognition models: download once, then speech to text
 * works on this device with no network (Hindi, also for Hinglish; English).
 * Shown in Hearing mode and Settings.
 */
export default function OfflineSpeechPanel({ compact = false }) {
  const [status, setStatus] = useState({});        // key -> 'ready' | 'missing'
  const [progress, setProgress] = useState({});    // key -> 0..1
  const [error, setError] = useState(null);

  const refresh = async () => {
    const out = {};
    for (const key of Object.keys(SPEECH_MODELS)) {
      // eslint-disable-next-line no-await-in-loop
      out[key] = (await offlineStt.isDownloaded(key).catch(() => false)) ? 'ready' : 'missing';
    }
    setStatus(out);
  };
  useEffect(() => { refresh(); }, []);

  const get = async (key) => {
    setError(null);
    setProgress((p) => ({ ...p, [key]: 0 }));
    try {
      await offlineStt.download(key, (loaded, total) => setProgress((p) => ({ ...p, [key]: total ? loaded / total : 0 })));
    } catch (err) {
      setError(navigator.onLine ? err.message : 'Connect to the internet once to download it.');
    }
    setProgress((p) => { const n = { ...p }; delete n[key]; return n; });
    refresh();
  };

  return (
    <section className={'surface-card ' + (compact ? 'mt-2 p-3' : 'mt-4 p-4')}>
      <p className="flex items-center gap-1.5 text-xs font-semibold"><MicOff size={13} /> Offline speech recognition</p>
      <p className="mt-0.5 text-[11px] text-ink-dim">
        Speech to text on this device, no internet. Less accurate than online (Sarvam); download once.
      </p>
      <ul className="mt-2 space-y-1.5">
        {Object.entries(SPEECH_MODELS).map(([key, m]) => {
          const p = progress[key];
          return (
            <li key={key} className="flex items-center gap-2 text-[12px]">
              <span className="flex-1">
                <b>{m.label}</b>
                <span className="text-ink-dim"> · {formatMB(m.bytes)}{key === 'hi' ? ' · also for Hinglish' : ''}</span>
              </span>
              {p !== undefined ? (
                <span className="flex items-center gap-1 text-primary"><Loader2 size={12} className="animate-spin" /> {Math.round(p * 100)}%</span>
              ) : status[key] === 'ready' ? (
                <>
                  <span className="flex items-center gap-1 text-primary"><Check size={12} /> ready offline</span>
                  <button type="button" onClick={async () => { await offlineStt.remove(key); refresh(); }} aria-label={`Remove ${m.label} speech model`} className="text-ink-dim"><Trash2 size={12} /></button>
                </>
              ) : (
                <button type="button" onClick={() => get(key)} className="btn-quiet px-3 py-1 text-xs"><Download size={12} /> Download</button>
              )}
            </li>
          );
        })}
      </ul>
      {error && <p className="mt-1 text-[11px] text-rose">{error}</p>}
    </section>
  );
}
