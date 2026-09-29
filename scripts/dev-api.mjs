/**
 * Run Aangika's API Worker (server/worker.js) locally, without Cloudflare:
 * the same code, with in-memory storage for the community dictionary.
 * For development and the browser tests.
 *
 *     $env:DEV_CODE = 'your-code'; node scripts/dev-api.mjs      # PowerShell
 *     then build the app with VITE_API_URL=http://localhost:8787
 *
 * Env: PORT (8787), DEV_CODE (developer code; required to publish),
 *      SARVAM_API_KEY (optional, to proxy Sarvam), ALLOWED_ORIGINS (extra).
 */
import http from 'node:http';
import { handle } from '../server/worker.js';

const PORT = Number(process.env.PORT || 8787);
const kv = new Map();
const env = {
  DICT: { get: async (k) => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, v); } },
  DEV_CODE: process.env.DEV_CODE || '',
  SARVAM_API_KEY: process.env.SARVAM_API_KEY || '',
  ALLOWED_ORIGINS: ['http://localhost:4175', process.env.ALLOWED_ORIGINS].filter(Boolean).join(','),
  RATE_PER_MIN: '600',
};

http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const headers = { ...req.headers, 'cf-connecting-ip': req.socket.remoteAddress || 'local' };
  const request = new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
  });
  const out = await handle(request, env);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
}).listen(PORT, () => {
  console.log(`[dev-api] http://localhost:${PORT}  (dictionary in memory; publishing ${env.DEV_CODE ? 'on' : 'OFF: set DEV_CODE'})`);
});
