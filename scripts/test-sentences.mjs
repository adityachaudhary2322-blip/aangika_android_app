/**
 * Phase 3: sentences from continuous signing.
 *
 *     node scripts/test-sentences.mjs
 *
 * Offline ASL gloss -> English rules, fingerspelled words joining in the token
 * stream, the automatic sentence-boundary rule, and ISL/ASL prompt routing.
 * Online engines are not called here (keys live in the browser).
 */

import { expandAsl } from '../src/services/aslGrammar.js';
import { buildAslRequest, ASL_SYSTEM_PROMPT } from '../src/services/aslRules.js';
import { buildGeminiRequest, ISL_SYSTEM_PROMPT } from '../src/services/qwenRules.js';
import { appendToken, tokenLabel } from '../src/hooks/useTokenStream.js';
import { boundaryDue } from '../src/hooks/useSentenceBoundary.js';
import { translate } from '../src/services/translationService.js';

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

console.log('='.repeat(74) + '\n  Sentences from continuous signing\n' + '='.repeat(74));

console.log('\n1. Offline ASL gloss -> English\n' + '-'.repeat(74));
const CASES = [
  [['HELLO'], 'Hello.'],
  [['THANK_YOU'], 'Thank you.'],
  [['YOU', 'HUNGRY'], 'You are hungry.'],
  [['MY', 'DOG', 'SICK'], 'My dog is sick.'],
  [['YESTERDAY', 'STORE', 'GO'], 'I went to the store yesterday.'],
  [['TOMORROW', 'DAD', 'HOME', 'COME'], 'Dad will come home tomorrow.'],
  [['PIZZA', 'LIKE', 'NOT'], 'I do not like pizza.'],
  [['MOM', 'WHERE'], 'Where is mom?'],
  [['WHY', 'YOU', 'SAD'], 'Why are you sad?'],
  [['WHO', 'CALL_ON_PHONE'], 'Who calls?'],
  [['HE_SHE_IT', 'THIRSTY'], 'He is thirsty.'],
  [['WE', 'DRINK', 'MILK'], 'We drink milk.'],
  [['HELLO', 'I', 'HUNGRY'], 'Hello, I am hungry.'],
  [['MY', 'NAME', 'FS-PRIYA'], 'My name is Priya.'],
  [['FS-ADITYA', 'SLEEPY'], 'Aditya is sleepy.'],
  [['FS-ADITYA', 'STORE', 'GO', 'YESTERDAY'], 'Aditya went to the store yesterday.'],
];
for (const [tags, want] of CASES) {
  const got = expandAsl(tags).english;
  check(got === want, `${tags.join(' ').padEnd(30)} -> ${got}`, got === want ? '' : `(want "${want}")`);
}
const t0 = performance.now();
for (let i = 0; i < 2000; i++) expandAsl(['YESTERDAY', 'STORE', 'GO']);
const offlineUs = ((performance.now() - t0) / 2000) * 1000;
check(offlineUs < 500, 'offline ASL sentence latency', `${offlineUs.toFixed(1)} µs per sentence`);

console.log('\n2. Fingerspelling joins letters into one name\n' + '-'.repeat(74));
{
  let s = [];
  let t = 1000;
  for (const L of 'ADITYA') { s = appendToken(s, L, (t += 600), null); }
  check(s.length === 1 && s[0].token === 'FS-ADITYA' && s[0].spelled, 'A D I T Y A -> FS-ADITYA', s.map((e) => e.token).join(' '));
  check(tokenLabel(s[0].token) === 'Aditya', 'shown as "Aditya"');
  s = appendToken(s, 'HUNGRY', (t += 600), null);
  s = appendToken(s, 'B', (t += 600), null);
  check(s.map((e) => e.token).join(' ') === 'FS-ADITYA HUNGRY FS-B', 'a word ends the spelling; the next letter starts a new one');
  let g = [];
  g = appendToken(g, 'A', 1000, null);
  g = appendToken(g, 'B', 1000 + 4000, null);
  check(g.length === 2, 'letters more than 2.5 s apart are separate words');
  let d = [];
  d = appendToken(d, 'L', 1000, null);
  d = appendToken(d, 'L', 1500, 1400);              // gone 100 ms: flicker
  check(d[0].token === 'FS-L', 'a flicker is not a double letter');
  d = appendToken(d, 'L', 3200, 1600);              // gone 1.6 s: signed again
  check(d[0].token === 'FS-LL', 'the same letter signed again doubles it', d[0].token);
}

console.log('\n3. Automatic sentence boundary\n' + '-'.repeat(74));
{
  const base = { pending: 3, lastAt: 10_000, handsUp: true, handsDownAt: null };
  check(!boundaryDue({ ...base, now: 10_800 }), 'no send 0.8 s after the last sign');
  check(boundaryDue({ ...base, now: 11_300 }), 'send after a 1.2 s pause');
  check(boundaryDue({ ...base, now: 10_700, handsUp: false, handsDownAt: 10_200 }), 'send 0.4 s after hands go down');
  check(!boundaryDue({ ...base, now: 10_300, handsUp: false, handsDownAt: 10_200 }), 'not before 0.4 s of hands down');
  check(!boundaryDue({ ...base, pending: 0, now: 20_000 }), 'nothing pending, nothing sent');
  check(!boundaryDue({ ...base, now: 11_300, pauseMs: 2500 }), 'mid-fingerspelling the pause stretches to 2.5 s');
}

console.log('\n4. ISL and ASL go to different prompts and rules\n' + '-'.repeat(74));
{
  const lang = { code: 'hi-IN', name: 'Hindi', script: 'हिन्दी' };
  const asl = buildAslRequest(['MOM', 'WHERE'], lang, []);
  const isl = buildGeminiRequest(['MOM', 'WHERE'], lang, []);
  check(asl.systemInstruction.startsWith(ASL_SYSTEM_PROMPT) && !asl.systemInstruction.includes(ISL_SYSTEM_PROMPT),
    'ASL requests carry the ASL prompt only');
  check(isl.systemInstruction.startsWith(ISL_SYSTEM_PROMPT), 'ISL requests keep the ISL prompt');
  check(/Hindi/.test(asl.systemInstruction) && /FS-WORD/.test(asl.systemInstruction),
    'ASL prompt asks for the chosen language and protects fingerspelled names');
  check(asl.contents.at(-1).parts[0].text === 'MOM, WHERE' && asl.contents.length === 15,
    '7 ASL few-shot pairs + the request');

  const a = await translate(['MOM', 'WHERE'], 'en-IN', { mode: 'offline', signLanguage: 'ASL' });
  check(a.english === 'Where is mom?' && a.engine.startsWith('asl-rules'), 'offline ASL routes to the ASL rules', `${a.engine}: ${a.english}`);
  const i = await translate(['NAME', 'FS-PRIYA'], 'hi-IN', { mode: 'offline', signLanguage: 'ISL' });
  check(i.english === 'Hello, my name is Priya.' && i.translated.includes('Priya'),
    'ISL: a fingerspelled name is kept as a name', `${i.english} / ${i.translated}`);
  const n = await translate(['HELLO', 'MY', 'NAME', 'FS-ADITYA'], 'en-IN', { mode: 'offline', signLanguage: 'ASL' });
  check(n.english === 'Hello, my name is Aditya.', 'ASL: greeting + fingerspelled introduction', n.english);
}

console.log('\n5. Demo mode: measured reliability and sentences from reliable signs only\n' + '-'.repeat(74));
{
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  };
  const P = await import('../src/services/practice.js');
  const M = 'asl-islr-250';
  for (let i = 0; i < 3; i++) P.recordAttempt(M, 'HELLO', { recognised: ['HELLO'], confidence: 0.9 });
  P.recordAttempt(M, 'MOM', { recognised: ['MOM'], confidence: 0.7 });
  P.recordAttempt(M, 'MOM', { recognised: ['MOM'], confidence: 0.6 });
  P.recordAttempt(M, 'MOM', { recognised: ['DAD'], confidence: 0 });
  P.recordAttempt(M, 'WHERE', { recognised: ['WHERE'], confidence: 0.8 });
  for (let i = 0; i < 3; i++) P.recordAttempt(M, 'HUNGRY', { recognised: [], confidence: 0 });
  const rel = P.reliability(M);
  const byTok = Object.fromEntries(rel.map((r) => [r.token, r]));
  check(byTok.HELLO.rate === 1 && byTok.MOM.ok === 2 && byTok.MOM.n === 3 && byTok.HUNGRY.rate === 0,
    'attempts are counted exactly as recognised', rel.map((r) => `${r.token} ${r.ok}/${r.n}`).join(', '));
  const reliable = P.reliableSigns(M);
  check(reliable.join() === 'HELLO,MOM', 'reliable = >=3 tries and >=67% (WHERE has 1 try, HUNGRY 0%)', reliable.join(', '));
  const sents = P.practiceSentences(reliable);
  const used = new Set(sents.flat());
  check(sents.length > 0 && [...used].every((t) => reliable.includes(t)),
    'practice sentences use reliable signs only', sents.map((s) => s.join(' ')).join(' | '));
  check(P.practiceSentences([]).length === 0, 'no reliable signs -> no invented sentences');
}

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
