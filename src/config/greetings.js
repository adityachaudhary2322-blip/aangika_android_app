/**
 * Offline greeting and self-introduction templates.
 *
 * These are the ONLY phrases the offline engine can produce in a language other
 * than English. They are fixed templates with a {name} slot, not translation --
 * there is no translation model in the browser. Anything outside these patterns
 * falls back to English and the UI says so.
 *
 * Name transliterations are per-script so "Aditya" reads correctly rather than
 * appearing in Latin letters inside a Devanagari sentence.
 */

/** Greeting word per language, used when the signer signs NAMASTE or HELLO. */
export const GREETING = {
  'en-IN': 'Hello',
  hinglish: 'Hello',
  'hi-IN': 'नमस्ते',
  'ta-IN': 'வணக்கம்',
  'te-IN': 'నమస్కారం',
  'bn-IN': 'নমস্কার',
  'mr-IN': 'नमस्कार',
  'gu-IN': 'નમસ્તે',
  'kn-IN': 'ನಮಸ್ಕಾರ',
  'ml-IN': 'നമസ്കാരം',
  'pa-IN': 'ਸਤ ਸ੍ਰੀ ਅਕਾਲ',
  'od-IN': 'ନମସ୍କାର',
};

/**
 * "My name is {name}." Kept as a whole-sentence template because word order,
 * the copula and the possessive all differ per language -- assembling them from
 * parts would produce subtly wrong grammar in most of these.
 */
export const MY_NAME_IS = {
  'en-IN': 'my name is {name}',
  hinglish: 'mera naam {name} hai',
  'hi-IN': 'मेरा नाम {name} है',
  'ta-IN': 'என் பெயர் {name}',
  'te-IN': 'నా పేరు {name}',
  'bn-IN': 'আমার নাম {name}',
  'mr-IN': 'माझे नाव {name} आहे',
  'gu-IN': 'મારું નામ {name} છે',
  'kn-IN': 'ನನ್ನ ಹೆಸರು {name}',
  'ml-IN': 'എന്റെ പേര് {name}',
  'pa-IN': 'ਮੇਰਾ ਨਾਮ {name} ਹੈ',
  'od-IN': 'ମୋର ନାମ {name}',
};

/** Sentence-final punctuation differs: Devanagari and Bengali use the danda. */
const TERMINATOR = {
  'en-IN': '.', 'hi-IN': '।', 'mr-IN': '.', 'bn-IN': '।', 'od-IN': '।',
  'pa-IN': '।', 'gu-IN': '.', 'ta-IN': '.', 'te-IN': '.', 'kn-IN': '.',
  'ml-IN': '.',
};

/**
 * Name transliterations. Only names with a known sign are listed; anything else
 * falls back to the Latin spelling, which is what a reader would expect for an
 * unfamiliar name anyway.
 */
export const NAME_FORMS = {
  ADITYA: {
    'en-IN': 'Aditya',
    'hi-IN': 'आदित्य',
    'mr-IN': 'आदित्य',
    'ta-IN': 'ஆதித்யா',
    'te-IN': 'ఆదిత్య',
    'bn-IN': 'আদিত্য',
    'gu-IN': 'આદિત્ય',
    'kn-IN': 'ಆದಿತ್ಯ',
    'ml-IN': 'ആദിത്യ',
    'pa-IN': 'ਆਦਿਤਿਆ',
    'od-IN': 'ଆଦିତ୍ୟ',
  },
};

/** Tokens the grammar engine should treat as a person's name. */
export const KNOWN_NAMES = new Set(Object.keys(NAME_FORMS));

function titleCase(token) {
  const s = String(token).toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** `override` carries a taught name's own forms ({langCode: text}). */
export function nameIn(token, code, override = null) {
  const forms = override || NAME_FORMS[String(token).toUpperCase()];
  if (!forms) return titleCase(token);
  return forms[code] || forms['en-IN'] || titleCase(token);
}

export function terminator(code) {
  return TERMINATOR[code] || '.';
}

/**
 * Build "Hello, my name is Aditya." in the requested language.
 *
 * @param {string} nameToken  e.g. "ADITYA", or null for a bare greeting
 * @param {string} code       BCP-47 tag from languages.js
 * @param {{ greet?: boolean }} options
 */
export function buildIntroduction(nameToken, code, { greet = true, forms = null } = {}) {
  const lang = GREETING[code] ? code : 'en-IN';
  const end = terminator(lang);
  const parts = [];

  if (greet) parts.push(GREETING[lang]);

  if (nameToken) {
    const template = MY_NAME_IS[lang] || MY_NAME_IS['en-IN'];
    parts.push(template.replace('{name}', nameIn(nameToken, lang, forms)));
  }

  if (parts.length === 0) return '';
  const joined = parts.join(', ');
  const capped = joined.charAt(0).toUpperCase() + joined.slice(1);
  return capped.endsWith(end) ? capped : capped + end;
}

export default { GREETING, MY_NAME_IS, NAME_FORMS, KNOWN_NAMES, buildIntroduction, nameIn };
