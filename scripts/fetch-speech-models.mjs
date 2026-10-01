/**
 * Offline speech recognition models (Vosk, Apache 2.0), fetched at BUILD time
 * into public/models/speech/ so the website serves them and phones can
 * download them once for offline use. Not committed to git.
 *
 *     node scripts/fetch-speech-models.mjs          # skips files already there
 *     SKIP_SPEECH_MODELS=1 npm run build            # build without them
 *
 * Vosk publishes zips; vosk-browser loads a .tar.gz of the model folder, so
 * each zip is repacked (contents unchanged).
 */
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';
import * as tar from 'tar';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'models', 'speech');
const TMP = join(ROOT, 'node_modules', '.cache', 'speech-models');

// Already repacked .tar.gz files on this repository's release (fast, no
// repacking); alphacephei.com's zips (slow: ~0.3 MB/s seen) only as a fallback.
const PREBUILT = 'https://github.com/adityachaudhary2322-blip/aangika_pwa02/releases/download/speech-models-v1';
export const SPEECH_MODELS = [
  { id: 'hi', file: 'vosk-hi.tar.gz', url: 'https://alphacephei.com/vosk/models/vosk-model-small-hi-0.22.zip' },
  { id: 'en-in', file: 'vosk-en-in.tar.gz', url: 'https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip' },
];
// A stalled download used to hang the whole deploy (no timeout). Every
// download now gives up after this long; the site then deploys without
// offline speech rather than not at all.
const PREBUILT_TIMEOUT_MS = 120_000;
const ZIP_TIMEOUT_MS = 300_000;

/** fetch to a file, aborted after `ms`. */
async function download(url, file, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timed out after ${ms / 1000} s`)), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    await pipeline(Readable.fromWeb(res.body), createWriteStream(file), { signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchOne(m) {
  const out = join(OUT, m.file);
  if (existsSync(out) && statSync(out).size > 1_000_000) {
    console.log(`[speech] ${m.file} present (${(statSync(out).size / 2 ** 20).toFixed(1)} MB)`);
    return;
  }
  mkdirSync(OUT, { recursive: true });
  // 1. The prebuilt .tar.gz (fast).
  try {
    const started = Date.now();
    const part = `${out}.part`;
    await download(`${PREBUILT}/${m.file}`, part, PREBUILT_TIMEOUT_MS);
    if (statSync(part).size < 1_000_000) throw new Error('file too small');
    renameSync(part, out);
    console.log(`[speech] ${m.file} ready from the release (${(statSync(out).size / 2 ** 20).toFixed(1)} MB, ${((Date.now() - started) / 1000).toFixed(1)} s)`);
    return;
  } catch (err) {
    console.warn(`[speech] prebuilt ${m.file} unavailable (${err.message}); trying alphacephei.com`);
  }

  // 2. The original zip, repacked.
  mkdirSync(TMP, { recursive: true });
  const zip = join(TMP, `${m.id}.zip`);
  console.log(`[speech] downloading ${m.url}`);
  await download(m.url, zip, ZIP_TIMEOUT_MS);

  const dir = join(TMP, m.id);
  rmSync(dir, { recursive: true, force: true });
  new AdmZip(zip).extractAllTo(dir, true);
  const top = new AdmZip(zip).getEntries()[0].entryName.split('/')[0];   // vosk-model-small-hi-0.22
  mkdirSync(OUT, { recursive: true });
  await tar.c({ gzip: true, file: out, cwd: dir, portable: true }, [top]);
  console.log(`[speech] ${m.file} ready (${(statSync(out).size / 2 ** 20).toFixed(1)} MB)`);
}

// The Android app (a Capacitor project) downloads them from the website on
// demand instead of carrying ~80 MB in the APK.
const isAndroidProject = existsSync(join(ROOT, 'capacitor.config.json')) && !process.env.BUNDLE_SPEECH_MODELS;

if (process.env.SKIP_SPEECH_MODELS || isAndroidProject) {
  console.log(`[speech] offline speech models not fetched (${isAndroidProject ? 'Android build: the app downloads them on demand' : 'SKIP_SPEECH_MODELS set'})`);
} else {
  for (const m of SPEECH_MODELS) {
    try {
      await fetchOne(m);
    } catch (err) {
      // A failed download must not fail the whole build: the app works
      // without offline speech and says so.
      console.warn(`[speech] ${m.file} NOT available: ${err.message}`);
    }
  }
}
