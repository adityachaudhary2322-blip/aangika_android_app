/**
 * The Sarvam proxy (proxy/sarvam/worker.js), run in Node with a fake
 * upstream: the key is added server-side, only allowed origins / paths /
 * models pass, chat replies are capped, abuse gets 429 / 413.
 *
 *     node scripts/test-proxy.mjs
 */
import { handle, _test } from '../server/worker.js';

let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

const ENV = { SARVAM_API_KEY: 'sk-test-secret', ALLOWED_ORIGINS: 'https://aangika.example', RATE_PER_MIN: '5' };
let seen = null;
const upstream = async (url, init) => {
  seen = { url, ...init, body: init.body };
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
};
const req = (path, { origin = 'https://aangika.example', method = 'POST', body = '{}', ip = '1.1.1.1', type = 'application/json' } = {}) =>
  new Request(`https://proxy.example${path}`, {
    method, body: method === 'POST' ? body : undefined,
    headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': type, 'CF-Connecting-IP': ip },
  });

console.log('='.repeat(74) + '\n  Sarvam proxy\n' + '='.repeat(74));

let r = await handle(req('/text-to-speech', { body: '{"text":"hi"}' }), ENV, upstream);
check(r.status === 200, 'allowed origin + path is forwarded', `HTTP ${r.status}`);
check(seen?.url === 'https://api.sarvam.ai/text-to-speech', 'forwarded to api.sarvam.ai with the same path');
check(seen?.headers['api-subscription-key'] === 'sk-test-secret', 'the key is added by the proxy');
check(r.headers.get('Access-Control-Allow-Origin') === 'https://aangika.example', 'CORS echoes the allowed origin only');
check(!(await r.text()).includes('sk-test'), 'the key never appears in the reply');

r = await handle(req('/translate', { origin: 'https://localhost', ip: '2.2.2.2' }), ENV, upstream);
check(r.status === 200, 'the Android app origin (https://localhost) is allowed');

seen = null;
r = await handle(req('/translate', { origin: 'https://evil.example' }), ENV, upstream);
check(r.status === 403 && !seen, 'another origin is refused and nothing is forwarded');
r = await handle(req('/translate', { origin: '' }), ENV, upstream);
check(r.status === 403, 'no origin (curl, scripts) is refused');

r = await handle(req('/v1/models', { ip: '3.3.3.3' }), ENV, upstream);
check(r.status === 404, 'endpoints the app does not use are refused');
r = await handle(req('/translate', { method: 'GET', ip: '3.3.3.4' }), ENV, upstream);
check(r.status === 405, 'GET is refused');
r = await handle(req('/translate', { method: 'OPTIONS' }), ENV, upstream);
check(r.status === 204 && r.headers.get('Access-Control-Allow-Methods') === 'GET, POST, OPTIONS', 'CORS preflight answered');

r = await handle(req('/v1/chat/completions', { ip: '4.4.4.4', body: JSON.stringify({ model: 'sarvam-105b', messages: [], max_tokens: 99999 }) }), ENV, upstream);
check(r.status === 200 && JSON.parse(seen.body).max_tokens === _test.MAX_CHAT_TOKENS, 'chat max_tokens capped', `sent ${JSON.parse(seen.body).max_tokens}`);
r = await handle(req('/v1/chat/completions', { ip: '4.4.4.5', body: JSON.stringify({ model: 'some-big-model', messages: [] }) }), ENV, upstream);
check(r.status === 400, 'chat models outside the app\'s list are refused');
r = await handle(req('/translate', { ip: '4.4.4.6', body: 'not json' }), ENV, upstream);
check(r.status === 400, 'bad JSON is refused');
r = await handle(req('/translate', { ip: '4.4.4.7', body: 'x'.repeat(20_000) }), ENV, upstream);
check(r.status === 413, 'oversized requests are refused');

_test.hits.clear();
const codes = [];
for (let i = 0; i < 7; i++) codes.push((await handle(req('/translate', { ip: '9.9.9.9' }), ENV, upstream)).status);
check(codes.slice(0, 5).every((c) => c === 200) && codes.slice(5).every((c) => c === 429), 'per-IP rate limit (5/min here)', codes.join(','));

r = await handle(req('/translate', { ip: '5.5.5.5' }), { ...ENV, SARVAM_API_KEY: '' }, upstream);
check(r.status === 503, 'no key configured: clear 503, not a silent failure');
const down = async () => { throw new Error('network'); };
r = await handle(req('/translate', { ip: '5.5.5.6' }), ENV, down);
check(r.status === 502, 'Sarvam unreachable: 502');

const form = new FormData();
form.append('file', new Blob([new Uint8Array(1000)]), 'a.wav');
form.append('model', 'saaras:v3');
const stt = new Request('https://proxy.example/speech-to-text', { method: 'POST', body: form, headers: { Origin: 'https://aangika.example', 'CF-Connecting-IP': '6.6.6.6' } });
r = await handle(stt, ENV, upstream);
check(r.status === 200 && /multipart\/form-data/.test(seen.headers['Content-Type']), 'speech-to-text audio (multipart) is passed through');

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
