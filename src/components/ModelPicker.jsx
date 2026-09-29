import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, CloudOff, Globe2 } from 'lucide-react';
import { MODELS, getModel, downloadBytes } from '../config/models.js';
import engines from '../services/engines/manager.js';
import { modelIdFor, visionFor, setSignLanguage } from '../services/engineState.js';
import { formatMB } from '../services/download.js';

/** Short names for the chip over the camera. */
const SHORT = {
  'isl-aangika-v2': 'ISL words',
  'isl-signbridge': 'ISL handshapes',
  'asl-islr-250': 'ASL 250',
};
const shortName = (m) => SHORT[m.id] || m.name;

/**
 * Every recognition model in one menu, ISL and ASL together. Choosing a
 * model from another sign language switches the sign language too. Loading
 * (with download progress) happens in the pipeline as before.
 */
export default function ModelPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [offline, setOffline] = useState({});
  const ref = useRef(null);
  const current = getModel(modelIdFor(value)) || MODELS[0];

  useEffect(() => {
    if (!open) return undefined;
    Promise.all(MODELS.map(async (m) => [m.id, await engines.offlineStatus(m).catch(() => null)]))
      .then((pairs) => setOffline(Object.fromEntries(pairs)));
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);

  const choose = (m) => {
    setOpen(false);
    if (m.id === current.id) return;
    setSignLanguage(m.language);
    onChange(visionFor(m.id));
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Recognition model: ${current.name}. Change model`}
        className="pill chrome-plate shrink-0 gap-1 whitespace-nowrap py-1.5 text-[11px] font-semibold text-ink"
      >
        <span className={'rounded px-1 text-[9px] ' + (current.language === 'ASL' ? 'bg-secondary/25 text-secondary' : 'bg-primary/20 text-primary')}>
          {current.language}
        </span>
        {shortName(current)}
        <ChevronDown size={12} className={'transition ' + (open ? 'rotate-180' : '')} />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Recognition models"
          className="absolute left-0 top-full z-30 mt-2 w-[17rem] max-w-[calc(100vw-2rem)] space-y-1 rounded-2xl border border-subtle bg-card p-1.5 shadow-card"
        >
          {MODELS.map((m) => {
            const on = m.id === current.id;
            const size = downloadBytes(m);
            const off = offline[m.id];
            return (
              <li key={m.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={on}
                  onClick={() => choose(m)}
                  className={'flex w-full items-start gap-2 rounded-xl px-2.5 py-2 text-left transition ' + (on ? 'bg-primary/10' : 'hover:bg-card-high')}
                >
                  <span className={'mt-0.5 rounded px-1 text-[9px] font-bold ' + (m.language === 'ASL' ? 'bg-secondary/25 text-secondary' : 'bg-primary/20 text-primary')}>
                    {m.language}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 text-[12px] font-semibold">
                      {m.name}
                      {m.language === 'ASL' && <Globe2 size={11} className="text-secondary" aria-label="international" />}
                    </span>
                    <span className="block text-[10px] leading-snug text-ink-dim">
                      {m.vocabSize} {m.kind === 'handshape rules' ? 'handshapes + yours' : m.kind === 'isolated signs' ? 'signs, one at a time' : 'words'}
                      {' · '}
                      {!size ? 'nothing to download'
                        : off?.ready ? 'ready offline'
                          : <span className="inline-flex items-center gap-0.5 text-amber"><CloudOff size={9} /> {formatMB(size)} download</span>}
                    </span>
                  </span>
                  {on && <Check size={14} className="mt-0.5 text-primary" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
