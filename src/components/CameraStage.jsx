import { useEffect, useRef, useState } from 'react';
import cameraManager from '../services/cameraManager.js';
import { cn } from '../lib/utils.js';

/**
 * Mounts the ONE shared <video> into this container.
 *
 * Renders an empty div rather than its own <video>: the element belongs to
 * cameraManager and is re-parented here on mount, then removed (but NOT
 * stopped) on unmount. That is what makes switching between Dashboard, Sign
 * Translator and Video Call flicker-free -- the stream never restarts.
 *
 * Mirroring is read from cameraManager rather than taken as a prop. A selfie
 * view is mirrored because that is what people expect of a mirror; a rear
 * camera must NOT be, or text and handedness come out backwards. Deriving it
 * from the one source of truth means the preview cannot disagree with the
 * camera that is actually running.
 */
export default function CameraStage({ className }) {
  const hostRef = useRef(null);
  const [front, setFront] = useState(() => cameraManager.isFrontCamera());

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const detach = cameraManager.attachTo(host);
    return detach;
  }, []);

  useEffect(() => cameraManager.subscribe((status) => {
    setFront(status.isFrontCamera);
  }), []);

  useEffect(() => {
    const video = cameraManager.getVideoElement();
    video.style.transform = front ? 'scaleX(-1)' : 'none';
  }, [front]);

  return (
    <div
      ref={hostRef}
      className={cn('h-full w-full overflow-hidden bg-surface-low', className)}
    />
  );
}
