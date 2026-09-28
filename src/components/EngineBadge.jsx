import { VISION_ENGINES } from '../services/engineState.js';

/**
 * The engine tag shown beside a recognised token, e.g. "(SignBridge 95%)".
 *
 * Worth the pixels: the two engines have very different failure modes, and a
 * user comparing them needs to know which one produced a given word.
 */
/** A sign the user taught ("My signs"), matched alongside the built-in rules. */
const CUSTOM = { icon: '✋', name: 'My sign', tone: 'amber' };

export default function EngineBadge({ engine, confidence }) {
  const e = engine === 'custom' ? CUSTOM : VISION_ENGINES[engine];
  if (!e) return null;
  const tint = e.tone === 'primary' ? 'text-primary'
    : e.tone === 'amber' ? 'text-amber' : 'text-secondary';
  return (
    <span className={'text-[9px] font-medium ' + tint}>
      {e.icon} {e.name}
      {typeof confidence === 'number' && ' ' + (confidence * 100).toFixed(0) + '%'}
    </span>
  );
}
