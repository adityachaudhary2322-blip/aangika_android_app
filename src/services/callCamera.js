import cameraManager from './cameraManager.js';

/**
 * Keep a call's video on the current camera.
 *
 * Flipping the camera (front <-> back) makes cameraManager open a NEW video
 * track; a call that keeps sending the old, stopped one shows the other
 * person a frozen picture. Whenever the track changes, it is swapped into
 * every live connection (RTCRtpSender.replaceTrack: no renegotiation) and
 * into the call's own local stream (the self view).
 *
 * @param getConnections  () => RTCPeerConnection[] currently in the call
 * @param localStream     the MediaStream the call was started with (or null)
 * @param isEnabled       () => boolean: camera on (a muted camera stays muted)
 * -> unsubscribe
 */
export function keepCallVideoCurrent(getConnections, localStream = null, isEnabled = () => true) {
  const current = () => cameraManager.getStream()?.getVideoTracks?.()[0] || null;
  let lastId = current()?.id || null;
  return cameraManager.subscribe(() => {
    const track = current();
    if (!track || track.id === lastId) return;
    lastId = track.id;
    track.enabled = isEnabled();
    for (const pc of getConnections()) {
      if (!pc?.getSenders) continue;
      for (const sender of pc.getSenders()) {
        // A stopped camera's sender still holds its old (ended) video track.
        if (sender.track?.kind === 'video') {
          sender.replaceTrack(track).catch((err) => console.warn('[call] camera switch not sent:', err?.message || err));
        }
      }
    }
    if (localStream) {
      localStream.getVideoTracks().forEach((t) => localStream.removeTrack(t));
      localStream.addTrack(track);
    }
  });
}

export default { keepCallVideoCurrent };
