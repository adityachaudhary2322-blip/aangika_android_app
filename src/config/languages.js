/**
 * The 11 languages the translator can speak.
 *
 * `code` is the BCP-47 tag Sarvam TTS/STT expects as `target_language_code`,
 * and the same tag is handed to the browser's SpeechSynthesis when Sarvam is
 * unreachable. `name` is what Gemini is asked to translate into. `script` is
 * shown in the picker so a user can find their own language without reading
 * English.
 *
 * Note `od-IN` for Odia: Sarvam uses that tag, not the ISO `or-IN`. Sending
 * `or-IN` returns a 4xx, so this list is the source of truth for API calls.
 */

import { getGender } from '../services/signerPrefs.js';
export const LANGUAGES = [
  { code: 'hi-IN', name: 'Hindi',     script: 'हिन्दी',    speaker: 'ritu',   dir: 'ltr' },
  { code: 'en-IN', name: 'English',   script: 'English',  speaker: 'ritu',   dir: 'ltr' },
  { code: 'ta-IN', name: 'Tamil',     script: 'தமிழ்',     speaker: 'ritu',   dir: 'ltr' },
  { code: 'te-IN', name: 'Telugu',    script: 'తెలుగు',    speaker: 'ritu',   dir: 'ltr' },
  { code: 'bn-IN', name: 'Bengali',   script: 'বাংলা',     speaker: 'ritu',   dir: 'ltr' },
  { code: 'mr-IN', name: 'Marathi',   script: 'मराठी',     speaker: 'ritu',   dir: 'ltr' },
  { code: 'gu-IN', name: 'Gujarati',  script: 'ગુજરાતી',   speaker: 'ritu',   dir: 'ltr' },
  { code: 'kn-IN', name: 'Kannada',   script: 'ಕನ್ನಡ',     speaker: 'ritu',   dir: 'ltr' },
  { code: 'ml-IN', name: 'Malayalam', script: 'മലയാളം',   speaker: 'ritu',   dir: 'ltr' },
  { code: 'pa-IN', name: 'Punjabi',   script: 'ਪੰਜਾਬੀ',    speaker: 'ritu',   dir: 'ltr' },
  { code: 'od-IN', name: 'Odia',      script: 'ଓଡ଼ିଆ',     speaker: 'ritu',   dir: 'ltr' },
  /**
   * Hinglish: everyday Hindi-English in Roman script ("Mujhe paani chahiye").
   * Not a BCP-47 language, so each engine is told what to use instead:
   *   sarvam  Sarvam's language (Mayura translates in code-mixed mode to Roman
   *           script; Bulbul's Hindi voice reads it)
   *   speech  the device voice offline (an Indian-English voice reads Roman
   *           Hinglish far better than a Hindi one reads Latin letters)
   *   stt     speech recognition language
   */
  {
    code: 'hinglish', name: 'Hinglish (casual)', script: 'Hinglish', speaker: 'ritu', dir: 'ltr',
    sarvam: 'hi-IN', speech: 'en-IN', stt: 'hi-IN',
  },
];

/** The language code Sarvam should be sent for this app language. */
export const sarvamCode = (code) => getLanguage(code).sarvam || getLanguage(code).code;
/** The language code for speech recognition (Sarvam STT / browser). */
export const sttCode = (code) => getLanguage(code).stt || getLanguage(code).code;

export const DEFAULT_LANGUAGE_CODE = 'hi-IN';

export function getLanguage(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}

/** Bulbul v3 speakers offered in Settings; both speak every language here. */
export const VOICES = [
  { id: 'ritu', label: 'Female · Ritu' },
  { id: 'shubh', label: 'Male · Shubh' },
];
const VOICE_KEY = 'isl.ttsVoice';

export function getVoice() {
  try {
    const v = localStorage.getItem(VOICE_KEY);
    return VOICES.some((x) => x.id === v) ? v : null;
  } catch {
    return null;
  }
}

export function setVoice(id) {
  try { localStorage.setItem(VOICE_KEY, id); } catch { /* private mode */ }
  return id;
}

/** Payload for POST https://api.sarvam.ai/text-to-speech */
export function sarvamTtsPayload(text, code) {
  const lang = getLanguage(code);
  return {
    text,
    target_language_code: lang.sarvam || lang.code,
    speaker: getVoice() || (getGender() === 'male' ? 'shubh' : getGender() === 'female' ? 'ritu' : lang.speaker),
    model: 'bulbul:v3',
    output_audio_codec: 'wav',
  };
}

/**
 * Browser SpeechSynthesis fallback locale.
 *
 * Voice coverage for Indic languages is thin and device-dependent; callers
 * should check `speechSynthesis.getVoices()` and say so in the UI rather than
 * silently speaking nothing.
 */
export function browserSpeechLocale(code) {
  return getLanguage(code).speech || getLanguage(code).code;
}

export default LANGUAGES;
