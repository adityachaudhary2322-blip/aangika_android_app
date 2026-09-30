/**
 * My dictionary (islPersonal.js): a person's own signs and changes on top of
 * the team's ISL Studio dictionary. Private, never publishable, and every
 * change reversible: deleting or disabling it restores the team's sign.
 *
 *     node scripts/test-personal.mjs
 */
import { handle } from '../server/worker.js';

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

const personal = await import('../src/services/isl/islPersonal.js');
const { effectiveSigns, merge } = personal;
const { createSpotter } = await import('../src/services/isl/islSpotter.js');
const { FEATURE_DIM, HAND_DIM } = await import('../src/services/isl/islFeatures.js');
const { translateStudio } = await import('../src/services/isl/islTranslate.js');

console.log('='.repeat(74) + '\n  My dictionary\n' + '='.repeat(74));

let seed = 9;
const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const proto = () => Array.from({ length: 3 }, () => { const f = Array.from({ length: FEATURE_DIM }, () => rand()); f[HAND_DIM] = 1; f[0] = 0; f[FEATURE_DIM - 1] = 1; return f; });
const perform = (keys, len = 14) => Array.from({ length: len }, (_, i) => {
  const u = (i / (len - 1)) * (keys.length - 1);
  const a = keys[Math.floor(u)]; const b = keys[Math.min(keys.length - 1, Math.floor(u) + 1)]; const w = u - Math.floor(u);
  return a.map((v, j) => (j === HAND_DIM || j === 0 || j === FEATURE_DIM - 1 ? v : Math.max(0, Math.min(1, v * (1 - w) + b[j] * w + (rand() - 0.5) * 0.02))));
});
const team = ['hello', 'water', 'go'].map((w, k) => {
  const p = proto();
  return { id: `t${k}`, token: w.toUpperCase(), word: w, category: 'other', type: 'word', texts: {}, takes: [perform(p), perform(p, 15), perform(p, 13)], proto: p };
});
const words = (list) => list.map((s) => s.word).sort().join(' ');

console.log('\n1. Change a team sign for me, then undo\n' + '-'.repeat(74));
personal._resetForTests();
await personal.setOverride('t0', { word: 'Namaste', texts: { 'hi-IN': 'नमस्ते' } });
let eff = effectiveSigns(team);
check(words(eff) === 'Namaste go water', 'my word replaces the team word for me', words(eff));
check(team[0].word === 'hello', 'the team sign itself is unchanged');
const said = await translateStudio([eff.find((s) => s.word === 'Namaste')], 'hi-IN', { mode: 'offline' });
check(said.english === 'Namaste.' && said.translated === 'नमस्ते', 'translation uses my word and my Hindi', `${said.english} | ${said.translated}`);
await personal.setOverride('t0', { disabled: true });
check(words(effectiveSigns(team)) === 'go hello water', 'disabling my change restores the team word');
await personal.setOverride('t0', { disabled: false });
await personal.clearOverride('t0');
check(words(effectiveSigns(team)) === 'go hello water' && !personal.getOverride('t0'), 'undo removes my change: the team word is back');

console.log('\n2. My own sign instead of a team sign\n' + '-'.repeat(74));
const mineP = proto();
const mine = await personal.savePersonal({ word: 'pani', category: 'thing', takes: [perform(mineP), perform(mineP, 15), perform(mineP, 13)] }, { replaces: ['t1'] });
check(mine.id.startsWith('p-') && mine.personal, 'saved as a personal sign', mine.id);
eff = effectiveSigns(team);
check(words(eff) === 'go hello pani', 'the team sign it replaces is hidden for me; mine is used', words(eff));
const spot = createSpotter(eff.map((s) => ({ id: s.id, token: s.token, takes: s.takes })));
const rest = () => { const f = new Array(FEATURE_DIM).fill(0.5); f[0] = 0; f[HAND_DIM] = 0; f[FEATURE_DIM - 1] = 1; return f; };
const stream = [rest(), rest(), ...perform(team[0].proto, 14), rest(), ...perform(mineP, 14), ...Array.from({ length: 8 }, rest)];
const heard = [...stream.flatMap((f) => spot.push(Float32Array.from(f))), ...spot.flush()].map((h) => eff.find((s) => s.id === h.id)?.word);
check(heard.join(' ') === 'hello pani', 'the translator recognises team and personal signs together', heard.join(' '));
await personal.setPersonalDisabled(mine.id, true);
check(words(effectiveSigns(team)) === 'go hello water', 'disabling my sign brings the team sign back');
await personal.setPersonalDisabled(mine.id, false);
check(words(effectiveSigns(team)) === 'go hello pani', 'enabling it again hides the team sign again');
await personal.removePersonal(mine.id);
check(words(effectiveSigns(team)) === 'go hello water' && !personal.getOverride('t1'), 'deleting my sign brings the team sign back for good');

console.log('\n3. Hide for me\n' + '-'.repeat(74));
await personal.setOverride('t2', { hidden: true });
check(words(effectiveSigns(team)) === 'hello water', 'a hidden team sign is not used for me');
await personal.setOverride('t2', { hidden: false });
check(words(effectiveSigns(team)) === 'go hello water', 'show again');

console.log('\n4. Syncing two devices: newer wins, deletes stick\n' + '-'.repeat(74));
const a = { signs: [{ id: 'p-1', word: 'one', updatedAt: 10 }, { id: 'p-2', word: 'two', updatedAt: 10 }], overrides: { t0: { word: 'Hi', updatedAt: 10 } }, deleted: {} };
const b = { signs: [{ id: 'p-1', word: 'ONE', updatedAt: 20 }], overrides: {}, deleted: { 'p-2': 15, 'o:t0': 5 } };
const m = merge(a, b);
check(m.signs.length === 1 && m.signs[0].word === 'ONE', 'the newer edit wins; a delete on the other device sticks', JSON.stringify(m.signs.map((s) => s.word)));
check(m.overrides.t0?.word === 'Hi', 'a change made after an older undo survives');

console.log('\n5. Never publishable\n' + '-'.repeat(74));
const kv = new Map();
const CODE = 'personal-test-code';
const ENV = { DICT: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } }, DEV_CODE: CODE, ALLOWED_ORIGINS: 'https://aangika.example' };
const pub = async (signs) => handle(new Request('https://api.example/isl/publish', { method: 'POST', headers: { Origin: 'https://aangika.example', 'CF-Connecting-IP': '1.1.1.1' }, body: JSON.stringify({ code: CODE, signs }) }), ENV);
const takes = [perform(proto())];
let r = await pub([{ id: 'p-abc', token: 'MINE', word: 'mine', type: 'word', takes }]);
check(r.status === 400, 'the server refuses a personal sign even with the developer code', String(r.status));
r = await pub([{ id: 'x1', personal: true, token: 'MINE', word: 'mine', type: 'word', takes }]);
check(r.status === 400, 'and a sign marked personal', String(r.status));
r = await pub([{ id: 'x2', token: 'TEAM', word: 'team', type: 'word', takes }]);
check(r.status === 200, 'a normal team sign still publishes', String(r.status));

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
