import { handleDictionary } from './dictionary.js';
import { handleIsl } from './isl.js';

/**
 * Aangika's API (Cloudflare Worker): the Sarvam proxy below, and the
 * community sign dictionary (dictionary.js).
 *
 * The app sends Sarvam requests here WITHOUT a key; this adds the project's
 * key (a Worker secret, never in the website or the APK) and forwards them to
 * api.sarvam.ai. Guard rails, because anything public gets found:
 *
 * - Only the four endpoints the app uses, POST only.
 * - Only from the app's origins (ALLOWED_ORIGINS). A non-browser client can
 *   fake an Origin header, so this blocks casual reuse, not a determined
 *   abuser: the limits below and Sarvam's own spend limit are the backstop.
 * - Per-IP rate limit (RATE_PER_MIN, per Worker instance: best effort).
 * - Body size caps; chat replies capped at MAX_CHAT_TOKENS and only the
 *   app's chat models; nothing is logged or stored.
 *
 * Deploy: see server/README.md.
 */

const UPSTREAM = 'https://api.sarvam.ai';
const ROUTES = {
  '/v1/chat/completions': { maxBytes: 64 * 1024, json: true },
  '/translate': { maxBytes: 16 * 1024, json: true },
  '/text-to-speech': { maxBytes: 16 * 1024, json: true },
  '/speech-to-text': { maxBytes: 6 * 1024 * 1024, json: false },   // multipart audio
};
const CHAT_MODELS = new Set(['sarvam-105b', 'sarvam-105b-conversations']);
const MAX_CHAT_TOKENS = 800;

const DEFAULT_ORIGINS = [
  'https://localhost',          // the Android app (Capacitor, androidScheme https)
  'http://localhost',
  'capacitor://localhost',
  'http://localhost:5173',      // vite dev
  'http://localhost:4173',      // vite preview
];

// ip -> { minute, count }; lives as long as this Worker instance.
const hits = new Map();

function allowedOrigins(env) {
  const extra = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return new Set([...DEFAULT_ORIGINS, ...extra]);
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, if-none-match',
    'Access-Control-Expose-Headers': 'ETag',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

const reply = (status, message, headers = {}) =>
  new Response(JSON.stringify({ error: message }), {
    status, headers: { ...headers, 'Content-Type': 'application/json' },
  });

function rateLimited(ip, perMin, now = Date.now()) {
  const minute = Math.floor(now / 60_000);
  const h = hits.get(ip);
  if (!h || h.minute !== minute) {
    hits.set(ip, { minute, count: 1 });
    if (hits.size > 5000) hits.clear();          // bound memory
    return false;
  }
  h.count += 1;
  return h.count > perMin;
}

export async function handle(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  const origin = request.headers.get('Origin') || '';
  const okOrigin = allowedOrigins(env).has(origin);
  const headers = okOrigin ? cors(origin) : {};

  if (request.method === 'OPTIONS') {
    return okOrigin ? new Response(null, { status: 204, headers }) : reply(403, 'Origin not allowed.');
  }
  if (url.pathname === '/health') return new Response('ok', { headers });
  if (!okOrigin) return reply(403, 'Origin not allowed.');

  // Community sign dictionary (dictionary.js): its own limits and code check.
  if (url.pathname === '/dictionary' || url.pathname.startsWith('/dictionary/')) {
    return handleDictionary(request, env, headers);
  }
  // ISL Studio dictionary (isl.js).
  if (url.pathname === '/isl' || url.pathname.startsWith('/isl/')) {
    return handleIsl(request, env, headers);
  }

  const route = ROUTES[url.pathname];
  if (!route) return reply(404, 'Unknown endpoint.', headers);
  if (request.method !== 'POST') return reply(405, 'POST only.', headers);
  if (!env.SARVAM_API_KEY) return reply(503, 'Proxy has no Sarvam key configured.', headers);

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (rateLimited(ip, Number(env.RATE_PER_MIN) || 30)) {
    return reply(429, 'Too many requests; try again in a minute.', { ...headers, 'Retry-After': '60' });
  }

  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > route.maxBytes) return reply(413, 'Request too large.', headers);
  const body = await request.arrayBuffer();
  if (body.byteLength > route.maxBytes) return reply(413, 'Request too large.', headers);

  let forwardBody = body;
  if (route.json) {
    let data;
    try { data = JSON.parse(new TextDecoder().decode(body)); } catch { return reply(400, 'Bad JSON.', headers); }
    if (url.pathname === '/v1/chat/completions') {
      if (!CHAT_MODELS.has(data.model)) return reply(400, 'Model not allowed.', headers);
      data.max_tokens = Math.min(Number(data.max_tokens) || MAX_CHAT_TOKENS, MAX_CHAT_TOKENS);
      data.stream = false;
      // Reasoning off unless asked: it costs ~70x the tokens for a sign sentence.
      if (!('reasoning_effort' in data)) data.reasoning_effort = null;
    }
    forwardBody = JSON.stringify(data);
  }

  const upstreamHeaders = { 'api-subscription-key': env.SARVAM_API_KEY };
  const type = request.headers.get('Content-Type');
  if (type) upstreamHeaders['Content-Type'] = route.json ? 'application/json' : type;

  let upstream;
  try {
    upstream = await fetchImpl(UPSTREAM + url.pathname, { method: 'POST', headers: upstreamHeaders, body: forwardBody });
  } catch {
    return reply(502, 'Sarvam is unreachable.', headers);
  }
  const out = new Headers(headers);
  out.set('Content-Type', upstream.headers.get('Content-Type') || 'application/json');
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export default {
  fetch: (request, env) => handle(request, env),
};

export const _test = { hits, ROUTES, MAX_CHAT_TOKENS };
