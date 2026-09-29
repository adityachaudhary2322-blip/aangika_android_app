/**
 * Sentence latency, offline rules vs online engines, on fixed gloss inputs.
 *
 *     node scripts/measure-latency.mjs
 *
 * Online needs keys: GEMINI_API_KEY / SARVAM_API_KEY in the environment or in
 * the repo's gitignored .env. Missing keys are reported, not faked. Results
 * go to stdout; nothing is sent anywhere except the model providers.
 */
import { readFileSync, existsSync } from 'node:fs';

const env = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const keys = {
  'isl.geminiKey': process.env.GEMINI_API_KEY || env.GEMINI_API_KEY || '',
  'isl.sarvamKey': process.env.SARVAM_API_KEY || env.SARVAM_API_KEY || '',
};
const mem = new Map(Object.entries(keys).filter(([, v]) => v));
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
};
Object.defineProperty(globalThis.navigator, 'onLine', { value: true, configurable: true });

const { translate } = await import('../src/services/translationService.js');

const CASES = [
  { lang: 'ASL', tags: ['MOM', 'WHERE'] },
  { lang: 'ASL', tags: ['YESTERDAY', 'STORE', 'GO'] },
  { lang: 'ASL', tags: ['HELLO', 'MY', 'NAME', 'FS-ADITYA'] },
  { lang: 'ISL', tags: ['MOTHER', 'HOSPITAL', 'YESTERDAY', 'GO'] },
  { lang: 'ISL', tags: ['DOCTOR', 'HELP', 'NEED'] },
];

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };

for (const [mode, needs] of [['offline', null], ['online', 'isl.geminiKey'], ['sarvam', 'isl.sarvamKey']]) {
  if (needs && !mem.has(needs)) {
    console.log(`\n[${mode}] skipped: no ${needs === 'isl.geminiKey' ? 'GEMINI_API_KEY' : 'SARVAM_API_KEY'} in .env / environment`);
    continue;
  }
  console.log(`\n[${mode}]`);
  const times = [];
  for (const c of CASES) {
    const t0 = performance.now();
    // eslint-disable-next-line no-await-in-loop
    const r = await translate(c.tags, 'hi-IN', { mode, signLanguage: c.lang });
    const ms = performance.now() - t0;
    times.push(ms);
    console.log(`  ${c.lang} ${c.tags.join(' ').padEnd(32)} ${String(Math.round(ms)).padStart(6)} ms  ${r.engine}${r.degraded ? ' (FELL BACK: ' + (r.note || '').slice(0, 80) + ')' : ''}`);
    console.log(`      en: ${r.english}${r.translated ? `\n      hi: ${r.translated}` : ''}`);
  }
  console.log(`  median ${Math.round(median(times))} ms, max ${Math.round(Math.max(...times))} ms`);
}
