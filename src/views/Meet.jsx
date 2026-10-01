import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Copy, Check, Share2, Mic, MicOff, Video, VideoOff, Captions,
  CaptionsOff, Volume2, VolumeX, MessageSquare, PhoneOff, Users, Loader2,
  Hand, AudioLines, Send, X, LogIn, Plus, AtSign,
} from 'lucide-react';
import { useCall } from '../context/CallContext.jsx';
import useMeeting, {
  newRoomCode, normaliseCode, formatCode, inviteLink,
} from '../hooks/useMeeting.js';
import useIslSigns from '../hooks/useIslSigns.js';
import useIslSentence from '../hooks/useIslSentence.js';
import useLiveSpeech from '../hooks/useLiveSpeech.js';
import cameraManager from '../services/cameraManager.js';
import { speak, unlockAudio } from '../services/ttsService.js';
import { ROLE_SIGNER, ROLE_SPEAKER } from '../services/chatStorage.js';
import { getUser } from '../services/session.js';

/** How long a caption stays on a tile after the person stops. */
const CAPTION_MS = 7000;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/**
 * One-to-one video calls with translation both ways. Before starting or
 * joining, each person says whether they SIGN or SPEAK in this call; that
 * decides what their device runs:
 *   signer  -> ISL Studio (the team's dictionary) reads the signs; the words
 *              appear as they are signed, and the finished sentence (FULL STOP,
 *              or a pause) is sent and SPOKEN on the other phone;
 *   speaker -> live speech recognition; the words appear as captions on the
 *              signer's screen.
 */
const ROLE_KEY = 'aangika-meet-role';
// Send a sentence without FULL STOP: hands down 1.5 s, or no new sign for 6 s
// (a shorter pause with the hands up split sentences, so rules never matched).
const AUTO_SEND = { handsDownMs: 1500, idleMs: 6000 };

export default function Meet({
  onBack, language, mode, initialCode = '', onLiveChange,
}) {
  const { profile } = useCall();
  const [role, setRoleState] = useState(() => {
    try { return localStorage.getItem(ROLE_KEY) || profile?.role || ROLE_SIGNER; } catch { return ROLE_SIGNER; }
  });
  const setRole = (r) => { setRoleState(r); try { localStorage.setItem(ROLE_KEY, r); } catch { /* not remembered */ } };
  const account = getUser();
  const me = useMemo(() => ({
    name: account?.name ? account.name : profile?.auto ? `Guest ${profile.handle.slice(0, 3).toUpperCase()}` : (profile?.name || 'Guest'),
    role,
    uid: profile?.handle,
  }), [profile, role, account?.name]);
  const meeting = useMeeting(me);
  const live = meeting.status === 'live' || meeting.status === 'starting';

  useEffect(() => { onLiveChange?.(live); }, [live, onLiveChange]);
  useEffect(() => () => onLiveChange?.(false), [onLiveChange]);

  if (live) {
    return <Room meeting={meeting} me={me} language={language} mode={mode} />;
  }
  return (
    <Lobby
      meeting={meeting}
      profile={profile}
      onBack={onBack}
      initialCode={initialCode}
      role={role}
      setRole={setRole}
    />
  );
}

// ── Lobby ───────────────────────────────────────────────────────────────────

function Lobby({ meeting, profile, onBack, initialCode, role, setRole }) {
  const [joinCode, setJoinCode] = useState(initialCode);
  const [copied, setCopied] = useState(false);
  const [asking, setAsking] = useState(null);             // { fn, code } waiting for "sign or speak?"

  // Every call starts with the question: it decides what this device runs.
  const start = (fn, code) => setAsking({ fn, code });
  const go = async (r) => {
    setRole(r);
    const { fn, code } = asking;
    setAsking(null);
    await unlockAudio();
    setTimeout(() => fn(code), 0);                        // once the role is applied
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 pb-8 no-scrollbar">
      <header className="flex items-center gap-2 pb-3 pt-4 lg:pt-6">
        <button type="button" onClick={onBack} aria-label="Back" className="btn-icon lg:hidden">
          <ArrowLeft size={18} />
        </button>
        <h1 className="display text-3xl">Meet</h1>
      </header>
      <p className="max-w-prose text-sm text-ink-dim">
        A one-to-one video call that translates both ways: signs are spoken to
        the other person, and speech appears as captions for the signer.
      </p>

      {asking && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center" role="dialog" aria-modal="true" aria-label="Do you sign or speak?">
          <div className="surface-card w-full max-w-md space-y-3 p-5">
            <p className="display text-xl">In this call, do you…</p>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => go(ROLE_SIGNER)} className={'rounded-3xl border p-4 text-left ' + (role === ROLE_SIGNER ? 'border-primary bg-primary/10' : 'border-subtle bg-card')}>
                <Hand size={22} className="text-primary" />
                <p className="mt-2 font-semibold">Sign</p>
                <p className="text-[11px] text-ink-dim">ISL Studio reads your signs; they are spoken to the other person.</p>
              </button>
              <button type="button" onClick={() => go(ROLE_SPEAKER)} className={'rounded-3xl border p-4 text-left ' + (role === ROLE_SPEAKER ? 'border-primary bg-primary/10' : 'border-subtle bg-card')}>
                <AudioLines size={22} className="text-primary" />
                <p className="mt-2 font-semibold">Speak</p>
                <p className="text-[11px] text-ink-dim">Your speech becomes their captions; their signs are read aloud to you.</p>
              </button>
            </div>
            <button type="button" onClick={() => setAsking(null)} className="btn-quiet w-full py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      {meeting.status === 'ended' && (
        <p className="mt-4 rounded-2xl border border-subtle bg-card-high px-4 py-3 text-sm">
          The meeting has ended.
        </p>
      )}
      {meeting.status === 'error' && (
        <p className="mt-4 rounded-2xl border border-rose/30 bg-rose/10 px-4 py-3 text-sm text-rose">
          {meeting.error}
        </p>
      )}

      {/* Your ID */}
      <section className="surface-card mt-5 flex items-center gap-4 p-4" data-tour="my-id">
        <span className="icon-well h-12 w-12 bg-primary/10 text-primary"><AtSign size={20} /></span>
        <div className="min-w-0 flex-1">
          <p className="eyebrow">Your ID</p>
          <p className="truncate font-mono text-xl font-semibold tracking-wide">{profile?.handle}</p>
          <p className="text-[11px] text-ink-dim">Friends message, call and invite you with this.</p>
        </div>
        <button
          type="button"
          onClick={async () => { if (await copyText(profile?.handle || '')) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
          aria-label="Copy your ID"
          className="btn-icon h-10 w-10"
        >
          {copied ? <Check size={16} className="text-secondary" /> : <Copy size={16} />}
        </button>
      </section>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Create */}
        <section className="surface-card p-5" data-tour="meet-create">
          <p className="display text-xl">Start a meeting</p>
          <p className="mt-1 text-xs text-ink-dim">
            Use your ID as the room code so people can always find you, or
            make a one-off code for this meeting.
          </p>
          <div className="mt-4 grid gap-2">
            <button type="button" onClick={() => start(meeting.host, profile?.handle)} className="btn-primary">
              <Users size={16} /> Start with my ID
            </button>
            <button type="button" onClick={() => start(meeting.host, newRoomCode())} className="btn-quiet">
              <Plus size={16} /> New room code
            </button>
          </div>
        </section>

        {/* Join */}
        <form
          className="surface-card p-5"
          data-tour="meet-join"
          onSubmit={(e) => { e.preventDefault(); const c = normaliseCode(joinCode); if (c) start(meeting.join, c); }}
        >
          <p className="display text-xl">Join a meeting</p>
          <p className="mt-1 text-xs text-ink-dim">
            Type the room code, or the ID of the person hosting. A pasted
            invite link works too.
          </p>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value)}
            placeholder="e.g. K7M-2QP or asha"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            aria-label="Room code"
            className="field mt-4 font-mono tracking-wide"
          />
          <button type="submit" disabled={normaliseCode(joinCode).length < 3} className="btn-primary mt-2 w-full">
            <LogIn size={16} /> Join
          </button>
        </form>
      </div>
    </div>
  );
}

// ── Room ────────────────────────────────────────────────────────────────────

function Room({ meeting, me, language, mode }) {
  const {
    status, code, isHost, people, messages, mic, cam, selfId,
    setMic, setCam, sendCaption, sendChat, leave,
  } = meeting;
  const signer = me.role !== ROLE_SPEAKER;
  const [captionsOn, setCaptionsOn] = useState(true);
  const [readAloud, setReadAloud] = useState(true);
  const [chatOpen, setChatOpen] = useState(false);
  const [copied, setCopied] = useState(null);
  const [seenChat, setSeenChat] = useState(0);
  const [mine, setMine] = useState('');                 // what I am sending, shown on my screen
  const live = status === 'live';

  // ── Signer: ISL Studio reads the signs ────────────────────────────────
  const { signs } = useIslSigns();
  const studio = useIslSentence({
    signs,
    active: signer && captionsOn && live,
    language,
    mode,
    autoSend: AUTO_SEND,
    onSentence: (r) => {
      const text = r.translated || r.english;
      if (!text) return;
      setMine(text);
      sendCaption(text, 'sign', { final: true, lang: language });
    },
  });
  // The words so far travel as they are signed (shown there, not spoken).
  const partial = studio.sentence.map((x) => x.word).join(' ');
  useEffect(() => {
    if (!signer || !partial) return undefined;
    setMine(`${partial} …`);
    sendCaption(`${partial} …`, 'sign');
    return undefined;
  }, [partial]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Speaker: live speech -> captions on the signer's screen ───────────
  const speech = useLiveSpeech({
    enabled: !signer && captionsOn && live,
    lang: language,
    onPartial: (t) => { setMine(t); sendCaption(t, 'speech'); },
    onFinal: (t) => { setMine(t); sendCaption(t, 'speech', { final: true, lang: language }); },
  });

  // ── The other person's finished SIGN sentences, spoken aloud here ─────
  const spokenRef = useRef(new Map());
  useEffect(() => {
    if (!readAloud) return;
    for (const p of Object.values(people)) {
      const c = p.caption;
      if (p.self || !c || c.kind !== 'sign' || !c.final) continue;
      if (spokenRef.current.get(p.id) === c.at) continue;
      spokenRef.current.set(p.id, c.at);
      speak(c.text, c.lang || language);
    }
  }, [people, readAloud, language]);

  const list = Object.values(people);
  const self = list.find((p) => p.self);
  const other = list.find((p) => !p.self);
  const unreadChat = messages.filter((m) => !m.system).length - seenChat;

  const share = async () => {
    const url = inviteLink(code);
    if (navigator.share) {
      try { await navigator.share({ title: 'Join my Aangika call', text: `Room ${formatCode(code)}`, url }); return; } catch { /* cancelled */ }
    }
    if (await copyText(url)) { setCopied('link'); setTimeout(() => setCopied(null), 1500); }
  };

  const notice = signer
    ? (!signs.length ? 'ISL Studio has no signs yet: record them in ISL Studio → Dictionary.'
      : studio.error || (!studio.ready && captionsOn ? 'Loading hand and body tracking…' : null))
    : speech.error;

  return (
    <div className="flex h-full flex-col lg:flex-row lg:gap-4 lg:p-4">
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Header */}
        <header className="flex flex-wrap items-center gap-2 px-4 py-3 lg:px-0 lg:pt-0">
          <span className="pill border-subtle bg-card py-1.5 font-mono text-sm font-semibold tracking-wide">
            {formatCode(code)}
          </span>
          {isHost && <span className="pill border-primary/30 bg-primary/10 text-primary">Host</span>}
          <span className="pill border-subtle bg-card text-ink-dim">
            {signer
              ? <><Hand size={12} /> You sign · ISL Studio</>
              : <><AudioLines size={12} /> You speak{speech.engine ? ` · ${speech.engine}` : ''}</>}
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={async () => { if (await copyText(code)) { setCopied('code'); setTimeout(() => setCopied(null), 1500); } }}
              className="btn-quiet px-3 py-2 text-xs"
            >
              {copied === 'code' ? <Check size={14} /> : <Copy size={14} />} Code
            </button>
            <button type="button" onClick={share} className="btn-quiet px-3 py-2 text-xs">
              {copied === 'link' ? <Check size={14} /> : <Share2 size={14} />} Invite
            </button>
          </div>
        </header>

        {status === 'starting' ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 text-sm text-ink-dim">
            <Loader2 size={24} className="animate-spin text-primary" />
            {isHost ? 'Opening the call…' : `Joining ${formatCode(code)}…`}
          </div>
        ) : (
          <div className="relative mx-2 min-h-0 flex-1 lg:mx-0">
            {/* The other person fills the stage; you are the small picture. */}
            {other ? <Tile person={other} main /> : self && <Tile person={self} main />}
            {!other && live && (
              <p className="chrome-plate pointer-events-none absolute inset-x-4 top-4 rounded-2xl px-3 py-2 text-center text-xs text-ink">
                Waiting for the other person. Share the code <b className="font-mono">{formatCode(code)}</b> or tap Invite.
              </p>
            )}
            {other && self && (
              <div className="absolute right-3 top-3 z-10 aspect-[3/4] w-28 overflow-hidden rounded-2xl border border-subtle shadow-card sm:w-40">
                <Tile person={self} />
              </div>
            )}
          </div>
        )}

        {/* What I am sending */}
        {captionsOn && live && (
          <p className="mx-4 mt-2 min-h-[1.25rem] text-center text-xs text-ink-dim" aria-live="polite">
            {notice || (mine
              ? <><span className="font-semibold text-ink">You {signer ? 'signed' : 'said'}:</span> {mine}</>
              : signer ? 'Sign, then FULL STOP or lower your hands to send the sentence.' : 'Speak: your words appear on their screen.')}
          </p>
        )}

        {/* Controls */}
        <footer className="flex items-center justify-center gap-2 px-4 py-3 lg:pb-0">
          <Ctl on={mic} onClick={() => setMic(!mic)} label={mic ? 'Mute' : 'Unmute'} OnIcon={Mic} OffIcon={MicOff} />
          <Ctl on={cam} onClick={() => setCam(!cam)} label={cam ? 'Camera off' : 'Camera on'} OnIcon={Video} OffIcon={VideoOff} />
          <Ctl
            on={captionsOn}
            onClick={() => setCaptionsOn((v) => !v)}
            label={signer ? 'Translate my signing' : 'Caption my speech'}
            OnIcon={Captions}
            OffIcon={CaptionsOff}
          />
          <Ctl on={readAloud} onClick={() => setReadAloud((v) => !v)} label="Speak their signs aloud" OnIcon={Volume2} OffIcon={VolumeX} />
          <button
            type="button"
            onClick={() => { setChatOpen((v) => !v); setSeenChat(messages.filter((m) => !m.system).length); }}
            aria-label="Chat"
            className="relative flex h-12 w-12 items-center justify-center rounded-full border border-subtle bg-card text-ink transition hover:border-strong"
          >
            <MessageSquare size={19} />
            {unreadChat > 0 && !chatOpen && (
              <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose px-1 text-[10px] font-bold text-white">
                {unreadChat}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={leave}
            aria-label={isHost ? 'End call' : 'Leave call'}
            className="flex h-12 items-center gap-2 rounded-full bg-rose px-5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-95"
          >
            <PhoneOff size={18} /> {isHost ? 'End' : 'Leave'}
          </button>
        </footer>
      </div>

      {chatOpen && (
        <Chat
          messages={messages}
          selfId={selfId}
          onSend={sendChat}
          onClose={() => { setChatOpen(false); setSeenChat(messages.filter((m) => !m.system).length); }}
        />
      )}
    </div>
  );
}

function Ctl({ on, onClick, label, OnIcon, OffIcon }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={on}
      title={label}
      className={
        'flex h-12 w-12 items-center justify-center rounded-full border transition active:scale-95 '
        + (on ? 'border-subtle bg-card text-ink hover:border-strong' : 'border-transparent bg-ink text-surface')
      }
    >
      {on ? <OnIcon size={19} /> : <OffIcon size={19} />}
    </button>
  );
}

function Tile({ person, main = false }) {
  const ref = useRef(null);
  const [, tick] = useState(0);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (v.srcObject !== person.stream) v.srcObject = person.stream || null;
    if (person.stream) v.play().catch(() => {});
  }, [person.stream]);

  // Re-render once a caption has aged out, so it disappears on time.
  useEffect(() => {
    if (!person.caption) return undefined;
    const id = setTimeout(() => tick((n) => n + 1), CAPTION_MS + 50);
    return () => clearTimeout(id);
  }, [person.caption]);

  const hasVideo = person.stream && person.stream.getVideoTracks().length > 0 && person.cam !== false;
  const caption = person.caption && Date.now() - person.caption.at < CAPTION_MS ? person.caption : null;
  const initials = String(person.name || '?').split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();

  return (
    <div data-testid="call-tile" data-name={person.name} className={'relative h-full w-full overflow-hidden bg-surface-low ' + (main ? 'rounded-3xl border border-subtle' : '')}>
      <video
        ref={ref}
        autoPlay
        playsInline
        muted={person.self}
        className={'h-full w-full object-cover ' + (hasVideo ? '' : 'invisible ') + (person.self && cameraManager.isFrontCamera() ? '-scale-x-100' : '')}
      />
      {!hasVideo && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-fill-a to-fill-b text-xl font-semibold text-white">
            {initials}
          </span>
        </div>
      )}
      {!person.stream && !person.self && main && (
        <span className="pill chrome-plate absolute right-2 top-2 text-[10px] text-ink-dim">
          <Loader2 size={10} className="animate-spin" /> connecting
        </span>
      )}
      {caption && main && !person.self && (
        <p className="chrome-plate absolute inset-x-3 bottom-12 animate-fade-up rounded-2xl px-4 py-3 text-center text-lg font-semibold leading-snug text-ink lg:text-2xl">
          {caption.text}
        </p>
      )}
      <span className={'pill chrome-plate absolute bottom-2 left-2 font-semibold text-ink ' + (main ? 'text-[11px]' : 'text-[9px]')}>
        {person.role === ROLE_SPEAKER ? <AudioLines size={11} /> : <Hand size={11} />}
        {person.self ? `${person.name} (you)` : person.name}
        {person.mic === false && <MicOff size={11} className="text-rose" />}
      </span>
    </div>
  );
}

function Chat({ messages, selfId, onSend, onClose }) {
  const [draft, setDraft] = useState('');
  const ref = useRef(null);
  useEffect(() => { const el = ref.current; if (el) el.scrollTop = el.scrollHeight; }, [messages]);

  return (
    <aside className="float-pane fixed inset-x-0 bottom-0 z-40 flex h-[60vh] flex-col rounded-t-[2rem] border border-subtle bg-card shadow-card lg:static lg:h-auto lg:w-80 lg:rounded-3xl">
      <header className="flex items-center border-b border-subtle px-4 py-3">
        <span className="display text-lg">Chat</span>
        <button type="button" onClick={onClose} aria-label="Close chat" className="btn-icon ml-auto h-8 w-8">
          <X size={15} />
        </button>
      </header>
      <div ref={ref} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3 no-scrollbar">
        {messages.length === 0 && <p className="py-6 text-center text-xs text-ink-dim">No messages yet.</p>}
        {messages.map((m, i) => (m.system ? (
          <p key={i} className="text-center text-[11px] text-ink-dim">{m.text}</p>
        ) : (
          <div key={i} className={m.from === selfId ? 'text-right' : ''}>
            <p className="text-[10px] text-ink-dim">{m.from === selfId ? 'You' : m.name}</p>
            <p className={
              'inline-block max-w-[85%] rounded-2xl px-3 py-1.5 text-left text-sm '
              + (m.from === selfId ? 'bg-gradient-to-br from-fill-a to-fill-b text-white' : 'bg-card-high')
            }
            >
              {m.text}
            </p>
          </div>
        )))}
      </div>
      <form
        onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (t) { onSend(t); setDraft(''); } }}
        className="flex gap-2 border-t border-subtle p-2.5"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message everyone"
          className="min-w-0 flex-1 rounded-full bg-card-high px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/30"
        />
        <button type="submit" disabled={!draft.trim()} aria-label="Send" className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-fill-a to-fill-b text-white disabled:opacity-40">
          <Send size={15} />
        </button>
      </form>
    </aside>
  );
}
