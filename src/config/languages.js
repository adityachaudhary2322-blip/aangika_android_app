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
];

export const DEFAULT_LANGUAGE_CODE = 'hi-IN';

export function getLanguage(code) {
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES[0];
}

/** Bulbul v3 speakers offered in Settings; both speak all 11 languages. */
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
    target_language_code: lang.code,
    speaker: getVoice() || lang.speaker,
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
  return getLanguage(code).code;
}

export default LANGUAGES;
