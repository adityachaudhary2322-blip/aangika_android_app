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
import { createWriteStream, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import AdmZip from 'adm-zip';
import * as tar from 'tar';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'models', 'speech');
const TMP = join(ROOT, 'node_modules', '.cache', 'speech-models');

export const SPEECH_MODELS = [
  { id: 'hi', file: 'vosk-hi.tar.gz', url: 'https://alphacephei.com/vosk/models/vosk-model-small-hi-0.22.zip' },
  { id: 'en-in', file: 'vosk-en-in.tar.gz', url: 'https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip' },
];

async function fetchOne(m) {
  const out = join(OUT, m.file);
  if (existsSync(out) && statSync(out).size > 1_000_000) {
    console.log(`[speech] ${m.file} present (${(statSync(out).size / 2 ** 20).toFixed(1)} MB)`);
    return;
  }
  mkdirSync(TMP, { recursive: true });
  const zip = join(TMP, `${m.id}.zip`);
  console.log(`[speech] downloading ${m.url}`);
  const res = await fetch(m.url);
  if (!res.ok) throw new Error(`${m.url}: HTTP ${res.status}`);
  await pipeline(Readable.fromWeb(res.body), createWriteStream(zip));

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
