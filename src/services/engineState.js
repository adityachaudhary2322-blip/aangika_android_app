/**
 * Which engines are active, persisted across reloads.
 *
 *   vision_engine   how landmarks become tokens
 *   grammar_engine  how tokens become a sentence
 *
 * The two are independent: SignBridge tokens can be expanded by Gemini, and
 * Aangika tokens can be left as raw gloss.
 */

const VISION_KEY = 'vision_engine';
const GRAMMAR_KEY = 'grammar_engine';

export const VISION_AANGIKA = 'aangika';
export const VISION_SIGNBRIDGE = 'signbridge';

export const GRAMMAR_QWEN_OFFLINE = 'qwen_offline';
export const GRAMMAR_GEMINI_ONLINE = 'gemini_online';
export const GRAMMAR_RAW_GLOSS = 'raw_gloss';

const VISION_VALUES = [VISION_AANGIKA, VISION_SIGNBRIDGE];
const GRAMMAR_VALUES = [GRAMMAR_QWEN_OFFLINE, GRAMMAR_GEMINI_ONLINE, GRAMMAR_RAW_GLOSS];

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
      'Measured at 0.49 precision / 0.23 recall on 5,854 held-out clips.',
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

export function getGrammarEngine() {
  return read(GRAMMAR_KEY, GRAMMAR_VALUES, GRAMMAR_QWEN_OFFLINE);
}

export function setGrammarEngine(value) {
  return write(
    GRAMMAR_KEY,
    GRAMMAR_VALUES.includes(value) ? value : GRAMMAR_QWEN_OFFLINE
  );
}

/** Bridge to translationService's online/offline mode. */
export function grammarToPipelineMode(grammar) {
  return grammar === GRAMMAR_GEMINI_ONLINE ? 'online' : 'offline';
}

export default {
  VISION_AANGIKA, VISION_SIGNBRIDGE,
  GRAMMAR_QWEN_OFFLINE, GRAMMAR_GEMINI_ONLINE, GRAMMAR_RAW_GLOSS,
  VISION_ENGINES, GRAMMAR_ENGINES,
  getVisionEngine, setVisionEngine, toggleVisionEngine,
  getGrammarEngine, setGrammarEngine, grammarToPipelineMode,
};
