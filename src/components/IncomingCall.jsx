import { useEffect, useState } from 'react';
import { Phone, PhoneOff, Video } from 'lucide-react';
import { useCall } from '../context/CallContext.jsx';
import { getContact, ROLE_SPEAKER } from '../services/chatStorage.js';

/**
 * The ringing screen.
 *
 * Mounted at the root so a call can arrive on ANY view — that is the whole
 * reason CallContext holds the registration above the router. Accepting has to
 * happen inside a real click: answering starts getUserMedia and unlocks audio,
 * and both are gated on a user gesture on mobile.
 *
 * There is deliberately no auto-answer and no timeout-to-voicemail. Nothing
 * here can take a message, so silently dropping the call after N seconds would
 * just lose it.
 */
export default function IncomingCall() {
  const { call, acceptCall, rejectCall } = useCall();
  const [busy, setBusy] = useState(false);

  const ringing = call.status === 'ringing';
  const contact = ringing ? getContact(call.handle) : null;
  const name = contact?.name || call.handle || 'Someone';

  // Reset the guard between calls, or a second call arrives with the accept
  // button already disabled.
  useEffect(() => {
    if (!ringing) setBusy(false);
  }, [ringing]);

  if (!ringing) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-6 bg-surface px-6">
      <div className="flex flex-col items-center gap-3">
        <span className="relative flex h-24 w-24 items-center justify-center">
          <span className="absolute h-24 w-24 rounded-full border border-primary/50 animate-pulse-ring" />
          <span className="flex h-24 w-24 items-center justify-center rounded-full bg-primary/15 text-3xl font-bold text-primary">
            {String(name).slice(0, 2).toUpperCase()}
          </span>
        </span>

        <p className="text-2xl font-bold">{name}</p>
        <p className="flex items-center gap-1.5 text-xs text-ink-dim">
          <Video size={13} /> Incoming video call
          {contact && (
            <span>· {contact.role === ROLE_SPEAKER ? '🗣️ Speaker' : '🤟 Signer'}</span>
          )}
        </p>
      </div>

      <div className="flex items-center gap-10">
        <button
          type="button"
          onClick={rejectCall}
          aria-label="Decline"
          className="flex flex-col items-center gap-2"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-rose shadow-[0_0_28px_-4px_rgba(244,63,94,0.7)] active:scale-95">
            <PhoneOff size={26} className="text-white" />
          </span>
          <span className="text-[10px] font-semibold tracking-wide text-ink-dim">
            DECLINE
          </span>
        </button>

        <button
          type="button"
          onClick={() => { setBusy(true); acceptCall(); }}
          disabled={busy}
          aria-label="Accept"
          className="flex flex-col items-center gap-2"
        >
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary shadow-glow active:scale-95">
            <Phone size={26} className="text-white" />
          </span>
          <span className="text-[10px] font-semibold tracking-wide text-ink-dim">
            {busy ? 'CONNECTING…' : 'ACCEPT'}
          </span>
        </button>
      </div>
    </div>
  );
}
