/**
 * Would a new sign be confused with one that already exists?
 *
 * Three checks over the recorded frames, each reported as the fraction of
 * frames that collide:
 *   builtin   the new sign's frames, run through the 20 built-in rules;
 *   custom    the new sign's frames, run through the existing taught signs;
 *   reverse   the existing taught signs' frames, run against the NEW sign's
 *             calibrated radius (a wide new sign can swallow an old one even
 *             when the old one does not reach it).
 * A check at or above CONFLICT_FRACTION is a conflict. The user can still
 * save: the report explains, it does not forbid.
 */

import { classifySignBridgeFrame } from './signbridgeEngine.js';
import { buildIndex, classifyCustom } from './customHandshapes.js';
import { sampleAsFrame, locationBucket, LOCATION_LABELS } from './handshapeFeatures.js';
import { listSigns } from './customSigns.js';

export const CONFLICT_FRACTION = 0.25;

function tally(map, key) {
  if (key) map.set(key, (map.get(key) || 0) + 1);
}

function suggestion(sameLocation, location) {
  return sameLocation
    ? `Change the handshape, or make it somewhere other than ${LOCATION_LABELS[location] || 'the same place'}.`
    : 'Change the handshape: the location alone does not separate them.';
}

/**
 * @param draft   a sign record (not yet saved) with samples
 * @param signs   existing signs to compare against (default: the library)
 * @returns {conflicts: [{kind, token, fraction, message, suggestion}], checked}
 */
export function checkConflicts(draft, signs = listSigns()) {
  const others = signs.filter((s) => s.id !== draft.id && s.samples?.length);
  const frames = (draft.samples || []).map(sampleAsFrame);
  const n = frames.length;
  if (!n) return { conflicts: [], checked: 0 };

  const draftIndex = buildIndex([{ ...draft, id: draft.id || '__draft__', kind: 'handshape' }]);
  const draftEntry = draftIndex.entries[0];
  const draftLoc = draftEntry?.location || 'unknown';
  const othersIndex = buildIndex(others);
  const conflicts = [];

  // 1. Built-in rules on the new sign's frames.
  const builtin = new Map();
  for (const f of frames) tally(builtin, classifySignBridgeFrame(f.hands, f.pose)?.token);
  for (const [token, count] of builtin) {
    const fraction = count / n;
    if (fraction >= CONFLICT_FRACTION) {
      conflicts.push({
        kind: 'builtin', token, fraction,
        message: `${Math.round(fraction * 100)}% of your frames also read as the built-in sign ${token}.`,
        suggestion: 'Change the handshape or location so the built-in sign does not fire.',
      });
    }
  }

  // 2. Existing taught signs on the new sign's frames. Stored samples carry
  //    side-true labels, hence mirrored:false.
  const custom = new Map();
  for (const f of frames) {
    tally(custom, classifyCustom(f.hands, f.pose, { mirrored: false, index: othersIndex })?.token);
  }
  // 3. Existing signs' frames against the new sign alone.
  const reverse = new Map();
  if (draftEntry) {
    for (const s of others) {
      let hit = 0;
      for (const sample of s.samples) {
        const f = sampleAsFrame(sample);
        const r = classifyCustom(f.hands, f.pose, { mirrored: false, index: draftIndex });
        if (r?.distance <= r?.radius) hit += 1;
      }
      if (hit) reverse.set(s.token, hit / s.samples.length);
    }
  }

  const byToken = new Map(others.map((s) => [s.token, s]));
  for (const token of new Set([...custom.keys(), ...reverse.keys()])) {
    const forward = (custom.get(token) || 0) / n;
    const back = reverse.get(token) || 0;
    const fraction = Math.max(forward, back);
    if (fraction < CONFLICT_FRACTION) continue;
    const other = byToken.get(token);
    const otherLoc = other?.location || 'unknown';
    conflicts.push({
      kind: 'custom', token, fraction,
      message: `Too close to your sign ${token} (${Math.round(fraction * 100)}% of frames overlap).`,
      suggestion: suggestion(otherLoc === draftLoc, draftLoc),
    });
  }

  conflicts.sort((a, b) => b.fraction - a.fraction);
  return { conflicts, checked: n, location: draftLoc, calibration: draftEntry?.calibration || null };
}

export { locationBucket };
export default { checkConflicts, CONFLICT_FRACTION };
