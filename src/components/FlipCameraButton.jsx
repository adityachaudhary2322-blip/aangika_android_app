import { useEffect, useState } from 'react';
import { SwitchCamera, Loader2 } from 'lucide-react';
import cameraManager from '../services/cameraManager.js';

/** More than one camera on this device (phones: front and back). */
async function hasSeveralCameras() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((d) => d.kind === 'videoinput').length > 1;
  } catch {
    return false;
  }
}

/**
 * Front <-> back camera. Shown only where there is a second camera. Calls
 * follow the switch (callCamera.js); the translators read the new camera's
 * frames, mirrored or not, from cameraManager.
 *
 * variant 'overlay' a round chip on a camera picture; 'control' a call button
 */
export default function FlipCameraButton({ variant = 'overlay', className = '' }) {
  const [several, setSeveral] = useState(false);
  const [status, setStatus] = useState(() => cameraManager.getStatus());
  const [busy, setBusy] = useState(false);

  useEffect(() => cameraManager.subscribe(setStatus), []);
  // Device labels / counts are complete only once the camera is allowed.
  useEffect(() => { hasSeveralCameras().then(setSeveral); }, [status.active]);

  if (!several) return null;
  const label = status.isFrontCamera ? 'Switch to back camera' : 'Switch to front camera';
  const flip = async () => {
    setBusy(true);
    try { await cameraManager.flip(); } catch { /* cameraManager restores the previous camera and reports it */ }
    setBusy(false);
  };
  const icon = busy || status.switching ? <Loader2 size={variant === 'control' ? 19 : 16} className="animate-spin" /> : <SwitchCamera size={variant === 'control' ? 19 : 16} />;

  if (variant === 'control') {
    return (
      <button type="button" onClick={flip} disabled={busy} aria-label={label} title={label}
        className={'flex h-12 w-12 items-center justify-center rounded-full border border-subtle bg-card text-ink transition hover:border-strong active:scale-95 disabled:opacity-50 ' + className}>
        {icon}
      </button>
    );
  }
  return (
    <button type="button" onClick={flip} disabled={busy} aria-label={label} title={label}
      className={'flex h-9 w-9 items-center justify-center rounded-full chrome-plate disabled:opacity-50 ' + className}>
      {icon}
    </button>
  );
}
