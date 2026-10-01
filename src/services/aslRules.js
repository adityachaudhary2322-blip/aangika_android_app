/**
 * ASL gloss -> English: the prompt shared by the Gemini and Sarvam engines.
 *
 * Separate from the ISL prompt (qwenRules.js) because the grammars differ in
 * ways a model must be told: ASL is topic-comment, puts WH-words at the END,
 * marks yes/no questions only with the face (invisible to the tagger), and
 * glosses fingerspelled words as FS-WORD. Versioned, so evaluation reports can
 * say which prompt produced a sentence.
 */

import { glossaryBlock, targetNotes } from './qwenRules.js';

export const ASL_PROMPT_VERSION = 'asl-1';

export const ASL_SYSTEM_PROMPT = [
  'You translate American Sign Language (ASL) gloss into natural English.',
  'The input is a list of recognised signs in the order they were signed.',
  'ASL grammar to undo:',
  '- Topic-comment order: the topic comes first ("STORE I GO" = "I am going to the store").',
  '- Time words come first and set the tense ("YESTERDAY I GO" = "I went"; "TOMORROW" = future).',
  '- WH-question words usually come LAST ("YOUR NAME WHAT" = "What is your name?").',
  '- NOT follows what it negates ("PIZZA LIKE NOT" = "I do not like pizza").',
  '- ASL has no articles and no "to be": add them.',
  '- A dropped subject usually means "I".',
  '- HE_SHE_IT is one pointing sign; pick he, she or it from context.',
  '- MY, WE, YOURSELF are pronoun signs.',
  '- FS-WORD is a fingerspelled word, usually a name: keep it exactly, as a proper noun, never translate it.',
  'Use only the given signs plus grammatical words; never add new content.',
  'If the signs are too few or too unrelated to form a sentence, return "english": "UNCLEAR".',
].join('\n');

export const ASL_FEW_SHOT = [
  { signs: 'HELLO', sentence: 'Hello.' },
  { signs: 'MY, NAME, FS-PRIYA', sentence: 'My name is Priya.' },
  { signs: 'YESTERDAY, STORE, GO', sentence: 'I went to the store yesterday.' },
  { signs: 'YOU, HUNGRY', sentence: 'Are you hungry?' },
  { signs: 'MOM, WHERE', sentence: 'Where is mom?' },
  { signs: 'PIZZA, LIKE, NOT', sentence: 'I do not like pizza.' },
  { signs: 'TOMORROW, DAD, HOME, COME', sentence: 'Dad will come home tomorrow.' },
];

/**
 * Same shape as buildGeminiRequest(): {systemInstruction, contents}, so both
 * online engines can use it unchanged.
 */
export function buildAslRequest(tags, targetLanguage, glossary = []) {
  const contents = [];
  for (const shot of ASL_FEW_SHOT) {
    contents.push({ role: 'user', parts: [{ text: shot.signs }] });
    contents.push({ role: 'model', parts: [{ text: JSON.stringify({ english: shot.sentence, translated: '' }) }] });
  }
  contents.push({ role: 'user', parts: [{ text: tags.join(', ') }] });

  let systemInstruction = `${ASL_SYSTEM_PROMPT}\n\n` + (targetLanguage && targetLanguage.code !== 'en-IN'
    ? `Also provide a ${targetLanguage.name} (${targetLanguage.script}) translation of the English sentence.${targetNotes(targetLanguage)} `
    : '') + 'Return JSON only: {"english": "...", "translated": "..."}';
  const block = glossaryBlock(glossary, targetLanguage?.code);
  if (block) systemInstruction += `\n\n${block}`;
  return { systemInstruction, contents };
}

export default { ASL_SYSTEM_PROMPT, ASL_FEW_SHOT, ASL_PROMPT_VERSION, buildAslRequest };
