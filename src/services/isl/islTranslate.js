/**
 * A finished ISL Studio sentence (the signs spotted before FULL STOP) ->
 * words in the chosen language.
 *
 *  1. one "sentence" sign: its stored sentence;
 *  2. this dictionary's OWN rules (islDictionary.getRules): patterns over
 *     sign names and categories, e.g. ["@pronoun", "@place", "GO"] ->
 *     "I am going to the {place}." with Hindi / Hinglish templates;
 *  3. everything else the app has: the built-in phrase rules (by meaning),
 *     the ISL grammar, and Sarvam / Gemini when online (translate()).
 */

import { getRules } from './islDictionary.js';
import { translate } from '../translationService.js';
import { hasSarvam, sarvamTranslate } from '../translator.js';

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** What a rule item captures from one sign. */
const capture = (s) => ({
  en: s.word, hi: s.texts?.['hi-IN'], hinglish: s.texts?.hinglish, word: s.word.toLowerCase(),
  ...(s.type === 'name' ? { name: s.word } : {}),
});

function fits(item, s) {
  if (item.startsWith('@')) {
    const cls = item.slice(1);
    if (cls === 'name') return s.type === 'name';
    return s.category === cls;
  }
  return item === s.token || item.toLowerCase() === s.word.toLowerCase();
}

/** Whole-sentence match of a pattern against the signs. -> captures | null */
export function matchStudioPattern(pattern, signs) {
  const go = (p, i, caps) => {
    if (p === pattern.length) return i === signs.length ? caps : null;
    const raw = pattern[p];
    const optional = raw.endsWith('?');
    const item = optional ? raw.slice(0, -1) : raw;
    if (i < signs.length && fits(item, signs[i])) {
      const key = item.startsWith('@') ? item.slice(1) : item.toLowerCase();
      const got = go(p + 1, i + 1, { ...caps, [key]: capture(signs[i]) });
      if (got) return got;
    }
    return optional ? go(p + 1, i, caps) : null;
  };
  return go(0, 0, {});
}

function fill(template, caps, lang) {
  const field = lang === 'en-IN' ? 'en' : lang === 'hi-IN' ? 'hi' : lang === 'hinglish' ? 'hinglish' : null;
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_, key) => {
    const c = caps[key];
    if (!c) return '';
    if (c.name) return c.name;
    const v = field ? c[field] : null;
    if (v) return v;
    if (lang === 'en-IN' || lang === 'hinglish') return c.en;
    missing = true;
    return '';
  });
  return missing ? null : out.replace(/\s+/g, ' ').replace(/\s+([.,!?।])/g, '$1').trim();
}

/** A "when I sign these, say this" rule (the Rules tab's quick form). */
export const isSayRule = (r) => r.id.startsWith('say-');

/**
 * Say-rule match: every sign of the pattern appears somewhere in the
 * sentence, in any order, with other signs allowed around them. -> captures | null
 */
export function matchStudioSigns(pattern, signs) {
  const used = new Set();
  const caps = {};
  for (const raw of pattern) {
    const item = raw.replace(/\?$/, '');
    const i = signs.findIndex((s, j) => !used.has(j) && fits(item, s));
    if (i < 0) {
      if (raw.endsWith('?')) continue;
      return null;
    }
    used.add(i);
    caps[item.startsWith('@') ? item.slice(1) : item.toLowerCase()] = capture(signs[i]);
  }
  return caps;
}

function apply(r, caps) {
  const texts = {};
  for (const [lang, tpl] of Object.entries(r.texts || {})) {
    const t = fill(tpl, caps, lang);
    if (t) texts[lang] = t;
  }
  return { english: cap(fill(r.english, caps, 'en-IN') || ''), texts, rule: `isl-rule:${r.id}` };
}

/**
 * This dictionary's own rules. -> {english, texts, rule} | null
 *  1. any rule matching the whole sentence exactly, in order;
 *  2. else the say-rule whose signs are all in the sentence, most signs first
 *     (so WELCOME + SEGUE beats WELCOME alone).
 */
export function matchStudioRules(signs, rules = getRules()) {
  for (const r of rules) {
    const caps = matchStudioPattern(r.pattern, signs);
    if (caps) return apply(r, caps);
  }
  const say = rules.filter(isSayRule).sort((a, b) => b.pattern.length - a.pattern.length);
  for (const r of say) {
    const caps = matchStudioSigns(r.pattern, signs);
    if (caps) return apply(r, caps);
  }
  return null;
}

/** Sign -> the token the rest of the app understands. */
const tagFor = (s) => (s.type === 'name' ? `FS-${s.token}` : s.token);

/**
 * @param signs     the sentence's signs, in order (full-stop signs removed)
 * @param language  output language code
 * -> translate()-shaped result
 */
export async function translateStudio(signs, language, { mode } = {}) {
  const words = signs.filter((s) => s.type !== 'full-stop');
  if (!words.length) return { english: '', translated: '', engine: 'none' };

  // A rule for these signs wins; otherwise one sign alone says its own
  // word ("Welcome.") rather than a grammar guess ("I am a welcome.").
  const one = words.length === 1 ? words[0] : null;
  const fixed = matchStudioRules(words) || (one ? {
    english: one.type === 'sentence' || /[.!?।]$/.test(one.word) ? one.word : `${cap(one.word.toLowerCase() === one.word ? one.word : one.word.charAt(0) + one.word.slice(1).toLowerCase())}.`,
    texts: one.texts || {},
    rule: one.type === 'sentence' ? 'isl-sentence-sign' : 'isl-single-sign',
  } : null);
  if (fixed?.english) {
    let translated = language === 'en-IN' ? '' : (fixed.texts[language] || '');
    let engine = fixed.rule;
    const online = typeof navigator === 'undefined' || navigator.onLine !== false;
    if (!translated && language !== 'en-IN' && online && mode !== 'offline' && hasSarvam()) {
      try { translated = await sarvamTranslate(fixed.english, language); engine += ' + mayura'; } catch { /* English */ }
    }
    return { english: fixed.english, translated, engine, source: 'isl-studio' };
  }
  return translate(words.map(tagFor), language, mode ? { mode } : {});
}

export default { translateStudio, matchStudioRules, matchStudioPattern, matchStudioSigns };
