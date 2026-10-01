/**
 * Is a translation written in its language's own script? The online engines
 * sometimes answer "Hindi" in Roman letters ("mai food khati hu") or leave
 * English words in Latin ("मेरा phone"). Hinglish and English are Roman by
 * design; every other app language has its own script.
 */
const RANGES = {
  hi: [0x0900, 0x097f], mr: [0x0900, 0x097f], ne: [0x0900, 0x097f],
  bn: [0x0980, 0x09ff], as: [0x0980, 0x09ff], pa: [0x0a00, 0x0a7f], gu: [0x0a80, 0x0aff],
  od: [0x0b00, 0x0b7f], or: [0x0b00, 0x0b7f], ta: [0x0b80, 0x0bff], te: [0x0c00, 0x0c7f],
  kn: [0x0c80, 0x0cff], ml: [0x0d00, 0x0d7f],
};

/** true when `text` has no Latin letters and uses the target language's script. */
export function inTargetScript(text, code) {
  const lang = String(code || '').split('-')[0].toLowerCase();
  const range = RANGES[lang];
  if (!range) return true;                     // English, Hinglish, unknown: nothing to check
  const s = String(text || '');
  if (/[A-Za-z]/.test(s)) return false;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if (c >= range[0] && c <= range[1]) return true;
  }
  return false;
}

export default { inTargetScript };
