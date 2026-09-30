import { useEffect, useRef, useState } from 'react';
import { isSupported as browserSttSupported, createRecognizer } from '../services/sttService.js';
import offlineStt, { modelFor } from '../services/offlineStt.js';
import { transcribe, hasSarvam } from '../services/translator.js';
import { decodeRecording, toWavChunks, toMono } from '../services/wav.js';

const CHUNK_MS = 4000;         // Sarvam: one short recording at a time
const SILENCE_RMS = 0.01;      // quieter than this: nobody spoke, skip the request

/**
 * Live captions of what the user says, wherever the app runs:
 *   1. the browser's recogniser (Chrome, Edge, Safari);
 *   2. otherwise the on-device model, if downloaded (works in the Android app
 *      and offline);
 *   3. otherwise Sarvam, a few seconds of audio at a time.
 * -> { engine, state, error }   engine: 'browser' | 'on-device' | 'sarvam' | null
 */
export default function useLiveSpeech({ enabled, lang, onPartial, onFinal }) {
  const [engine, setEngine] = useState(null);
  const [state, setState] = useState('idle');
  const [error, setError] = useState(null);
  const cb = useRef({ onPartial, onFinal });
  cb.current = { onPartial, onFinal };

  useEffect(() => {
    if (!enabled) { setState('idle'); return undefined; }
    let stopped = false;
    let stop = () => {};
    setError(null);

    (async () => {
      // 1. Browser recogniser.
      if (browserSttSupported()) {
        const rec = createRecognizer({
          lang,
          onPartial: (t) => cb.current.onPartial?.(t),
          onFinal: (t) => cb.current.onFinal?.(t),
          onState: setState,
          onError: setError,
        });
        rec.start();
        setEngine('browser');
        stop = () => rec.stop();
        return;
      }
      // 2. On-device model.
      const key = modelFor(lang) || 'hi';
      if (await offlineStt.isDownloaded(key).catch(() => false)) {
        try {
          const end = await offlineStt.startLive(key, {
            onPartial: (t) => t && cb.current.onPartial?.(t),
            onResult: (t) => cb.current.onFinal?.(t),
            onError: (e) => setError(e.message),
          });
          if (stopped) { end(); return; }
          setEngine('on-device');
          setState('listening');
          stop = end;
          return;
        } catch (e) { setError(e.message); }
      }
      // 3. Sarvam, in short recordings.
      if (!hasSarvam() || !navigator.onLine) {
        setState('unsupported');
        setError('Speech captions need Chrome / Edge, the offline speech model (Speech to text → download), or internet.');
        return;
      }
      let mic;
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        setState('error'); setError('Microphone permission denied: speech captions are off.'); return;
      }
      if (stopped) { mic.getTracks().forEach((t) => t.stop()); return; }
      setEngine('sarvam');
      setState('listening');
      let timer = 0;
      const next = () => {
        if (stopped) return;
        const parts = [];
        const rec = new MediaRecorder(mic);
        rec.ondataavailable = (e) => e.data.size && parts.push(e.data);
        rec.onstop = async () => {
          next();                                        // keep listening while this one is sent
          try {
            const audio = await decodeRecording(new Blob(parts, { type: rec.mimeType }));
            const x = toMono(audio);
            let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i];
            if (Math.sqrt(s / x.length) < SILENCE_RMS) return;
            const text = (await transcribe(toWavChunks(audio), lang) || '').trim();
            if (text && !stopped) cb.current.onFinal?.(text);
          } catch (e) { if (!stopped) setError(e.message); }
        };
        rec.start();
        timer = setTimeout(() => { if (rec.state !== 'inactive') rec.stop(); }, CHUNK_MS);
      };
      next();
      stop = () => { clearTimeout(timer); mic.getTracks().forEach((t) => t.stop()); };
    })();

    return () => { stopped = true; stop(); setEngine(null); };
  }, [enabled, lang]);

  return { engine, state, error };
}
