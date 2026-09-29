import { HAND_BONES } from '../services/landmarker.js';
import { unpackSample } from '../services/handshapeFeatures.js';

/**
 * A small line drawing of a stored sign frame: one or two hands, fitted to
 * the box. Drawn from the raw landmarks the sign was saved with, so it shows
 * exactly what the matcher compares against.
 */
export default function HandSkeleton({ sample, size = 44, className = '' }) {
  // Glove signs store flex/orientation, not camera landmarks.
  if (sample && (sample.f || sample.seq)) {
    return (
      <div
        style={{ width: size, height: size }}
        className={'flex items-center justify-center rounded-lg bg-card-high text-[10px] font-semibold text-amber ' + className}
      >
        glove
      </div>
    );
  }
  if (!sample || (!sample.left && !sample.right)) {
    return (
      <div
        style={{ width: size, height: size }}
        className={'flex items-center justify-center rounded-lg bg-card-high text-[9px] text-ink-dim ' + className}
      >
        no frames
      </div>
    );
  }
  const { left, right } = unpackSample(sample);
  const hands = [left, right].filter(Boolean);
  const pts = hands.flat();
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const pad = 4;
  const k = (size - 2 * pad) / span;
  // Mirror x like the selfie preview, so the drawing matches what the user saw.
  const P = (p) => [size - (pad + (p.x - minX) * k), pad + (p.y - minY) * k];

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={'rounded-lg bg-card-high ' + className}
      aria-hidden="true"
    >
      {hands.map((lm, h) => (
        <g key={h} className={h === 0 ? 'text-primary' : 'text-secondary'} stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
          {HAND_BONES.map(([a, b]) => {
            const [x1, y1] = P(lm[a]);
            const [x2, y2] = P(lm[b]);
            return <line key={`${a}-${b}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
        </g>
      ))}
    </svg>
  );
}
