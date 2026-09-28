import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
} from 'react';
import cameraManager from '../services/cameraManager.js';
import { unlockAudio } from '../services/ttsService.js';
import { buildIceServers } from '../services/iceConfig.js';
import { peerServerOptions } from '../services/peerServer.js';
import * as store from '../services/chatStorage.js';

/**
 * The one Peer for the whole app.
 *
 * WHY THIS IS A ROOT CONTEXT AND NOT A HOOK INSIDE VideoCall. The old design
 * created the Peer when the call view mounted and destroyed it when the view
 * unmounted, which meant the app was only reachable while the user was already
 * sitting on the call screen. Nobody could ever be called first. Registration
 * has to outlive every view, so it lives above all of them and stays open for
 * the life of the tab.
 *
 * ONE CONNECTION PER CONTACT, TWO JOBS. A DataConnection is opened per contact
 * and used for BOTH chat text and, once a call is up, the role handshake and
 * live captions. Opening a second channel for captions would double the
 * signalling and give the two ends a way to disagree about which one is
 * authoritative. Messages are discriminated by `type`.
 *
 * WHO DIALS. Only the caller opens the DataConnection; the callee receives it.
 * If both ends opened one on sight, a mutual "open chat" would create two half-
 * used channels and the role handshake could land on the wrong one.
 *
 * DELIVERY IS NOT GUARANTEED AND THE UI SAYS SO. There is no server and no
 * store-and-forward. A message to an offline contact stays 'pending' on this
 * device and is flushed when a channel to them next opens.
 */

const CallContext = createContext(null);

/** Human-readable cause for every PeerJS error type. */
const PEER_ERRORS = {
  'browser-incompatible': 'This browser cannot do WebRTC calling. Try Chrome or Safari.',
  'invalid-id': 'That handle contains characters the signalling server rejects.',
  'invalid-key': 'The signalling server rejected the API key.',
  'unavailable-id':
    'That handle is already registered by someone else right now. '
    + 'Pick another one in your profile, or close the other tab using it.',
  'ssl-unavailable': 'The signalling server needs HTTPS. Open this page over https://.',
  'server-error': 'The signalling server is unreachable. It may be down or blocked.',
  'socket-error': 'Lost the connection to the signalling server.',
  'socket-closed': 'The signalling connection closed unexpectedly.',
  disconnected: 'Disconnected from the signalling server. Reconnecting…',
  'peer-unavailable': 'They are not online right now.',
  webrtc: 'The media connection failed. On mobile data this usually means TURN did not relay.',
  network: 'Network error reaching the signalling server.',
};

function describePeerError(err) {
  const type = err?.type;
  if (type && PEER_ERRORS[type]) return { message: PEER_ERRORS[type], type };
  return { message: err?.message || String(err), type: type || 'unknown' };
}

/**
 * idle -> preparing -> dialling -> live   (outgoing)
 * idle -> ringing  -> preparing -> live   (incoming)
 *
 * 'preparing' is the camera coming up. It is separate from 'dialling' because
 * during it the far end has not been contacted at all.
 */
const IDLE = { status: 'idle', handle: null, direction: null, startedAt: 0 };

export function CallProvider({ children }) {
  // ── Registration ─────────────────────────────────────────────────────────
  const [profile, setProfileState] = useState(() => store.ensureProfile());
  const [registration, setRegistration] = useState('idle'); // idle|connecting|online|error
  const [regError, setRegError] = useState(null);

  // ── Call ─────────────────────────────────────────────────────────────────
  const [call, setCall] = useState(IDLE);
  const [remoteStream, setRemoteStream] = useState(null);
  const [connectionState, setConnectionState] = useState('');
  const [diagnostic, setDiagnostic] = useState(null);
  const [muted, setMuted] = useState(false);

  // ── Relay handshake ──────────────────────────────────────────────────────
  const [peerRole, setPeerRole] = useState(null);
  const [linkReady, setLinkReady] = useState(false);
  const [remoteLine, setRemoteLine] = useState(null);

  // ── Chat ─────────────────────────────────────────────────────────────────
  // Bumped on every storage write so consumers re-read. The store is the truth;
  // this is only a change signal.
  const [revision, setRevision] = useState(0);
  const [onlineHandles, setOnlineHandles] = useState(() => new Set());

  const peerRef = useRef(null);
  const mediaRef = useRef(null);            // active MediaConnection
  const pendingRef = useRef(null);          // unanswered incoming MediaConnection
  const connsRef = useRef(new Map());       // handle -> DataConnection
  const micRef = useRef(null);
  const announcedRoleRef = useRef(null);

  const myRole = profile?.role || store.ROLE_SIGNER;
  const myRoleRef = useRef(myRole);
  myRoleRef.current = myRole;

  useEffect(() => store.subscribe(() => {
    setProfileState(store.getProfile());
    setRevision((r) => r + 1);
  }), []);

  const markOnline = useCallback((handle, isOnline) => {
    setOnlineHandles((prev) => {
      const has = prev.has(handle);
      if (has === isOnline) return prev;
      const next = new Set(prev);
      if (isOnline) next.add(handle); else next.delete(handle);
      return next;
    });
  }, []);

  // ── DataChannel ──────────────────────────────────────────────────────────

  const sendOn = useCallback((handle, payload) => {
    const conn = connsRef.current.get(handle);
    if (!conn || !conn.open) return false;
    try {
      conn.send(payload);
      return true;
    } catch {
      return false;
    }
  }, []);

  /** Flush everything still 'pending' for a contact whose channel just opened. */
  const flushPending = useCallback((handle) => {
    for (const msg of store.pendingFor(handle)) {
      const ok = sendOn(handle, {
        type: 'chat', id: msg.id, text: msg.text, at: msg.at,
      });
      if (!ok) break;                       // channel died mid-flush; try later
      store.setMessageStatus(handle, msg.id, store.SENT);
    }
  }, [sendOn]);

  const sendRole = useCallback((handle, ack) => {
    const role = myRoleRef.current;
    if (sendOn(handle, { type: 'role-sync', role, ack: Boolean(ack) }) && !ack) {
      announcedRoleRef.current = role;
    }
  }, [sendOn]);

  const handleData = useCallback((handle, msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'chat' && typeof msg.text === 'string') {
      const text = msg.text.trim();
      if (!text) return;
      store.ensureContact(handle, { name: msg.from || handle, role: msg.role });
      store.appendMessage(handle, {
        id: msg.id, dir: 'in', text, at: msg.at || Date.now(), status: store.SENT,
      });
      // Acknowledge so the sender can move the tick from pending to sent even
      // though nothing in between persisted it.
      sendOn(handle, { type: 'chat-ack', id: msg.id });
      return;
    }

    if (msg.type === 'chat-ack' && msg.id) {
      store.setMessageStatus(handle, msg.id, store.SENT);
      return;
    }

    if (msg.type === 'role-sync') {
      setPeerRole(msg.role === store.ROLE_SPEAKER ? store.ROLE_SPEAKER : store.ROLE_SIGNER);
      // Answered once; an ack is never answered, so this cannot ping-pong.
      if (!msg.ack) sendRole(handle, true);
      return;
    }

    if (msg.type === 'caption' && typeof msg.text === 'string') {
      const text = msg.text.trim();
      if (!text) return;
      setRemoteLine({
        text,
        kind: msg.kind === 'speech' ? 'speech' : 'sign',
        at: Date.now(),
      });
      return;
    }

    if (msg.type === 'hangup') {
      // The far end pressed end. Tear down locally without waiting for the
      // media connection's own 'close', which can take seconds over a relay.
      endCallRef.current({ remote: true });
    }
  }, [sendOn, sendRole]);

  const wireData = useCallback((conn) => {
    if (!conn) return;
    const handle = store.handleFromPeerId(conn.peer);
    if (!handle) return;                    // not one of ours; ignore

    const previous = connsRef.current.get(handle);
    if (previous && previous !== conn) {
      try { previous.close(); } catch { /* already gone */ }
    }
    connsRef.current.set(handle, conn);

    const opened = () => {
      markOnline(handle, true);
      setLinkReady(true);
      sendRole(handle, false);
      flushPending(handle);
    };
    if (conn.open) opened();
    else conn.on('open', opened);

    conn.on('data', (msg) => handleData(handle, msg));
    conn.on('close', () => {
      markOnline(handle, false);
      if (connsRef.current.get(handle) === conn) connsRef.current.delete(handle);
      setLinkReady(false);
      setPeerRole(null);
      announcedRoleRef.current = null;
    });
    // A dead text channel must never take a call down with it: the video and
    // audio are still perfectly usable without captions.
    conn.on('error', () => markOnline(handle, false));
  }, [handleData, sendRole, flushPending, markOnline]);

  /**
   * Reuse the channel to a contact, or open one.
   *
   * Any entry still in the map is reused, open or not: a connection that is
   * mid-handshake is not a reason to start a second one, and 'close' removes
   * the entry, so a stale one cannot linger here.
   */
  const ensureChannel = useCallback((handle) => {
    const existing = connsRef.current.get(handle);
    if (existing) return existing;
    const peer = peerRef.current;
    if (!peer || peer.destroyed || !peer.open) return null;
    const conn = peer.connect(store.peerIdFor(handle), {
      // Reliable and ordered: a caption out of order reads as gibberish, and a
      // dropped chat line is one the other person never sees.
      reliable: true,
      serialization: 'json',
      metadata: { from: store.getProfile()?.handle },
    });
    wireData(conn);
    return conn;
  }, [wireData]);

  // ── Media ────────────────────────────────────────────────────────────────

  /**
   * How long to wait for getUserMedia before giving up.
   *
   * A permission prompt that is never answered leaves getUserMedia pending
   * FOREVER -- it does not reject on its own. Without this the call sits on
   * "starting camera" with no error and no way to understand why, which is
   * exactly what it did the first time this was tested.
   */
  const MEDIA_TIMEOUT_MS = 30000;

  const buildLocalStream = useCallback(async () => {
    await cameraManager.start();
    const camera = cameraManager.getStream();
    if (!camera) throw new Error('Camera unavailable — grant permission and retry.');

    const combined = new MediaStream();
    camera.getVideoTracks().forEach((t) => combined.addTrack(t));

    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getAudioTracks().forEach((t) => combined.addTrack(t));
      micRef.current = mic;
    } catch {
      // A call without a microphone is still useful to a signer.
      setDiagnostic({
        tone: 'warn',
        message: myRoleRef.current === store.ROLE_SPEAKER
          ? 'No microphone — your speech cannot be captioned for the signer.'
          : 'No microphone — you will be seen but not heard.',
      });
    }
    return combined;
  }, []);

  /** buildLocalStream, but it always settles. */
  const acquireMedia = useCallback(() => Promise.race([
    buildLocalStream(),
    new Promise((_, reject) => setTimeout(
      () => reject(new Error(
        'The camera never started. Check that this site is allowed to use the '
        + 'camera and microphone, then try again.'
      )),
      MEDIA_TIMEOUT_MS,
    )),
  ]), [buildLocalStream]);

  const wireMedia = useCallback((mc, handle, direction) => {
    mediaRef.current = mc;

    mc.on('stream', (stream) => {
      setRemoteStream(stream);
      setCall({ status: 'live', handle, direction, startedAt: Date.now() });
      setDiagnostic(null);
    });

    mc.on('close', () => endCallRef.current({ remote: true }));
    mc.on('error', (err) => {
      const { message, type } = describePeerError(err);
      setDiagnostic({ tone: 'error', message, detail: type });
      endCallRef.current({ remote: true });
    });

    // The RTCPeerConnection is the honest source of truth for whether media
    // actually flowed; PeerJS's own events say nothing about ICE.
    const pc = mc.peerConnection;
    if (pc) {
      pc.oniceconnectionstatechange = () => {
        setConnectionState(pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
          setDiagnostic({
            tone: 'error',
            message:
              'Media could not connect. On mobile data this means TURN did not '
              + 'relay — the shared open-relay credentials are often exhausted.',
          });
        }
      };
    }
  }, []);

  // ── Teardown ─────────────────────────────────────────────────────────────
  // Held in a ref because wireMedia/handleData close over it before it exists.
  const endCallRef = useRef(() => {});

  const endCall = useCallback(({ remote = false } = {}) => {
    const handle = mediaRef.current
      ? store.handleFromPeerId(mediaRef.current.peer)
      : call.handle;

    if (!remote && handle) sendOn(handle, { type: 'hangup' });

    try { mediaRef.current?.close(); } catch { /* already closed */ }
    try { pendingRef.current?.close(); } catch { /* already closed */ }
    mediaRef.current = null;
    pendingRef.current = null;

    micRef.current?.getAudioTracks().forEach((t) => t.stop());
    micRef.current = null;

    // Leave the shared camera the way every other view expects to find it.
    cameraManager.setQuality('standard');

    setCall(IDLE);
    setMuted(false);
    setRemoteStream(null);
    setConnectionState('');
    setPeerRole(null);
    setRemoteLine(null);
    announcedRoleRef.current = null;
  }, [call.handle, sendOn]);

  endCallRef.current = endCall;

  // ── The Peer itself ──────────────────────────────────────────────────────

  useEffect(() => {
    if (!profile?.handle) {
      setRegistration('idle');
      return undefined;
    }

    let cancelled = false;
    let peer = null;
    setRegistration('connecting');
    setRegError(null);

    import('peerjs').then(({ default: Peer }) => {
      if (cancelled) return;

      peer = new Peer(store.peerIdFor(profile.handle), {
        ...peerServerOptions(),
        config: { iceServers: buildIceServers(), iceCandidatePoolSize: 4 },
        debug: 1,
      });
      peerRef.current = peer;

      peer.on('open', () => {
        if (cancelled) return;
        setRegistration('online');
        setRegError(null);
      });

      peer.on('connection', (conn) => wireData(conn));

      peer.on('call', (incoming) => {
        const handle = store.handleFromPeerId(incoming.peer);
        // An unanswered call while one is already up would swap the streams
        // under the user mid-sentence. Refuse it rather than hijack.
        if (mediaRef.current || pendingRef.current) {
          try { incoming.close(); } catch { /* already gone */ }
          return;
        }
        store.ensureContact(handle, { name: handle });
        pendingRef.current = incoming;
        setCall({
          status: 'ringing', handle, direction: 'in', startedAt: Date.now(),
        });
      });

      peer.on('error', (err) => {
        const { message, type } = describePeerError(err);
        if (type === 'peer-unavailable') {
          // THEY are not there; our own registration is still fine.
          setDiagnostic({ tone: 'warn', message, detail: type });
          setCall(IDLE);
          return;
        }
        setRegError({ message, type });
        setRegistration('error');
      });

      peer.on('disconnected', () => {
        if (cancelled) return;
        setRegistration('connecting');
        try { peer.reconnect(); } catch { /* destroyed */ }
      });

      peer.on('close', () => {
        if (!cancelled) setRegistration('idle');
      });
    }).catch((err) => {
      if (cancelled) return;
      setRegError({ message: err?.message || String(err), type: 'load' });
      setRegistration('error');
    });

    return () => {
      cancelled = true;
      for (const conn of connsRef.current.values()) {
        try { conn.close(); } catch { /* already closed */ }
      }
      connsRef.current.clear();
      try { peer?.destroy(); } catch { /* already destroyed */ }
      if (peerRef.current === peer) peerRef.current = null;
    };
    // Re-registering on a handle change is the whole point: the peer id IS the
    // handle. Role changes must NOT land here, or picking a role would drop the
    // registration and any call on it.
  }, [profile?.handle, wireData]);

  // ── Actions ──────────────────────────────────────────────────────────────

  const placeCall = useCallback(async (handle) => {
    const target = store.normaliseHandle(handle);
    const peer = peerRef.current;
    if (!target) return;
    if (!peer || !peer.open) {
      setDiagnostic({ tone: 'error', message: 'Not registered yet — give it a moment.' });
      return;
    }
    if (mediaRef.current) return;                 // already in a call

    setDiagnostic(null);
    // 'preparing', not 'dialling'. The camera has to come up before an offer
    // can be sent, and on a first run that means a permission prompt. Claiming
    // to be "calling" while the far end has not been contacted at all is a
    // lie the user cannot act on.
    setCall({ status: 'preparing', handle: target, direction: 'out', startedAt: Date.now() });

    try {
      // Fire-and-forget, NOT awaited. It only has to be CALLED inside the click
      // for the unlock to count, and it awaits audio.play(), which in a hidden
      // or autoplay-blocked tab can stay pending forever -- blocking the call
      // behind a nicety that only matters later, for TTS.
      unlockAudio();
      const stream = await acquireMedia();
      ensureChannel(target);                      // captions + role handshake
      const mc = peer.call(store.peerIdFor(target), stream);
      if (!mc) throw new Error('Could not place the call.');
      setCall({ status: 'dialling', handle: target, direction: 'out', startedAt: Date.now() });
      wireMedia(mc, target, 'out');
    } catch (err) {
      setDiagnostic({ tone: 'error', message: err?.message || String(err) });
      setCall(IDLE);
    }
  }, [acquireMedia, ensureChannel, wireMedia]);

  const acceptCall = useCallback(async () => {
    const incoming = pendingRef.current;
    if (!incoming) return;
    const handle = store.handleFromPeerId(incoming.peer);
    setCall({ status: 'preparing', handle, direction: 'in', startedAt: Date.now() });
    try {
      unlockAudio();                              // see placeCall: never awaited
      const stream = await acquireMedia();
      incoming.answer(stream);
      pendingRef.current = null;
      ensureChannel(handle);
      wireMedia(incoming, handle, 'in');
    } catch (err) {
      setDiagnostic({ tone: 'error', message: err?.message || String(err) });
      try { incoming.close(); } catch { /* already gone */ }
      pendingRef.current = null;
      setCall(IDLE);
    }
  }, [buildLocalStream, ensureChannel, wireMedia]);

  /**
   * Mute.
   *
   * The microphone track is on the stream this context handed to PeerJS, NOT on
   * the camera stream -- disabling a camera track would blank the video
   * instead. Only the owner of that stream can mute it correctly, which is why
   * this lives here rather than in the call surface.
   */
  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      micRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
      return next;
    });
  }, []);

  const rejectCall = useCallback(() => {
    try { pendingRef.current?.close(); } catch { /* already gone */ }
    pendingRef.current = null;
    setCall(IDLE);
  }, []);

  /** Send a chat line. Persists first, so nothing is lost if the send fails. */
  const sendChat = useCallback((handle, text) => {
    const body = String(text || '').trim();
    if (!body) return null;
    const target = store.normaliseHandle(handle);

    const msg = store.appendMessage(target, {
      dir: 'out', text: body, status: store.PENDING,
    });

    const conn = connsRef.current.get(target);
    if (conn && conn.open) {
      const ok = sendOn(target, {
        type: 'chat', id: msg.id, text: body, at: msg.at,
        from: store.getProfile()?.handle, role: myRoleRef.current,
      });
      if (ok) store.setMessageStatus(target, msg.id, store.SENT);
    } else {
      // Not connected: open one and let flushPending drain the queue on 'open'.
      ensureChannel(target);
    }
    return msg;
  }, [ensureChannel, sendOn]);

  /** In-call caption relay, used by the VideoCall surface. */
  const sendCaption = useCallback((kind, text) => {
    const handle = call.handle;
    if (!handle) return false;
    return sendOn(handle, { type: 'caption', kind, text });
  }, [call.handle, sendOn]);

  /** Re-announce our role mid-call, for when the phone changes hands. */
  const announceRole = useCallback(() => {
    if (call.handle) sendRole(call.handle, false);
  }, [call.handle, sendRole]);

  useEffect(() => {
    if (linkReady && call.handle && announcedRoleRef.current !== myRole) {
      sendRole(call.handle, false);
    }
  }, [myRole, linkReady, call.handle, sendRole]);

  const value = useMemo(() => ({
    profile,
    myRole,
    peerId: profile ? store.peerIdFor(profile.handle) : '',
    registration,
    regError,
    call,
    inCall: call.status === 'live' || call.status === 'dialling'
      || call.status === 'preparing',
    remoteStream,
    connectionState,
    diagnostic,
    setDiagnostic,
    muted,
    toggleMute,
    peerRole,
    linkReady,
    remoteLine,
    onlineHandles,
    isOnline: (handle) => onlineHandles.has(store.normaliseHandle(handle)),
    revision,
    placeCall,
    acceptCall,
    rejectCall,
    endCall,
    sendChat,
    sendCaption,
    announceRole,
    openChannel: ensureChannel,
  }), [
    profile, myRole, registration, regError, call, remoteStream, connectionState,
    diagnostic, muted, toggleMute, peerRole, linkReady, remoteLine,
    onlineHandles, revision, placeCall, acceptCall, rejectCall, endCall,
    sendChat, sendCaption, announceRole, ensureChannel,
  ]);

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
}

/**
 * Read the call layer.
 *
 * Throws outside a provider rather than returning a plausible default: a silent
 * fallback means a view renders a permanently dead call button and the missing
 * <CallProvider> is never found.
 */
export function useCall() {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall() must be used inside a <CallProvider>.');
  return ctx;
}

export default CallContext;
