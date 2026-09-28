/**
 * Fill every app language for a "sentence" sign, so it speaks offline later.
 *
 * Online: each language in config/languages.js that the user has not written
 * themselves is translated from English with Sarvam and stored on the sign.
 * Offline, or without a key: the missing languages are recorded in
 * output.pendingLangs and filled by fillPendingTranslations() the next time
 * the app is online. Text the user typed is never overwritten.
 */

import { LANGUAGES } from '../config/languages.js';
import { sarvamTranslate, getKeys, isOnline } from './translator.js';
import { listSigns, saveSign, getSign } from './customSigns.js';

const langCodes = () => LANGUAGES.map((l) => l.code).filter((c) => c !== 'en-IN');

/** Languages a sign still lacks. `edited` lists codes the user wrote by hand. */
export function missingLanguages(sign) {
  const texts = sign.output?.texts || {};
  return langCodes().filter((c) => !String(texts[c] || '').trim());
}

/**
 * Translate the missing languages of one sentence sign and save it.
 * -> {filled: [codes], pending: [codes], error?}
 */
export async function fillSentenceLanguages(signOrId) {
  const sign = typeof signOrId === 'string' ? getSign(signOrId) : signOrId;
  if (!sign || sign.output?.type !== 'sentence') return { filled: [], pending: [] };
  const missing = missingLanguages(sign);
  if (!missing.length) {
    if (sign.output.pendingLangs?.length) {
      await saveSign({ id: sign.id, output: { ...sign.output, pendingLangs: [] } });
    }
    return { filled: [], pending: [] };
  }
  if (!isOnline() || !getKeys().sarvam) {
    await saveSign({ id: sign.id, output: { ...sign.output, pendingLangs: missing } });
    return {
      filled: [], pending: missing,
      error: !isOnline() ? 'offline' : 'no Sarvam key',
    };
  }

  const texts = { ...(sign.output.texts || {}) };
  const filled = [];
  const pending = [];
  for (const code of missing) {
    try {
      // eslint-disable-next-line no-await-in-loop
      texts[code] = await sarvamTranslate(sign.output.text_en, code);
      filled.push(code);
    } catch {
      pending.push(code);
    }
  }
  const auto = new Set([...(sign.output.autoLangs || []), ...filled]);
  await saveSign({
    id: sign.id,
    output: { ...sign.output, texts, pendingLangs: pending, autoLangs: [...auto] },
  });
  return { filled, pending };
}

/** Finish every sentence sign that was saved offline. Safe to call repeatedly. */
export async function fillPendingTranslations() {
  if (!isOnline() || !getKeys().sarvam) return { signs: 0 };
  let signs = 0;
  for (const s of listSigns()) {
    if (s.output?.type === 'sentence' && missingLanguages(s).length) {
      // eslint-disable-next-line no-await-in-loop
      await fillSentenceLanguages(s);
      signs += 1;
    }
  }
  return { signs };
}

export default { fillSentenceLanguages, fillPendingTranslations, missingLanguages };
