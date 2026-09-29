import { useCallback, useEffect, useState } from 'react';
import { Check, CloudOff, Download, Loader2, ShieldAlert } from 'lucide-react';
import {
  MODELS, SIGN_LANGUAGES, modelsFor, downloadBytes,
} from '../config/models.js';
import engines from '../services/engines/manager.js';
import {
  getSignLanguage, setSignLanguage, modelIdFor, visionFor,
} from '../services/engineState.js';
import { formatMB } from '../services/download.js';

/**
 * Settings > Recognition: which sign language, and which model reads it.
 *
 * Every card shows what a judge or user needs to trust it: download size,
 * whether it already works offline on this device, its MEASURED accuracy (or
 * "not measured"), and its licence (code / weights / data). "Use" downloads
 * with real byte progress, caches it for offline use and frees the previous
 * model; a failed load falls back to the language's default.
 */
export default function RecognitionSettings({ visionEngine, chooseVision }) {
  const [lang, setLang] = useState(() => getSignLanguage());
  const [offline, setOffline] = useState({});
  const [load, setLoad] = useState(engines.getState());
  const [note, setNote] = useState(null);
  const activeId = modelIdFor(visionEngine);

  const refresh = useCallback(async () => {
    const out = {};
    for (const m of MODELS) {
      // eslint-disable-next-line no-await-in-loop
      out[m.id] = await engines.offlineStatus(m).catch(() => ({ supported: false }));
    }
    setOffline(out);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => engines.subscribe(setLoad), []);

  const pickLanguage = (l) => {
    const { language, vision } = setSignLanguage(l);
    setLang(language);
    if (vision !== visionEngine) chooseVision(vision);
  };

  const use = async (model) => {
    setNote(null);
    chooseVision(visionFor(model.id));
    try {
      const res = await engines.activate(model.id);
      if (res.fellBack) {
        chooseVision(visionFor(res.modelId));
        setNote({ tone: 'amber', text: `${model.name} could not load (${res.error}). Using ${res.modelId} instead.` });
      } else {
        setNote({ tone: 'primary', text: `${model.name} is ready.` });
      }
    } catch (err) {
      setNote({ tone: 'rose', text: err.message });
    }
    refresh();
  };

  const list = modelsFor(lang);

  return (
    <section className="mt-4 surface-card p-4" data-tour="recognition">
      <p className="eyebrow">Recognition</p>
      <p className="mt-1 text-[11px] text-ink-dim">Which sign language, and which model reads it.</p>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {SIGN_LANGUAGES.map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => pickLanguage(l)}
            aria-pressed={lang === l}
            className={'rounded-lg border px-3 py-2 text-sm font-semibold ' + (lang === l ? 'border-primary/50 bg-primary/10 text-primary' : 'border-subtle')}
          >
            {l === 'ISL' ? 'Indian (ISL)' : 'American (ASL)'}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {!list.length && (
          <p className="rounded-lg border border-subtle p-3 text-[12px] text-ink-dim">
            No {lang} models installed in this build yet.
          </p>
        )}
        {list.map((m) => {
          const selected = activeId === m.id;
          const busy = load.status === 'loading' && load.modelId === m.id;
          const off = offline[m.id];
          const pct = busy && load.total ? Math.round((load.loaded / load.total) * 100) : null;
          const size = downloadBytes(m);
          return (
            <div key={m.id} className={'rounded-xl border p-3 ' + (selected ? 'border-primary/50 bg-primary/10' : 'border-subtle')}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    {m.name}
                    {selected && <Check size={14} className="text-primary" aria-label="in use" />}
                  </p>
                  <p className="text-[10px] text-ink-dim">
                    {m.kind} · {m.runtime.toUpperCase()} · {m.vocabSize} {m.kind === 'handshape rules' ? 'signs + yours' : 'words'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => use(m)}
                  disabled={busy}
                  className={'shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ' + (selected ? 'bg-card-highest' : 'bg-primary text-surface')}
                >
                  {busy ? <Loader2 size={13} className="animate-spin" /> : selected ? 'Reload' : 'Use'}
                </button>
              </div>

              <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-0.5 text-[10px]">
                <dt className="text-ink-dim">Size</dt>
                <dd>{size ? formatMB(size) : 'nothing to download'}{m.sharedFiles?.includes('ort-wasm') ? ' (incl. 27.8 MB shared runtime)' : ''}</dd>
                <dt className="text-ink-dim">Offline</dt>
                <dd className={off?.ready || !size ? 'text-primary' : 'text-amber'}>
                  {!size ? 'always available' : off?.ready ? 'ready on this device'
                    : off?.supported === false ? 'not cached (no service worker here)'
                    : <span className="inline-flex items-center gap-1"><CloudOff size={10} /> not downloaded yet</span>}
                </dd>
                <dt className="text-ink-dim">Accuracy</dt>
                <dd>{m.accuracy.summary}</dd>
                <dt className="text-ink-dim">Licence</dt>
                <dd className={m.licence.commercial ? '' : 'text-amber'}>
                  {m.licence.weights}{!m.licence.commercial && ' · not for commercial use'}
                </dd>
              </dl>

              {busy && (
                <div className="mt-2">
                  <div className="h-1.5 overflow-hidden rounded-full bg-card-highest">
                    <div className="h-full bg-primary transition-all" style={{ width: `${pct ?? 10}%` }} />
                  </div>
                  <p className="mt-0.5 text-[10px] text-ink-dim">
                    <Download size={10} className="mr-1 inline" />
                    {load.message || 'Downloading'}{pct !== null ? ` ${pct}% of ${formatMB(load.total)}` : ''}
                  </p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {note && (
        <p className={`mt-2 text-[11px] ${note.tone === 'rose' ? 'text-rose' : note.tone === 'amber' ? 'text-amber' : 'text-primary'}`}>
          {note.tone !== 'primary' && <ShieldAlert size={11} className="mr-1 inline" />}
          {note.text}
        </p>
      )}
    </section>
  );
}
