/**
 * ISL grammar rules and few-shot demonstrations.
 *
 * Ported verbatim from ISL-FINAL/llm/qwen_engine.py (SYSTEM_PROMPT, FEW_SHOT,
 * MAX_NEW_TOKENS). Kept here so the web app, the Android app and the Python
 * reference all steer their language model with the same text -- if these
 * diverge, the same signs produce different sentences on different clients.
 *
 * Why these rules exist, from measurements on the Python side:
 *
 *   Without them, Qwen2.5-0.5B rendered DOCTOR/HELP/NEED as "Doctor needs
 *   help." -- fluent English, inverted meaning. Adding the first-person and
 *   medical priors fixed that. Adding only TOMORROW as a tense example then
 *   taught it "time word => will", producing "I will go to the market
 *   yesterday.", so a YESTERDAY example was added too. Listing only pronouns as
 *   valid subjects made it drop MOTHER and say "I", so kinship nouns were added.
 *
 * Honest caveat carried over from that work: on held-out cases the 0.5B model
 * still fails most of these rules. The rules materially help a capable model
 * (Gemini scores 6/7 on the same held-out set); they do not rescue a tiny one.
 * Treat offline output as a rough gloss, not a translation.
 */

import { grammarGender } from './signerPrefs.js';

export const ISL_SYSTEM_PROMPT = [
  'You are an ISL (Indian Sign Language) translation assistant.',
  "ISL frequently omits first-person pronouns ('I', 'me', 'my'). Unless " +
    "another subject is explicitly stated, default to first-person 'I'.",
  "An explicit subject includes pronouns ('he', 'she', 'they'), specific " +
    "names, kinship nouns ('MOTHER', 'FATHER', 'BROTHER', 'SISTER', 'FRIEND'), " +
    'and other nouns naming a person who acts. When such a word is present it ' +
    "IS the subject and must NEVER be replaced by 'I'. Render kinship nouns " +
    "possessively where natural ('MOTHER' -> 'my mother').",
  "Time words (e.g., 'TOMORROW', 'YESTERDAY') establish tense: 'TOMORROW' " +
    "implies future tense ('I will...'), 'YESTERDAY' implies past tense " +
    "('I went...'). Never combine a past time word with a future verb.",
  "Medical/emergency signs like 'DOCTOR HELP NEED' represent the signer's " +
    "need: translate as 'I need doctor's help' or 'I need a doctor'.",
  "Do not hallucinate extra actions (e.g., do not add 'drink' to 'WANT WATER').",
  'Output ONLY the final, grammatically correct English sentence.',
].join('\n');

/**
 * Worked examples, supplied as real chat turns rather than pasted into the
 * system message. Instruct models are tuned on multi-turn transcripts and
 * follow a demonstrated pair far more reliably than a described rule.
 */
export const ISL_FEW_SHOT = [
  { signs: 'I, WANT, WATER', sentence: 'I want water.' },
  { signs: 'TOMORROW, COLLEGE, GO', sentence: 'I will go to college tomorrow.' },
  { signs: 'DOCTOR, HELP, NEED', sentence: "I need a doctor's help." },
  { signs: 'YESTERDAY, MARKET, GO', sentence: 'I went to the market yesterday.' },
  {
    signs: 'MOTHER, HOSPITAL, YESTERDAY, GO',
    sentence: 'My mother went to the hospital yesterday.',
  },
];

/** A sign sentence is short; this bounds worst-case latency. */
export const MAX_NEW_TOKENS = 32;

/** Deterministic last resort when no model is reachable. */
export function ruleBasedJoin(tags) {
  if (!tags || tags.length === 0) return '';
  const joined = tags.join(' ').toLowerCase();
  return joined.charAt(0).toUpperCase() + joined.slice(1) + '.';
}

/**
 * Build a Gemini `contents` array: system rules, then the few-shot turns, then
 * the real request. Gemini takes system text separately, so that is returned
 * alongside rather than folded in.
 */

/**
 * For the online models: write the translation in the language's own script
 * (no Roman letters, no English words left in), and use the signer's gender
 * for first-person forms ("मैं खाता हूँ" / "मैं खाती हूँ").
 */
export function targetNotes(targetLanguage) {
  if (!targetLanguage || targetLanguage.code === 'en-IN') return '';
  const g = grammarGender();
  const script = targetLanguage.code === 'hinglish'
    ? 'Write it in Roman script, casually, as Hinglish.'
    : `Write it entirely in ${targetLanguage.name} script (${targetLanguage.script}): no Roman letters, and translate every English word (e.g. "food" -> "खाना", not "food").`;
  return ` ${script} The person signing is ${g}: use ${g === 'female' ? 'feminine' : 'masculine'} first-person forms (Hindi: ${g === 'female' ? '"मैं खाती हूँ", "मैं जा रही हूँ"' : '"मैं खाता हूँ", "मैं जा रहा हूँ"'}).`;
}

export function buildGeminiRequest(tags, targetLanguage, glossary = []) {
  const contents = [];
  for (const shot of ISL_FEW_SHOT) {
    contents.push({ role: 'user', parts: [{ text: shot.signs }] });
    contents.push({ role: 'model', parts: [{ text: shot.sentence }] });
  }
  contents.push({ role: 'user', parts: [{ text: tags.join(', ') }] });

  let systemInstruction = targetLanguage
    ? `${ISL_SYSTEM_PROMPT}\n\nAlso provide a ${targetLanguage.name} ` +
      `(${targetLanguage.script}) translation.${targetNotes(targetLanguage)} Return JSON only: ` +
      '{"english": "...", "translated": "..."}'
    : ISL_SYSTEM_PROMPT;

  const block = glossaryBlock(glossary, targetLanguage?.code);
  if (block) systemInstruction += `\n\n${block}`;

  return { systemInstruction, contents };
}

/**
 * The user's own signs as a glossary for online prompts: what each token
 * means, its word category, and that names are proper nouns to keep as given
 * (transliterated, never translated).
 *
 * @param {{token, type, text_en, category?, texts?}[]} glossary
 */
export function glossaryBlock(glossary, targetCode) {
  if (!glossary || !glossary.length) return '';
  const lines = glossary.map((g) => {
    const target = targetCode && g.texts?.[targetCode] ? `; in the target language: "${g.texts[targetCode]}"` : '';
    if (g.type === 'name') {
      return `- ${g.token}: a person's name, "${g.text_en}". A proper noun: keep it, ` +
        `transliterate it, never translate it${target}.`;
    }
    const cat = g.category ? ` (${g.category})` : '';
    return `- ${g.token}${cat}: means "${g.text_en}"${target}.`;
  });
  return "Glossary of the signer's own signs (use these meanings exactly):\n" + lines.join('\n');
}

export default {
  ISL_SYSTEM_PROMPT,
  ISL_FEW_SHOT,
  MAX_NEW_TOKENS,
  ruleBasedJoin,
  buildGeminiRequest,
  glossaryBlock,
};
