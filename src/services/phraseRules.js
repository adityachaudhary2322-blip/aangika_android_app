/**
 * Phrase rules: whole sign sequences with a fixed meaning, in English, Hindi
 * and Hinglish, offline.
 *
 *   I + <name sign>            -> "I am Aditya."
 *   ME + WATER                 -> "I need water."
 *   I + LOWER + BACK           -> "I have pain in my lower back."
 *
 * A pattern is a list of items that must cover the WHOLE sentence:
 *   a sign token (NAME, PAIN) or a word class (@self, @need, @body ...);
 *   a trailing "?" makes an item optional.
 * Word classes match by MEANING, so a taught sign joins a class through its
 * text: teach LOWER meaning "lower" and it is a @side.
 *
 * Built-in rules (below) render Hindi with the right gender agreement in
 * code. Developers add more from the Developer section: those are templates
 * ("I need {need}.") shared through the community dictionary, and are tried
 * first, so a developer can also override a built-in rule.
 */

import { findByToken } from './customSigns.js';
import { KNOWN_NAMES } from '../config/greetings.js';

// ── Word classes (English word -> forms) ────────────────────────────────────
// en: how it reads in an English sentence; hi / hinglish: the word itself;
// g: Hindi grammatical gender (m/f) where the sentence needs agreement.

export const CLASSES = {
  self: { i: {}, me: {}, my: {}, myself: {}, mine: {} },
  need: {
    water: { en: 'water', hi: 'पानी', hinglish: 'paani' },
    food: { en: 'food', hi: 'खाना', hinglish: 'khaana' },
    help: { en: 'help', hi: 'मदद', hinglish: 'help' },
    // (no "doctor": "I DOCTOR" may mean "I am a doctor"; DOCTOR HELP NEED is
    // handled by the general grammar.)
    medicine: { en: 'medicine', hi: 'दवाई', hinglish: 'dawai' },
    toilet: { en: 'the toilet', hi: 'शौचालय', hinglish: 'washroom' },
    washroom: { en: 'the washroom', hi: 'शौचालय', hinglish: 'washroom' },
    rest: { en: 'rest', hi: 'आराम', hinglish: 'aaram' },
    money: { en: 'money', hi: 'पैसे', hinglish: 'paise' },
    tea: { en: 'tea', hi: 'चाय', hinglish: 'chai' },
    milk: { en: 'milk', hi: 'दूध', hinglish: 'doodh' },
    ambulance: { en: 'an ambulance', hi: 'एम्बुलेंस', hinglish: 'ambulance' },
  },
  body: {
    back: { en: 'back', hi: 'पीठ', g: 'f', hinglish: 'back' },
    head: { en: 'head', hi: 'सिर', g: 'm', hinglish: 'sir' },
    stomach: { en: 'stomach', hi: 'पेट', g: 'm', hinglish: 'pet' },
    chest: { en: 'chest', hi: 'छाती', g: 'f', hinglish: 'chest' },
    leg: { en: 'leg', hi: 'पैर', g: 'm', hinglish: 'pair' },
    legs: { en: 'legs', hi: 'पैरों', g: 'm', hinglish: 'pairon' },
    hand: { en: 'hand', hi: 'हाथ', g: 'm', hinglish: 'haath' },
    arm: { en: 'arm', hi: 'बाँह', g: 'f', hinglish: 'arm' },
    eye: { en: 'eye', hi: 'आँख', g: 'f', hinglish: 'aankh' },
    ear: { en: 'ear', hi: 'कान', g: 'm', hinglish: 'kaan' },
    tooth: { en: 'tooth', hi: 'दाँत', g: 'm', hinglish: 'daant' },
    neck: { en: 'neck', hi: 'गर्दन', g: 'f', hinglish: 'gardan' },
    knee: { en: 'knee', hi: 'घुटने', g: 'm', hinglish: 'ghutne' },
    shoulder: { en: 'shoulder', hi: 'कंधे', g: 'm', hinglish: 'kandhe' },
    throat: { en: 'throat', hi: 'गले', g: 'm', hinglish: 'gale' },
    foot: { en: 'foot', hi: 'पैर', g: 'm', hinglish: 'pair' },
    heart: { en: 'heart', hi: 'दिल', g: 'm', hinglish: 'dil' },
    body: { en: 'body', hi: 'शरीर', g: 'm', hinglish: 'body' },
  },
  side: {
    lower: { en: 'lower', hi: 'निचले', hinglish: 'lower', part: true },
    upper: { en: 'upper', hi: 'ऊपरी', hinglish: 'upper', part: true },
    left: { en: 'left', hi: { m: 'बाएँ', f: 'बाईं' }, hinglish: 'left' },
    right: { en: 'right', hi: { m: 'दाएँ', f: 'दाईं' }, hinglish: 'right' },
  },
  pain: { pain: {}, hurt: {}, hurts: {}, ache: {}, paining: {} },
  feel: {
    hungry: { en: 'I am hungry.', hi: 'मुझे भूख लगी है।', hinglish: 'Mujhe bhook lagi hai.' },
    thirsty: { en: 'I am thirsty.', hi: 'मुझे प्यास लगी है।', hinglish: 'Mujhe pyaas lagi hai.' },
    // Gender-neutral on purpose: the signer's gender is unknown.
    tired: { en: 'I am tired.', hi: 'मुझे बहुत थकान हो रही है।', hinglish: 'Bahut thakaan ho rahi hai.' },
    sick: { en: 'I am not feeling well.', hi: 'मेरी तबीयत ठीक नहीं है।', hinglish: 'Meri tabiyat theek nahi hai.' },
    cold: { en: 'I am feeling cold.', hi: 'मुझे ठंड लग रही है।', hinglish: 'Mujhe thand lag rahi hai.' },
    hot: { en: 'I am feeling hot.', hi: 'मुझे गर्मी लग रही है।', hinglish: 'Mujhe garmi lag rahi hai.' },
    sleepy: { en: 'I am sleepy.', hi: 'मुझे नींद आ रही है।', hinglish: 'Mujhe neend aa rahi hai.' },
    happy: { en: 'I am happy.', hi: 'मैं खुश हूँ।', hinglish: 'Main khush hoon.' },
    sad: { en: 'I am sad.', hi: 'मैं उदास हूँ।', hinglish: 'Main thoda sad hoon.' },
    scared: { en: 'I am scared.', hi: 'मुझे डर लग रहा है।', hinglish: 'Mujhe darr lag raha hai.' },
  },
  want: { want: {}, need: {} },
};

/** What a token means as a word: {word, name?} (lower-case word). */
function wordOf(token) {
  const t = String(token || '').toUpperCase();
  if (/^FS[-_]/.test(t)) {
    const w = t.slice(3).toLowerCase();
    return { word: w, name: w.charAt(0).toUpperCase() + w.slice(1) };
  }
  const own = findByToken(t);
  if (own?.output?.type === 'name') return { word: own.output.text_en.toLowerCase(), name: own.output.text_en, sign: own };
  if (own?.output?.type === 'word') return { word: String(own.output.text_en).trim().toLowerCase(), sign: own };
  if (KNOWN_NAMES.has(t)) return { word: t.toLowerCase(), name: t.charAt(0) + t.slice(1).toLowerCase() };
  return { word: t.toLowerCase().replace(/_/g, ' ') };
}

/** Does this sign fit this pattern item? -> captured value | null */
function fits(item, info, token) {
  if (item.startsWith('@')) {
    const cls = item.slice(1);
    if (cls === 'name') return info.name ? { name: info.name, sign: info.sign } : null;
    const entry = CLASSES[cls]?.[info.word];
    return entry ? { ...entry, word: info.word } : null;
  }
  return item === String(token).toUpperCase() || item.toLowerCase() === info.word ? { word: info.word } : null;
}

/** Match a whole sentence against a pattern. -> {captures} | null */
export function matchPattern(pattern, tokens) {
  const infos = tokens.map(wordOf);
  const go = (p, t, caps) => {
    if (p === pattern.length) return t === tokens.length ? caps : null;
    const raw = pattern[p];
    const optional = raw.endsWith('?');
    const item = optional ? raw.slice(0, -1) : raw;
    if (t < tokens.length) {
      const hit = fits(item, infos[t], tokens[t]);
      if (hit) {
        const key = item.startsWith('@') ? item.slice(1) : item.toLowerCase();
        const got = go(p + 1, t + 1, { ...caps, [key]: hit });
        if (got) return got;
      }
    }
    return optional ? go(p + 1, t, caps) : null;
  };
  return go(0, 0, {});
}

// ── Built-in rules ──────────────────────────────────────────────────────────

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const nameIn = (c, lang) => (lang === 'hi-IN' ? c.name.sign?.output?.texts?.['hi-IN'] : null) || c.name.name;

function painSentence(c, lang) {
  const b = c.body; const s = c.side;
  if (lang === 'en-IN') return `I have pain in my ${s ? `${s.en} ` : ''}${b.en}.`;
  if (lang === 'hinglish') {
    return `${b.g === 'f' ? 'Meri' : 'Mere'} ${s ? `${s.hinglish} ` : ''}${b.hinglish} mein dard ho raha hai.`;
  }
  if (lang === 'hi-IN') {
    const my = b.g === 'f' ? 'मेरी' : 'मेरे';
    if (!s) return `${my} ${b.hi} में दर्द है।`;
    // Lower/upper name a PART of the body part: "मेरी पीठ के निचले हिस्से में दर्द है।"
    if (s.part) return `${my} ${b.hi} के ${s.hi} हिस्से में दर्द है।`;
    const sideHi = typeof s.hi === 'object' ? s.hi[b.g || 'm'] : s.hi;
    return `${my} ${sideHi} ${b.hi} में दर्द है।`;
  }
  return null;
}

export const BUILTIN_RULES = [
  {
    id: 'self-name-is', pattern: ['@self', 'NAME', '@name'], example: 'I NAME ADITYA',
    render: (c, l) => ({ 'en-IN': `My name is ${nameIn(c, l)}.`, 'hi-IN': `मेरा नाम ${nameIn(c, l)} है।`, hinglish: `Mera naam ${nameIn(c, l)} hai.` })[l],
  },
  {
    id: 'self-name', pattern: ['@self', '@name'], example: 'I ADITYA',
    render: (c, l) => ({ 'en-IN': `I am ${nameIn(c, l)}.`, 'hi-IN': `मैं ${nameIn(c, l)} हूँ।`, hinglish: `Main ${nameIn(c, l)} hoon.` })[l],
  },
  {
    id: 'self-need', pattern: ['@self?', '@want?', '@need', '@want?'], example: 'ME WATER',
    render: (c, l) => ({ 'en-IN': `I need ${c.need.en}.`, 'hi-IN': `मुझे ${c.need.hi} चाहिए।`, hinglish: `Mujhe ${c.need.hinglish} chahiye.` })[l],
    // A lone need-word is the built-in single sign's job (WATER -> "I need water").
    requires: ['self', 'want'],
  },
  {
    id: 'need-self', pattern: ['@need', '@self', '@want?'], example: 'WATER ME',
    render: (c, l) => ({ 'en-IN': `I need ${c.need.en}.`, 'hi-IN': `मुझे ${c.need.hi} चाहिए।`, hinglish: `Mujhe ${c.need.hinglish} chahiye.` })[l],
  },
  {
    id: 'body-pain', pattern: ['@self?', '@side?', '@body', '@pain?'], example: 'I LOWER BACK',
    render: (c, l) => painSentence(c, l),
    // "BACK" alone is not a complaint; I/ME, a side or PAIN makes it one.
    requires: ['self', 'side', 'pain'],
  },
  {
    id: 'self-feel', pattern: ['@self?', '@feel'], example: 'I HUNGRY',
    render: (c, l) => c.feel[l === 'hinglish' ? 'hinglish' : l === 'hi-IN' ? 'hi' : 'en'],
    requires: ['self'],
  },
];

// ── Shared (developer) rules: templates ─────────────────────────────────────

let shared = [];
export const setSharedRules = (rules) => { shared = Array.isArray(rules) ? rules : []; };
export const getSharedRules = () => shared;

/** "{side} {body}" etc. filled from captures, in one language. */
function fill(template, caps, lang) {
  const field = lang === 'en-IN' ? 'en' : lang === 'hi-IN' ? 'hi' : lang === 'hinglish' ? 'hinglish' : null;
  let missing = false;
  const out = template.replace(/\{(\w+)\}/g, (_, key) => {
    const c = caps[key];
    if (!c) return '';
    if (c.name) return c.name;
    const v = field ? c[field] : null;
    const val = typeof v === 'object' && v ? v.m : v;
    if (val) return val;
    if (lang === 'en-IN' || lang === 'hinglish') return c.word;
    missing = true;
    return '';
  });
  return missing ? null : out.replace(/\s+/g, ' ').replace(/\s+([.,!?।])/g, '$1').trim();
}

/**
 * The first rule (developer rules first) that covers these signs.
 * -> {english, texts: {'hi-IN', hinglish}, rule} | null
 */
export function matchRules(tokens) {
  if (!tokens?.length) return null;
  for (const r of shared) {
    const caps = matchPattern(r.pattern, tokens);
    if (!caps) continue;
    const english = fill(r.english, caps, 'en-IN');
    const texts = {};
    for (const [lang, tpl] of Object.entries(r.texts || {})) {
      const t = fill(tpl, caps, lang);
      if (t) texts[lang] = t;
    }
    return { english: cap(english), texts, rule: `dev-rule:${r.id}` };
  }
  for (const r of BUILTIN_RULES) {
    const caps = matchPattern(r.pattern, tokens);
    if (!caps) continue;
    if (r.requires && !r.requires.some((k) => caps[k])) continue;
    const english = r.render(caps, 'en-IN');
    if (!english) continue;
    const texts = {};
    for (const lang of ['hi-IN', 'hinglish']) {
      const t = r.render(caps, lang);
      if (t) texts[lang] = t;
    }
    return { english, texts, rule: `phrase:${r.id}` };
  }
  return null;
}

export default { matchRules, matchPattern, setSharedRules, getSharedRules, BUILTIN_RULES, CLASSES };
