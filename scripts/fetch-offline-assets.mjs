/**
 * Stage MediaPipe's runtime and models inside public/mediapipe/ so the Android
 * app (Capacitor) bundles them and recognises signs offline from first launch.
 *
 *     node scripts/fetch-offline-assets.mjs
 *
 * - wasm: copied from node_modules/@mediapipe/tasks-vision/wasm (the version
 *   that matches the installed JS package)
 * - .task models: downloaded from the pinned URLs in src/services/landmarker.js
 *   and verified by size; skipped when already present.
 * public/mediapipe/ is git-ignored: these are build inputs, not source.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = 'public/mediapipe';
const WASM_SRC = 'node_modules/@mediapipe/tasks-vision/wasm';
mkdirSync(join(OUT, 'wasm'), { recursive: true });
mkdirSync(join(OUT, 'models'), { recursive: true });

let wasmBytes = 0;
for (const f of readdirSync(WASM_SRC)) {
  copyFileSync(join(WASM_SRC, f), join(OUT, 'wasm', f));
  wasmBytes += statSync(join(WASM_SRC, f)).size;
}
console.log(`[offline] wasm: ${readdirSync(WASM_SRC).length} files, ${(wasmBytes / 2 ** 20).toFixed(1)} MB`);

const src = readFileSync('src/services/landmarker.js', 'utf8');
const urls = [...src.matchAll(/const (HAND|POSE|FACE)_MODEL\s*=\s*'([^']+)'/g)].map((m) => m[2]);
if (urls.length !== 3) throw new Error(`expected 3 pinned model URLs in landmarker.js, found ${urls.length}`);
for (const url of urls) {
  if (url.includes('/latest/')) throw new Error(`${url} is not pinned`);
  const dest = join(OUT, 'models', url.split('/').pop());
  if (existsSync(dest) && statSync(dest).size > 0) {
    console.log(`[offline] ${dest} present (${(statSync(dest).size / 2 ** 20).toFixed(1)} MB)`);
    continue;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const expected = Number(res.headers.get('content-length'));
  if (expected && buf.length !== expected) throw new Error(`${url}: got ${buf.length} of ${expected} bytes`);
  writeFileSync(dest, buf);
  console.log(`[offline] ${dest} downloaded (${(buf.length / 2 ** 20).toFixed(1)} MB)`);
}
