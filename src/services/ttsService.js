/**
 * Speech output, with the mobile autoplay problem solved properly.
 *
 * THE PROBLEM: iOS Safari and Chrome on Android start every page with a
 * suspended AudioContext and refuse `audio.play()` until the user has physically
 * interacted with the page. An app that only ever plays audio from a timer or a
 * network callback is silent forever, with no error in the console. The failure
 * looks exactly like "TTS is broken".
 *
 * THE FIX: arm one-shot listeners on the first touch/click/keydown, and in that
 * handler -- while the browser still counts us as inside a user gesture --
 * resume the AudioContext and play a zero-length buffer through a silent
 * <audio> element. That marks both channels as unlocked for the rest of the
 * page's life.
 *
 * Voice ladder:
 *   1. Sarvam Bulbul  cloud, proper Indic voices, needs a key and a network
 *   2. speechSynthesis on-device; Indic coverage is thin and device-dependent
 *   3. nothing        reported honestly rather than failing silently
 */

import { getLanguage, sarvamTtsPayload } from '../config/languages.js';
import { hasSarvam, sarvamFetch } from './sarvamClient.js';

const SARVAM_TTS_PATH = '/text-to-speech';

const state = {
  unlocked: false,
  audioContext: null,
  primer: null,
  listenersArmed: false,
  lastError: null,
};

// ── Audio unlock ─────────────────────────────────────────────────────────────

function getAudioContext() {
  if (state.audioContext) return state.audioContext;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  state.audioContext = new Ctor();
  return state.audioContext;
}

/**
 * Run inside a real user gesture. Resumes the AudioContext and primes an
 * <audio> element so later programmatic playback is permitted.
 */
export async function unlockAudio() {
  try {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') await ctx.resume();

    if (ctx) {
      // A one-sample silent buffer is enough to mark the context as used.
      const buffer = ctx.createBuffer(1, 1, 22050);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.start(0);
    }

    // Safari gates HTMLAudioElement separately from AudioContext, so prime one
    // of those too and keep it around to reuse.
    if (!state.primer) {
      const el = new Audio();
      el.setAttribute('playsinline', '');
      el.muted = true;
      el.src =
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
      await el.play().catch(() => {});
      el.pause();
      state.primer = el;
    }

    state.unlocked = true;
    state.lastError = null;
    return true;
  } catch (err) {
    state.lastError = err?.message || String(err);
    return false;
  }
}

/**
 * Arm one-shot unlock listeners. Safe to call repeatedly; call it once at
 * start-up and forget about it.
 */
export function armAudioUnlock() {
  if (state.listenersArmed || typeof window === 'undefined') return;
  state.listenersArmed = true;

  const events = ['touchstart', 'touchend', 'pointerdown', 'click', 'keydown'];
  const handler = async () => {
    const ok = await unlockAudio();
    if (ok) events.forEach((e) => window.removeEventListener(e, handler, true));
  };
  // Capture phase, so a handler that stops propagation cannot rob us of the
  // one gesture we need.
  events.forEach((e) =>
    window.addEventListener(e, handler, { capture: true, passive: true })
  );
}

export function isUnlocked() {
  return state.unlocked;
}

// ── Voice selection ──────────────────────────────────────────────────────────

/** speechSynthesis populates voices asynchronously on most engines. */
function loadVoices(timeoutMs = 1000) {
  return new Promise((resolve) => {
    if (typeof speechSynthesis === 'undefined') return resolve([]);
    const existing = speechSynthesis.getVoices();
    if (existing.length) return resolve(existing);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(speechSynthesis.getVoices());
    };
    speechSynthesis.addEventListener('voiceschanged', finish, { once: true });
    setTimeout(finish, timeoutMs);
  });
}

/**
 * Best available on-device voice for a language tag.
 *
 * Falls back down the specificity ladder: exact tag ("ta-IN"), then the base
 * language in any region ("ta-*"), then an Indian-English voice, which at least
 * pronounces Indian proper nouns closer to right than en-US does.
 */
export async function pickVoice(code) {
  const voices = await loadVoices();
  if (!voices.length) return null;

  const base = code.split('-')[0];
  return (
    voices.find((v) => v.lang?.replace('_', '-') === code) ||
    voices.find((v) => v.lang?.replace('_', '-').startsWith(base + '-')) ||
    voices.find((v) => v.lang?.replace('_', '-') === 'en-IN') ||
    null
  );
}

/** Which languages this device can actually speak, for an honest UI. */
export async function availableLanguages(codes) {
  const out = {};
  for (const code of codes) {
    // eslint-disable-next-line no-await-in-loop
    const voice = await pickVoice(code);
    out[code] = voice ? { name: voice.name, lang: voice.lang } : null;
  }
  return out;
}

// ── Sarvam ───────────────────────────────────────────────────────────────────

// Own key or the hosted proxy (sarvamClient.js).
export async function synthesizeSarvam(text, code) {
  if (!hasSarvam()) throw new Error('No Sarvam key set.');

  const response = await sarvamFetch(SARVAM_TTS_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sarvamTtsPayload(text, code)),
  });
  if (!response.ok) throw new Error('Sarvam TTS: HTTP ' + response.status);

  const body = await response.json();
  const base64 = body?.audios?.[0];
  if (!base64) throw new Error('Sarvam TTS returned no audio.');

  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: 'audio/wav' });
}

// ── Public speak ─────────────────────────────────────────────────────────────

let currentAudio = null;

export function stop() {
  try {
    currentAudio?.pause();
    currentAudio = null;
  } catch { /* nothing playing */ }
  try {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  } catch { /* nothing queued */ }
}

/**
 * Speak `text` in `code`.
 *
 * Always resolves; never throws. The result names the path actually taken so
 * the UI can tell the user "used the device voice" instead of implying the
 * cloud voice worked.
 *
 * @returns {{source:'sarvam'|'browser'|'none', voice?:string, warning?:string}}
 */
export async function speak(text, code) {
  if (!text || !text.trim()) return { source: 'none', warning: 'Nothing to speak.' };

  const language = getLanguage(code);
  stop();

  // Playback needs the unlock; if the caller reached here from a click we are
  // still inside the gesture, so this succeeds.
  if (!state.unlocked) await unlockAudio();

  // 1. Sarvam.
  try {
    const blob = await synthesizeSarvam(text, language.code);
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.setAttribute('playsinline', '');
    audio.onended = () => URL.revokeObjectURL(url);
    currentAudio = audio;
    await audio.play();
    return { source: 'sarvam' };
  } catch (sarvamError) {
    state.lastError = sarvamError.message;

    // 2. On-device voice.
    if (typeof speechSynthesis === 'undefined') {
      return { source: 'none', warning: sarvamError.message };
    }

    const voice = await pickVoice(language.code);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = language.code;
    if (voice) utterance.voice = voice;
    utterance.rate = 0.95;   // Indic scripts read better slightly slowed

    speechSynthesis.speak(utterance);

    if (!voice) {
      return {
        source: 'browser',
        warning:
          `No ${language.name} voice on this device — the text may be ` +
          'mispronounced by the default voice.',
      };
    }
    // An en-IN voice reading Devanagari is a genuine mismatch worth reporting.
    const mismatched = !voice.lang?.replace('_', '-').startsWith(
      language.code.split('-')[0]
    );
    return {
      source: 'browser',
      voice: voice.name,
      warning: mismatched
        ? `Using the ${voice.lang} voice; no ${language.name} voice installed.`
        : undefined,
    };
  }
}

export default {
  armAudioUnlock, unlockAudio, isUnlocked,
  pickVoice, availableLanguages, speak, stop, synthesizeSarvam,
};
