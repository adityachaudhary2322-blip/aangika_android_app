import { useEffect, useRef } from 'react';
import cameraManager from '../services/cameraManager.js';
import { cn } from '../lib/utils.js';

/**
 * Mounts the ONE shared <video> into this container.
 *
 * Deliberately renders an empty div rather than its own <video>: the element
 * belongs to cameraManager and is re-parented here on mount, then removed (but
 * NOT stopped) on unmount. That is what makes switching between Dashboard,
 * Sign Translator and Video Call flicker-free -- the stream never restarts.
 *
 * `mirrored` only flips the CSS transform. It does not change the pixels the
 * landmarker sees, so handedness labels stay correct.
 */
export default function CameraStage({ mirrored = true, className }) {
  const hostRef = useRef(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const detach = cameraManager.attachTo(host);
    return detach;
  }, []);

  useEffect(() => {
    const video = cameraManager.getVideoElement();
    video.style.transform = mirrored ? 'scaleX(-1)' : 'none';
  }, [mirrored]);

  return (
    <div
      ref={hostRef}
      className={cn('h-full w-full overflow-hidden bg-surface-low', className)}
    />
  );
}
