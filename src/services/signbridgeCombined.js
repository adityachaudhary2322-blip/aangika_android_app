/**
 * SignBridge = built-in rules + the user's own handshapes, one call per frame.
 *
 * Used by useSignPipeline.js (live) and RecordedVideoTranslator.jsx (files) so
 * both resolve a frame identically.
 *
 * Arbitration:
 *   - a CONFIDENT custom match (well inside its radius, clearly ahead of the
 *     runner-up) wins outright: the user taught it on purpose, and a built-in
 *     rule firing on the same handshape is the likelier mistake;
 *   - otherwise the higher confidence wins, custom and rule alike;
 *   - the rule result's honesty flags (motionAssumed, ambiguous, tiltUnreliable)
 *     are preserved whenever the rule result is the one returned.
 */

import { classifySignBridgeFrame } from './signbridgeEngine.js';
import { classifyCustom } from './customHandshapes.js';

export function classifyFrame(hands, pose = null, { mirrored = false } = {}) {
  const rule = classifySignBridgeFrame(hands, pose);
  let custom = null;
  try {
    custom = classifyCustom(hands, pose, { mirrored });
  } catch (err) {
    // A corrupt stored sign must never take the built-in engine down with it.
    if (typeof console !== 'undefined') console.warn('[custom signs]', err);
  }

  if (!custom?.accepted) {
    return rule ? { ...rule, customNear: custom?.nearestToken || null } : rule;
  }

  const customHit = {
    token: custom.token,
    confidence: custom.confidence,
    engine: 'custom',
    latencyMs: (rule?.latencyMs || 0) + custom.latencyMs,
    motionAssumed: null,          // handshape signs are defined by the shape itself
    ambiguous: Boolean(rule?.token) && !custom.confident,
    alternatives: [rule?.token, ...custom.alternatives].filter(Boolean).slice(0, 2),
    tiltUnreliable: false,
    customId: custom.id,
    distance: custom.distance,
    radius: custom.radius,
  };

  if (!rule?.token || custom.confident || custom.confidence >= rule.confidence) {
    return customHit;
  }
  return {
    ...rule,
    ambiguous: true,
    alternatives: [custom.token, ...(rule.alternatives || [])].slice(0, 2),
  };
}

export default { classifyFrame };
