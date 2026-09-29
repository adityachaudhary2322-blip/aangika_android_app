/**
 * Phrases: a sequence of signs the user performs continuously, given one
 * meaning for the whole sentence.
 *
 *   { id, tokens: ['HELLO', 'NAME', 'ADITYA'],
 *     text_en: "Hi, I'm Aditya",
 *     texts: { 'hi-IN': 'नमस्ते, मैं आदित्य हूँ' },   // filled lazily
 *     createdAt, updatedAt }
 *
 * Matching runs over the stream of recognised tokens (see tokenStream.js).
 * A phrase fires when its tokens appear IN ORDER among the recent tokens and
 * its last token is the newest one, so it fires once, on completion, rather
 * than on every frame after. Stray tokens in between are tolerated: the
 * recogniser often emits a wrong word between two right ones.
 *
 * Phrases are small, so they live in localStorage and survive a reload.
 */

import { sarvamTranslate, hasSarvam, isOnline } from './translator.js';

const KEY = 'isl.phrases';
const listeners = new Set();
let cache = load();
let pendingDraft = null;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode */ }
  for (const fn of listeners) {
    try { fn(listPhrases()); } catch { /* a listener's bug is not the store's */ }
  }
}

export const normaliseToken = (t) =>
  String(t || '').trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');

export function listPhrases() {
  return [...cache].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function savePhrase({ id, tokens, text_en, texts }) {
  const clean = (tokens || []).map(normaliseToken).filter(Boolean);
  const meaning = String(text_en || '').trim();
  if (clean.length < 2) throw new Error('A phrase needs at least two signs.');
  if (clean.length > 12) throw new Error('Keep a phrase to twelve signs or fewer.');
  if (!meaning) throw new Error('Write what the whole phrase means.');
  const key = clean.join(' ');
  const clash = cache.find((p) => p.tokens.join(' ') === key && p.id !== id);
  if (clash) throw new Error(`That sequence already means “${clash.text_en}”.`);

  const now = Date.now();
  const prev = id ? cache.find((p) => p.id === id) : null;
  // A changed English meaning invalidates the cached translations.
  const keepTexts = prev && prev.text_en === meaning ? prev.texts : {};
  const record = {
    id: prev?.id || `phrase-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    tokens: clean,
    text_en: meaning,
    texts: { ...keepTexts, ...(texts || {}) },
    createdAt: prev?.createdAt || now,
    updatedAt: now,
  };
  cache = [...cache.filter((p) => p.id !== record.id), record];
  persist();
  return record;
}

export function deletePhrase(id) {
  cache = cache.filter((p) => p.id !== id);
  persist();
}

/**
 * The phrase completed by the newest token, if any.
 * `stream` is [{ token, at }], oldest first.
 */
export function matchPhrase(stream, now = Date.now()) {
  if (!stream.length || !cache.length) return null;
  const newest = stream[stream.length - 1].token;
  let best = null;
  for (const p of cache) {
    if (p.tokens[p.tokens.length - 1] !== newest) continue;
    // Generous window: ~2.5 s per sign plus slack for a slow start.
    const windowMs = 2500 * p.tokens.length + 3000;
    const recent = stream.filter((e) => now - e.at <= windowMs).map((e) => e.token);
    // Walk backwards so the match ends on the newest token.
    let i = p.tokens.length - 1;
    for (let j = recent.length - 1; j >= 0 && i >= 0; j -= 1) {
      if (recent[j] === p.tokens[i]) i -= 1;
    }
    if (i < 0 && (!best || p.tokens.length > best.tokens.length)) best = p;
  }
  return best;
}

/**
 * The phrase's meaning in `code`. Uses a cached translation, else translates
 * once online and caches it, else falls back to the English meaning.
 */
export async function phraseText(phrase, code) {
  if (!phrase) return '';
  if (code === 'en-IN') return phrase.text_en;
  const cached = phrase.texts?.[code];
  if (cached) return cached;
  if (!isOnline() || !hasSarvam()) return phrase.text_en;
  try {
    const out = await sarvamTranslate(phrase.text_en, code);
    const live = cache.find((p) => p.id === phrase.id);
    if (live && out) {
      live.texts = { ...live.texts, [code]: out };
      persist();
    }
    return out || phrase.text_en;
  } catch {
    return phrase.text_en;
  }
}

/** Hand a token sequence from the translator to the phrase editor. */
export function setDraft(tokens) { pendingDraft = tokens ? [...tokens] : null; }
export function takeDraft() {
  const d = pendingDraft;
  pendingDraft = null;
  return d;
}

export default {
  listPhrases, savePhrase, deletePhrase, subscribe, matchPhrase, phraseText,
  setDraft, takeDraft, normaliseToken,
};
