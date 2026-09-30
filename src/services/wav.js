/**
 * Recorded audio -> 16 kHz mono 16-bit WAV, the format every speech API
 * accepts. MediaRecorder gives WebM/Opus (Chrome) or MP4/AAC (Safari), which
 * Sarvam rejects with HTTP 400, so recordings are decoded and re-encoded here.
 *
 * Long recordings are split: Sarvam's REST speech-to-text takes at most 30 s
 * per request.
 */

export const STT_RATE = 16000;
export const MAX_CHUNK_SECONDS = 25;

/** Average all channels into one. */
export function toMono(audioBuffer) {
  const n = audioBuffer.numberOfChannels;
  if (n === 1) return audioBuffer.getChannelData(0);
  const out = new Float32Array(audioBuffer.length);
  for (let c = 0; c < n; c++) {
    const ch = audioBuffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += ch[i] / n;
  }
  return out;
}

/** Linear resampling; plenty for speech recognition. */
export function resample(samples, from, to = STT_RATE) {
  if (from === to) return samples;
  const out = new Float32Array(Math.max(1, Math.round((samples.length * to) / from)));
  const step = from / to;
  for (let i = 0; i < out.length; i++) {
    const x = i * step;
    const a = Math.floor(x);
    const b = Math.min(samples.length - 1, a + 1);
    out[i] = samples[a] + (samples[b] - samples[a]) * (x - a);
  }
  return out;
}

/** Float samples (-1..1) -> WAV bytes (PCM 16-bit, mono). */
export function encodeWav(samples, rate = STT_RATE) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/** AudioBuffer -> WAV Blobs of at most MAX_CHUNK_SECONDS each. */
export function toWavChunks(audioBuffer, { maxSeconds = MAX_CHUNK_SECONDS } = {}) {
  const samples = resample(toMono(audioBuffer), audioBuffer.sampleRate, STT_RATE);
  const size = maxSeconds * STT_RATE;
  const chunks = [];
  for (let i = 0; i < samples.length; i += size) {
    chunks.push(new Blob([encodeWav(samples.subarray(i, i + size))], { type: 'audio/wav' }));
  }
  return chunks;
}

/** A recorded Blob (any browser format) -> AudioBuffer. */
export async function decodeRecording(blob) {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  const ctx = new Ctx();
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    ctx.close().catch(() => {});
  }
}

export default { toMono, resample, encodeWav, toWavChunks, decodeRecording, STT_RATE, MAX_CHUNK_SECONDS };
