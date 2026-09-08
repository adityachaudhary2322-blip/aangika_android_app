import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Mic, MicOff, FlipHorizontal, Captions, PhoneOff, Copy, Video,
} from 'lucide-react';
import CameraStage from '../components/CameraStage.jsx';
import LandmarkCanvas from '../components/LandmarkCanvas.jsx';
import LanguageSelect from '../components/LanguageSelect.jsx';
import EngineToggle from '../components/EngineToggle.jsx';
import useSignPipeline from '../hooks/useSignPipeline.js';
import cameraManager from '../services/cameraManager.js';
import { translate } from '../services/translationService.js';
import { unlockAudio } from '../services/ttsService.js';
import { durationString } from '../lib/utils.js';

/**
 * WhatsApp-style P2P call.
 *
 * Layout follows the convention people already know: the remote person fills
 * the screen, you are a small draggable-looking card in the corner, and the
 * controls float at the bottom over the video rather than taking a row of their
 * own. Subtitles sit in the middle where the eye already is.
 *
 * The local card stays large enough to frame hands: a WhatsApp PiP is tiny
 * because it only needs to show a face, but a signer has to see their own hands
 * to know they are in frame.
 */

/**
 * Explicit STUN servers.
 *
 * PeerJS's default config is minimal, and on mobile carrier networks (CGNAT,
 * symmetric NAT) candidate gathering fails and the call silently never
 * connects. These are Google's public STUN servers.
 *
 * STUN only discovers your public address; it cannot relay. Roughly one call in
 * ten between two symmetric NATs still needs a TURN server, which must be
 * hosted and credentialed. Without one, some mobile-to-mobile calls will fail
 * however good the STUN list is.
 */
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export default function VideoCall({
  language, setLanguage, online, onBack, cameraError, mode,
  visionEngine, chooseVision,
}) {
  const [peerId, setPeerId] = useState('');
  const [remoteId, setRemoteId] = useState('');
  const [phase, setPhase] = useState('lobby');   // lobby | waiting | live
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [mirrored, setMirrored] = useState(() => cameraManager.isFrontCamera());

  // Mirroring follows the manager, never a local toggle.
  useEffect(() => cameraManager.subscribe((s) => setMirrored(s.isFrontCamera)), []);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState(null);
  const [signerLine, setSignerLine] = useState('');
  const [remoteLine] = useState('');

  const peerRef = useRef(null);
  const callRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const localStreamRef = useRef(null);

  const { words, stats, frameRef } = useSignPipeline({
    enabled: phase === 'live',
    mirrored,
    visionEngine,
  });

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
    localStreamRef.current?.getAudioTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
  }

  /**
   * Build the outgoing stream: shared camera video plus a fresh microphone
   * track. cameraManager owns a video-only stream so that switching views never
   * touches the camera; audio is added here, for the call only.
   */
  async function buildLocalStream() {
    await cameraManager.start();
    const video = cameraManager.getStream();
    const combined = new MediaStream();
    video?.getVideoTracks().forEach((t) => combined.addTrack(t));

    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      mic.getAudioTracks().forEach((t) => combined.addTrack(t));
      localStreamRef.current = mic;
    } catch {
      // A call without a microphone is still useful to a signer.
    }
    return combined;
  }

  async function ensurePeer() {
    if (peerRef.current) return peerRef.current;
    const { default: Peer } = await import('peerjs');
    const peer = new Peer({ config: { iceServers: ICE_SERVERS } });
    peerRef.current = peer;

    peer.on('open', (id) => setPeerId(id));
    peer.on('error', (err) => {
      setError(err?.message || String(err));
      setPhase('lobby');
    });
    peer.on('call', async (incoming) => {
      const stream = await buildLocalStream();
      incoming.answer(stream);
      wireCall(incoming);
    });
    return peer;
  }

  function wireCall(call) {
    callRef.current = call;
    call.on('stream', (stream) => {
      const el = remoteVideoRef.current;
      if (el) {
        el.srcObject = stream;
        // Autoplay policy: a remote video that is not muted can be blocked, so
        // ask forgiveness and retry muted rather than showing a frozen frame.
        el.play().catch(() => {
          el.muted = true;
          el.play().catch(() => {});
        });
      }
      setPhase('live');
    });
    call.on('close', () => setPhase('lobby'));
    call.on('error', (err) => setError(err?.message || String(err)));
  }

  async function createRoom() {
    setError(null);
    setPhase('waiting');
    try {
      await unlockAudio();   // inside the click, before any await that matters
      await buildLocalStream();
      await ensurePeer();
    } catch (err) {
      setError(err.message);
      setPhase('lobby');
    }
  }

  async function joinRoom() {
    if (!remoteId.trim()) return;
    setError(null);
    setPhase('waiting');
    try {
      await unlockAudio();
      const stream = await buildLocalStream();
      const peer = await ensurePeer();
      const call = peer.call(remoteId.trim(), stream);
      if (!call) throw new Error('Could not place the call. Check the room ID.');
      wireCall(call);
    } catch (err) {
      setError(err.message);
      setPhase('lobby');
    }
  }

  function endCall() {
    cleanup();
    setPhase('lobby');
    setSeconds(0);
    setPeerId('');
    setSignerLine('');
  }

  function toggleMute() {
    const next = !muted;
    setMuted(next);
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
  }

  // ── Lobby ────────────────────────────────────────────────────────
  if (phase !== 'live') {
    return (
      <div className="flex h-full flex-col px-4">
        <header className="flex items-center gap-2 py-3">
          <button type="button" onClick={onBack} className="flex h-9 w-9 items-center justify-center rounded-full bg-card-high">
            <ArrowLeft size={18} />
          </button>
          <h1 className="text-lg font-bold">Realtime Call</h1>
          <div className="ml-auto">
            <LanguageSelect value={language} onChange={setLanguage} />
          </div>
        </header>

        <div className="flex flex-1 flex-col justify-center gap-4">
          <div className="rounded-2xl border border-white/10 bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">
              Your room ID
            </p>
            {peerId ? (
              <>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg bg-card-high px-3 py-2 font-mono text-sm text-primary">
                    {peerId}
                  </code>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard?.writeText(peerId)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg bg-card-high"
                  >
                    <Copy size={16} />
                  </button>
                </div>
                <p className="mt-2 text-[11px] text-ink-dim">
                  Share this ID. The call starts when they join.
                </p>
              </>
            ) : (
              <button
                type="button"
                onClick={createRoom}
                disabled={!online || phase === 'waiting'}
                className="mt-2 w-full rounded-xl bg-primary py-3 font-semibold text-surface disabled:opacity-40"
              >
                {phase === 'waiting' ? 'Starting…' : 'Create room'}
              </button>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">
              Join a room
            </p>
            <input
              value={remoteId}
              onChange={(e) => setRemoteId(e.target.value)}
              placeholder="Paste room ID"
              className="mt-2 w-full rounded-lg border border-white/10 bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-secondary"
            />
            <button
              type="button"
              onClick={joinRoom}
              disabled={!remoteId.trim() || !online || phase === 'waiting'}
              className="mt-2 w-full rounded-xl bg-secondary py-3 font-semibold text-surface disabled:opacity-40"
            >
              {phase === 'waiting' ? 'Connecting…' : 'Join call'}
            </button>
          </div>

          {!online && (
            <p className="text-center text-xs text-amber">
              Calling needs a network connection.
            </p>
          )}
          {error && <p className="text-center text-xs text-rose">{error}</p>}
          {cameraError && <p className="text-center text-xs text-rose">{cameraError}</p>}

          <p className="text-center text-[10px] leading-relaxed text-ink-dim">
            Peer-to-peer over STUN. Some mobile networks sit behind a symmetric
            NAT that STUN cannot traverse; those calls need a TURN relay, which
            this build does not have.
          </p>
        </div>
      </div>
    );
  }

  // ── Live call: WhatsApp layout ───────────────────────────────────
  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {/* Remote fills the screen. */}
      <video
        ref={remoteVideoRef}
        autoPlay
        playsInline
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Top scrim: duration, language, captions toggle. */}
      <div className="absolute inset-x-0 top-0 z-20 bg-gradient-to-b from-black/70 to-transparent p-3">
        <div className="flex items-center gap-2">
          <span className="pill bg-black/45 font-mono text-ink backdrop-blur">
            {durationString(seconds)}
          </span>
          <span className="pill bg-black/45 text-primary backdrop-blur">
            ⚡ P2P
          </span>
          <div className="ml-auto flex items-center gap-2">
            <EngineToggle value={visionEngine} onChange={chooseVision} compact />
            <LanguageSelect
              value={language}
              onChange={setLanguage}
              variant="overlay"
            />
          </div>
        </div>
      </div>

      {/* Local PiP, top-right under the scrim. Deliberately larger than a
          WhatsApp thumbnail: a signer must see their own hands. */}
      <div className="absolute right-3 top-16 z-30 h-44 w-32 overflow-hidden rounded-2xl border border-white/25 bg-surface-low shadow-2xl">
        <CameraStage className="absolute inset-0" />
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

      {/* Floating centre subtitles. */}
      {captions && (
        <div className="pointer-events-none absolute inset-x-3 top-1/2 z-20 -translate-y-1/2 space-y-2">
          {remoteLine && (
            <div className="rounded-2xl bg-black/60 px-4 py-2.5 backdrop-blur">
              <p className="text-[10px] font-bold tracking-wide text-amber">
                THEM
              </p>
              <p className="text-base leading-snug text-ink">{remoteLine}</p>
            </div>
          )}
          <div className="rounded-2xl bg-black/60 px-4 py-2.5 backdrop-blur">
            <p className="text-[10px] font-bold tracking-wide text-secondary">
              YOU (SIGNING)
            </p>
            <p className="text-base leading-snug text-ink">
              {signerLine || 'Sign to caption…'}
            </p>
          </div>
          {!remoteLine && (
            <p className="px-1 text-[10px] text-ink-dim">
              Incoming speech is not transcribed in this build.
            </p>
          )}
        </div>
      )}

      {/* Bottom floating controls. */}
      <div className="absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/80 to-transparent pb-7 pt-10">
        <div className="flex items-center justify-center gap-5">
          <CallButton
            onClick={toggleMute}
            active={!muted}
            label={muted ? 'Unmute' : 'Mute'}
          >
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

      {error && (
        <p className="absolute inset-x-4 bottom-32 z-40 rounded-lg bg-rose/90 px-3 py-2 text-center text-xs">
          {error}
        </p>
      )}
    </div>
  );
}

function CallButton({ children, onClick, active, tint = 'ink', label }) {
  const on =
    tint === 'secondary'
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
