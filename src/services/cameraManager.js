/**
 * Singleton camera stream manager -- the zero-flicker architecture.
 *
 * The failure this exists to prevent: if each view calls getUserMedia() and
 * renders its own <video>, then switching Dashboard -> Sign Translator -> Video
 * Call tears the stream down and re-acquires it every time. On a phone that is
 * a visible black flash plus a 300-800 ms camera warm-up, and on some Android
 * browsers the second acquire fails outright because the first has not fully
 * released.
 *
 * So: ONE <video> element and ONE MediaStream, both created once and owned by
 * this module for the life of the page. Views do not mount a <video>; they mount
 * a container and this module moves the single element into it. Switching views
 * is a DOM re-parent, which does not interrupt playback.
 *
 * The element lives detached from the document when no view wants it. A detached
 * <video> keeps its srcObject and keeps playing, so returning to a camera view
 * shows a live frame immediately rather than a black rectangle.
 */

const state = {
  resolution: { width: null, height: null, frameRate: null },
  video: null,
  stream: null,
  starting: null,       // in-flight getUserMedia promise, so parallel callers share one
  facingMode: 'user',
  listeners: new Set(),
  error: null,
};

/** Create the one <video> element, once. */
function ensureVideoElement() {
  if (state.video) return state.video;

  const video = document.createElement('video');
  video.autoplay = true;
  video.playsInline = true;   // iOS: without this the video goes fullscreen
  video.muted = true;         // required for autoplay without user gesture
  video.setAttribute('playsinline', '');
  video.setAttribute('muted', '');
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = 'cover';
  video.style.display = 'block';

  state.video = video;
  return video;
}

function notify() {
  for (const fn of state.listeners) {
    try {
      fn(getStatus());
    } catch {
      // A broken subscriber must not take the camera down with it.
    }
  }
}

export function getResolution() {
  return state.resolution;
}

export function getStatus() {
  return {
    resolution: state.resolution,
    active: Boolean(state.stream && state.stream.active),
    facingMode: state.facingMode,
    error: state.error,
    hasVideoElement: Boolean(state.video),
  };
}

export function subscribe(fn) {
  state.listeners.add(fn);
  fn(getStatus());
  return () => state.listeners.delete(fn);
}

/**
 * Acquire the camera. Safe to call repeatedly: if a stream is already live it
 * is reused, and concurrent callers share a single in-flight request.
 */
export async function start({ facingMode = state.facingMode } = {}) {
  const video = ensureVideoElement();

  if (state.stream && state.stream.active && facingMode === state.facingMode) {
    return video;
  }
  if (state.starting) return state.starting;

  state.facingMode = facingMode;
  state.error = null;

  state.starting = (async () => {
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          'Camera unavailable. A browser only exposes getUserMedia on ' +
          'https:// or http://localhost.'
        );
      }

      // Swapping facing mode: release the old tracks first, or a phone with a
      // single camera pipeline will refuse the second acquire.
      if (state.stream) {
        state.stream.getTracks().forEach((t) => t.stop());
        state.stream = null;
      }

      // 480x360 is a deliberate downscale. MediaPipe's cost scales with the
      // pixels it is handed, and a phone happily reports a 1280x720 (or
      // 1920x1080) stream that then has to be resampled for every detector on
      // every frame. Landmarks are normalised to 0..1, so nothing downstream
      // cares about the source resolution -- only the per-frame cost does.
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode,
          width: { ideal: 480, max: 640 },
          height: { ideal: 360, max: 480 },
          frameRate: { ideal: 30, max: 30 },
        },
        audio: false,
      });

      // Report what the device actually granted: constraints are a request,
      // not a guarantee, and a phone that ignored them is worth knowing about.
      const settings = stream.getVideoTracks()[0]?.getSettings?.() || {};
      state.resolution = {
        width: settings.width || null,
        height: settings.height || null,
        frameRate: settings.frameRate || null,
      };

      state.stream = stream;
      video.srcObject = stream;
      await video.play().catch(() => {
        // Autoplay can still be blocked; the frame appears on first interaction.
      });
      state.error = null;
      return video;
    } catch (err) {
      state.error = err?.message || String(err);
      throw err;
    } finally {
      state.starting = null;
      notify();
    }
  })();

  return state.starting;
}

/**
 * Move the shared <video> into `container`.
 *
 * Returns a detach function. Detaching removes the element from the DOM but
 * does NOT stop the stream -- that is the whole point. Call this from a React
 * effect's cleanup when a view unmounts.
 */
export function attachTo(container) {
  const video = ensureVideoElement();
  if (!container) return () => {};

  if (video.parentElement !== container) {
    container.appendChild(video);
  }
  // A re-parented <video> can pause on some engines; nudge it.
  if (video.paused) video.play().catch(() => {});

  return () => {
    if (video.parentElement === container) {
      container.removeChild(video);
    }
  };
}

/** Flip between the front and rear camera, keeping the same element. */
export async function flip() {
  const next = state.facingMode === 'user' ? 'environment' : 'user';
  return start({ facingMode: next });
}

/** The shared element, for MediaPipe / canvas consumers. */
export function getVideoElement() {
  return ensureVideoElement();
}

export function getStream() {
  return state.stream;
}

/** True once the element actually has decodable frames. */
export function isReady() {
  return Boolean(state.video && state.video.readyState >= 2);
}

/**
 * Fully release the camera. Deliberately NOT called on view changes -- only on
 * an explicit user action, such as ending a call or leaving camera mode.
 */
export function stop() {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop());
    state.stream = null;
  }
  if (state.video) {
    state.video.srcObject = null;
  }
  notify();
}

export default {
  start, stop, flip, attachTo, subscribe, getStatus, getResolution,
  getVideoElement, getStream, isReady,
};
