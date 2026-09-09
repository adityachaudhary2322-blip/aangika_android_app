import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Mic, MicOff, SwitchCamera, Captions, PhoneOff, Copy, Check,
  Loader2, AlertTriangle, Signal, Hand, Ear, Volume2, VolumeX, Repeat,
} from 'lucide-react';
import LandmarkCanvas from '../components/LandmarkCanvas.jsx';
import LanguageSelect from '../components/LanguageSelect.jsx';
import EngineToggle from '../components/EngineToggle.jsx';
import useSignPipeline from '../hooks/useSignPipeline.js';
import cameraManager from '../services/cameraManager.js';
import { translate } from '../services/translationService.js';
import { speak, stop as stopSpeaking, unlockAudio } from '../services/ttsService.js';
import { isSupported as sttSupported, createRecognizer } from '../services/sttService.js';
import {
  buildIceServers, testIceServers, getTurnCredentials,
} from '../services/iceConfig.js';
import { durationString } from '../lib/utils.js';

/**
 * WhatsApp-style P2P call over PeerJS, with a dual-role assistive relay.
 *
 * Signalling goes through PeerJS's public broker; media is direct when the NAT
 * allows it and relayed through TURN when it does not (see iceConfig.js).
 *
 * Nothing about the identity is hardcoded: the room code is whatever the broker
 * assigns, and no call can be placed until the broker has confirmed the
 * registration by emitting 'open'. Calling before that is the classic silent
 * failure -- peer.id is undefined, peer.call() returns null, and the UI sits on
 * "Connecting..." forever with nothing in the console.
 *
 * THE RELAY. A call is only assistive if the two ends do DIFFERENT things, and
 * neither end can know which without being told. So each side declares a role
 * in the lobby and the two exchange it over a DataChannel the moment the call
 * opens ('role-sync'); every pipeline and every pixel of the overlay is then
 * derived from the PAIR, not from one side's own choice:
 *
 *   signer  + speaker -> classify landmarks here, send text; they hear it spoken
 *   speaker + signer  -> run STT here, send text; speak their sign captions
 *   signer  + signer  -> no pipelines at all, full-resolution video, no clutter
 *   speaker + speaker -> an ordinary video call
 *
 * The DataChannel carries text and nothing else. A translated sentence is a few
 * dozen bytes and arrives intact over a TURN relay that is already struggling
 * to carry the media; sending synthesised audio over the same path would fight
 * the call for the bandwidth it needs.
 */

const ROLE_SIGNER = 'signer';
const ROLE_SPEAKER = 'speaker';
const ROLE_KEY = 'isl.callRole';

/**
 * Human-readable cause for every PeerJS error type.
 *
 * PeerJS reports these as bare strings like 'peer-unavailable'. Showing that
 * raw is useless to someone whose call just failed on mobile data; this mapping
 * is the difference between "it's broken" and "they aren't online yet".
 */
const PEER_ERRORS = {
  'browser-incompatible': 'This browser cannot do WebRTC calling. Try Chrome or Safari.',
  'invalid-id': 'That room code contains characters the signalling server rejects.',
  'invalid-key': 'The signalling server rejected the API key.',
  'unavailable-id': 'That room code is already taken. Reload to get a new one.',
  'ssl-unavailable': 'The signalling server needs HTTPS. Open this page over https://.',
  'server-error': 'The signalling server is unreachable. It may be down or blocked.',
  'socket-error': 'Lost the connection to the signalling server.',
  'socket-closed': 'The signalling connection closed unexpectedly.',
  disconnected: 'Disconnected from the signalling server. Reload to reconnect.',
  'peer-unavailable': 'Nobody is waiting on that room code. Check it, and that they still have the app open.',
  webrtc: 'The media connection failed. On mobile data this usually means TURN did not relay.',
  network: 'Network error reaching the signalling server.',
};

function describePeerError(err) {
  const type = err?.type;
  if (type && PEER_ERRORS[type]) return { message: PEER_ERRORS[type], type };
  return { message: err?.message || String(err), type: type || 'unknown' };
}

function loadRole() {
  try {
    return localStorage.getItem(ROLE_KEY) === ROLE_SPEAKER ? ROLE_SPEAKER : ROLE_SIGNER;
  } catch {
    return ROLE_SIGNER;
  }
}

export default function VideoCall({
  language, setLanguage, online, onBack, cameraError, mode,
  visionEngine, chooseVision,
}) {
  const [myPeerId, setMyPeerId] = useState('');       // assigned by the broker
  const [peerReady, setPeerReady] = useState(false);  // 'open' has fired
  const [remoteId, setRemoteId] = useState('');
  const [phase, setPhase] = useState('lobby');        // lobby | waiting | live
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [voiceOut, setVoiceOut] = useState(true);     // speak incoming signs
  const [mirrored, setMirrored] = useState(() => cameraManager.isFrontCamera());
  const [swapped, setSwapped] = useState(false);      // PiP holds the remote feed
  const [seconds, setSeconds] = useState(0);
  const [diagnostic, setDiagnostic] = useState(null);
  const [iceReport, setIceReport] = useState(null);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [signerLine, setSignerLine] = useState('');
  const [connectionState, setConnectionState] = useState('');

  // ── Role state ────────────────────────────────────────────────────────────
  const [myRole, setMyRole] = useState(loadRole);
  const [peerRole, setPeerRole] = useState(null);     // null until 'role-sync'
  const [linkReady, setLinkReady] = useState(false);  // DataChannel is open
  const [remoteLine, setRemoteLine] = useState(null); // {text, kind, at}
  const [mySpeech, setMySpeech] = useState('');       // live STT hypothesis
  const [sttState, setSttState] = useState('idle');

  const peerRef = useRef(null);
  const callRef = useRef(null);
  const dataRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const micStreamRef = useRef(null);
  const spokenRef = useRef('');       // last sentence handed to TTS, for dedupe
  const sentLineRef = useRef('');     // last sign caption put on the wire

  // The DataChannel handlers are installed once, from inside PeerJS callbacks,
  // and must not answer a role-sync with whatever role was current when they
  // were created.
  const myRoleRef = useRef(myRole);
  myRoleRef.current = myRole;
  /** Last role actually put on the wire, so the handshake is not re-sent. */
  const announcedRoleRef = useRef(null);

  const turn = getTurnCredentials();

  // ── What this PAIR of roles means ─────────────────────────────────────────
  //
  // Until 'role-sync' lands the peer is ASSUMED to be complementary. That is
  // the overwhelmingly common case, and assuming it gets captions flowing from
  // the first frame instead of after a signalling round trip; the moment the
  // real role arrives this derivation corrects itself and the UI follows.
  const relay = useMemo(() => {
    const theirs = peerRole || (myRole === ROLE_SIGNER ? ROLE_SPEAKER : ROLE_SIGNER);
    if (myRole === ROLE_SIGNER) {
      return theirs === ROLE_SIGNER ? 'sign-to-sign' : 'sign-to-speech';
    }
    return theirs === ROLE_SIGNER ? 'speech-to-sign' : 'voice';
  }, [myRole, peerRole]);

  const live = phase === 'live';
  /** Classify landmarks only when a hearing peer is waiting for the text. */
  const signingActive = live && relay === 'sign-to-speech';
  /** Run the microphone recogniser only when a signer is waiting for the text. */
  const listeningActive = live && relay === 'speech-to-sign';
  /** Two signers: the video IS the language, so nothing may cover it. */
  const cleanVideo = relay === 'sign-to-sign';

  const { words, stats, frameRef } = useSignPipeline({
    enabled: signingActive,
    mirrored,
    visionEngine,
    language,
    mode,
    // Deliberately NOT auto-speaking here: the other party already hears the
    // synthesised voice over the call, so speaking locally would echo back.
    autoSpeak: false,
  });

  // Mirroring follows the camera manager, never a local toggle.
  useEffect(() => cameraManager.subscribe((s) => setMirrored(s.isFrontCamera)), []);

  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [live]);

  useEffect(() => () => cleanup(), []);

  // ── DataChannel ───────────────────────────────────────────────────────────

  /** Fire-and-forget; a closed channel is normal, not an error worth showing. */
  const send = useCallback((payload) => {
    const conn = dataRef.current;
    if (!conn || !conn.open) return false;
    try {
      conn.send(payload);
      return true;
    } catch {
      return false;
    }
  }, []);

  const sendRole = useCallback((ack) => {
    const role = myRoleRef.current;
    if (send({ type: 'role-sync', role, ack: Boolean(ack) }) && !ack) {
      announcedRoleRef.current = role;
    }
  }, [send]);

  const handleData = useCallback((msg) => {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'role-sync') {
      setPeerRole(msg.role === ROLE_SPEAKER ? ROLE_SPEAKER : ROLE_SIGNER);
      // Answer once, so whichever side opened the channel later still learns
      // our role. The answer carries `ack`, and an ack is never answered, so
      // the two ends cannot bounce role-syncs off each other forever.
      if (!msg.ack) sendRole(true);
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
    }
  }, [sendRole]);

  const wireData = useCallback((conn) => {
    if (!conn) return;
    dataRef.current = conn;

    const opened = () => {
      setLinkReady(true);
      sendRole(false);
    };
    if (conn.open) opened();
    else conn.on('open', opened);

    conn.on('data', handleData);
    conn.on('close', () => {
      setLinkReady(false);
      setPeerRole(null);
      announcedRoleRef.current = null;
      if (dataRef.current === conn) dataRef.current = null;
    });
    // A dead text channel must never take the call down with it: the video and
    // the audio are still perfectly usable without captions.
    conn.on('error', () => setLinkReady(false));
  }, [handleData, sendRole]);

  // The role pill is tappable mid-call, for when the phone changes hands.
  // Re-announce so the far end re-derives its own half of the relay -- but only
  // on an actual change, or this would re-send the handshake the channel's
  // 'open' has already done.
  useEffect(() => {
    if (linkReady && announcedRoleRef.current !== myRole) sendRole(false);
  }, [myRole, linkReady, sendRole]);

  function cleanup() {
    try { dataRef.current?.close(); } catch { /* already closed */ }
    try { callRef.current?.close(); } catch { /* already closed */ }
    try { peerRef.current?.destroy(); } catch { /* already destroyed */ }
    dataRef.current = null;
    callRef.current = null;
    peerRef.current = null;
    micStreamRef.current?.getAudioTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    stopSpeaking();
    // Leave the shared camera the way every other view expects to find it.
    cameraManager.setQuality('standard');
  }

  // ── Signs -> text -> wire ─────────────────────────────────────────────────

  useEffect(() => {
    if (!signingActive || words.length === 0) return undefined;
    let cancelled = false;
    translate(words.map((w) => w.word), language, { mode }).then((r) => {
      if (cancelled) return;
      const text = r.translated || r.english;
      if (!text) return;
      setSignerLine(text);
      // Only put a CHANGED sentence on the wire. The classifier re-emits the
      // same tokens for as long as a sign is held, and re-sending would make
      // the speaker's phone read the same sentence aloud over and over.
      if (text !== sentLineRef.current) {
        sentLineRef.current = text;
        send({ type: 'caption', kind: 'sign', text });
      }
    });
    return () => { cancelled = true; };
  }, [words, signingActive, language, mode, send]);

  // ── Microphone -> text -> wire (speaker side) ─────────────────────────────

  useEffect(() => {
    if (!listeningActive) return undefined;

    if (!sttSupported()) {
      setSttState('unsupported');
      setDiagnostic({
        tone: 'warn',
        message:
          'This browser has no live speech recognition, so the signer cannot ' +
          'see your words. Chrome or Safari can.',
      });
      return undefined;
    }

    const recognizer = createRecognizer({
      lang: language,
      onPartial: setMySpeech,
      onFinal: (text) => {
        setMySpeech(text);
        send({ type: 'caption', kind: 'speech', text });
      },
      onState: setSttState,
      onError: (message) => setDiagnostic({ tone: 'warn', message }),
    });
    recognizer.start();

    return () => {
      recognizer.stop();
      setMySpeech('');
    };
  }, [listeningActive, language, send]);

  // ── Incoming sign captions -> voice (speaker side) ────────────────────────

  useEffect(() => {
    if (!live || myRole !== ROLE_SPEAKER || !voiceOut) return;
    if (remoteLine?.kind !== 'sign') return;
    // The far end only sends a sentence when it changes, but a reconnect or a
    // re-render must not make the phone say it twice.
    if (remoteLine.text === spokenRef.current) return;
    spokenRef.current = remoteLine.text;
    speak(remoteLine.text, language);
  }, [remoteLine, live, myRole, voiceOut, language]);

  // ── Capture profile follows the relay ─────────────────────────────────────

  useEffect(() => {
    if (!live) return;
    // Between two signers no detector runs, so the pixels the downscale was
    // protecting are free again -- and those are exactly the pixels that carry
    // handshape and finger position.
    cameraManager.setQuality(cleanVideo ? 'high' : 'standard');
  }, [live, cleanVideo]);

  // ── Local preview ─────────────────────────────────────────────────────────

  /**
   * Bind the local <video> straight to the shared camera stream.
   *
   * A second <video> on the SAME MediaStream costs nothing and does not
   * re-acquire the camera, so the single-getUserMedia design still holds.
   * `muted` is mandatory: an unmuted local preview feeds audio back AND has its
   * autoplay refused outright by mobile browsers.
   */
  const attachLocalPreview = useCallback(() => {
    const el = localVideoRef.current;
    const stream = cameraManager.getStream();
    if (!el || !stream) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    el.muted = true;
    el.play().catch(() => {});
  }, []);

  useEffect(() => {
    if (!live) return undefined;
    attachLocalPreview();
    // Re-bind periodically: flipping the camera swaps the underlying stream.
    const id = setInterval(attachLocalPreview, 1000);
    return () => clearInterval(id);
  }, [live, attachLocalPreview]);

  // ── Media ─────────────────────────────────────────────────────────────────

  async function buildLocalStream() {
    await cameraManager.start();
    const camera = cameraManager.getStream();
    if (!camera) throw new Error('Camera unavailable — grant permission and retry.');

    const combined = new MediaStream();
    camera.getVideoTracks().forEach((t) => combined.addTrack(t));

    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getAudioTracks().forEach((t) => combined.addTrack(t));
      micStreamRef.current = mic;
    } catch {
      // A call without a microphone is still useful to a signer.
      setDiagnostic({
        tone: 'warn',
        message: myRole === ROLE_SPEAKER
          ? 'No microphone — your speech cannot be captioned for the signer.'
          : 'No microphone — you will be seen but not heard.',
      });
    }
    return combined;
  }

  // ── Signalling ────────────────────────────────────────────────────────────

  /** Create the Peer and resolve ONLY once the broker emits 'open'. */
  function ensurePeer() {
    if (peerRef.current && peerReady) return Promise.resolve(peerRef.current);

    return new Promise((resolve, reject) => {
      import('peerjs')
        .then(({ default: Peer }) => {
          const peer = new Peer({
            config: { iceServers: buildIceServers(), iceCandidatePoolSize: 4 },
            debug: 1,
          });
          peerRef.current = peer;

          peer.on('open', (id) => {
            setMyPeerId(id);
            setPeerReady(true);
            setDiagnostic(null);
            resolve(peer);
          });

          peer.on('error', (err) => {
            const { message, type } = describePeerError(err);
            setDiagnostic({ tone: 'error', message, detail: type });
            // 'peer-unavailable' means THEY are not there; our own registration
            // is still fine, so do not tear it down.
            if (type !== 'peer-unavailable') setPeerReady(false);
            setPhase('lobby');
            reject(err);
          });

          peer.on('disconnected', () => {
            setPeerReady(false);
            setDiagnostic({
              tone: 'warn',
              message: 'Signalling dropped — reconnecting…',
            });
            try { peer.reconnect(); } catch { /* destroyed */ }
          });

          peer.on('close', () => setPeerReady(false));

          // Only the joiner opens the text channel, so this side only ever
          // receives one and the two cannot race to create a pair.
          peer.on('connection', (conn) => wireData(conn));

          // Someone is calling us.
          peer.on('call', async (incoming) => {
            try {
              const stream = await buildLocalStream();
              incoming.answer(stream);
              wireCall(incoming);
            } catch (err) {
              setDiagnostic({ tone: 'error', message: err.message });
            }
          });
        })
        .catch(reject);
    });
  }

  function wireCall(call) {
    callRef.current = call;

    call.on('stream', (stream) => {
      const el = remoteVideoRef.current;
      if (el) {
        el.srcObject = stream;
        el.playsInline = true;
        // Autoplay policy: unmuted playback can be refused. Retry muted rather
        // than leaving a frozen black rectangle, and say why it is silent.
        el.play().catch(() => {
          el.muted = true;
          el.play()
            .then(() => setDiagnostic({
              tone: 'warn',
              message: 'Audio muted by the browser — tap the screen to enable it.',
            }))
            .catch(() => {});
        });
      }
      setPhase('live');
      setDiagnostic(null);
    });

    call.on('close', () => {
      setPhase('lobby');
      setConnectionState('');
      setPeerRole(null);
      setLinkReady(false);
    });

    call.on('error', (err) => {
      const { message, type } = describePeerError(err);
      setDiagnostic({ tone: 'error', message, detail: type });
      setPhase('lobby');
    });

    // The RTCPeerConnection is the honest source of truth for whether media
    // actually flowed; PeerJS's own events say nothing about ICE.
    const pc = call.peerConnection;
    if (pc) {
      pc.oniceconnectionstatechange = () => {
        setConnectionState(pc.iceConnectionState);
        if (pc.iceConnectionState === 'failed') {
          setDiagnostic({
            tone: 'error',
            message:
              'Media could not connect. On mobile data this means TURN did not ' +
              'relay — run the connection test in the lobby.',
          });
        }
      };
    }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  function chooseRole(role) {
    setMyRole(role);
    try { localStorage.setItem(ROLE_KEY, role); } catch { /* private mode */ }
  }

  async function createRoom() {
    setDiagnostic(null);
    setPhase('waiting');
    try {
      await unlockAudio();              // still inside the click gesture
      await buildLocalStream();
      await ensurePeer();               // resolves only after 'open'
      // Stay in 'waiting' until someone calls in.
    } catch (err) {
      setDiagnostic((d) => d || { tone: 'error', message: err?.message || String(err) });
      setPhase('lobby');
    }
  }

  async function joinRoom() {
    const target = remoteId.trim();
    if (!target) return;
    setDiagnostic(null);
    setPhase('waiting');
    try {
      await unlockAudio();
      const stream = await buildLocalStream();
      const peer = await ensurePeer();  // guarantees peer.id exists
      const call = peer.call(target, stream);
      if (!call) throw new Error('Could not place the call — check the room code.');
      wireCall(call);
      // Reliable and ordered: a caption that arrives out of order reads as
      // gibberish, and a dropped one is a sentence the other person never sees.
      wireData(peer.connect(target, { reliable: true, serialization: 'json' }));
    } catch (err) {
      setDiagnostic((d) => d || { tone: 'error', message: err?.message || String(err) });
      setPhase('lobby');
    }
  }

  function endCall() {
    cleanup();
    setPhase('lobby');
    setSeconds(0);
    setMyPeerId('');
    setPeerReady(false);
    setSignerLine('');
    setConnectionState('');
    setPeerRole(null);
    setLinkReady(false);
    setRemoteLine(null);
    setMySpeech('');
    setSttState('idle');
    setSwapped(false);
    spokenRef.current = '';
    sentLineRef.current = '';
    announcedRoleRef.current = null;
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    micStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
  }

  function toggleVoiceOut() {
    // Stop mid-sentence rather than letting the current utterance finish: the
    // reason to hit this button is usually that it is saying the wrong thing.
    if (voiceOut) stopSpeaking();
    setVoiceOut((v) => !v);
  }

  async function copyCode() {
    if (!myPeerId) return;
    try {
      await navigator.clipboard.writeText(myPeerId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setDiagnostic({ tone: 'warn', message: 'Clipboard blocked — copy the code manually.' });
    }
  }

  async function runIceTest() {
    setTesting(true);
    setIceReport(null);
    setIceReport(await testIceServers());
    setTesting(false);
  }

  // ── Lobby ─────────────────────────────────────────────────────────────────

  if (!live) {
    return (
      <div className="flex h-full flex-col overflow-y-auto px-4 no-scrollbar">
        <header className="flex items-center gap-2 py-3">
          <button type="button" onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-full bg-card-high">
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-lg font-bold">Realtime Call</h1>
          <div className="ml-auto">
            <LanguageSelect value={language} onChange={setLanguage} />
          </div>
        </header>

        <div className="flex flex-1 flex-col justify-center gap-4 pb-6">
          {/* Role */}
          <div className="rounded-2xl border border-white/10 bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">
              I am joining as
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <RoleCard
                icon={<Hand size={20} />}
                title="Sign User"
                subtitle="Deaf / hard of hearing"
                detail="The camera reads your signs and speaks them to the other person."
                active={myRole === ROLE_SIGNER}
                tint="primary"
                onClick={() => chooseRole(ROLE_SIGNER)}
              />
              <RoleCard
                icon={<Ear size={20} />}
                title="Speaker"
                subtitle="Hearing"
                detail="Your speech is captioned for them, and their signs are read aloud to you."
                active={myRole === ROLE_SPEAKER}
                tint="secondary"
                onClick={() => chooseRole(ROLE_SPEAKER)}
              />
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-ink-dim">
              Roles are exchanged automatically when the call connects, so the
              screen adapts to whoever actually answers. Two sign users get
              plain high-resolution video with nothing covering the hands.
            </p>
            {myRole === ROLE_SPEAKER && !sttSupported() && (
              <p className="mt-2 text-[11px] text-amber">
                This browser has no live speech recognition. Use Chrome or
                Safari, or your words will not reach the signer.
              </p>
            )}
          </div>

          {/* Room code */}
          <div className="rounded-2xl border border-white/10 bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">
              Your room code
            </p>

            {myPeerId ? (
              <>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-card-high px-3 py-2 font-mono text-sm text-primary">
                    {myPeerId}
                  </code>
                  <button
                    type="button"
                    onClick={copyCode}
                    aria-label="Copy room code"
                    className={
                      'flex h-10 w-10 items-center justify-center rounded-lg ' +
                      (copied ? 'bg-primary text-surface' : 'bg-card-high')
                    }
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-ink-dim">
                  {copied ? 'Copied. ' : ''}
                  Share this code. The call starts when they join.
                </p>
              </>
            ) : (
              <button
                type="button"
                onClick={createRoom}
                disabled={!online || phase === 'waiting'}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 font-semibold text-surface disabled:opacity-40"
              >
                {phase === 'waiting' && <Loader2 size={16} className="animate-spin" />}
                {phase === 'waiting' ? 'Registering with the server…' : 'Create room'}
              </button>
            )}
          </div>

          {/* Join */}
          <div className="rounded-2xl border border-white/10 bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">
              Join a room
            </p>
            <input
              value={remoteId}
              onChange={(e) => setRemoteId(e.target.value)}
              placeholder="Paste room code"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className="mt-2 w-full rounded-lg border border-white/10 bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-secondary"
            />
            <button
              type="button"
              onClick={joinRoom}
              disabled={!remoteId.trim() || !online || phase === 'waiting'}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-secondary py-3 font-semibold text-surface disabled:opacity-40"
            >
              {phase === 'waiting' && <Loader2 size={16} className="animate-spin" />}
              {phase === 'waiting' ? 'Connecting…' : 'Join call'}
            </button>
          </div>

          {/* Diagnostics */}
          {diagnostic && (
            <div
              className={
                'flex gap-2 rounded-xl border px-3 py-2.5 text-xs ' +
                (diagnostic.tone === 'error'
                  ? 'border-rose/40 bg-rose/10 text-rose'
                  : 'border-amber/40 bg-amber/10 text-amber')
              }
            >
              <AlertTriangle size={15} className="mt-0.5 shrink-0" />
              <span>
                {diagnostic.message}
                {diagnostic.detail && (
                  <span className="mt-0.5 block font-mono text-[10px] opacity-70">
                    {diagnostic.detail}
                  </span>
                )}
              </span>
            </div>
          )}

          {!online && (
            <p className="text-center text-xs text-amber">
              Calling needs a network connection.
            </p>
          )}
          {cameraError && <p className="text-center text-xs text-rose">{cameraError}</p>}

          {/* Connection test */}
          <div className="rounded-2xl border border-white/10 bg-card p-4">
            <div className="flex items-center gap-2">
              <Signal size={14} className="text-ink-dim" />
              <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">
                Connection test
              </p>
              <button
                type="button"
                onClick={runIceTest}
                disabled={testing}
                className="ml-auto rounded-lg bg-card-high px-3 py-1.5 text-[11px] disabled:opacity-40"
              >
                {testing ? 'Testing…' : 'Run test'}
              </button>
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
              Checks whether a TURN relay candidate can actually be obtained.
              Without one, calls between two mobile-data connections will not
              connect, however strong the signal looks.
            </p>

            {iceReport && (
              <div className="mt-3 rounded-lg bg-surface p-3 font-mono text-[11px]">
                <p className={iceReport.ok ? 'text-primary' : 'text-rose'}>
                  {iceReport.ok
                    ? 'RELAY OK — mobile-to-mobile should connect.'
                    : 'NO RELAY — symmetric-NAT calls will fail.'}
                </p>
                <p className="mt-1 text-ink-dim">
                  host {iceReport.host} · srflx {iceReport.srflx} · relay {iceReport.relay}
                </p>
                {iceReport.error && <p className="mt-1 text-amber">{iceReport.error}</p>}
                {!iceReport.ok && !iceReport.error && (
                  <p className="mt-1 text-amber">
                    TURN did not allocate. The shared open credentials are
                    rate-limited and often exhausted — add your own Metered key.
                  </p>
                )}
              </div>
            )}

            <p className="mt-2 text-[10px] text-ink-dim">
              TURN credentials:{' '}
              {turn.source === 'custom' ? 'your own key' : 'shared open-relay (rate-limited)'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Live call ─────────────────────────────────────────────────────────────

  // One main box and one PiP box, exchanged by tapping the small one. The two
  // <video> elements keep their position in the tree and swap only className,
  // so neither is ever unmounted and no MediaStream has to be re-bound -- which
  // would black the feed out for a frame on every tap.
  const MAIN_BOX = 'absolute inset-0 z-0 h-full w-full bg-black';
  const PIP_BOX =
    'absolute right-3 top-16 z-30 h-44 w-32 cursor-pointer overflow-hidden ' +
    'rounded-2xl border border-white/25 bg-surface-low shadow-2xl active:scale-95';

  const swap = () => setSwapped((v) => !v);
  const incomingSpeech = remoteLine?.kind === 'speech' ? remoteLine.text : '';
  const incomingSign = remoteLine?.kind === 'sign' ? remoteLine.text : '';

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* Their feed */}
      <div
        className={swapped ? PIP_BOX : MAIN_BOX}
        onClick={swapped ? swap : undefined}
        role={swapped ? 'button' : undefined}
        aria-label={swapped ? 'Show their video full screen' : undefined}
      >
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="h-full w-full object-cover"
        />
        {swapped && (
          <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px]">
            THEM
          </span>
        )}
      </div>

      {/* Your feed. The front camera is mirrored so a raised right hand appears
          on the right, the way it does in a mirror; the back camera already
          shows the world the right way round and must NOT be flipped. */}
      <div
        className={swapped ? MAIN_BOX : PIP_BOX}
        onClick={swapped ? undefined : swap}
        role={swapped ? undefined : 'button'}
        aria-label={swapped ? undefined : 'Show your video full screen'}
      >
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className={'h-full w-full object-cover ' + (mirrored ? 'scale-x-[-1]' : '')}
        />
        {signingActive && <LandmarkCanvas frameRef={frameRef} mirrored={mirrored} />}
        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px]">
          {signingActive ? `${stats.fps} fps` : 'YOU'}
        </span>
      </div>

      {/* Top scrim */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 bg-gradient-to-b from-black/70 to-transparent p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <span className="pill bg-black/45 font-mono text-ink backdrop-blur">
            {durationString(seconds)}
          </span>
          <span
            className={
              'pill bg-black/45 backdrop-blur ' +
              (connectionState === 'connected' || connectionState === 'completed'
                ? 'text-primary'
                : connectionState === 'failed' ? 'text-rose' : 'text-ink-dim')
            }
          >
            {connectionState || 'connecting'}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {signingActive && (
              <EngineToggle value={visionEngine} onChange={chooseVision} compact />
            )}
            {!cleanVideo && (
              <LanguageSelect value={language} onChange={setLanguage} variant="overlay" />
            )}
          </div>
        </div>

        {/* Who is who. Your own pill is tappable, for when the phone changes
            hands mid-call and the person holding it is now the other role. */}
        <div className="pointer-events-auto mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => chooseRole(myRole === ROLE_SIGNER ? ROLE_SPEAKER : ROLE_SIGNER)}
            aria-label="Switch your role"
            className={
              'pill bg-black/45 backdrop-blur ' +
              (myRole === ROLE_SIGNER ? 'text-primary' : 'text-secondary')
            }
          >
            {myRole === ROLE_SIGNER ? <Hand size={11} /> : <Ear size={11} />}
            YOU · {myRole === ROLE_SIGNER ? 'SIGN' : 'SPEAK'}
          </button>

          <span className={'pill bg-black/45 backdrop-blur ' + (peerRole ? 'text-ink' : 'text-ink-dim')}>
            {peerRole === ROLE_SPEAKER ? <Ear size={11} /> : <Hand size={11} />}
            THEM · {peerRole
              ? (peerRole === ROLE_SIGNER ? 'SIGN' : 'SPEAK')
              : (linkReady ? 'SYNCING' : 'ASSUMED')}
          </span>

          {listeningActive && (
            <span
              className={
                'pill bg-black/45 backdrop-blur ' +
                (sttState === 'listening' ? 'text-primary' : 'text-amber')
              }
            >
              <Mic size={11} />
              {sttState === 'listening' ? 'HEARING YOU' : sttState.toUpperCase()}
            </span>
          )}
        </div>
      </div>

      {/* Captions. Suppressed entirely between two signers: the whole point of
          that pairing is an unobstructed view of the hands. */}
      {captions && !cleanVideo && (
        <div className="pointer-events-none absolute inset-x-3 bottom-28 z-20 space-y-2">
          {relay === 'sign-to-speech' && (
            <>
              <CaptionCard
                label="THEM (SPEAKING)"
                tone="primary"
                text={incomingSpeech}
                placeholder={peerRole === ROLE_SPEAKER
                  ? 'Waiting for them to speak…'
                  : 'Their speech appears here once they connect.'}
                large
              />
              <CaptionCard
                label="YOU (SIGNING)"
                tone="secondary"
                text={signerLine}
                placeholder="Sign to caption…"
              />
            </>
          )}

          {relay === 'speech-to-sign' && (
            <>
              <CaptionCard
                label="THEM (SIGNING)"
                tone="primary"
                text={incomingSign}
                placeholder="Waiting for their signs…"
                large
              />
              <CaptionCard
                label="YOU (SPEAKING)"
                tone="secondary"
                text={mySpeech}
                placeholder={sttState === 'listening'
                  ? 'Listening…'
                  : 'Speech captions are not running.'}
              />
            </>
          )}

          {relay === 'voice' && (
            <p className="px-1 text-[10px] text-ink-dim">
              Both ends are hearing users — an ordinary call, with no
              translation running.
            </p>
          )}
        </div>
      )}

      {diagnostic && (
        <p className="absolute inset-x-4 bottom-24 z-40 rounded-lg bg-black/75 px-3 py-2 text-center text-xs text-amber backdrop-blur">
          {diagnostic.message}
        </p>
      )}

      {/* Bottom dock */}
      <div className="absolute inset-x-0 bottom-0 z-40 bg-gradient-to-t from-black/80 to-transparent pb-7 pt-10">
        <div className="flex items-center justify-center gap-3.5">
          <CallButton onClick={toggleMute} active={!muted} label={muted ? 'Unmute' : 'Mute'}>
            {muted ? <MicOff size={20} /> : <Mic size={20} />}
          </CallButton>

          <CallButton
            onClick={swap}
            active={swapped}
            tint="secondary"
            label="Swap the main and mini video"
          >
            <Repeat size={20} />
          </CallButton>

          <button
            type="button"
            onClick={endCall}
            aria-label="End call"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-rose shadow-[0_0_28px_-4px_rgba(244,63,94,0.8)] active:scale-95"
          >
            <PhoneOff size={26} className="text-white" />
          </button>

          <CallButton
            onClick={() => cameraManager.flip()}
            active={false}
            label={mirrored ? 'Switch to back camera' : 'Switch to front camera'}
          >
            <SwitchCamera size={20} />
          </CallButton>

          {myRole === ROLE_SPEAKER ? (
            <CallButton
              onClick={toggleVoiceOut}
              active={voiceOut}
              tint="secondary"
              label={voiceOut ? 'Stop speaking their signs' : 'Speak their signs aloud'}
            >
              {voiceOut ? <Volume2 size={20} /> : <VolumeX size={20} />}
            </CallButton>
          ) : (
            <CallButton
              onClick={() => setCaptions((v) => !v)}
              active={captions}
              tint="secondary"
              label="Captions"
            >
              <Captions size={20} />
            </CallButton>
          )}
        </div>
      </div>
    </div>
  );
}

function CaptionCard({ label, tone, text, placeholder, large = false }) {
  return (
    <div className="rounded-2xl bg-black/60 px-4 py-2.5 backdrop-blur">
      <p className={
        'text-[10px] font-bold tracking-wide ' +
        (tone === 'primary' ? 'text-primary' : 'text-secondary')
      }>
        {label}
      </p>
      <p className={
        (large ? 'text-base' : 'text-sm') + ' leading-snug ' +
        (text ? 'text-ink' : 'text-ink-dim')
      }>
        {text || placeholder}
      </p>
    </div>
  );
}

function RoleCard({ icon, title, subtitle, detail, active, tint, onClick }) {
  const ring = tint === 'primary'
    ? 'border-primary bg-primary/10 text-primary'
    : 'border-secondary bg-secondary/10 text-secondary';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded-xl border p-3 text-left ' +
        (active ? ring : 'border-white/10 bg-card-high text-ink-dim')
      }
    >
      <span className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-semibold">{title}</span>
      </span>
      <span className="mt-0.5 block text-[11px] opacity-80">{subtitle}</span>
      <span className="mt-1.5 block text-[10px] leading-snug opacity-70">{detail}</span>
    </button>
  );
}

function CallButton({ children, onClick, active, tint = 'ink', label }) {
  const on = tint === 'secondary'
    ? 'bg-secondary text-surface'
    : 'bg-white/90 text-surface';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={
        'flex h-12 w-12 items-center justify-center rounded-full ' +
        'backdrop-blur active:scale-95 ' +
        (active ? on : 'bg-white/15 text-white')
      }
    >
      {children}
    </button>
  );
}
