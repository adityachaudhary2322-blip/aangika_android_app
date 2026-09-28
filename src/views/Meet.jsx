import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Copy, Check, Share2, Mic, MicOff, Video, VideoOff, Captions,
  CaptionsOff, Volume2, VolumeX, MessageSquare, PhoneOff, Users, Loader2,
  Hand, AudioLines, Send, X, LogIn, Plus, AtSign,
} from 'lucide-react';
import { useCall } from '../context/CallContext.jsx';
import useMeeting, {
  newRoomCode, normaliseCode, formatCode, inviteLink, MAX_PEOPLE,
} from '../hooks/useMeeting.js';
import useSignPipeline from '../hooks/useSignPipeline.js';
import useTokenStream from '../hooks/useTokenStream.js';
import cameraManager from '../services/cameraManager.js';
import { speak, unlockAudio } from '../services/ttsService.js';
import { ROLE_SPEAKER } from '../services/chatStorage.js';
import { getLanguage } from '../config/languages.js';

/** How long a caption stays on a tile after the person stops. */
const CAPTION_MS = 7000;

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/**
 * Group meetings: create a room (with your own ID as the code, or a fresh
 * one), share the code or link, or join someone else's by typing theirs.
 * In the room every tile carries live captions: a signer's recognised signs,
 * or a speaker's words from the browser's speech recogniser.
 */
export default function Meet({
  onBack, language, visionEngine, initialCode = '', onLiveChange,
}) {
  const { profile } = useCall();
  const me = useMemo(() => ({
    name: profile?.auto ? `Guest ${profile.handle.slice(0, 3).toUpperCase()}` : (profile?.name || 'Guest'),
    role: profile?.role,
  }), [profile]);
  const meeting = useMeeting(me);
  const live = meeting.status === 'live' || meeting.status === 'starting';

  useEffect(() => { onLiveChange?.(live); }, [live, onLiveChange]);
  useEffect(() => () => onLiveChange?.(false), [onLiveChange]);

  if (live) {
    return <Room meeting={meeting} me={me} language={language} visionEngine={visionEngine} />;
  }
  return (
    <Lobby
      meeting={meeting}
      profile={profile}
      onBack={onBack}
      initialCode={initialCode}
    />
  );
}

// ── Lobby ───────────────────────────────────────────────────────────────────

function Lobby({ meeting, profile, onBack, initialCode }) {
  const [joinCode, setJoinCode] = useState(initialCode);
  const [copied, setCopied] = useState(false);

  const start = async (fn, code) => {
    await unlockAudio();
    fn(code);
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
        Talk in a group, with live captions of everyone’s signing and speech.
        Up to {MAX_PEOPLE} people, connected directly to each other.
      </p>

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

function Room({ meeting, me, language, visionEngine }) {
  const {
    status, code, isHost, people, messages, mic, cam, selfId,
    setMic, setCam, sendCaption, sendChat, leave,
  } = meeting;
  const signer = me.role !== ROLE_SPEAKER;
  const [captionsOn, setCaptionsOn] = useState(true);
  const [readAloud, setReadAloud] = useState(!signer);
  const [chatOpen, setChatOpen] = useState(false);
  const [copied, setCopied] = useState(null);
  const [seenChat, setSeenChat] = useState(0);
  const lang = getLanguage(language);

  // ── My captions: signs (signer) or speech (speaker) ──────────────────
  const signing = captionsOn && signer && status === 'live';
  const { words } = useSignPipeline({
    enabled: signing,
    mirrored: cameraManager.isFrontCamera(),
    visionEngine,
    autoSpeak: false,
    language,
  });
  const { stream: signStream } = useTokenStream(words, { enabled: signing });
  useEffect(() => {
    if (!signStream.length) return;
    const text = signStream.slice(-6).map((e) => e.token.replace(/_+/g, ' ').toLowerCase()).join(' ');
    sendCaption(text, 'sign');
  }, [signStream, sendCaption]);

  const speechSupported = typeof window !== 'undefined'
    && (window.SpeechRecognition || window.webkitSpeechRecognition);
  useSpeechCaptions({
    enabled: captionsOn && !signer && status === 'live' && Boolean(speechSupported),
    lang: lang.code,
    onText: (text) => sendCaption(text, 'speech'),
  });

  // ── Others' sign captions, read aloud for hearing people ──────────────
  const spokenRef = useRef(new Map());
  useEffect(() => {
    if (!readAloud) return;
    for (const p of Object.values(people)) {
      if (p.self || !p.caption || p.caption.kind !== 'sign') continue;
      if (spokenRef.current.get(p.id) === p.caption.at) continue;
      spokenRef.current.set(p.id, p.caption.at);
      const newest = p.caption.text.split(' ').slice(-1)[0];
      if (newest) speak(newest, 'en-IN');
    }
  }, [people, readAloud]);

  const list = Object.values(people).sort((a, b) => (a.self ? -1 : b.self ? 1 : 0));
  const unreadChat = messages.filter((m) => !m.system).length - seenChat;
  const cols = list.length <= 1 ? 'grid-cols-1' : list.length <= 4 ? 'grid-cols-2' : 'grid-cols-2 lg:grid-cols-3';

  const share = async () => {
    const url = inviteLink(code);
    if (navigator.share) {
      try { await navigator.share({ title: 'Join my Aangika meeting', text: `Room ${formatCode(code)}`, url }); return; } catch { /* cancelled */ }
    }
    if (await copyText(url)) { setCopied('link'); setTimeout(() => setCopied(null), 1500); }
  };

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
            <Users size={12} /> {list.length}/{MAX_PEOPLE}
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
            {isHost ? 'Opening the room…' : `Joining ${formatCode(code)}…`}
          </div>
        ) : (
          <div className={'grid min-h-0 flex-1 auto-rows-fr gap-2 overflow-y-auto px-2 lg:px-0 ' + cols}>
            {list.map((p) => <Tile key={p.id} person={p} />)}
          </div>
        )}

        {list.length === 1 && status === 'live' && (
          <p className="px-4 py-2 text-center text-xs text-ink-dim">
            Waiting for others. Share the code <b className="font-mono">{formatCode(code)}</b> or tap Invite.
          </p>
        )}

        {/* Controls */}
        <footer className="flex items-center justify-center gap-2 px-4 py-3 lg:pb-0">
          <Ctl on={mic} onClick={() => setMic(!mic)} label={mic ? 'Mute' : 'Unmute'} OnIcon={Mic} OffIcon={MicOff} />
          <Ctl on={cam} onClick={() => setCam(!cam)} label={cam ? 'Camera off' : 'Camera on'} OnIcon={Video} OffIcon={VideoOff} />
          <Ctl
            on={captionsOn}
            onClick={() => setCaptionsOn((v) => !v)}
            label={signer ? 'Caption my signing' : speechSupported ? 'Caption my speech' : 'Speech captions need Chrome or Edge'}
            OnIcon={Captions}
            OffIcon={CaptionsOff}
          />
          <Ctl on={readAloud} onClick={() => setReadAloud((v) => !v)} label="Read sign captions aloud" OnIcon={Volume2} OffIcon={VolumeX} />
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
            aria-label={isHost ? 'End meeting' : 'Leave meeting'}
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

function Tile({ person }) {
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
    <div className="relative min-h-[140px] overflow-hidden rounded-3xl border border-subtle bg-surface-low">
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
      {!person.stream && !person.self && (
        <span className="pill chrome-plate absolute right-2 top-2 text-[10px] text-ink-dim">
          <Loader2 size={10} className="animate-spin" /> connecting
        </span>
      )}
      {caption && (
        <p className="chrome-plate absolute inset-x-2 bottom-10 animate-fade-up rounded-2xl px-3 py-2 text-center text-sm font-semibold leading-snug text-ink">
          {caption.text}
        </p>
      )}
      <span className="pill chrome-plate absolute bottom-2 left-2 text-[11px] font-semibold text-ink">
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
    <aside className="fixed inset-x-0 bottom-0 z-40 flex h-[60vh] flex-col rounded-t-[2rem] border border-subtle bg-card shadow-card lg:static lg:h-auto lg:w-80 lg:rounded-3xl">
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

/**
 * Live speech captions from the browser's recogniser (Chrome, Edge, Safari),
 * in the user's language. Restarts itself: the recogniser stops after a
 * pause, and a meeting should not need the button pressed again.
 */
function useSpeechCaptions({ enabled, lang, onText }) {
  const cb = useRef(onText);
  cb.current = onText;
  useEffect(() => {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!enabled || !SR) return undefined;
    let stopped = false;
    let rec = null;
    let last = 0;
    const begin = () => {
      rec = new SR();
      rec.lang = lang;
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (e) => {
        const r = e.results[e.results.length - 1];
        const text = r[0].transcript.trim();
        const now = Date.now();
        // Final results always go out; interim ones at most every 400 ms.
        if (text && (r.isFinal || now - last > 400)) { last = now; cb.current(text); }
      };
      rec.onend = () => { if (!stopped) setTimeout(() => { try { begin(); } catch { /* gave up */ } }, 300); };
      rec.onerror = (e) => { if (e.error === 'not-allowed') stopped = true; };
      try { rec.start(); } catch { /* already running */ }
    };
    begin();
    return () => { stopped = true; try { rec?.stop(); } catch { /* ignore */ } };
  }, [enabled, lang]);
}
