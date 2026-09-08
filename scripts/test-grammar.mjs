/**
 * Offline grammar engine test.
 *
 *     node scripts/test-grammar.mjs
 *
 * The held-out cases are the same ones measured against the real
 * Qwen2.5-0.5B-Instruct in the Python reference, where that model scored 1/7.
 * They are the honest bar for this engine: not "does it look plausible" but
 * "does it beat what the model it replaces actually produced".
 */

import { expand } from '../src/services/islGrammar.js';

const DEMONSTRATED = [
  [['I', 'WANT', 'WATER'], 'I want water.'],
  [['TOMORROW', 'COLLEGE', 'GO'], 'I will go to college tomorrow.'],
  [['DOCTOR', 'HELP', 'NEED'], "I need a doctor's help."],
  [['YESTERDAY', 'MARKET', 'GO'], 'I went to the market yesterday.'],
  [['MOTHER', 'HOSPITAL', 'YESTERDAY', 'GO'], 'My mother went to the hospital yesterday.'],
];

// Never shown to the engine as few-shot; these are the generalisation test.
const HELD_OUT = [
  [['FOOD', 'WANT'], 'I want food.', 'no hallucinated verb'],
  [['HE', 'TEACHER'], 'He is a teacher.', 'copula + explicit subject'],
  [['POLICE', 'CALL', 'NEED'], 'I need to call the police.', 'need-to-verb'],
  [['FATHER', 'SHOP', 'TOMORROW', 'GO'], 'My father will go to the shop tomorrow.', 'kinship subject + future'],
  [['SISTER', 'BOOK', 'READ'], 'My sister is reading a book.', 'kinship subject, no time cue'],
  [['YESTERDAY', 'SCHOOL', 'GO'], 'I went to school yesterday.', 'past tense, new noun'],
  [['FRIEND', 'HELP', 'NEED'], "I need my friend's help.", 'person noun as object'],
];

const EXTRA = [
  [['WATER', 'NOT', 'WANT'], 'negation'],
  [['WHERE', 'HOSPITAL'], 'question'],
  [['THEY', 'TOMORROW', 'COME'], 'plural subject + future'],
  [['I', 'DELHI', 'LIVE'], 'verb preposition'],
  [['YOU', 'UNDERSTAND'], 'second person, no object'],
];

let pass = 0;
let fail = 0;

function run(label, cases, strict) {
  console.log(`\n${label}\n${'-'.repeat(72)}`);
  for (const [tags, expected, note] of cases) {
    const t0 = process.hrtime.bigint();
    const { english, rule } = expand(tags);
    const us = Number(process.hrtime.bigint() - t0) / 1000;

    if (!strict) {
      console.log(`  ${String(tags.join(' ')).padEnd(30)} -> ${english}`);
      console.log(`  ${''.padEnd(30)}    [${rule}] ${note || ''}`);
      continue;
    }

    const ok = english === expected;
    ok ? pass++ : fail++;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${tags.join(' ')}`);
    console.log(`         got      ${english}`);
    if (!ok) console.log(`         expected ${expected}`);
    console.log(`         rule=${rule}  ${us.toFixed(0)}us${note ? '  · ' + note : ''}`);
  }
}

console.log('='.repeat(72));
console.log('  Offline ISL grammar engine - deterministic, no model, no network');
console.log('='.repeat(72));

run('1. Demonstrated phrases (in the few-shot table)', DEMONSTRATED, true);
run('2. Held-out cases (Qwen2.5-0.5B scored 1/7 on these)', HELD_OUT, true);
run('3. Additional coverage (no fixed expectation)', EXTRA, false);

console.log('\n' + '='.repeat(72));
console.log(`  ${pass} passed, ${fail} failed of ${pass + fail} checked`);
console.log('='.repeat(72));

process.exit(fail ? 1 : 0);
