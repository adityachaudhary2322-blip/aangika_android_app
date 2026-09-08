/**
 * Subtitle cue assembly and SRT export.
 *
 * Cues are built by grouping consecutive frames that classified the same way.
 * A single frame is never a cue: a hand passing through a shape on its way
 * somewhere else would otherwise litter the transcript with phantom signs, so a
 * run has to survive a minimum duration before it counts.
 */

/** A run shorter than this is treated as noise, not a sign. */
export const MIN_CUE_MS = 250;

/** Runs of the same token closer together than this are merged. */
export const MERGE_GAP_MS = 400;

/**
 * Turn a per-frame detection log into cues.
 *
 * @param {{timeMs:number, token:string|null, confidence:number}[]} samples
 *   in playback order
 * @returns {{startMs:number, endMs:number, token:string, confidence:number}[]}
 */
export function buildCues(samples) {
  const cues = [];
  let run = null;

  for (const s of samples) {
    if (!s.token) {
      if (run) { cues.push(run); run = null; }
      continue;
    }
    if (run && run.token === s.token && s.timeMs - run.endMs <= MERGE_GAP_MS) {
      run.endMs = s.timeMs;
      run.confidence = Math.max(run.confidence, s.confidence);
      run.frames += 1;
    } else {
      if (run) cues.push(run);
      run = {
        token: s.token,
        startMs: s.timeMs,
        endMs: s.timeMs,
        confidence: s.confidence,
        frames: 1,
      };
    }
  }
  if (run) cues.push(run);

  return cues
    .filter((c) => c.endMs - c.startMs >= MIN_CUE_MS)
    // Give a cue a readable minimum on screen even if the sign was brief.
    .map((c) => ({ ...c, endMs: Math.max(c.endMs, c.startMs + 700) }));
}

/** "00:00:01,234" — SRT wants a comma before the milliseconds, not a dot. */
export function formatSrtTime(ms) {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3600000);
  const m = Math.floor((total % 3600000) / 60000);
  const s = Math.floor((total % 60000) / 1000);
  const milli = total % 1000;
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

/** "00:00:01.234" — WebVTT uses a dot. */
export function formatVttTime(ms) {
  return formatSrtTime(ms).replace(',', '.');
}

/**
 * Render cues as an SRT file.
 * @param {Array} cues from buildCues
 * @param {(cue) => string} textFor how to render each cue's caption
 */
export function toSrt(cues, textFor = (c) => c.token) {
  return cues
    .map((c, i) => {
      const text = textFor(c) || c.token;
      return `${i + 1}\n${formatSrtTime(c.startMs)} --> ${formatSrtTime(c.endMs)}\n${text}\n`;
    })
    .join('\n');
}

/** Render cues as a WebVTT file, for players that prefer it. */
export function toVtt(cues, textFor = (c) => c.token) {
  const body = cues
    .map((c) => {
      const text = textFor(c) || c.token;
      return `${formatVttTime(c.startMs)} --> ${formatVttTime(c.endMs)}\n${text}\n`;
    })
    .join('\n');
  return `WEBVTT\n\n${body}`;
}

/** Trigger a download of `content` as `filename`. */
export function downloadText(filename, content, type = 'text/plain') {
  const blob = new Blob([content], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on the next tick: revoking synchronously can cancel the download
  // in some browsers before it has read the blob.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default { buildCues, toSrt, toVtt, formatSrtTime, formatVttTime, downloadText };
