import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Mic, MicOff, SwitchCamera, Captions, PhoneOff, Copy, Loader2,
} from 'lucide-react';
import CameraStage from '../components/CameraStage.jsx';
import LandmarkCanvas from '../components/LandmarkCanvas.jsx';
import useSignPipeline from '../hooks/useSignPipeline.js';
import cameraManager from '../services/cameraManager.js';
import { reconstruct } from '../services/translator.js';
import { durationString } from '../lib/utils.js';

/**
 * PeerJS P2P call.
 *
 * PeerJS is loaded lazily, on the first Create/Join, so opening this view does
 * not cost a signalling connection to the public broker. That broker is fine
 * for a demo but is a third party: for anything real, host your own PeerServer.
 */
export default function VideoCall({ language, online, onBack, cameraError }) {
  const [peerId, setPeerId] = useState('');
  const [remoteId, setRemoteId] = useState('');
  const [phase, setPhase] = useState('lobby');   // lobby | connecting | live
  const [muted, setMuted] = useState(false);
  const [captions, setCaptions] = useState(true);
  const [mirrored, setMirrored] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState(null);
  const [signerLine, setSignerLine] = useState('');

  const peerRef = useRef(null);
  const callRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const { words, stats, frameRef } = useSignPipeline({
    enabled: phase === 'live',
    mirrored,
  });

  // Call timer.
  useEffect(() => {
    if (phase !== 'live') return undefined;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Turn recognised tags into the outgoing subtitle line.
  useEffect(() => {
    if (!captions || words.length === 0) return;
    let cancelled = false;
    reconstruct(words.map((w) => w.word), language).then((r) => {
      if (!cancelled) setSignerLine(r.english);
    });
    return () => { cancelled = true; };
  }, [words, captions, language]);

  useEffect(() => () => cleanup(), []);

  function cleanup() {
    try { callRef.current?.close(); } catch { /* already closed */ }
    try { peerRef.current?.destroy(); } catch { /* already destroyed */ }
    callRef.current = null;
    peerRef.current = null;
  }

  async function ensurePeer() {
    if (peerRef.current) return peerRef.current;
    const { default: Peer } = await import('peerjs');
    const peer = new Peer();
    peerRef.current = peer;

    peer.on('open', (id) => setPeerId(id));
    peer.on('error', (err) => {
      setError(err.message || String(err));
      setPhase('lobby');
    });
    peer.on('call', async (incoming) => {
      const stream = await cameraManager.start().then(() => cameraManager.getStream());
      incoming.answer(stream || undefined);
      wireCall(incoming);
    });
    return peer;
  }

  function wireCall(call) {
    callRef.current = call;
    call.on('stream', (stream) => {
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = stream;
      setPhase('live');
    });
    call.on('close', () => setPhase('lobby'));
    call.on('error', (err) => setError(err.message || String(err)));
  }

  async function createRoom() {
    setError(null);
    setPhase('connecting');
    try {
      await cameraManager.start();
      await ensurePeer();
      // Stay in "connecting" until a peer actually calls in.
    } catch (err) {
      setError(err.message);
      setPhase('lobby');
    }
  }

  async function joinRoom() {
    if (!remoteId.trim()) return;
    setError(null);
    setPhase('connecting');
    try {
      await cameraManager.start();
      const peer = await ensurePeer();
      const stream = cameraManager.getStream();
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
  }

  function toggleMute() {
    const stream = cameraManager.getStream();
    const next = !muted;
    setMuted(next);
    // The shared stream is video-only; audio tracks only exist while a call is
    // negotiated, so guard rather than assume.
    stream?.getAudioTracks().forEach((t) => { t.enabled = !next; });
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
        </header>

        <div className="flex flex-1 flex-col justify-center gap-4">
          <div className="rounded-2xl border border-white/10 bg-card p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-dim">
              Your room ID
            </p>
            {peerId ? (
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
            ) : (
              <button
                type="button"
                onClick={createRoom}
                disabled={!online}
                className="mt-2 w-full rounded-xl bg-primary py-3 font-semibold text-surface disabled:opacity-40"
              >
                {phase === 'connecting'
                  ? 'Waiting for someone to join…'
                  : 'Create room'}
              </button>
            )}
            {peerId && (
              <p className="mt-2 text-[11px] text-ink-dim">
                Share this ID. The call starts when they join.
              </p>
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
              disabled={!remoteId.trim() || !online}
              className="mt-2 w-full rounded-xl bg-secondary py-3 font-semibold text-surface disabled:opacity-40"
            >
              {phase === 'connecting' ? 'Connecting…' : 'Join call'}
            </button>
          </div>

          {!online && (
            <p className="text-center text-xs text-amber">
              Calling needs a network connection.
            </p>
          )}
          {error && <p className="text-center text-xs text-rose">{error}</p>}
          {cameraError && <p className="text-center text-xs text-rose">{cameraError}</p>}
        </div>
      </div>
    );
  }

  // ── Live call ────────────────────────────────────────────────────
  return (
    <div className="relative flex h-full flex-col bg-surface-low">
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className="font-mono text-sm font-bold">{durationString(seconds)}</span>
        <span className="pill border-primary/40 bg-primary/10 text-primary">
          ⚡ P2P Encrypted
        </span>
      </header>

      {/* Remote */}
      <div className="relative mx-3 flex-1 overflow-hidden rounded-2xl border border-white/10 bg-card">
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="h-full w-full object-cover"
        />
        <span className="absolute bottom-3 left-3 rounded-lg bg-black/60 px-2.5 py-1 text-[11px] backdrop-blur">
          Remote participant
        </span>
      </div>

      {/* Subtitles */}
      {captions && (
        <div className="px-3 py-2">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
            Bi-Directional Translation
          </p>
          <div className="rounded-xl border border-amber/35 bg-amber/10 px-3 py-2">
            <p className="text-[10px] font-bold text-amber">HEARING REMOTE</p>
            <p className="text-sm">Audio captions are not wired up yet.</p>
          </div>
          <div className="mt-1.5 rounded-xl border border-secondary/35 bg-secondary/10 px-3 py-2">
            <p className="text-[10px] font-bold text-secondary">YOU (SIGNER)</p>
            <p className="text-sm">{signerLine || 'Sign to caption…'}</p>
          </div>
        </div>
      )}

      {/* Local */}
      <div className="relative mx-3 mb-24 flex-1 overflow-hidden rounded-2xl border border-primary/35">
        <CameraStage mirrored={mirrored} className="absolute inset-0" />
        <LandmarkCanvas frameRef={frameRef} mirrored={mirrored} />
        <span className="absolute bottom-3 left-3 rounded-lg bg-black/60 px-2.5 py-1 text-[11px] backdrop-blur">
          You (ISL landmarks active)
        </span>
        <span className="absolute right-3 top-3 rounded-lg bg-black/55 px-2 py-1 font-mono text-[10px] backdrop-blur">
          {stats.fps} FPS HandMesh
        </span>
      </div>

      {/* Dock */}
      <div className="absolute inset-x-0 bottom-4 flex justify-center">
        <div className="glass flex items-center gap-3 rounded-full px-4 py-2.5">
          <DockButton onClick={toggleMute} active={!muted}>
            {muted ? <MicOff size={20} /> : <Mic size={20} />}
          </DockButton>
          <DockButton
            onClick={() => { cameraManager.flip(); setMirrored((v) => !v); }}
          >
            <SwitchCamera size={20} />
          </DockButton>
          <DockButton onClick={() => setCaptions((v) => !v)} active={captions} cyan>
            <Captions size={20} />
          </DockButton>
          <button
            type="button"
            onClick={endCall}
            className="flex h-13 w-13 items-center justify-center rounded-full bg-rose p-3.5"
          >
            <PhoneOff size={20} className="text-surface" />
          </button>
        </div>
      </div>
    </div>
  );
}

function DockButton({ children, onClick, active = false, cyan = false }) {
  const tint = cyan
    ? 'border-secondary/60 bg-secondary/20 text-secondary'
    : 'border-white/25 bg-white/10 text-ink';
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'flex h-12 w-12 items-center justify-center rounded-full border ' +
        (active ? tint : 'border-white/10 bg-card-high text-ink-dim')
      }
    >
      {children}
    </button>
  );
}
