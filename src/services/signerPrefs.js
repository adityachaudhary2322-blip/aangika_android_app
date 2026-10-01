/**
 * Who is signing, and how they want it translated.
 *
 *   signer   'me'      the user signs: front camera, mirrored preview
 *            'friend'  the user holds the phone up to someone who signs:
 *                      back camera, and the app leads with replying by voice
 *            null      not asked yet (the home screen asks once)
 *   capture  'live'    realtime: signs are spoken as a sentence ends
 *            'record'  like Google Translate: record, stop, then read and play
 *
 *   gender   'male' | 'female' | null   the signer's own gender, for Hindi
 *            (and other gendered languages) first-person forms: "मैं खाता हूँ"
 *            / "मैं खाती हूँ", and the default voice. null: not set (masculine
 *            forms, as before the setting existed in the rules; Sarvam used to
 *            default to feminine).
 *
 * Kept in localStorage; changeable at any time from Home or the translator.
 */

const SIGNER_KEY = 'aangika.signer';
const CAPTURE_KEY = 'aangika.capture';
const GENDER_KEY = 'aangika.gender';
const GENDERS = ['male', 'female'];
const SIGNERS = ['me', 'friend'];
const CAPTURES = ['live', 'record'];
const listeners = new Set();

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };
const emit = () => listeners.forEach((fn) => fn({ signer: getSigner(), capture: getCapture(), gender: getGender() }));

export function getGender() {
  const v = read(GENDER_KEY);
  return GENDERS.includes(v) ? v : null;
}
/** Grammatical gender to use: the user's choice, masculine when not set. */
export const grammarGender = () => getGender() || 'male';
export function setGender(v) {
  if (!GENDERS.includes(v)) return getGender();
  write(GENDER_KEY, v);
  emit();
  return v;
}

export function getSigner() {
  const v = read(SIGNER_KEY);
  return SIGNERS.includes(v) ? v : null;
}

export function setSigner(v) {
  if (!SIGNERS.includes(v)) return getSigner();
  write(SIGNER_KEY, v);
  emit();
  return v;
}

export function getCapture() {
  const v = read(CAPTURE_KEY);
  return CAPTURES.includes(v) ? v : 'live';
}

export function setCapture(v) {
  if (!CAPTURES.includes(v)) return getCapture();
  write(CAPTURE_KEY, v);
  emit();
  return v;
}

/** The camera that faces whoever is signing. */
export const facingFor = (signer) => (signer === 'friend' ? 'environment' : 'user');

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export default { getSigner, setSigner, getCapture, setCapture, facingFor, subscribe, getGender, setGender, grammarGender };
