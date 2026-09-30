/**
 * Speech to text audio: recordings reach Sarvam as real WAV (the browser's
 * WebM / MP4 was rejected with HTTP 400 by every model), long ones in pieces
 * Sarvam accepts, and a failure says why.
 *
 *     node scripts/test-stt-audio.mjs
 */
let pass = 0;
let fail = 0;
const check = (ok, label, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}${detail ? '  ' + detail : ''}`);
};

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };

const { encodeWav, resample, toMono, toWavChunks, STT_RATE } = await import('../src/services/wav.js');
const { _setApiBaseForTests } = await import('../src/services/apiBase.js');
const { transcribe } = await import('../src/services/translator.js');

console.log('='.repeat(74) + '\n  Speech to text audio\n' + '='.repeat(74));

// A fake decoded recording: 48 kHz stereo, a 440 Hz tone.
const fakeBuffer = (seconds, rate = 48000) => {
  const len = Math.round(seconds * rate);
  const ch = Array.from({ length: 2 }, () => Float32Array.from({ length: len }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / rate)));
  return { sampleRate: rate, length: len, numberOfChannels: 2, getChannelData: (c) => ch[c] };
};

console.log('\n1. WAV encoding\n' + '-'.repeat(74));
{
  const wav = encodeWav(new Float32Array([0, 0.5, -0.5, 1, -1]), STT_RATE);
  const v = new DataView(wav.buffer);
  const tag = (o) => String.fromCharCode(...wav.subarray(o, o + 4));
  check(tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(36) === 'data', 'RIFF / WAVE / data headers');
  check(v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint16(34, true) === 16, 'PCM, mono, 16-bit');
  check(v.getUint32(24, true) === 16000, 'sample rate 16 kHz', String(v.getUint32(24, true)));
  check(wav.length === 44 + 5 * 2, 'size = header + 2 bytes per sample', String(wav.length));
  check(v.getInt16(50, true) === 32767 && v.getInt16(52, true) === -32768, 'full scale clipped correctly');
  const mono = toMono(fakeBuffer(0.1));
  check(mono.length === 4800, 'stereo -> mono keeps the length');
  check(resample(mono, 48000).length === 1600, '48 kHz -> 16 kHz', String(resample(mono, 48000).length));
}

console.log('\n2. Recordings are split for Sarvam (max 30 s per request)\n' + '-'.repeat(74));
{
  const short = toWavChunks(fakeBuffer(4));
  check(short.length === 1 && short[0].type === 'audio/wav', '4 s -> one WAV', `${short.length} chunk(s), ${short[0].type}`);
  const long = toWavChunks(fakeBuffer(62));
  check(long.length === 3, '62 s -> 3 pieces of <= 25 s', `${long.length}`);
  check(long.every((b) => (b.size - 44) / 2 / STT_RATE <= 25), 'every piece <= 25 s');
}

console.log('\n3. What is sent to Sarvam\n' + '-'.repeat(74));
{
  _setApiBaseForTests('https://api.example');
  const sent = [];
  globalThis.fetch = async (url, init) => {
    const f = init.body;
    sent.push({ url, file: f.get('file'), model: f.get('model'), lang: f.get('language_code') });
    return new Response(JSON.stringify({ transcript: `part ${sent.length}` }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const text = await transcribe(toWavChunks(fakeBuffer(40)), 'en-IN');
  check(sent.every((s) => s.url === 'https://api.example/speech-to-text'), 'through the hosted proxy');
  check(sent.every((s) => s.file.name === 'input.wav' && s.file.type === 'audio/wav'), 'file is input.wav, audio/wav', `${sent[0].file.name} ${sent[0].file.type}`);
  check(sent[0].lang === 'en-IN', 'language code sent', sent[0].lang);
  check(text === 'part 1 part 2', 'pieces transcribed and joined', text);

  // Sarvam refuses: the reason reaches the screen, not just "HTTP 400".
  sent.length = 0;
  globalThis.fetch = async (url, init) => {
    sent.push(init.body.get('model'));
    return new Response(JSON.stringify({ error: { message: 'Invalid audio format' } }), { status: 400 });
  };
  let msg = '';
  try { await transcribe(toWavChunks(fakeBuffer(2)), 'unknown'); } catch (err) { msg = err.message; }
  check(/Invalid audio format/.test(msg), "Sarvam's reason is in the error", msg.slice(0, 90));
  check(sent.length === 4, 'every model tried on a 400', String(sent.length));

  // Network down: fail fast so the screen can switch to on-device.
  sent.length = 0;
  globalThis.fetch = async () => { sent.push(1); throw new TypeError('Failed to fetch'); };
  try { await transcribe(toWavChunks(fakeBuffer(2))); } catch (err) { msg = err.message; }
  check(sent.length === 1 && /Failed to fetch/.test(msg), 'network error: one try, then fall back', msg);
}

console.log('\n' + '='.repeat(74) + `\n  ${pass} passed, ${fail} failed\n` + '='.repeat(74));
process.exit(fail ? 1 : 0);
