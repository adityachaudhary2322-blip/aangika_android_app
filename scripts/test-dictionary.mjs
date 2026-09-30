/**
 * Community sign dictionary: the server (server/dictionary.js via the
 * Worker, with an in-memory KV) and the app's sync
 * (src/services/sharedDictionary.js) against it.
 *
 *     node scripts/test-dictionary.mjs
 */
import { handle } from '../server/worker.js';
import { _dictTest } from '../server/dictionary.js';

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

// In-memory stand-in for Workers KV.
const kv = new Map();
const DICT = {
  get: async (k) => (kv.has(k) ? kv.get(k) : null),
  put: async (k, v) => { kv.set(k, v); },
};
const CODE = 'test-code-9981';                   // the real code lives only in the Worker secret
const ENV = { DICT, DEV_CODE: CODE, ALLOWED_ORIGINS: 'https://aangika.example' };
const ORIGIN = 'https://aangika.example';

const call = (path, { method = 'POST', body, ip = '1.1.1.1', env = ENV, headers = {} } = {}) => handle(
  new Request(`https://api.example${path}`, {
    method, body: body === undefined ? undefined : JSON.stringify(body),
    headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'CF-Connecting-IP': ip, ...headers },
  }), env, async () => { throw new Error('no upstream in these tests'); },
);
const jsonOf = async (r) => { try { return await r.json(); } catch { return null; } };

const hand = (dx = 0) => Array.from({ length: 63 }, (_, i) => +(0.5 + ((i * 7) % 13) / 100 + dx).toFixed(4));
const sign = (token, id = token.toLowerCase(), extra = {}) => ({
  id, token, kind: 'handshape', hands: 'one',
  output: { type: 'word', text_en: token.toLowerCase(), texts: { 'hi-IN': 'x' }, category: 'other' },
  samples: [0, 1, 2].map((c) => ({ capture: c, left: null, right: hand(c / 100), pose: { 11: [0.4, 0.4], 99: 'junk' } })),
  ...extra,
});

console.log('='.repeat(74) + '\n  Community sign dictionary\n' + '='.repeat(74));

console.log('\n1. Server\n' + '-'.repeat(74));
let r = await call('/dictionary', { method: 'GET' });
let d = await jsonOf(r);
check(r.status === 200 && d.signs.length === 0 && d.version === 0, 'empty dictionary to start');

r = await call('/dictionary/verify', { body: { code: '000000' } });
check(r.status === 403, 'a wrong code is refused');
r = await call('/dictionary/publish', { body: { code: '123456', signs: [sign('HI')] } });
const afterWrong = await jsonOf(await call('/dictionary', { method: 'GET' }));
check(r.status === 403 && afterWrong.signs.length === 0, 'publishing with a wrong code changes nothing');

r = await call('/dictionary/verify', { body: { code: CODE }, ip: '2.2.2.2' });
check(r.status === 200 && (await jsonOf(r)).ok === true, 'the right code verifies');
r = await call('/dictionary/verify', { body: { code: ` ${CODE} ` }, ip: '2.2.2.2', env: { ...ENV, DEV_CODE: `${CODE}\r\n` } });
check(r.status === 200, 'a secret saved with a trailing CR/LF (Windows shell) and a padded entry still match');
const verifyText = JSON.stringify(await jsonOf(await call('/dictionary/verify', { body: { code: CODE }, ip: '2.2.2.2' })));
check(!verifyText.includes(CODE), 'the code is never echoed back');

r = await call('/dictionary/publish', {
  ip: '2.2.2.2',
  body: { code: CODE, signs: [sign('WAVE_HI'), sign('THANKS_ALL'), sign('EMPTY', 'e', { samples: [] }), sign('bad token!')] },
});
d = await jsonOf(r);
check(r.status === 200 && d.added === 2 && d.version === 1, 'publish adds the valid signs', JSON.stringify({ added: d.added, version: d.version }));
check(d.rejected.length === 2 && d.rejected.some((x) => /untrained/.test(x)) && d.rejected.some((x) => /bad token/.test(x)),
  'untrained and badly named signs are rejected with a reason', d.rejected.join(' | '));

r = await call('/dictionary', { method: 'GET' });
d = await jsonOf(r);
const etag = r.headers.get('ETag');
check(d.signs.length === 2 && etag === '"v1"', 'everyone can read it, with a version ETag', etag);
check(!('99' in d.signs[0].samples[0].pose) && '11' in d.signs[0].samples[0].pose, 'unknown fields in samples are stripped');
r = await call('/dictionary', { method: 'GET', headers: { 'If-None-Match': etag } });
check(r.status === 304, 'unchanged dictionary: 304, nothing downloaded');

r = await call('/dictionary/publish', { ip: '2.2.2.2', body: { code: CODE, signs: [sign('WAVE_HI', 'wave_hi', { output: { type: 'word', text_en: 'hello all' } })] } });
d = await jsonOf(r);
check(d.updated === 1 && d.added === 0 && d.total === 2, 're-publishing the same sign updates it');
r = await call('/dictionary/publish', { ip: '2.2.2.2', body: { code: CODE, signs: [sign('WAVE_HI', 'other-device-id')] } });
d = await jsonOf(r);
check(r.status === 400 && /already in the dictionary/.test(d.rejected?.[0] || ''), 'another sign with a taken token is refused');

r = await call('/dictionary/remove', { ip: '2.2.2.2', body: { code: CODE, ids: ['thanks_all'] } });
d = await jsonOf(r);
check(d.removed === 1 && d.total === 1, 'developers can remove a shared sign');
r = await call('/dictionary/remove', { ip: '3.3.3.3', body: { code: 'nope', ids: ['wave_hi'] } });
check(r.status === 403, 'removing needs the code too');

const glove = { id: 'g1', token: 'G_OK', kind: 'glove', output: { type: 'gloss', text_en: 'ok' }, samples: [{ capture: 0, f: [1, 2, 3, 4, 5, 6, 7] }] };
const motion = { id: 'g2', token: 'G_WAVE', kind: 'glove-motion', output: { type: 'word', text_en: 'wave' }, samples: [{ seq: [[1, 2, 3], [2, 3, 4]] }] };
d = await jsonOf(await call('/dictionary/publish', { ip: '2.2.2.2', body: { code: CODE, signs: [glove, motion] } }));
check(d.added === 2, 'glove and glove-motion signs publish too');

console.log('\n1b. Built-in sign overrides and grammar rules (developer section)\n' + '-'.repeat(74));
r = await call('/dictionary/override', { ip: '2.2.2.2', body: { code: CODE, token: 'WATER', override: { token: 'thirsty', text_en: 'I am very thirsty.', texts: { 'hi-IN': 'मुझे बहुत प्यास लगी है।', hinglish: 'Bahut pyaas lagi hai.', 'xx': 'junk' }, extra: 1 } } });
d = await jsonOf(r);
check(r.status === 200 && d.override.token === 'THIRSTY' && !('xx' in d.override.texts) && !('extra' in d.override),
  'reassigning a built-in sign stores a cleaned override', JSON.stringify(d.override));
r = await call('/dictionary/override', { ip: '2.2.2.2', body: { code: 'nope', token: 'BAD', override: { disabled: true } } });
check(r.status === 403, 'overrides need the code');
await call('/dictionary/override', { ip: '2.2.2.2', body: { code: CODE, token: 'BAD', override: { disabled: true } } });
d = await jsonOf(await call('/dictionary', { method: 'GET' }));
check(d.overrides.BAD?.disabled === true && d.overrides.WATER?.token === 'THIRSTY', 'everyone reads the overrides');
await call('/dictionary/override', { ip: '2.2.2.2', body: { code: CODE, token: 'BAD', override: null } });
d = await jsonOf(await call('/dictionary', { method: 'GET' }));
check(!('BAD' in d.overrides), 'reset removes an override');
r = await call('/dictionary/rules', { ip: '2.2.2.2', body: { code: CODE, rules: [{ id: 'self-need', pattern: ['@self', '@need'], english: 'I need {need}.', texts: { 'hi-IN': 'मुझे {need} चाहिए।' } }] } });
check(r.status === 200 && (await jsonOf(r)).rules === 1, 'grammar rules can be published');
r = await call('/dictionary/rules', { ip: '2.2.2.2', body: { code: CODE, rules: [{ id: 'Bad Id', pattern: ['x y'], english: '' }] } });
check(r.status === 400, 'malformed rules are refused');
await call('/dictionary/override', { ip: '2.2.2.2', body: { code: CODE, token: 'WATER', override: null } });
await call('/dictionary/rules', { ip: '2.2.2.2', body: { code: CODE, rules: [] } });

console.log('\n2. Guessing the code\n' + '-'.repeat(74));
_dictTest.failures.clear();
const statuses = [];
for (let i = 0; i < _dictTest.IP_FAILS + 2; i++) statuses.push((await call('/dictionary/verify', { ip: '9.9.9.9', body: { code: String(100000 + i) } })).status);
check(statuses.slice(0, _dictTest.IP_FAILS).every((s) => s === 403) && statuses.slice(_dictTest.IP_FAILS).every((s) => s === 429),
  `one device: locked after ${_dictTest.IP_FAILS} wrong codes`, statuses.join(','));
r = await call('/dictionary/verify', { ip: '9.9.9.9', body: { code: CODE } });
check(r.status === 429, 'even the right code waits out the lock');

for (let i = 0; i < _dictTest.GLOBAL_FAILS_PER_HOUR; i++) {
  await call('/dictionary/verify', { ip: `10.0.${i}.1`, body: { code: 'x' + i } });
}
r = await call('/dictionary/verify', { ip: '11.1.1.1', body: { code: CODE } });
check(r.status === 423, `many devices guessing: publishing locks for the hour (after ${_dictTest.GLOBAL_FAILS_PER_HOUR})`);
for (const k of [...kv.keys()]) if (k.startsWith('fails:')) kv.delete(k);
_dictTest.failures.clear();

console.log('\n3. Not set up yet\n' + '-'.repeat(74));
r = await call('/dictionary', { method: 'GET', env: { ...ENV, DICT: undefined } });
check(r.status === 503, 'no storage bound: a clear 503');
r = await call('/dictionary/verify', { body: { code: CODE }, env: { ...ENV, DEV_CODE: '' } });
check(r.status === 503, 'no code configured: publishing is off (503), never open');
r = await handle(new Request('https://api.example/dictionary', { headers: { Origin: 'https://evil.example' } }), ENV);
check(r.status === 403, 'other websites cannot read it through the browser');

console.log('\n4. The app: publish from one device, receive on another\n' + '-'.repeat(74));
{
  kv.clear();
  // Browser pieces Node lacks: localStorage, and fetch routed to the Worker.
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
  let requests = 0;
  globalThis.fetch = async (url, init = {}) => {
    requests += 1;
    return handle(new Request(url, {
      ...init, headers: { ...(init.headers || {}), Origin: ORIGIN, 'CF-Connecting-IP': '7.7.7.7' },
    }), ENV);
  };
  const { _setApiBaseForTests } = await import('../src/services/apiBase.js');
  _setApiBaseForTests('https://api.example');
  const signs = await import('../src/services/customSigns.js');
  const dict = await import('../src/services/sharedDictionary.js');

  // Developer's device: two taught signs.
  signs._resetForTests();
  const mine = sign('NAMASTE_ALL', undefined, { id: undefined });
  const a = await signs.saveSign({ ...mine, id: undefined });
  const b = await signs.saveSign({ ...sign('GOOD_WORK'), id: undefined });
  check(dict.publishable().length === 2, 'two taught signs are publishable');
  check((await dict.verifyCode('111111')) === false, 'a wrong code is reported as wrong');
  check((await dict.verifyCode(CODE)) === true, 'the right code unlocks publishing');
  const res = await dict.publish(CODE, dict.publishable());
  check(res.added === 2, 'publish sends them to the server', `added ${res.added}`);
  check(signs.listSharedSigns().length === 0 && signs.listOwnSigns().length === 2,
    'on the publisher\'s device their own copies stay (no duplicates)');

  // Another user's device: empty, then updates.
  signs._resetForTests();
  store.clear();
  let st = await dict.checkForUpdates();
  check(st.status === 'updated' && signs.listSharedSigns().length === 2, 'another device downloads the new signs', st.status);
  const shared = signs.findByToken('NAMASTE_ALL');
  check(shared?.shared === true && shared.id === `shared:${a.id}`, 'stored as shared, linked to the published id');
  check(signs.listSigns().some((s) => s.token === 'GOOD_WORK'), 'the recognisers see them (listSigns)');
  check(JSON.parse(signs.exportJSON()).signs.length === 0, 'shared signs are not exported as the user\'s own');
  check(signs.validate({ token: 'GOOD_WORK', kind: 'handshape', hands: 'one', output: { type: 'word', text_en: 'x' } })
    .some((e) => /community dictionary/.test(e)), 'teaching a taken name says it is in the community dictionary');

  const before = requests;
  st = await dict.checkForUpdates();
  check(st.status === 'current' && requests === before + 1, 'next check: unchanged (one small request, 304)');

  // Developer removes one; the other device drops it on the next update.
  await dict.removeShared(CODE, [b.id]);
  st = await dict.checkForUpdates();
  check(signs.listSharedSigns().length === 1 && !signs.findByToken('GOOD_WORK'), 'removed for everyone on the next update');

  // A user's own sign with the same name wins over the dictionary's.
  signs._resetForTests();
  store.clear();
  await signs.saveSign({ ...sign('NAMASTE_ALL'), id: undefined, output: { type: 'word', text_en: 'my own namaste' } });
  st = await dict.checkForUpdates({ force: true });
  check(signs.findByToken('NAMASTE_ALL')?.shared !== true && st.last.skipped.length === 1,
    'the user\'s own sign keeps its name; the shared one is skipped');

  // Developer overrides reach this device and change recognition + meaning.
  const { classifyFrame } = await import('../src/services/signbridgeCombined.js');
  const { translate, MODE_OFFLINE } = await import('../src/services/translationService.js');
  const { CASES } = await import('./fixtures/syntheticHands.mjs');
  const caseOf = (t) => CASES.find(([x]) => x === t);
  check(await dict.unlock('000000') === false && !dict.isUnlocked(), 'developer section stays locked with a wrong code');
  check(await dict.unlock(CODE) === true && dict.isUnlocked(), 'developer section unlocks with the right code');
  await dict.setOverride(dict.getDevCode(), 'BAD', { disabled: true });
  await dict.setOverride(dict.getDevCode(), 'WATER', { token: 'THIRSTY', text_en: 'I am very thirsty.', texts: { 'hi-IN': 'मुझे बहुत प्यास लगी है।' } });
  const [, badHands, P] = caseOf('BAD');
  const [, waterHands] = caseOf('WATER');
  check(classifyFrame(badHands, P)?.token == null, 'a disabled built-in sign is no longer recognised');
  const w = classifyFrame(waterHands, P);
  check(w?.token === 'THIRSTY' && w.originalToken === 'WATER', 'a reassigned sign produces the new word', w?.token);
  const t1 = await translate(['THIRSTY'], 'hi-IN', { mode: MODE_OFFLINE });
  check(t1.english === 'I am very thirsty.' && t1.translated === 'मुझे बहुत प्यास लगी है।',
    'its new meaning is spoken, offline, in English and the given Hindi', `${t1.english} / ${t1.translated}`);
  await dict.setOverride(dict.getDevCode(), 'BAD', null);
  await dict.setOverride(dict.getDevCode(), 'WATER', null);
  check(classifyFrame(badHands, P)?.token === 'BAD' && classifyFrame(waterHands, P)?.token === 'WATER', 'reset restores both for everyone');
  dict.lock();
  check(!dict.isUnlocked(), 'lock forgets the code');

  _setApiBaseForTests('');
  st = await dict.checkForUpdates();
  check(st.status === 'unavailable', 'no server in the build: "unavailable", nothing breaks');
}

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
