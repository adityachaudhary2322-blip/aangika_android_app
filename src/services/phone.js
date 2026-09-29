/**
 * Phone numbers for opt-in friend discovery. Pure functions, shared by the app
 * and the discover-friends Edge Function (which copies the same logic).
 */

/**
 * Normalise to E.164 (+CCNNNN…). Numbers without a country code are taken as
 * Indian (+91). Returns null when the input cannot be a phone number.
 */
export function toE164(raw, defaultCountry = '91') {
  let s = String(raw || '').trim();
  if (!s) return null;
  s = s.replace(/[\s().-]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (!s.startsWith('+')) {
    s = s.replace(/^0+/, '');
    if (!/^\d+$/.test(s)) return null;
    // Indian mobile numbers are 10 digits; anything longer already has a code.
    s = s.length === 10 ? `+${defaultCountry}${s}` : `+${s}`;
  }
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}

/** Unique, valid E.164 numbers from any list of raw strings, capped. */
export function normaliseList(raws, max = 500) {
  const out = new Set();
  for (const r of raws || []) {
    const e = toE164(r);
    if (e) out.add(e);
    if (out.size >= max) break;
  }
  return [...out];
}

/**
 * Server-side rule (mirrored in supabase/functions/discover-friends): a
 * profile matches when its owner made it discoverable and the number is one
 * the caller looked up. Numbers are self-declared (no SMS check), so each
 * match says whether the number was verified. The reply contains matches
 * only: nothing about numbers that did not match.
 */
export function matchDiscoverable(profiles, numbers) {
  const wanted = new Set(numbers);
  return profiles
    .filter((p) => p.discoverable && p.phone_e164 && wanted.has(p.phone_e164))
    .map((p) => ({ id: p.id, handle: p.handle, display_name: p.display_name, verified: Boolean(p.phone_verified) }));
}

export default { toE164, normaliseList, matchDiscoverable };
