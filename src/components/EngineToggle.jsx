import { VISION_ENGINES, VISION_AANGIKA, VISION_SIGNBRIDGE } from '../services/engineState.js';

/**
 * Compact two-state pill: [⚡ Aangika | 🌿 SignBridge].
 *
 * Sits in the top chrome over live video, so it uses a dark scrim rather than a
 * surface colour.
 */
export default function EngineToggle({ value, onChange, compact = false }) {
  const options = [VISION_AANGIKA, VISION_SIGNBRIDGE];

  return (
    <div
      role="radiogroup"
      aria-label="Vision engine"
      className="inline-flex items-center rounded-full border border-subtle chrome-plate p-0.5 backdrop-blur"
    >
      {options.map((id) => {
        const e = VISION_ENGINES[id];
        const active = value === id;
        const tint = e.tone === 'primary'
          ? 'bg-primary text-surface'
          : 'bg-secondary text-surface';
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(id)}
            title={e.tagline}
            className={
              'rounded-full px-2.5 py-1 text-[10px] font-semibold transition ' +
              (active ? tint : 'text-ink-dim')
            }
          >
            {e.icon}{compact ? '' : ' ' + e.name}
          </button>
        );
      })}
    </div>
  );
}
