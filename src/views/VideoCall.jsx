import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Mic, MicOff, FlipHorizontal, Captions, PhoneOff, Copy, Check,
  Loader2, AlertTriangle, Signal,
} from 'lucide-react';
import LandmarkCanvas from '../components/LandmarkCanvas.jsx';
import LanguageSelect from '../components/LanguageSelect.jsx';
import EngineToggle from '../components/EngineToggle.jsx';
import useSignPipeline from '../hooks/useSignPipeline.js';
import cameraManager from '../services/cameraManager.js';
import { translate } from '../services/translationService.js';
import { unlockAudio } from '../services/ttsService.js';
import {
  buildIceServers, testIceServers, getTurnCredentials,
} from '../services/iceConfig.js';
import { durationString } from '../lib/utils.js';

/**
 * WhatsApp-style P2P call over PeerJS.
 *
 * Signalling goes through PeerJS's public broker; media is direct when the NAT
 * allows it and relayed through TURN when it does not (see iceConfig.js).
 *
 * Nothing about the identity is hardcoded: the room code is whatever the broker
 * assigns, and no call can be placed until the broker has confirmed the
 * registration by emitting 'open'. Calling before that is the classic silent
 * failure -- peer.id is undefined, peer.call() returns null, and the UI sits on
 * "Connecting..." forever with nothing in the console.
 */

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
  const [mirrored, setMirrored] = useState(() => cameraManager.isFrontCamera());
  const [seconds, setSeconds] = useState(0);
  const [diagnostic, setDiagnostic] = useState(null);
  const [iceReport, setIceReport] = useState(null);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [signerLine, setSignerLine] = useState('');
  const [connectionState, setConnectionState] = useState('');

  const peerRef = useRef(null);
  const callRef = useRef(null);
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const micStreamRef = useRef(null);

  const { words, stats, frameRef } = useSignPipeline({
    enabled: phase === 'live',
    mirrored,
    visionEngine,
    language,
    mode,
    // Deliberately NOT auto-speaking here: the other party already hears the
    // synthesised voice over the call, so speaking locally would echo back.
    autoSpeak: false,
  });

  const turn = getTurnCredentials();

  // Mirroring follows the camera manager, never a local toggle.
  useEffect(() => cameraManager.subscribe((s) => setMirrored(s.isFrontCamera)), []);

  useEffect(() => {
    if (phase !== 'live') return undefined;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Recognised tags -> outgoing subtitle, in the selected language.
  useEffect(() => {
    if (!captions || words.length === 0) return undefined;
    let cancelled = false;
    translate(words.map((w) => w.word), language, { mode }).then((r) => {
      if (!cancelled) setSignerLine(r.translated || r.english);
    });
    return () => { cancelled = true; };
  }, [words, captions, language, mode]);

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    try { callRef.current?.close(); } catch { /* already closed */ }
    try { peerRef.current?.destroy(); } catch { /* already destroyed */ }
    callRef.current = null;
    peerRef.current = null;
    micStreamRef.current?.getAudioTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
  }

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
    if (phase !== 'live') return undefined;
    attachLocalPreview();
    // Re-bind periodically: flipping the camera swaps the underlying stream.
    const id = setInterval(attachLocalPreview, 1000);
    return () => clearInterval(id);
  }, [phase, attachLocalPreview]);

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
        message: 'No microphone — you will be seen but not heard.',
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
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    micStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
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

  if (phase !== 'live') {
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

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* Remote fills the screen. */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Top scrim */}
      <div className="absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent p-3">
        <div className="flex items-center gap-2">
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
            <EngineToggle value={visionEngine} onChange={chooseVision} compact />
            <LanguageSelect value={language} onChange={setLanguage} variant="overlay" />
          </div>
        </div>
      </div>

      {/* Local PiP — its own <video> on the shared stream, muted + playsInline */}
      <div className="absolute right-3 top-16 z-30 h-44 w-32 overflow-hidden rounded-2xl border border-white/25 bg-surface-low shadow-2xl">
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="h-full w-full object-cover"
          style={{ transform: mirrored ? 'scaleX(-1)' : 'none' }}
        />
        <LandmarkCanvas frameRef={frameRef} mirrored={mirrored} />
        <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[9px]">
          {stats.fps} fps
        </span>
        <button
          type="button"
          onClick={() => cameraManager.flip()}
          className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 backdrop-blur"
          aria-label={mirrored ? 'Switch to back camera' : 'Switch to front camera'}
        >
          <FlipHorizontal size={13} />
        </button>
      </div>

      {/* Floating centre subtitles */}
      {captions && (
        <div className="pointer-events-none absolute inset-x-3 top-1/2 z-20 -translate-y-1/2 space-y-2">
          <div className="rounded-2xl bg-black/60 px-4 py-2.5 backdrop-blur">
            <p className="text-[10px] font-bold tracking-wide text-secondary">
              YOU (SIGNING)
            </p>
            <p className="text-base leading-snug text-ink">
              {signerLine || 'Sign to caption…'}
            </p>
          </div>
          <p className="px-1 text-[10px] text-ink-dim">
            Incoming speech is not transcribed in this build.
          </p>
        </div>
      )}

      {diagnostic && (
        <p className="absolute inset-x-4 bottom-32 z-40 rounded-lg bg-black/75 px-3 py-2 text-center text-xs text-amber backdrop-blur">
          {diagnostic.message}
        </p>
      )}

      {/* Bottom controls */}
      <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/80 to-transparent pb-7 pt-10">
        <div className="flex items-center justify-center gap-5">
          <CallButton onClick={toggleMute} active={!muted} label={muted ? 'Unmute' : 'Mute'}>
            {muted ? <MicOff size={22} /> : <Mic size={22} />}
          </CallButton>

          <CallButton
            onClick={() => setCaptions((v) => !v)}
            active={captions}
            tint="secondary"
            label="Captions"
          >
            <Captions size={22} />
          </CallButton>

          <button
            type="button"
            onClick={endCall}
            aria-label="End call"
            className="flex h-16 w-16 items-center justify-center rounded-full bg-rose shadow-[0_0_28px_-4px_rgba(244,63,94,0.8)] active:scale-95"
          >
            <PhoneOff size={26} className="text-white" />
          </button>
        </div>
      </div>
    </div>
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
        'flex h-13 w-13 items-center justify-center rounded-full p-3.5 ' +
        'backdrop-blur active:scale-95 ' +
        (active ? on : 'bg-white/15 text-white')
      }
    >
      {children}
    </button>
  );
}
