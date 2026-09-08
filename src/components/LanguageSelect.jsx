import { useEffect, useRef, useState } from 'react';
import { Languages, Check } from 'lucide-react';
import { LANGUAGES, getLanguage } from '../config/languages.js';

/**
 * Output-language picker, shared by the translator and the call screen.
 *
 * `variant="overlay"` styles it for use on top of live video (dark scrim,
 * blurred), `variant="solid"` for a normal surface.
 */
export default function LanguageSelect({
  value,
  onChange,
  variant = 'solid',
  align = 'right',
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const active = getLanguage(value);

  // Close on any outside pointer press. Without this the sheet stays open over
  // the video and swallows the next tap on a call control.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const trigger =
    variant === 'overlay'
      ? 'pill bg-black/55 text-ink backdrop-blur border-white/20'
      : 'pill border-secondary/40 bg-secondary/10 text-secondary';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={trigger}
      >
        <Languages size={12} />
        {active.script}
      </button>

      {open && (
        <div
          role="listbox"
          className={
            'absolute z-50 mt-1 max-h-64 w-44 overflow-y-auto rounded-xl ' +
            'border border-white/10 bg-card-high p-1 shadow-xl no-scrollbar ' +
            (align === 'right' ? 'right-0' : 'left-0')
          }
        >
          {LANGUAGES.map((l) => {
            const selected = l.code === value;
            return (
              <button
                key={l.code}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(l.code);
                  setOpen(false);
                }}
                className={
                  'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left ' +
                  (selected ? 'bg-primary/15 text-primary' : 'text-ink')
                }
              >
                <span className="flex-1">
                  <span className="block text-sm font-medium">{l.script}</span>
                  <span className="block text-[10px] text-ink-dim">
                    {l.name} · {l.code}
                  </span>
                </span>
                {selected && <Check size={14} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
