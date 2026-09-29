/**
 * Which engines are active, persisted across reloads.
 *
 *   vision_engine   how landmarks become tokens
 *   grammar_engine  how tokens become a sentence
 *
 * The two are independent: SignBridge tokens can be expanded by Gemini, and
 * Aangika tokens can be left as raw gloss.
 */

import { MODELS, getModel, defaultModel, SIGN_LANGUAGES } from '../config/models.js';
import { isHosted } from './sarvamClient.js';

const VISION_KEY = 'vision_engine';
const GRAMMAR_KEY = 'grammar_engine';

export const VISION_AANGIKA = 'aangika';
export const VISION_SIGNBRIDGE = 'signbridge';

export const GRAMMAR_QWEN_OFFLINE = 'qwen_offline';
export const GRAMMAR_GEMINI_ONLINE = 'gemini_online';
export const GRAMMAR_SARVAM_ONLINE = 'sarvam_online';
export const GRAMMAR_RAW_GLOSS = 'raw_gloss';

/**
 * The vision engine value is either a legacy alias ('aangika', 'signbridge',
 * kept so saved settings and the compact toggles keep working) or any model
 * id from src/config/models.js.
 */
const VISION_ALIASES = {
  [VISION_AANGIKA]: 'isl-aangika-v2',
  [VISION_SIGNBRIDGE]: 'isl-signbridge',
};
export const modelIdFor = (vision) => VISION_ALIASES[vision] || vision;
export function visionFor(modelId) {
  const alias = Object.entries(VISION_ALIASES).find(([, id]) => id === modelId);
  return alias ? alias[0] : modelId;
}
const VISION_VALUES = [VISION_AANGIKA, VISION_SIGNBRIDGE, ...MODELS.map((m) => m.id)];
const GRAMMAR_VALUES = [
  GRAMMAR_QWEN_OFFLINE, GRAMMAR_SARVAM_ONLINE, GRAMMAR_GEMINI_ONLINE, GRAMMAR_RAW_GLOSS,
];

/** Descriptions shown in the UI. Kept here so every surface agrees. */
export const VISION_ENGINES = {
  [VISION_AANGIKA]: {
    id: VISION_AANGIKA,
    icon: '⚡',
    name: 'Aangika',
    tagline: '1500 dynamic words, multi-frame temporal model',
    detail:
      'A 5.3 M-parameter Conv1d + BiLSTM tagger over a 40-frame window. It ' +
      'reads movement, so it can recognise signs that differ only in motion. ' +
      'Measured live (40-frame windows) on 996 never-seen clips: 0.44 precision / 0.22 recall.',
    tone: 'primary',
  },
  [VISION_SIGNBRIDGE]: {
    id: VISION_SIGNBRIDGE,
    icon: '🌿',
    name: 'SignBridge',
    tagline: 'Static pose & alphabet classifier, ultra-low latency',
    detail:
      "Wrist-relative 63-coordinate hand features from SignBridge's " +
      'normaliser, classified geometrically in ~0.004 ms per frame. It sees ' +
      'one frame at a time, so it handles handshapes and fingerspelling but ' +
      'cannot recognise anything defined by movement.',
    tone: 'secondary',
  },
};

export const GRAMMAR_ENGINES = {
  [GRAMMAR_QWEN_OFFLINE]: {
    id: GRAMMAR_QWEN_OFFLINE,
    icon: '📴',
    name: 'Local SVO Rules',
    tagline: 'Deterministic ISL grammar, on device',
    detail:
      'Pro-drop recovery, SOV to SVO reordering, tense from the time word, ' +
      'kinship possessives. No network, ~40 microseconds. English only, ' +
      'except for the greeting templates.',
    tone: 'amber',
  },
  [GRAMMAR_SARVAM_ONLINE]: {
    id: GRAMMAR_SARVAM_ONLINE,
    icon: '🇮🇳',
    name: 'Sarvam',
    tagline: 'Indian-language AI: sentence, translation and voice',
    detail:
      'Sends the recognised words to Sarvam\'s chat model (sarvam-30b) with ' +
      'the ISL grammar priors; Mayura fills any language the model skips, and ' +
      'Bulbul speaks all 11. ' +
      (isHosted()
        ? 'Included: no key needed (your own key in Settings is used instead, if you add one). '
        : 'Needs a Sarvam key. ') +
      'If the chat model is unavailable the local rules make the sentence and Mayura translates it.',
    tone: 'primary',
  },
  [GRAMMAR_GEMINI_ONLINE]: {
    id: GRAMMAR_GEMINI_ONLINE,
    icon: '🟢',
    name: 'Gemini Flash',
    tagline: 'Cloud translation into all 11 languages',
    detail:
      'Sends the recognised words to Gemini with the ISL grammar priors. ' +
      'Needs a key and a connection; falls back to the local rules if either ' +
      'is missing.',
    tone: 'primary',
  },
  [GRAMMAR_RAW_GLOSS]: {
    id: GRAMMAR_RAW_GLOSS,
    icon: '🔤',
    name: 'Raw Gloss',
    tagline: 'The tokens exactly as recognised',
    detail:
      'No reconstruction at all. Shows what the vision model actually output, ' +
      'which is the honest view when you want to judge recognition quality ' +
      'rather than the language model on top of it.',
    tone: 'ink',
  },
};

function read(key, values, fallback) {
  try {
    const v = localStorage.getItem(key);
    return values.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode: the choice does not persist.
  }
  return value;
}

export function getVisionEngine() {
  return read(VISION_KEY, VISION_VALUES, VISION_AANGIKA);
}

export function setVisionEngine(value) {
  return write(VISION_KEY, VISION_VALUES.includes(value) ? value : VISION_AANGIKA);
}

export function toggleVisionEngine() {
  return setVisionEngine(
    getVisionEngine() === VISION_AANGIKA ? VISION_SIGNBRIDGE : VISION_AANGIKA
  );
}

const SIGN_LANGUAGE_KEY = 'sign_language';

/** The sign language being recognised: 'ISL' (default) or 'ASL'. */
export function getSignLanguage() {
  return read(SIGN_LANGUAGE_KEY, SIGN_LANGUAGES, 'ISL');
}

/**
 * Switch sign language. If the current model is for another language, the
 * new language's default model is chosen too. -> {language, vision}
 */
export function setSignLanguage(language) {
  const lang = write(SIGN_LANGUAGE_KEY, SIGN_LANGUAGES.includes(language) ? language : 'ISL');
  const current = getModel(modelIdFor(getVisionEngine()));
  let vision = getVisionEngine();
  if (!current || current.language !== lang) {
    const d = defaultModel(lang);
    if (d && d.language === lang) vision = setVisionEngine(visionFor(d.id));
  }
  return { language: lang, vision };
}

/** Default: Sarvam when this build includes the hosted service (no key needed). */
export function getGrammarEngine() {
  return read(GRAMMAR_KEY, GRAMMAR_VALUES, isHosted() ? GRAMMAR_SARVAM_ONLINE : GRAMMAR_QWEN_OFFLINE);
}

export function setGrammarEngine(value) {
  return write(
    GRAMMAR_KEY,
    GRAMMAR_VALUES.includes(value) ? value : GRAMMAR_QWEN_OFFLINE
  );
}

/** Bridge to translationService's online/offline mode. */
export function grammarToPipelineMode(grammar) {
  if (grammar === GRAMMAR_GEMINI_ONLINE) return 'online';
  if (grammar === GRAMMAR_SARVAM_ONLINE) return 'sarvam';
  return 'offline';
}

export default {
  VISION_AANGIKA, VISION_SIGNBRIDGE,
  GRAMMAR_QWEN_OFFLINE, GRAMMAR_SARVAM_ONLINE, GRAMMAR_GEMINI_ONLINE, GRAMMAR_RAW_GLOSS,
  VISION_ENGINES, GRAMMAR_ENGINES,
  getVisionEngine, setVisionEngine, toggleVisionEngine,
  getGrammarEngine, setGrammarEngine, grammarToPipelineMode,
  getSignLanguage, setSignLanguage, modelIdFor, visionFor,
};
