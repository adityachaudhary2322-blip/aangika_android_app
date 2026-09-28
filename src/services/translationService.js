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
import { reconstruct as geminiReconstruct } from './translator.js';
import { getLanguage } from '../config/languages.js';
import { findByToken, textFor } from './customSigns.js';

/**
 * The user's own signs among the tags, as a glossary for online prompts.
 * Only word/name signs; a sentence sign never reaches a model.
 */
export function glossaryFor(tags) {
  const out = [];
  const seen = new Set();
  for (const t of tags || []) {
    const s = findByToken(t);
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

export const MODE_ONLINE = 'online';
export const MODE_OFFLINE = 'offline';

const STORAGE_KEY = 'isl.pipelineMode';

/** Persisted so the choice survives a reload. */
export function getMode() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === MODE_OFFLINE ? MODE_OFFLINE : MODE_ONLINE;
  } catch {
    return MODE_ONLINE;
  }
}

export function setMode(mode) {
  const value = mode === MODE_OFFLINE ? MODE_OFFLINE : MODE_ONLINE;
  try {
    localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Private mode: the choice simply does not persist.
  }
  return value;
}

export function toggleMode() {
  return setMode(getMode() === MODE_OFFLINE ? MODE_ONLINE : MODE_OFFLINE);
}

/**
 * Badge text and colour for the current pipeline.
 *
 * `effective` is what will ACTUALLY be used: selecting online mode with no
 * network or no key still runs offline, and the badge says so rather than
 * promising a translation that will not arrive.
 */
export function describeMode(mode = getMode(), { online = true, hasKey = true } = {}) {
  const degraded = mode === MODE_ONLINE && (!online || !hasKey);

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
        : 'Online mode is selected but no Gemini key is set.',
    };
  }

  return {
    effective: MODE_ONLINE,
    icon: '🟢',
    label: 'Online (Gemini)',
    short: 'Online',
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
 * @param {{ mode?: string }} options
 */
export async function translate(tags, languageCode, { mode = getMode() } = {}) {
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
    const { english, rule, translated } = expand(tags, language.code);
    // The rules produce non-English text only for fixed templates (built-in
    // gestures, greetings, introductions). Everything else stays English --
    // inventing a Hindi string we cannot produce would be worse than admitting
    // the gap.
    const target = language.code === 'en-IN' ? '' : (translated || '');
    return {
      english,
      translated: target,
      source: 'offline',
      engine: `isl-rules:${rule}`,
      language,
      latencyMs: Math.round((performance.now() - started) * 100) / 100,
      mode,
      note: language.code === 'en-IN' || target
        ? null
        : `${language.name} translation needs the online engine.`,
    };
  }

  // ── Online: Gemini, with the offline engine as the safety net ───────────
  const result = await geminiReconstruct(tags, languageCode, { glossary: glossaryFor(tags) });

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
  const { english, rule, translated } = expand(tags, language.code);
  return {
    english,
    translated: language.code === 'en-IN' ? '' : (translated || ''),
    source: 'offline',
    engine: `isl-rules:${rule}`,
    language,
    latencyMs: Math.round(performance.now() - started),
    mode,
    degraded: true,
    note: result.error || 'Gemini unavailable — used the local rules engine.',
  };
}

export default {
  MODE_ONLINE, MODE_OFFLINE,
  getMode, setMode, toggleMode, describeMode, translate, glossaryFor,
};
