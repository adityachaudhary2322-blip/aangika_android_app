/**
 * Tag list -> sentence -> speech, with an honest offline ladder.
 *
 *   1. Sarvam or Gemini   real sentence + translation (needs that key)
 *   2. rule-based         capitalised concatenation, English only, always available
 *
 * There is no in-browser LLM here. The Python side measured Qwen2.5-0.5B at
 * ~2.1 GB resident, which is not something to load into a phone browser tab,
 * so offline degrades to the deterministic join and the UI says so rather than
 * dressing it up as a translation.
 */

import { buildGeminiRequest, ruleBasedJoin } from './qwenRules.js';
import { buildAslRequest } from './aslRules.js';

/** The prompt builder for the sign language being read (ISL or ASL). */
const requestFor = (signLanguage) => (signLanguage === 'ASL' ? buildAslRequest : buildGeminiRequest);
import { getLanguage, sarvamTtsPayload } from '../config/languages.js';

import { hasSarvam, sarvamFetch } from './sarvamClient.js';

const GEMINI_ENDPOINT =
  'https://generativelanguage.googleapis.com/v1beta/models';
// Sarvam paths: sent with the user's own key, or through the hosted proxy.
const SARVAM_TTS_PATH = '/text-to-speech';
const SARVAM_STT_PATH = '/speech-to-text';

// Measured against this project's key on 2026-09-07: gemini-3.6-flash works;
// 2.5-flash, 2.0-flash and 1.5-flash all return 404 "no longer available to
// new users". The 404s stay at the tail -- they reject in ~200 ms and keep
// older keys working.
const GEMINI_MODELS = [
  'gemini-3.6-flash',
  'gemini-flash-latest',
  'gemini-2.5-flash',
  'gemini-2.0-flash',
];

const STT_MODELS = ['saaras:v3', 'saaras:v2.5', 'saarika:v2.5', 'saarika:v2'];

// Sarvam's chat models as of 2026-09 (sarvam-m is retired and now rejected).
// 30b first: it is the faster one, and a sign sentence is a short job.
const SARVAM_CHAT_PATH = '/v1/chat/completions';
const SARVAM_CHAT_MODELS = ['sarvam-30b', 'sarvam-105b'];

/**
 * The user's own keys (localStorage, never in the bundle). Whether Sarvam can
 * be used at all is hasSarvam(): a hosted proxy works without a key.
 */
export function getKeys() {
  try {
    return {
      gemini: localStorage.getItem('isl.geminiKey') || '',
      sarvam: localStorage.getItem('isl.sarvamKey') || '',
    };
  } catch {
    return { gemini: '', sarvam: '' };
  }
}

export function setKey(which, value) {
  try {
    const name = which === 'gemini' ? 'isl.geminiKey' : 'isl.sarvamKey';
    localStorage.setItem(name, String(value).trim());
  } catch {
    // Private mode: keys simply do not persist.
  }
}

export function isOnline() {
  return typeof navigator !== 'undefined' && navigator.onLine;
}

function extractJson(raw) {
  const text = String(raw || '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    throw new Error('no JSON object in reply');
  }
}

/**
 * Reconstruct a sentence from sign tags. NEVER throws: any failure degrades to
 * the rule-based join, and the result says which path produced it.
 */
export async function reconstruct(tags, languageCode, { glossary = [], signLanguage = 'ISL' } = {}) {
  const started = performance.now();
  const language = getLanguage(languageCode);
  const fallback = (error) => ({
    english: ruleBasedJoin(tags),
    translated: '',
    source: 'fallback',
    model: null,
    language,
    latencyMs: Math.round(performance.now() - started),
    error,
  });

  if (!tags || tags.length === 0) return fallback('no tags supplied');

  const { gemini } = getKeys();
  if (!gemini) return fallback('No Gemini key set - open Settings to add one.');
  if (!isOnline()) return fallback('Device is offline.');

  const { systemInstruction, contents } = requestFor(signLanguage)(tags, language, glossary);
  const errors = [];

  for (const model of GEMINI_MODELS) {
    try {
      const response = await fetch(
        GEMINI_ENDPOINT + '/' + model + ':generateContent',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': gemini,
          },
          body: JSON.stringify({
            system_instruction: { parts: [{ text: systemInstruction }] },
            contents,
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.2,
            },
          }),
        }
      );

      if (!response.ok) {
        errors.push(model + ': HTTP ' + response.status);
        continue;
      }

      const body = await response.json();
      const parts = body && body.candidates && body.candidates[0]
        && body.candidates[0].content && body.candidates[0].content.parts;
      const reply = (parts && parts[0] && parts[0].text) || '';
      const parsed = extractJson(reply);
      const english = String(parsed.english || '').trim();
      if (!english) {
        errors.push(model + ": reply had no 'english' field");
        continue;
      }

      return {
        english,
        translated: String(parsed.translated || '').trim(),
        source: 'gemini',
        model,
        language,
        latencyMs: Math.round(performance.now() - started),
      };
    } catch (err) {
      errors.push(model + ': ' + err.message);
    }
  }

  return fallback(errors.join(' | '));
}

/** Drop a reasoning model's <think> block, if it put one in the content. */
function stripThinking(text) {
  return String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

/**
 * One Sarvam chat completion. `messages` is OpenAI-shaped
 * ([{role, content}]). Returns { text, model }; throws when every model fails.
 */
export async function sarvamChat(messages, { temperature = 0.2, maxTokens = 600 } = {}) {
  if (!hasSarvam()) throw new Error('No Sarvam key set.');
  if (!isOnline()) throw new Error('Device is offline.');

  const errors = [];
  for (const model of SARVAM_CHAT_MODELS) {
    try {
      const response = await sarvamFetch(SARVAM_CHAT_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, temperature, max_tokens: maxTokens }),
      });
      if (!response.ok) { errors.push(`${model}: HTTP ${response.status}`); continue; }
      const body = await response.json();
      const text = stripThinking(body?.choices?.[0]?.message?.content);
      if (text) return { text, model };
      errors.push(`${model}: empty reply`);
    } catch (err) {
      errors.push(`${model}: ${err.message}`);
    }
  }
  throw new Error('Sarvam chat failed - ' + errors.join(' | '));
}

/**
 * Sign tags -> sentence with Sarvam's chat model, using the same ISL grammar
 * prompt and few-shot examples as the Gemini path. Same result shape as
 * reconstruct(); NEVER throws (source 'fallback' on failure).
 */
export async function sarvamReconstruct(tags, languageCode, { glossary = [], signLanguage = 'ISL' } = {}) {
  const started = performance.now();
  const language = getLanguage(languageCode);
  const fail = (error) => ({
    english: ruleBasedJoin(tags), translated: '', source: 'fallback', model: null,
    language, latencyMs: Math.round(performance.now() - started), error,
  });
  if (!tags || tags.length === 0) return fail('no tags supplied');

  const { systemInstruction, contents } = requestFor(signLanguage)(tags, language, glossary);
  const messages = [
    { role: 'system', content: systemInstruction },
    ...contents.map((c) => ({
      role: c.role === 'model' ? 'assistant' : 'user',
      content: c.parts.map((p) => p.text).join(''),
    })),
  ];
  try {
    const { text, model } = await sarvamChat(messages);
    const parsed = extractJson(text);
    const english = String(parsed.english || '').trim();
    if (!english) return fail(`${model}: reply had no 'english' field`);
    return {
      english,
      translated: String(parsed.translated || '').trim(),
      source: 'sarvam',
      model,
      language,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (err) {
    return fail(err.message);
  }
}

/** Synthesise with Sarvam; returns a Blob. Throws on failure. */
export async function synthesize(text, languageCode) {
  if (!hasSarvam()) throw new Error('No Sarvam key set.');
  if (!text || !text.trim()) throw new Error('Nothing to speak.');

  const response = await sarvamFetch(SARVAM_TTS_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sarvamTtsPayload(text, languageCode)),
  });

  if (!response.ok) throw new Error('Sarvam TTS: HTTP ' + response.status);

  const body = await response.json();
  const base64 = body && body.audios && body.audios[0];
  if (!base64) throw new Error('Sarvam TTS returned no audio.');

  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'audio/wav' });
}

/**
 * Speak text: Sarvam when reachable, the browser voice otherwise.
 * Reports which path was used so the UI can be honest about it.
 */
export async function speak(text, languageCode) {
  if (!text || !text.trim()) return { source: 'none' };

  try {
    const blob = await synthesize(text, languageCode);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
    return { source: 'sarvam' };
  } catch (err) {
    if (typeof speechSynthesis === 'undefined') {
      return { source: 'none', error: err.message };
    }
    // Indic voice coverage in browsers is thin and device-dependent, so report
    // whether a matching voice actually existed instead of silently mispronouncing.
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = getLanguage(languageCode).code;
    const voices = speechSynthesis.getVoices();
    const base = utterance.lang.split('-')[0];
    const match =
      voices.find((v) => v.lang === utterance.lang) ||
      voices.find((v) => v.lang && v.lang.startsWith(base));
    if (match) utterance.voice = match;
    speechSynthesis.cancel();
    speechSynthesis.speak(utterance);
    return { source: 'browser', voiceFound: Boolean(match), error: err.message };
  }
}

const SARVAM_TRANSLATE_PATH = '/translate';
/** Mayura first; sarvam-translate:v1 covers anything Mayura rejects. */
const TRANSLATE_MODELS = ['mayura:v1', 'sarvam-translate:v1'];
const TRANSLATE_CHAR_LIMIT = 1000;

/**
 * English -> target language with Sarvam /translate (own key or the hosted
 * proxy). Throws on failure so callers can queue a retry.
 */
export async function sarvamTranslate(
  text, targetCode, { mode = 'modern-colloquial', source = 'en-IN' } = {}
) {
  if (!hasSarvam()) throw new Error('No Sarvam key set.');
  const input = String(text || '').trim();
  if (!input) return '';
  if (targetCode === source) return input;
  if (input.length > TRANSLATE_CHAR_LIMIT) throw new Error('Text too long to translate.');

  const errors = [];
  for (const model of TRANSLATE_MODELS) {
    try {
      const response = await sarvamFetch(SARVAM_TRANSLATE_PATH, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input,
          // 'auto' lets Mayura detect the language, for transcripts.
          source_language_code: source,
          target_language_code: targetCode,
          model,
          ...(model === 'mayura:v1' ? { mode, numerals_format: 'international' } : {}),
        }),
      });
      if (!response.ok) { errors.push(`${model}: HTTP ${response.status}`); continue; }
      const body = await response.json();
      const out = String(body?.translated_text || '').trim();
      if (out) return out;
      errors.push(`${model}: empty reply`);
    } catch (err) {
      errors.push(`${model}: ${err.message}`);
    }
  }
  throw new Error('Sarvam translate failed - ' + errors.join(' | '));
}

/** Transcribe a recorded Blob with Sarvam STT. Throws on failure. */
export async function transcribe(blob, languageCode = 'unknown') {
  if (!hasSarvam()) throw new Error('No Sarvam key set.');

  const errors = [];
  for (const model of STT_MODELS) {
    const form = new FormData();
    form.append('file', blob, 'input.wav');
    form.append('model', model);
    form.append('language_code', languageCode);

    try {
      const response = await sarvamFetch(SARVAM_STT_PATH, { method: 'POST', body: form });
      if (response.ok) {
        const body = await response.json();
        return (body.transcript || '').trim();
      }
      errors.push(model + ': HTTP ' + response.status);
    } catch (err) {
      errors.push(model + ': ' + err.message);
    }
  }
  throw new Error('All STT models failed - ' + errors.join(' | '));
}

export { hasSarvam };

export default {
  reconstruct, sarvamReconstruct, sarvamChat, synthesize, speak, transcribe,
  sarvamTranslate, getKeys, setKey, isOnline, hasSarvam,
};
