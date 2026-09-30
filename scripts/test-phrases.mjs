/**
 * Phrase grammar rules (src/services/phraseRules.js): built-in rules, word
 * classes by meaning, developer template rules, and the offline path of
 * translate().
 *
 *     node scripts/test-phrases.mjs
 */
import * as signs from '../src/services/customSigns.js';
import { matchRules, setSharedRules } from '../src/services/phraseRules.js';
import { translate, MODE_OFFLINE } from '../src/services/translationService.js';

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};
const say = (tokens) => matchRules(tokens);

console.log('='.repeat(74) + '\n  Phrase grammar rules\n' + '='.repeat(74));

signs._resetForTests();
await signs.saveSign({ token: 'LOWER', kind: 'handshape', hands: 'one', output: { type: 'word', text_en: 'lower', texts: {} }, samples: [] });
await signs.saveSign({ token: 'RAHUL', kind: 'handshape', hands: 'one', output: { type: 'name', text_en: 'Rahul', texts: { 'hi-IN': 'राहुल' } }, samples: [] });

console.log('\n1. The requested examples\n' + '-'.repeat(74));
const CASES = [
  [['I', 'RAHUL'], 'I am Rahul.', 'मैं राहुल हूँ।', 'Main Rahul hoon.'],
  [['ME', 'WATER'], 'I need water.', 'मुझे पानी चाहिए।', 'Mujhe paani chahiye.'],
  [['I', 'LOWER', 'BACK'], 'I have pain in my lower back.', 'मेरी पीठ के निचले हिस्से में दर्द है।', 'Meri lower back mein dard ho raha hai.'],
  [['ME', 'LOWER', 'BACK'], 'I have pain in my lower back.'],
];
for (const [tokens, en, hi, hing] of CASES) {
  const r = say(tokens);
  check(r?.english === en && (!hi || r.texts['hi-IN'] === hi) && (!hing || r.texts.hinglish === hing),
    `${tokens.join(' + ')} -> ${en}`, r ? `${r.texts['hi-IN'] || ''} | ${r.texts.hinglish || ''}` : 'no rule');
}

console.log('\n2. More forms of the same rules\n' + '-'.repeat(74));
const MORE = [
  [['I', 'NAME', 'RAHUL'], 'My name is Rahul.'],
  [['I', 'FS-ADITYA'], 'I am Aditya.'],
  [['WATER', 'ME'], 'I need water.'],
  [['I', 'WATER', 'NEED'], 'I need water.'],
  [['ME', 'FOOD'], 'I need food.'],
  [['I', 'HEAD', 'PAIN'], 'I have pain in my head.'],
  [['BACK', 'PAIN'], 'I have pain in my back.'],
  [['MY', 'LEFT', 'EYE'], 'I have pain in my left eye.'],
  [['I', 'HUNGRY'], 'I am hungry.'],
];
for (const [tokens, en] of MORE) check(say(tokens)?.english === en, `${tokens.join(' + ')} -> ${en}`, say(tokens)?.english || 'no rule');
check(say(['MY', 'LEFT', 'EYE']).texts['hi-IN'] === 'मेरी बाईं आँख में दर्द है।', 'Hindi agrees with gender (आँख is feminine: मेरी बाईं)');
check(say(['I', 'HEAD', 'PAIN']).texts['hi-IN'] === 'मेरे सिर में दर्द है।', 'Hindi agrees with gender (सिर is masculine: मेरे)');

console.log('\n3. What must NOT become a phrase\n' + '-'.repeat(74));
for (const tokens of [['WATER'], ['BACK'], ['HUNGRY'], ['I', 'GO', 'SCHOOL'], ['I', 'DOCTOR']]) {
  check(say(tokens) === null, `${tokens.join(' + ')} is left to the normal grammar`);
}

console.log('\n4. Developer rules (shared templates)\n' + '-'.repeat(74));
setSharedRules([
  { id: 'self-need-please', pattern: ['@self', '@need', 'PLEASE'], english: 'May I have some {need}, please?', texts: { 'hi-IN': 'क्या मुझे थोड़ा {need} मिल सकता है?', hinglish: 'Thoda {need} milega please?' } },
  { id: 'my-name-override', pattern: ['@self', '@name'], english: 'Hi, I am {name}!', texts: {} },
]);
let r = say(['ME', 'WATER', 'PLEASE']);
check(r?.english === 'May I have some water, please?' && r.texts['hi-IN'] === 'क्या मुझे थोड़ा पानी मिल सकता है?' && r.texts.hinglish === 'Thoda paani milega please?',
  'a developer template fills each language with the matched word', `${r?.english} | ${r?.texts['hi-IN']} | ${r?.texts.hinglish}`);
check(say(['I', 'RAHUL'])?.english === 'Hi, I am Rahul!', 'developer rules are tried before built-in ones');
setSharedRules([]);

console.log('\n5. translate() uses the rules in every mode (offline here)\n' + '-'.repeat(74));
let t = await translate(['I', 'LOWER', 'BACK'], 'hi-IN', { mode: MODE_OFFLINE });
check(t.english === 'I have pain in my lower back.' && t.translated === 'मेरी पीठ के निचले हिस्से में दर्द है।', 'offline Hindi for a phrase', t.translated);
t = await translate(['ME', 'WATER'], 'en-IN', { mode: MODE_OFFLINE });
check(t.english === 'I need water.' && t.engine.startsWith('phrase:'), 'offline English for a phrase', t.engine);

console.log('\n5b. Everyday questions and requests, offline Hindi\n' + '-'.repeat(74));
for (const [t, m] of [['WHERE', 'where'], ['WHAT', 'what'], ['HOW', 'how'], ['YOU', 'you'], ['NOT', 'not']]) {
  await signs.saveSign({ token: t, kind: 'handshape', hands: 'one', output: { type: 'word', text_en: m, texts: {} }, samples: [] });
}
const EVERYDAY = [
  [['HOSPITAL', 'WHERE'], 'Where is the hospital?', 'अस्पताल कहाँ है?'],
  [['I', 'HOSPITAL', 'GO', 'WANT'], 'I want to go to the hospital.', 'मुझे अस्पताल जाना है।'],
  [['WANT', 'GO', 'HOME'], 'I want to go home.', 'मुझे घर जाना है।'],
  [['YOU', 'NAME', 'WHAT'], 'What is your name?', 'आपका नाम क्या है?'],
  [['YOU', 'HOW'], 'How are you?', 'आप कैसे हैं?'],
  [['DOCTOR', 'CALL'], 'Please call a doctor.', 'कृपया डॉक्टर को बुलाइए।'],
  [['I', 'NOT', 'UNDERSTAND'], 'I do not understand.', 'मुझे समझ नहीं आया।'],
  [['PLEASE', 'WAIT'], 'Please wait.', 'कृपया रुकिए।'],
];
for (const [tokens, en, hi] of EVERYDAY) {
  const x = say(tokens);
  check(x?.english === en && x.texts['hi-IN'] === hi, `${tokens.join(' + ')} -> ${en} / ${hi}`, x ? '' : 'no rule');
}
check(say(['I', 'HOSPITAL', 'WENT']) === null, 'past tense (WENT) is left to the general grammar');
check(say(['I', 'HOSPITAL', 'GO']) === null, 'no WANT signed: "I go to the hospital" stays with the general grammar');

console.log('\n6. Hinglish (casual)\n' + '-'.repeat(74));
{
  const { getLanguage, sarvamCode, sttCode, browserSpeechLocale, sarvamTtsPayload } = await import('../src/config/languages.js');
  const { GESTURE_TOKENS, sentenceFor } = await import('../src/config/gestureSentences.js');
  check(getLanguage('hinglish').name === 'Hinglish (casual)', 'Hinglish is an output language');
  check(sarvamCode('hinglish') === 'hi-IN' && sttCode('hinglish') === 'hi-IN' && browserSpeechLocale('hinglish') === 'en-IN',
    'engines get Hindi for Sarvam and speech input, an Indian-English device voice offline');
  check(sarvamTtsPayload('Mujhe paani chahiye.', 'hinglish').target_language_code === 'hi-IN', 'Sarvam voice is asked for Hindi');
  check(GESTURE_TOKENS.every((t) => sentenceFor(t, 'hinglish') && sentenceFor(t, 'hinglish') !== sentenceFor(t, 'en-IN') || ['PLEASE'].includes(t)),
    'all 20 built-in signs have casual Hinglish');
  let h = await translate(['WATER'], 'hinglish', { mode: MODE_OFFLINE });
  check(h.translated === 'Mujhe paani chahiye.', 'offline: WATER -> Mujhe paani chahiye.', h.translated);
  h = await translate(['I', 'LOWER', 'BACK'], 'hinglish', { mode: MODE_OFFLINE });
  check(h.translated === 'Meri lower back mein dard ho raha hai.', 'offline: phrase rule in Hinglish', h.translated);
  h = await translate(['NAMASTE', 'NAME', 'ADITYA'], 'hinglish', { mode: MODE_OFFLINE });
  check(h.translated === 'Hello, mera naam Aditya hai.', 'offline: introduction in Hinglish', h.translated);

  // Online: the request Mayura receives for Hinglish (fetch stubbed, no network).
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  store.set('isl.sarvamKey', 'test-key');
  let sent = null;
  globalThis.fetch = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return new Response(JSON.stringify({ translated_text: 'Mujhe paani chahiye.' }), { status: 200 }); };
  const { sarvamTranslate } = await import('../src/services/translator.js');
  const out = await sarvamTranslate('I need water.', 'hinglish');
  check(out === 'Mujhe paani chahiye.' && sent.body.target_language_code === 'hi-IN' && sent.body.mode === 'code-mixed' && sent.body.output_script === 'roman' && sent.body.model === 'mayura:v1',
    'online: Mayura code-mixed mode, Roman script', JSON.stringify({ t: sent.body.target_language_code, m: sent.body.mode, s: sent.body.output_script }));
  await sarvamTranslate('I need water.', 'ta-IN');
  check(sent.body.target_language_code === 'ta-IN' && !('output_script' in sent.body) && sent.body.mode === 'modern-colloquial', 'other languages unchanged');
}

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
