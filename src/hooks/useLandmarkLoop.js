import { useEffect, useRef, useState } from 'react';
import cameraManager from '../services/cameraManager.js';
import landmarker from '../services/landmarker.js';

/**
 * One detection pass over the shared camera on every new video frame, while
 * `active`. `onFrame(result, ts)` receives { hands, pose, face }.
 * (The same loop My signs uses, shared for ISL Studio.)
 */
export default function useLandmarkLoop(active, onFrame) {
  const cb = useRef(onFrame);
  cb.current = onFrame;
  const [ready, setReady] = useState(landmarker.isLoaded());
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!active || ready) return;
    landmarker.load().then(() => setReady(true)).catch((e) => setError(e.message));
  }, [active, ready]);

  useEffect(() => {
    if (!active || !ready) return undefined;
    let raf = 0;
    let lastVideoTime = -1;
    let lastTs = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const video = cameraManager.getVideoElement();
      if (!video || video.readyState < 2 || video.currentTime === lastVideoTime) return;
      lastVideoTime = video.currentTime;
      const ts = Math.max(performance.now(), lastTs + 1);
      lastTs = ts;
      const result = landmarker.detect(video, ts);
      if (result) cb.current(result, ts);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, ready]);

  return { ready, error };
}
