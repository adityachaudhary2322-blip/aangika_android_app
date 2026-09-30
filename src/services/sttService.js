/**
 * Live speech-to-text over the browser's Web Speech API.
 *
 * This is deliberately NOT the same path as Hearing Mode. That view records a
 * clip with MediaRecorder and posts it to a cloud recogniser, which is accurate
 * but only produces a result after the speaker stops. A call cannot wait: the
 * signer on the other end needs the words while they are being said, so this
 * uses the on-device recogniser, which streams interim results at conversation
 * latency and costs nothing per minute.
 *
 * The trade-offs, all of which the caller has to be told about honestly:
 *   - Chrome and Safari only. Firefox has no SpeechRecognition at all.
 *   - Chrome ships the audio to Google's servers, so it needs a network.
 *   - `continuous` is a lie on most engines: the recogniser stops itself after
 *     a silence, so staying "always on" means restarting it in `onend`.
 */

/** BCP-47 tags where the browser recogniser disagrees with our Sarvam tags. */
const STT_LOCALE_OVERRIDES = {
  // Sarvam wants 'od-IN' for Odia; the ISO tag every browser knows is 'or-IN'.
  'od-IN': 'or-IN',
  // Hinglish speech is recognised as Hindi.
  hinglish: 'hi-IN',
};

/**
 * The recogniser restarts itself after every silence. If it instead fails
 * instantly -- no microphone permission, no network -- that restart becomes a
 * tight loop, so a burst of quick restarts is treated as a hard failure.
 */
const RAPID_RESTART_MS = 500;
const MAX_RAPID_RESTARTS = 8;
const RESTART_DELAY_MS = 250;

function getConstructor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isSupported() {
  return Boolean(getConstructor());
}

export function sttLocale(code) {
  return STT_LOCALE_OVERRIDES[code] || code;
}

/** Human-readable cause for the SpeechRecognition error codes worth showing. */
const STT_ERRORS = {
  'not-allowed': 'Microphone permission denied — speech captions are off.',
  'service-not-allowed': 'This browser blocked its speech service.',
  'audio-capture': 'No microphone found for speech captions.',
  network: 'Speech recognition needs a network connection.',
  'language-not-supported': 'This browser cannot recognise the selected language.',
};

/**
 * Build a recogniser that keeps itself running until `stop()` is called.
 *
 * Callbacks, all optional:
 *   onPartial(text)  interim hypothesis, revised as the speaker continues
 *   onFinal(text)    a settled utterance; this is what to send over the wire
 *   onState(state)   'listening' | 'idle' | 'error'
 *   onError(message) human-readable, already mapped from the error code
 *
 * @returns {{start:Function, stop:Function, setLanguage:Function}}
 */
export function createRecognizer({
  lang = 'en-IN',
  onPartial,
  onFinal,
  onState,
  onError,
} = {}) {
  const Ctor = getConstructor();
  if (!Ctor) {
    return {
      start: () => { onState?.('unsupported'); },
      stop: () => {},
      setLanguage: () => {},
    };
  }

  const recognition = new Ctor();
  recognition.lang = sttLocale(lang);
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let wanted = false;      // the caller wants it running
  let restarts = 0;
  let lastRestartAt = 0;
  let restartTimer = 0;

  recognition.onstart = () => {
    onState?.('listening');
  };

  recognition.onresult = (event) => {
    // Only walk the results added since the last event; `event.results` is
    // cumulative for the whole session and re-reading it grows without bound.
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript?.trim();
      if (!text) continue;
      if (result.isFinal) {
        restarts = 0;           // real speech: this session is healthy
        onFinal?.(text);
      } else {
        interim += (interim ? ' ' : '') + text;
      }
    }
    if (interim) onPartial?.(interim);
  };

  recognition.onerror = (event) => {
    const code = event?.error;
    // 'no-speech' and 'aborted' are the engine's normal punctuation, not
    // failures; surfacing them would flash an error banner every few seconds.
    if (code === 'no-speech' || code === 'aborted') return;
    onError?.(STT_ERRORS[code] || `Speech recognition error: ${code}`);
    if (code === 'not-allowed' || code === 'service-not-allowed') {
      wanted = false;
      onState?.('error');
    }
  };

  recognition.onend = () => {
    if (!wanted) {
      onState?.('idle');
      return;
    }
    const now = Date.now();
    restarts = now - lastRestartAt < RAPID_RESTART_MS ? restarts + 1 : 0;
    lastRestartAt = now;
    if (restarts > MAX_RAPID_RESTARTS) {
      wanted = false;
      onState?.('error');
      onError?.('Speech recognition kept dropping — captions are off.');
      return;
    }
    restartTimer = setTimeout(() => {
      if (!wanted) return;
      try { recognition.start(); } catch { /* already restarted */ }
    }, RESTART_DELAY_MS);
  };

  return {
    start() {
      if (wanted) return;
      wanted = true;
      restarts = 0;
      try {
        recognition.start();
      } catch {
        // start() throws InvalidStateError if a previous session has not fully
        // ended yet; onend will restart it.
      }
    },
    stop() {
      wanted = false;
      clearTimeout(restartTimer);
      try { recognition.abort(); } catch { /* never started */ }
      onState?.('idle');
    },
    setLanguage(code) {
      recognition.lang = sttLocale(code);
    },
  };
}

export default { isSupported, createRecognizer, sttLocale };
