/**
 * The single entry point for turning sign tags into a sentence.
 *
 * Two pipelines, chosen explicitly by the user rather than guessed:
 *
 *   ONLINE   -> Gemini. Real translation into any of the 11 languages.
 *   OFFLINE  -> islGrammar.js. Deterministic ISL grammar expansion, executed
 *               in this tab. No fetch is issued at all.
 *
 * "Offline" here means genuinely offline: the offline path contains no network
 * call, so it works in airplane mode, costs nothing, leaks nothing, and returns
 * in well under a millisecond.
 *
 * Naming note, because the UI label says "Local Qwen Logic": no Qwen weights
 * run in the browser. The offline engine executes the grammar RULES that were
 * derived while prompt-engineering Qwen2.5-0.5B (see qwenRules.js). On the
 * seven held-out cases those rules were built from, this engine scores 7/7
 * where the actual 0.5 B model scored 1/7 -- so the substitution is an upgrade
 * in accuracy as well as in size, but it is rules, not a model.
 */

import { expand } from './islGrammar.js';
import {
  reconstruct as geminiReconstruct, sarvamReconstruct, sarvamTranslate, getKeys,
} from './translator.js';
import { getLanguage } from '../config/languages.js';
import { findByToken, textFor } from './customSigns.js';
import { expandAsl } from './aslGrammar.js';
import { getSignLanguage } from './engineState.js';

/** A fingerspelled word in the token stream: FS-ADITYA (ASL gloss convention). */
export const isFingerspelled = (t) => /^FS[-_]/i.test(String(t || ''));
const spelledText = (t) => {
  const w = String(t).slice(3).toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

/**
 * Taught signs first, then fingerspelled words, which behave like taught
 * NAME signs: proper nouns, kept exactly, never translated.
 */
function lookupSign(token) {
  const own = findByToken(token);
  if (own) return own;
  if (isFingerspelled(token)) {
    return { id: `fs:${token}`, token, output: { type: 'name', text_en: spelledText(token), texts: {} } };
  }
  return null;
}

/** Offline grammar for the sign language being read. */
function rules(tags, languageCode, signLanguage) {
  if (signLanguage === 'ASL') {
    const { english, rule } = expandAsl(tags);
    return { english, translated: '', rule: `asl-rules:${rule}` };
  }
  const r = expand(tags, languageCode, { lookup: lookupSign });
  return { ...r, rule: `isl-rules:${r.rule}` };
}

/**
 * The user's own signs among the tags, as a glossary for online prompts.
 * Only word/name signs; a sentence sign never reaches a model.
 */
export function glossaryFor(tags) {
  const out = [];
  const seen = new Set();
  for (const t of tags || []) {
    const s = lookupSign(t);
    if (!s || seen.has(s.id)) continue;
    const type = s.output?.type;
    if (type !== 'word' && type !== 'name') continue;
    seen.add(s.id);
    out.push({
      token: s.token, type, text_en: s.output.text_en,
      category: s.output.category, texts: s.output.texts,
    });
  }
  return out;
}

export const MODE_ONLINE = 'online';     // Gemini
export const MODE_SARVAM = 'sarvam';     // Sarvam chat + Mayura translation
export const MODE_OFFLINE = 'offline';

const MODES = [MODE_ONLINE, MODE_SARVAM, MODE_OFFLINE];
const STORAGE_KEY = 'isl.pipelineMode';
/** The last online engine chosen, so the offline toggle can restore it. */
const LAST_ONLINE_KEY = 'isl.pipelineOnline';

/** Persisted so the choice survives a reload. */
export function getMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return MODES.includes(saved) ? saved : MODE_ONLINE;
  } catch {
    return MODE_ONLINE;
  }
}

export function setMode(mode) {
  const value = MODES.includes(mode) ? mode : MODE_ONLINE;
  try {
    localStorage.setItem(STORAGE_KEY, value);
    if (value !== MODE_OFFLINE) localStorage.setItem(LAST_ONLINE_KEY, value);
  } catch {
    // Private mode: the choice simply does not persist.
  }
  return value;
}

/**
 * Offline <-> online. Going online restores the online engine used last,
 * or picks whichever one has a key (Sarvam first: it covers all 11 languages
 * in one service).
 */
export function toggleMode() {
  if (getMode() !== MODE_OFFLINE) return setMode(MODE_OFFLINE);
  let last = null;
  try { last = localStorage.getItem(LAST_ONLINE_KEY); } catch { /* private mode */ }
  if (last === MODE_SARVAM || last === MODE_ONLINE) return setMode(last);
  const keys = getKeys();
  return setMode(keys.sarvam || !keys.gemini ? MODE_SARVAM : MODE_ONLINE);
}

/**
 * Badge text and colour for the current pipeline.
 *
 * `effective` is what will ACTUALLY be used: selecting online mode with no
 * network or no key still runs offline, and the badge says so rather than
 * promising a translation that will not arrive.
 */
export function describeMode(mode = getMode(), { online = true, hasKey } = {}) {
  // Each online engine needs its own key; callers may only know Gemini's.
  const keys = getKeys();
  const keyed = mode === MODE_SARVAM
    ? Boolean(keys.sarvam)
    : (hasKey ?? Boolean(keys.gemini));
  const degraded = mode !== MODE_OFFLINE && (!online || !keyed);
  const engineName = mode === MODE_SARVAM ? 'Sarvam' : 'Gemini';

  if (mode === MODE_OFFLINE) {
    return {
      effective: MODE_OFFLINE,
      icon: '📴',
      label: 'Offline (Local Qwen Logic)',
      short: 'Offline',
      tone: 'amber',
      detail: 'Deterministic ISL grammar rules, running in this tab. No network.',
    };
  }

  if (degraded) {
    return {
      effective: MODE_OFFLINE,
      icon: '📴',
      label: !online
        ? 'Offline (no network — using Local Qwen Logic)'
        : 'Offline (no API key — using Local Qwen Logic)',
      short: 'Offline',
      tone: 'amber',
      detail: !online
        ? 'Online mode is selected but there is no connection.'
        : `${engineName} is selected but no ${engineName} key is set (Settings).`,
    };
  }

  if (mode === MODE_SARVAM) {
    return {
      effective: MODE_SARVAM,
      icon: '🟢',
      label: 'Online (Sarvam)',
      short: 'Sarvam',
      tone: 'primary',
      detail: 'Sentences from Sarvam, spoken and translated in all 11 languages.',
    };
  }

  return {
    effective: MODE_ONLINE,
    icon: '🟢',
    label: 'Online (Gemini)',
    short: 'Gemini',
    tone: 'primary',
    detail: 'Sentences and translation come from Gemini Flash.',
  };
}

/**
 * Translate sign tags.
 *
 * NEVER throws. The offline path cannot fail; the online path degrades to the
 * offline path and reports that it did.
 *
 * @param {string[]} tags
 * @param {string} languageCode
 * @param {{ mode?: string, signLanguage?: 'ISL' | 'ASL' }} options
 */
export async function translate(tags, languageCode, {
  mode = getMode(), signLanguage = getSignLanguage(),
} = {}) {
  const started = performance.now();
  const language = getLanguage(languageCode);

  if (!tags || tags.length === 0) {
    return {
      english: '', translated: '', source: 'offline', engine: 'none',
      language, latencyMs: 0, mode,
    };
  }

  // ── A taught "sentence" sign: its stored text, no grammar, no model ─────
  // It already carries a whole utterance in every language the user saved
  // (filled online when it was created), so it works identically offline.
  if (tags.length === 1) {
    const sign = findByToken(tags[0]);
    if (sign?.output?.type === 'sentence') {
      const english = textFor(sign, 'en-IN') || '';
      const stored = sign.output.texts?.[language.code];
      return {
        english,
        translated: language.code === 'en-IN' ? '' : (stored || ''),
        source: 'custom',
        engine: 'my-sign',
        language,
        latencyMs: Math.round((performance.now() - started) * 100) / 100,
        mode,
        note: language.code !== 'en-IN' && !stored
          ? `No ${language.name} text saved for this sign yet.`
          : null,
      };
    }
  }

  // ── Offline: no fetch, no await on anything remote ──────────────────────
  if (mode === MODE_OFFLINE) {
    const { english, rule, translated } = rules(tags, language.code, signLanguage);
    // The rules produce non-English text only for fixed templates (built-in
    // gestures, greetings, introductions). Everything else stays English --
    // inventing a Hindi string we cannot produce would be worse than admitting
    // the gap.
    const target = language.code === 'en-IN' ? '' : (translated || '');
    return {
      english,
      translated: target,
      source: 'offline',
      engine: rule,
      language,
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
      mode,
      signLanguage,
      note: language.code === 'en-IN' || target
        ? null
        : `${language.name} translation needs the online engine.`,
    };
  }

  // ── Sarvam: chat model, then rules + Mayura, then rules alone ──────────
  if (mode === MODE_SARVAM) {
    const glossary = glossaryFor(tags);
    const r = await sarvamReconstruct(tags, languageCode, { glossary, signLanguage });
    if (r.source === 'sarvam') {
      let translated = r.translated;
      // The chat model occasionally skips the translation; Mayura fills it.
      if (!translated && language.code !== 'en-IN') {
        translated = await sarvamTranslate(r.english, language.code).catch(() => '');
      }
      return {
        english: r.english,
        translated: language.code === 'en-IN' ? '' : translated,
        source: 'online', engine: r.model, language,
        latencyMs: Math.round(performance.now() - started), mode,
      };
    }
    // Chat unavailable: the local grammar still makes the sentence, and
    // Mayura can still put it into the user's language.
    const { english, rule, translated: ruleText } = rules(tags, language.code, signLanguage);
    let translated = language.code === 'en-IN' ? '' : (ruleText || '');
    let engine = rule;
    if (!translated && language.code !== 'en-IN') {
      try {
        translated = await sarvamTranslate(english, language.code);
        engine += ' + mayura';
      } catch { /* stays English, note says why */ }
    }
    return {
      english, translated, source: translated || language.code === 'en-IN' ? 'online' : 'offline',
      engine, language, latencyMs: Math.round(performance.now() - started), mode,
      degraded: true, note: r.error || 'Sarvam chat unavailable — used the local rules.',
    };
  }

  // ── Online: Gemini, with the offline engine as the safety net ───────────
  const result = await geminiReconstruct(tags, languageCode, {
    glossary: glossaryFor(tags), signLanguage,
  });

  if (result.source === 'gemini') {
    return {
      english: result.english,
      translated: result.translated,
      source: 'online',
      engine: result.model,
      language,
      latencyMs: result.latencyMs,
      mode,
    };
  }

  // Gemini was unreachable. Fall through to the rules engine rather than the
  // bare word-join that translator.js would otherwise return -- the rules give
  // a real sentence for free.
  const { english, rule, translated } = rules(tags, language.code, signLanguage);
  return {
    english,
    translated: language.code === 'en-IN' ? '' : (translated || ''),
    source: 'offline',
    engine: rule,
    language,
    latencyMs: Math.round(performance.now() - started),
    mode,
    degraded: true,
    note: result.error || 'Gemini unavailable — used the local rules engine.',
  };
}

export default {
  MODE_ONLINE, MODE_SARVAM, MODE_OFFLINE,
  getMode, setMode, toggleMode, describeMode, translate, glossaryFor,
};
