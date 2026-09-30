/**
 * ISL Studio dictionary end to end, no network: the server (server/isl.js
 * through the Worker, in-memory KV), the device store (islDictionary.js),
 * sentence translation with this dictionary's rules (islTranslate.js), and
 * a recorded sentence spotted from features all the way to FULL STOP.
 *
 *     node scripts/test-isl-dictionary.mjs
 */
import { handle } from '../server/worker.js';

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

const kv = new Map();
const CODE = 'isl-test-code-5521';
const ENV = { DICT: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } }, DEV_CODE: CODE, ALLOWED_ORIGINS: 'https://aangika.example' };
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
globalThis.fetch = async (url, init = {}) => handle(new Request(url, { ...init, headers: { ...(init.headers || {}), Origin: 'https://aangika.example', 'CF-Connecting-IP': '8.8.8.8' } }), ENV);

const { _setApiBaseForTests } = await import('../src/services/apiBase.js');
_setApiBaseForTests('https://api.example');
const isl = await import('../src/services/isl/islDictionary.js');
const { translateStudio, matchStudioRules } = await import('../src/services/isl/islTranslate.js');
const { createSpotter } = await import('../src/services/isl/islSpotter.js');
const { FEATURE_DIM, HAND_DIM } = await import('../src/services/isl/islFeatures.js');

console.log('='.repeat(74) + '\n  ISL Studio dictionary\n' + '='.repeat(74));

// Synthetic signs: distinct feature patterns, 3 takes each.
let seed = 5;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const proto = () => Array.from({ length: 3 }, () => { const f = Array.from({ length: FEATURE_DIM }, () => rand()); f[HAND_DIM] = 1; f[0] = 0; f[FEATURE_DIM - 1] = 1; return f; });
const perform = (keys, len = 14) => Array.from({ length: len }, (_, i) => {
  const u = (i / (len - 1)) * (keys.length - 1);
  const a = keys[Math.floor(u)]; const b = keys[Math.min(keys.length - 1, Math.floor(u) + 1)]; const w = u - Math.floor(u);
  return a.map((v, j) => (j === HAND_DIM || j === 0 || j === FEATURE_DIM - 1 ? v : Math.max(0, Math.min(1, v * (1 - w) + b[j] * w + (rand() - 0.5) * 0.02))));
});
const WORDS = [
  ['I', 'pronoun', 'word'], ['hospital', 'place', 'word', 'अस्पताल', 'hospital'], ['go', 'action', 'word'],
  ['Rahul', 'person', 'name'], ['full stop', 'other', 'full-stop'],
];
const protos = Object.fromEntries(WORDS.map(([w]) => [w, proto()]));

console.log('\n1. Recording and publishing\n' + '-'.repeat(74));
isl._resetForTests();
for (const [word, category, type, hi, hinglish] of WORDS) {
  await isl.saveDraft({ word, category, type, texts: { ...(hi ? { 'hi-IN': hi } : {}), ...(hinglish ? { hinglish } : {}) }, takes: [perform(protos[word]), perform(protos[word], 16), perform(protos[word], 12)] });
}
check(isl.listSigns().length === 5 && isl.listSigns().every((s) => s.status === 'draft'), 'five signs saved on this device as drafts');
let threw = false;
try { await isl.saveDraft({ word: 'hospital', takes: [perform(protos.hospital)] }); } catch { threw = true; }
check(threw, 'a second sign with the same word is refused');

let r = await fetch('https://api.example/isl/publish', { method: 'POST', body: JSON.stringify({ code: 'wrong', signs: isl.listDrafts() }) });
check(r.status === 403, 'publishing needs the developer code');
const pub = await isl.publish(CODE, isl.listDrafts().map((d) => d.id));
check(pub.added === 5 && isl.listSigns().every((s) => s.status === 'published'), 'published for everyone; drafts cleared', JSON.stringify({ added: pub.added }));
r = await fetch('https://api.example/isl/publish', { method: 'POST', body: JSON.stringify({ code: CODE, signs: [{ token: 'BAD', word: 'bad', type: 'word', takes: [[[1, 2, 3]]] }] }) });
check(r.status === 400, 'malformed recordings are refused by the server');

isl._resetForTests();
check(await isl.sync() === 'updated' && isl.listSigns().length === 5, 'another device downloads the whole dictionary');
check(await isl.sync() === 'current', 'next check: unchanged (304)');

console.log('\n2. Edit, reassign, delete\n' + '-'.repeat(74));
const hosp = isl.listSigns().find((s) => s.word === 'hospital');
await isl.saveDraft({ ...hosp, word: 'clinic', texts: { 'hi-IN': 'क्लिनिक' } });
check(isl.getSign(hosp.id).status === 'edited' && isl.getSign(hosp.id).word === 'clinic', 'reassigning a published sign makes an edit (same id)');
await isl.publish(CODE, [hosp.id]);
check(isl.getSign(hosp.id).word === 'clinic' && isl.getSign(hosp.id).status === 'published', 'the new word is published for everyone');
await isl.saveDraft({ ...isl.getSign(hosp.id), word: 'hospital', texts: { 'hi-IN': 'अस्पताल', hinglish: 'hospital' } });
await isl.publish(CODE, [hosp.id]);
const extra = await isl.saveDraft({ word: 'temporary', category: 'thing', takes: [perform(proto())] });
await isl.publish(CODE, [extra.id]);
await isl.removeSigns(CODE, [extra.id]);
check(!isl.getSign(extra.id) && isl.listSigns().length === 5, 'a sign can be deleted for everyone');

console.log('\n3. This dictionary\'s own rules\n' + '-'.repeat(74));
await isl.saveRules(CODE, [
  { id: 'pronoun-place-go', pattern: ['@pronoun', '@place', 'GO'], english: 'I am going to the {place}.', texts: { 'hi-IN': 'मैं {place} जा रहा हूँ।', hinglish: 'Main {place} ja raha hoon.' } },
  { id: 'person-name', pattern: ['@pronoun', '@name'], english: 'I am {name}.', texts: { 'hi-IN': 'मैं {name} हूँ।' } },
]);
check(isl.getRules().length === 2, 'rules saved for everyone');
const S = (w) => isl.listSigns().find((s) => s.word === w);
let m = matchStudioRules([S('I'), S('hospital'), S('go')]);
check(m?.english === 'I am going to the hospital.' && m.texts['hi-IN'] === 'मैं अस्पताल जा रहा हूँ।' && m.texts.hinglish === 'Main hospital ja raha hoon.',
  'categories fill the rule in every language', `${m?.english} | ${m?.texts['hi-IN']} | ${m?.texts.hinglish}`);
m = matchStudioRules([S('I'), S('Rahul')]);
check(m?.english === 'I am Rahul.', 'a name sign fills {name}', m?.english);
const t = await translateStudio([S('I'), S('hospital'), S('go')], 'hi-IN', { mode: 'offline' });
check(t.translated === 'मैं अस्पताल जा रहा हूँ।' && t.engine.startsWith('isl-rule:'), 'translateStudio: offline Hindi from the rule', t.translated);
const t2 = await translateStudio([S('go'), S('I')], 'en-IN', { mode: 'offline' });
check(t2.english && !t2.engine.startsWith('isl-rule:'), 'no rule: falls through to the app\'s grammar', `${t2.english} (${t2.engine})`);

console.log('\n4. A whole signed sentence, spotted, ended by FULL STOP\n' + '-'.repeat(74));
const signs = isl.listSigns();
const spotter = createSpotter(signs.map((s) => ({ id: s.id, token: s.token, takes: s.takes })));
const rest = () => { const f = new Array(FEATURE_DIM).fill(0.5); f[0] = 0; f[HAND_DIM] = 0; f[FEATURE_DIM - 1] = 1; return f; };
const stream = [rest(), rest(), rest(), ...perform(protos.I, 13), rest(), ...perform(protos.hospital, 15), rest(), ...perform(protos.go, 14), rest(), ...perform(protos['full stop'], 13), rest(), rest(), rest(), rest(), rest(), rest()];
const heard = [...stream.flatMap((f) => spotter.push(Float32Array.from(f))), ...spotter.flush()].map((h) => signs.find((s) => s.id === h.id));
const sentence = heard.slice(0, heard.findIndex((s) => s.type === 'full-stop'));
check(heard.map((s) => s.word).join(' ') === 'I hospital go full stop', 'signs spotted in order, then FULL STOP', heard.map((s) => s.word).join(' '));
const said = await translateStudio(sentence, 'hinglish', { mode: 'offline' });
check(said.translated === 'Main hospital ja raha hoon.', 'the sentence before FULL STOP is translated (Hinglish)', said.translated);

console.log('\n5. "When I sign these, say this": WELCOME + SEGUE -> "Welcome to Segue."\n' + '-'.repeat(74));
{
  const pw = proto();
  const ps = proto();
  await isl.saveDraft({ word: 'WELCOME', category: 'action', type: 'word', takes: [perform(pw), perform(pw, 15), perform(pw, 13)] });
  await isl.saveDraft({ word: 'SEGUE', category: 'place', type: 'word', hands: 'two', takes: [perform(ps), perform(ps, 15), perform(ps, 13)] });
  await isl.publish(CODE, isl.listDrafts().map((d) => d.id));
  // What the app's form saves: the signs, in order, and the typed sentence.
  await isl.saveRules(CODE, [...isl.getRules(), { id: 'say-welcome-segue', pattern: ['WELCOME', 'SEGUE'], english: 'Welcome to Segue.', texts: { hinglish: 'Segue mein aapka swagat hai.' } }]);
  const all = isl.listSigns();
  const sp = createSpotter(all.map((s) => ({ id: s.id, token: s.token, takes: s.takes })));
  const signed = [rest(), rest(), rest(), ...perform(pw, 14), rest(), ...perform(ps, 14), rest(), ...perform(protos['full stop'], 13), ...Array.from({ length: 6 }, rest)];
  const got = [...signed.flatMap((f) => sp.push(Float32Array.from(f))), ...sp.flush()].map((h) => all.find((s) => s.id === h.id));
  const before = got.slice(0, got.findIndex((s) => s.type === 'full-stop'));
  check(got.map((s) => s.word).join(' ') === 'WELCOME SEGUE full stop', 'WELCOME, SEGUE, FULL STOP spotted', got.map((s) => s.word).join(' '));
  const en = await translateStudio(before, 'en-IN', { mode: 'offline' });
  check(en.english === 'Welcome to Segue.', 'it says the typed sentence', `${en.english} (${en.engine})`);
  const hg = await translateStudio(before, 'hinglish', { mode: 'offline' });
  check(hg.translated === 'Segue mein aapka swagat hai.', 'and the typed Hinglish', hg.translated);
  const only = await translateStudio([before[0]], 'en-IN', { mode: 'offline' });
  check(only.english === 'Welcome.', 'WELCOME alone does not trigger it, and just says its word', only.english);

  // The camera rarely gives exactly the rule's signs: extras and order vary.
  const [w, s] = before;
  const extra = all.find((x) => x.word === 'I') || { ...w, id: 'x', token: 'HELLO', word: 'HELLO', category: 'other' };
  const noisy = await translateStudio([extra, w, extra, s], 'en-IN', { mode: 'offline' });
  check(noisy.english === 'Welcome to Segue.', 'still says it with other signs around', noisy.english);
  const flipped = await translateStudio([s, w], 'en-IN', { mode: 'offline' });
  check(flipped.english === 'Welcome to Segue.', 'and in the other order', flipped.english);
  const rules = [{ id: 'say-welcome', pattern: ['WELCOME'], english: 'Hi there.' }, { id: 'say-welcome-segue', pattern: ['WELCOME', 'SEGUE'], english: 'Welcome to Segue.' }];
  check(matchStudioRules([w, s], rules)?.english === 'Welcome to Segue.', 'the rule with more signs wins');
  check(matchStudioRules([w, extra], rules)?.english === 'Hi there.', 'a one-sign rule fires when only that sign is present');
  check(matchStudioRules([w, extra], [{ id: 'any-action', pattern: ['@action'], english: 'Hi there.' }]) === null, 'rules with @categories still match the whole sentence only');
  // What the team saved: one rule per sign (made with either form).
  const team = [{ id: 'welcome-to-segue', pattern: ['WELCOME'], english: 'welcome to segue.', texts: { hinglish: 'Segue mein swagat hai' } }, { id: 'say-segue', pattern: ['SEGUE'], english: 'we are team healx.', texts: { hinglish: 'Hum team HealX hain.' } }];
  const both = matchStudioRules([w, s], team);
  check(both?.english === 'Welcome to segue. We are team healx.', 'two one-sign rules: both sentences, in signed order', both?.english);
  check(both?.texts.hinglish === 'Segue mein swagat hai. Hum team HealX hain.', 'and their Hinglish joined', both?.texts.hinglish);
  check(matchStudioRules([s, w], team)?.english === 'We are team healx. Welcome to segue.', 'signed the other way round, said the other way round');
  check(matchStudioRules([w, s, w], team)?.english === 'Welcome to segue. We are team healx.', 'a sign spotted twice does not repeat its sentence');
}

console.log('\n6. Broken stored data never crashes ISL Studio (the blank page)\n' + '-'.repeat(74));
{
  const ok = (label, fn) => { try { const out = fn(); check(true, label, out); } catch (err) { check(false, label, err.message); } };
  const cases = [
    ['a sign without a word', { version: 1, signs: [{ id: 'a', token: 'X' }, { id: 'b', word: 'SEGUE' }], rules: [] }, []],
    ['signs / rules / drafts not arrays', { version: 1, signs: null, rules: 'x' }, null],
    ['no stored copy at all', undefined, undefined],
    ['junk entries', { signs: [null, 42, 'x', { id: 7, word: 'NUM' }, { id: 'c', word: 'OK', takes: 'bad', texts: 5 }], rules: [null, { id: 'r' }, { id: 's', pattern: [], english: 'x' }] }, [null, { id: 'd' }]],
  ];
  for (const [label, sh, dr] of cases) {
    isl._loadForTests(sh, dr);
    ok(`listSigns survives ${label}`, () => isl.listSigns().map((x) => x.word).join(',') || '(none)');
    ok(`getRules survives ${label}`, () => `${isl.getRules().length} rules`);
    ok(`sentence rules survive ${label}`, () => String(matchStudioRules(isl.listSigns())));
  }
  isl._loadForTests({ signs: [{ id: 'c', word: 'OK', takes: 'bad', texts: 5 }], rules: [] }, []);
  const [c] = isl.listSigns();
  check(c.token === 'OK' && Array.isArray(c.takes) && typeof c.texts === 'object', 'missing fields are filled in', JSON.stringify({ token: c.token, takes: c.takes, texts: c.texts }));
}

console.log('\n7. An "either hand" sign downloaded from the server (e.subarray is not a function)\n' + '-'.repeat(74));
{
  const p = proto();
  const plain = [perform(p), perform(p, 15), perform(p, 13)].map((t) => t.map((f) => Array.from(f)));
  let sp = null;
  try { sp = createSpotter([{ id: 'e', token: 'EITHER', takes: plain, eitherHand: true }]); } catch (err) { check(false, 'spotter builds with plain-array takes', err.message); }
  check(sp && sp.size() === 6, 'spotter builds with plain-array takes, own + mirrored', sp ? `${sp.size()} templates` : 'crashed');
  const bad = createSpotter([{ id: 'x', token: 'BAD', takes: [[[1, 2], 'junk', null]], eitherHand: true }, { id: 'e', token: 'EITHER', takes: plain }]);
  check(bad.size() === 3, 'a broken sign is skipped, the others still work', `${bad.size()} templates`);
}

console.log('\n8. Nothing is lost: deleted signs can be restored, every change is backed up\n' + '-'.repeat(74));
{
  isl._resetForTests();
  await isl.sync({ force: true });                     // the server's dictionary again
  const one = isl.listSigns().find((s) => s.word === 'go');
  const takesBefore = JSON.stringify(one.takes);
  const count = isl.listSigns().length;
  await isl.removeSigns(CODE, [one.id]);
  check(!isl.getSign(one.id) && isl.listSigns().length === count - 1, 'a sign is deleted for everyone');
  let bin = await isl.listDeleted(CODE);
  check(bin.some((b) => b.id === one.id && b.takes === 3), 'it is kept in "Recently deleted"', bin.map((b) => b.word).join(', '));
  let denied = false;
  try { await isl.listDeleted('wrong'); } catch { denied = true; }
  check(denied, 'the deleted list needs the developer code');
  await isl.restoreSigns(CODE, [one.id]);
  check(isl.getSign(one.id) && JSON.stringify(isl.getSign(one.id).takes) === takesBefore, 'restore brings it back with its recordings unchanged');
  bin = await isl.listDeleted(CODE);
  check(!bin.some((b) => b.id === one.id), 'and removes it from the bin');
  const backups = [...kv.keys()].filter((k) => k.startsWith('isl:backup:'));
  const newest = JSON.parse(kv.get(`isl:backup:${(JSON.parse(kv.get('isl')).version - 1) % 10}`));
  check(backups.length >= 5 && backups.length <= 10 && newest.version === JSON.parse(kv.get('isl')).version - 1,
    'the previous dictionary is kept in rotating backups (at most 10)', `${backups.length} backups, newest v${newest.version}`);
}

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
