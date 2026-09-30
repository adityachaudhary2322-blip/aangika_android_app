/**
 * Accounts on the Worker (server/auth.js), no network: username + PIN,
 * lockouts, session tokens, Google ID tokens (signed here with a key made for
 * the test and served as the "Google" key set), and my dictionary kept
 * private to its owner.
 *
 *     node scripts/test-auth.mjs
 */
import { handle } from '../server/worker.js';

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

const kv = new Map();
const CLIENT = 'test-client.apps.googleusercontent.com';
const ENV = {
  DICT: { get: async (k) => kv.get(k) ?? null, put: async (k, v) => { kv.set(k, v); } },
  SESSION_SECRET: 'test-session-secret-1234567890',
  GOOGLE_CLIENT_IDS: `other-client,${CLIENT}`,
  GOOGLE_JWKS_URL: 'https://keys.example/jwks',
  ALLOWED_ORIGINS: 'https://aangika.example',
};

// A "Google" signing key for the test.
const { privateKey, publicKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify'],
);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: 'k1', alg: 'RS256', use: 'sig' };
const fetchImpl = async (url) => (url === ENV.GOOGLE_JWKS_URL
  ? new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })
  : new Response('no', { status: 404 }));
const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
async function googleToken(claims, { key = privateKey, kid = 'k1' } = {}) {
  const head = b64u(JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: 'https://accounts.google.com', aud: CLIENT, exp: Math.floor(Date.now() / 1000) + 600, sub: '1234567890', email: 'asha@example.com', name: 'Asha', ...claims }));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64u(sig)}`;
}

let ipN = 0;
const call = async (path, { method = 'POST', body, token, ip, headers = {} } = {}) => {
  const r = await handle(new Request(`https://api.example${path}`, {
    method,
    headers: { Origin: 'https://aangika.example', 'CF-Connecting-IP': ip || `10.0.0.${++ipN % 250}`, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    ...(body ? { body: JSON.stringify(body) } : {}),
  }), ENV, fetchImpl);
  let data = null;
  try { data = await r.json(); } catch { /* 304 */ }
  return { status: r.status, data, etag: r.headers.get('ETag') };
};

console.log('='.repeat(74) + '\n  Accounts\n' + '='.repeat(74));

console.log('\n1. Username + PIN\n' + '-'.repeat(74));
let r = await call('/auth/register', { body: { username: 'Asha_1', pin: '482913', name: 'Asha' } });
check(r.status === 200 && r.data.token && r.data.user.uid === 'u:asha_1', 'register: a token and the account', JSON.stringify(r.data?.user));
const asha = r.data.token;
check(!kv.get('acct:u:asha_1').includes('482913'), 'the PIN is not stored, only a salted hash');
r = await call('/auth/register', { body: { username: 'asha_1', pin: '771234' } });
check(r.status === 409, 'a taken username is refused');
r = await call('/auth/register', { body: { username: 'bob', pin: '123456' } });
check(r.status === 400, 'an easy PIN (123456) is refused', r.data?.error);
r = await call('/auth/register', { body: { username: 'bob', pin: '12ab' } });
check(r.status === 400, 'a PIN must be 6+ digits');
r = await call('/auth/login', { body: { username: 'ASHA_1', pin: '482913' } });
check(r.status === 200 && r.data.user.name === 'Asha', 'login with the right PIN (username not case-sensitive)');
r = await call('/auth/login', { body: { username: 'asha_1', pin: '000001' } });
check(r.status === 403, 'a wrong PIN is refused');
r = await call('/auth/login', { body: { username: 'nobody', pin: '482913' } });
check(r.status === 403 && r.data.error === 'Wrong username or PIN.', 'an unknown username gets the same answer (no account probing)');

console.log('\n2. Guessing is stopped\n' + '-'.repeat(74));
await call('/auth/register', { body: { username: 'target', pin: '583920' } });
for (let i = 0; i < 12; i++) await call('/auth/login', { body: { username: 'target', pin: String(100000 + i) } });
r = await call('/auth/login', { body: { username: 'target', pin: '583920' } });
check(r.status === 423, 'after 10 wrong PINs the account is locked for the hour, even with the right PIN', String(r.status));
for (let i = 0; i < 21; i++) await call('/auth/login', { body: { username: `spray${i}`, pin: String(200000 + i) }, ip: '9.9.9.9' });
r = await call('/auth/login', { body: { username: 'someone', pin: '111222' }, ip: '9.9.9.9' });
check(r.status === 429 || r.status === 423, 'one address trying PINs across many usernames is stopped', String(r.status));

console.log('\n3. Session tokens\n' + '-'.repeat(74));
r = await call('/me', { method: 'GET', token: asha });
check(r.status === 200 && r.data.user.uid === 'u:asha_1', '/me with the token');
const parts = asha.split('.');
const forged = [parts[0], Buffer.from('u:target').toString('base64url'), parts[2], parts[3]].join('.');
r = await call('/me', { method: 'GET', token: forged });
check(r.status === 401, 'a token edited to another user is refused');
const { makeToken } = await import('../server/auth.js');
const expired = await makeToken(ENV, 'u:asha_1', Date.now() - 91 * 86_400_000);
r = await call('/me', { method: 'GET', token: expired });
check(r.status === 401, 'an expired token is refused');
r = await call('/me', { method: 'GET' });
check(r.status === 401, 'no token: sign in first');

console.log('\n4. My dictionary is private\n' + '-'.repeat(74));
const frames = Array.from({ length: 5 }, () => Array.from({ length: 100 }, (_, j) => (j === 48 || j === 99 ? 1 : 0.5)));
const mine = {
  signs: [{ id: 'p-1', personal: true, token: 'PANI', word: 'pani', type: 'word', category: 'thing', takes: [frames], updatedAt: 5 }],
  overrides: { t1: { hidden: true, by: 'p-1', updatedAt: 5 }, t2: { word: 'Namaste', texts: { 'hi-IN': 'नमस्ते', evil: 'x' }, updatedAt: 6 } },
  deleted: { 'p-0': 3 },
};
r = await call('/me/personal', { body: { data: mine }, token: asha });
check(r.status === 200 && r.data.version === 1, 'saved', JSON.stringify(r.data));
r = await call('/me/personal', { method: 'GET', token: asha });
check(r.status === 200 && r.data.signs[0].word === 'pani' && r.data.overrides.t2.word === 'Namaste' && !r.data.overrides.t2.texts.evil,
  'read back, cleaned (unknown fields dropped)');
const etag = r.etag;
r = await call('/me/personal', { method: 'GET', token: asha, headers: { 'If-None-Match': etag } });
check(r.status === 304, 'unchanged: 304');
const other = (await call('/auth/register', { body: { username: 'carol', pin: '905172' } })).data.token;
r = await call('/me/personal', { method: 'GET', token: other });
check(r.status === 200 && r.data.signs.length === 0, 'another account sees only its own (empty) dictionary');
r = await call('/me/personal', { method: 'GET' });
check(r.status === 401, 'nobody reads it without signing in');
r = await call('/me/personal', { body: { data: { signs: [{ ...mine.signs[0], id: 'x-team', personal: false }] } }, token: asha });
check(r.status === 400, 'only personal signs are kept in my dictionary');

console.log('\n5. Google\n' + '-'.repeat(74));
r = await call('/auth/google', { body: { idToken: await googleToken({}) } });
check(r.status === 200 && r.data.user.uid === 'g:1234567890' && r.data.user.name === 'Asha', 'a valid Google token signs in (new account)', JSON.stringify(r.data?.user));
const g = r.data.token;
r = await call('/me', { method: 'GET', token: g });
check(r.status === 200, 'its session works');
r = await call('/auth/google', { body: { idToken: await googleToken({ aud: 'someone-else' }) } });
check(r.status === 401 && /audience/.test(r.data.error), 'a token for another app is refused', r.data?.error);
r = await call('/auth/google', { body: { idToken: await googleToken({ iss: 'https://evil.example' }) } });
check(r.status === 401 && /issuer/.test(r.data.error), 'a token from another issuer is refused');
r = await call('/auth/google', { body: { idToken: await googleToken({ exp: Math.floor(Date.now() / 1000) - 10 }) } });
check(r.status === 401 && /expired/.test(r.data.error), 'an expired token is refused');
const { privateKey: otherKey } = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
r = await call('/auth/google', { body: { idToken: await googleToken({}, { key: otherKey }) } });
check(r.status === 401 && /signature/.test(r.data.error), 'a token not signed by Google is refused');

console.log('\n6. Link Google to a username account (a way back in without the PIN)\n' + '-'.repeat(74));
r = await call('/auth/link-google', { body: { idToken: await googleToken({ sub: '555', name: 'Carol' }) }, token: other });
check(r.status === 200 && r.data.user.google, 'linked');
r = await call('/auth/google', { body: { idToken: await googleToken({ sub: '555' }) } });
check(r.status === 200 && r.data.user.uid === 'u:carol', 'Google now signs in to the SAME account', r.data?.user?.uid);
r = await call('/auth/link-google', { body: { idToken: await googleToken({ sub: '555' }) }, token: asha });
check(r.status === 409, 'a Google account already in use cannot be linked to a second account');

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
