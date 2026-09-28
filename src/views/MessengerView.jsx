import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Video, Send, UserPlus, Search, Check, CheckCheck, Clock,
  X, Loader2, AlertTriangle, MessageSquare, AtSign, ShieldCheck, Hand, AudioLines,
} from 'lucide-react';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { useCall } from '../context/CallContext.jsx';
import * as store from '../services/chatStorage.js';

/**
 * WhatsApp-shaped messenger.
 *
 * Two panes on a wide screen, ONE at a time on a phone. The pane split is
 * driven by whether a chat is selected rather than by a media query alone,
 * because a phone showing a half-width contact list next to a half-width chat
 * is unusable at 390px and that is the primary target.
 *
 * The call button is the whole point of the screen: it dials
 * `aangika_peer_<handle>` directly. There is no room code, no lobby and nothing
 * to copy — the handle IS the address (see chatStorage.js).
 */

function timeString(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function RoleTag({ role, className = '' }) {
  const signer = role !== store.ROLE_SPEAKER;
  return (
    <span
      className={
        'pill shrink-0 text-[10px] '
        + (signer
          ? 'border-primary/40 bg-primary/10 text-primary'
          : 'border-secondary/40 bg-secondary/10 text-secondary')
        + ' ' + className
      }
    >
      {signer ? <Hand size={11} /> : <AudioLines size={11} />} {signer ? 'Signer' : 'Speaker'}
    </span>
  );
}

function Avatar({ name, role, online, size = 'md' }) {
  const box = size === 'sm' ? 'h-9 w-9 text-xs' : 'h-11 w-11 text-sm';
  const signer = role !== store.ROLE_SPEAKER;
  const initials = String(name || '?')
    .split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  return (
    <span className="relative shrink-0">
      <span
        className={
          box + ' flex items-center justify-center rounded-full font-bold '
          + (signer
            ? 'bg-primary/15 text-primary'
            : 'bg-secondary/15 text-secondary')
        }
      >
        {initials}
      </span>
      {/* Presence is real: it means a DataConnection to them is open right now,
          not a server's guess. */}
      <span
        title={online ? 'Connected' : 'Not connected'}
        className={
          'absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface '
          + (online ? 'bg-primary' : 'bg-card-highest')
        }
      />
    </span>
  );
}

// ── Profile setup ────────────────────────────────────────────────────────────

/**
 * Shown inside the Messages tab until a profile exists. The rest of the app
 * works without one; only chat and calls need a handle, because the handle IS
 * the peer id.
 */
function ProfileSetup({ onDone }) {
  const [name, setName] = useState('');
  const [handle, setHandle] = useState('');
  const [role, setRole] = useState(store.ROLE_SIGNER);
  const [error, setError] = useState(null);

  const preview = store.normaliseHandle(handle);

  function submit(e) {
    e.preventDefault();
    try {
      store.saveProfile({ name, handle, role });
      onDone();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 no-scrollbar">
      <header className="pb-2 pt-4">
        <h1 className="display text-3xl">Messages</h1>
      </header>

      <form onSubmit={submit} className="my-auto flex flex-col gap-4 py-4">
        <div className="text-center">
          <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-3xl bg-gradient-to-br from-fill-a to-fill-b text-white shadow-glow">
            <MessageSquare size={28} strokeWidth={1.8} />
          </span>
          <h2 className="display mt-4 text-2xl">
            Chat and call in sign
          </h2>
          <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-ink-dim">
            Pick a handle so friends can reach you. It is your address:
            no room codes, no accounts, nothing stored on a server.
          </p>
        </div>

        <div className="surface-card space-y-4 p-4">
          <div>
            <label htmlFor="profile-name" className="eyebrow">Display name</label>
            <input
              id="profile-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Asha Kumar"
              className="field mt-2"
            />
          </div>

          <div>
            <label htmlFor="profile-handle" className="eyebrow">Handle</label>
            <div className="relative mt-2">
              <AtSign size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-dim" />
              <input
                id="profile-handle"
                value={handle}
                onChange={(e) => { setHandle(e.target.value); setError(null); }}
                placeholder="asha"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className="field pl-10 font-mono"
              />
            </div>
            <p className="mt-1.5 text-[11px] text-ink-dim">
              Lowercase letters, digits and underscores.
              {preview && (
                <>
                  {' '}You will be reachable as{' '}
                  <code className="rounded-md bg-card-high px-1 py-0.5 font-mono text-primary">
                    {store.peerIdFor(preview)}
                  </code>
                </>
              )}
            </p>
          </div>

          <div>
            <p className="eyebrow">I am a</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <RolePick
                active={role === store.ROLE_SIGNER}
                onClick={() => setRole(store.ROLE_SIGNER)}
                Icon={Hand}
                title="Signer"
                detail="Deaf / hard of hearing"
                tone="primary"
              />
              <RolePick
                active={role === store.ROLE_SPEAKER}
                onClick={() => setRole(store.ROLE_SPEAKER)}
                Icon={AudioLines}
                title="Speaker"
                detail="Hearing"
                tone="secondary"
              />
            </div>
          </div>
        </div>

        {error && (
          <p className="flex items-center gap-2 rounded-2xl border border-rose/40 bg-rose/10 px-4 py-2.5 text-xs text-rose">
            <AlertTriangle size={14} /> {error}
          </p>
        )}

        <button type="submit" className="btn-primary w-full py-3.5">
          Start messaging
        </button>
        <p className="flex items-center justify-center gap-1.5 text-[11px] text-ink-dim">
          <ShieldCheck size={12} /> Peer-to-peer. Your chats stay on this device.
        </p>
      </form>
    </div>
  );
}

function RolePick({ active, onClick, Icon, title, detail, tone }) {
  const ring = tone === 'primary'
    ? 'border-primary bg-primary/10 text-primary'
    : 'border-secondary bg-secondary/10 text-secondary';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded-2xl border-2 p-3 text-left transition '
        + (active ? ring : 'border-transparent bg-card-high text-ink-dim hover:border-subtle')
      }
    >
      <Icon size={18} />
      <span className="mt-0.5 block text-sm font-semibold">{title}</span>
      <span className="block text-[10px] opacity-80">{detail}</span>
    </button>
  );
}

// ── Add-a-friend sheet ───────────────────────────────────────────────────────

function AddFriend({ onClose, onAdded }) {
  const [handle, setHandle] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState(store.ROLE_SPEAKER);
  const [error, setError] = useState(null);

  function submit(e) {
    e.preventDefault();
    try {
      const c = store.addContact({ handle, name, role });
      onAdded(c.handle);
      onClose();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/40 backdrop-blur-sm sm:items-center sm:justify-center">
      <form
        onSubmit={submit}
        className="w-full animate-fade-up rounded-t-[2rem] border border-subtle bg-card p-5 shadow-card sm:max-w-sm sm:rounded-[2rem]"
      >
        <span aria-hidden="true" className="mx-auto mb-3 block h-1 w-10 rounded-full bg-card-highest sm:hidden" />
        <div className="flex items-center gap-2">
          <h2 className="display text-xl">Add a friend</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-card-high"
          >
            <X size={16} />
          </button>
        </div>

        <label className="eyebrow mt-4 block">
          Their handle
        </label>
        <input
          value={handle}
          onChange={(e) => { setHandle(e.target.value); setError(null); }}
          placeholder="ravi"
          autoFocus
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="field mt-2 font-mono"
        />

        <label className="eyebrow mt-4 block">
          Name (optional)
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ravi"
          className="field mt-2"
        />

        <p className="eyebrow mt-4">
          They are a
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <RolePick
            active={role === store.ROLE_SIGNER}
            onClick={() => setRole(store.ROLE_SIGNER)}
            Icon={Hand} title="Signer" detail="Deaf / HoH" tone="primary"
          />
          <RolePick
            active={role === store.ROLE_SPEAKER}
            onClick={() => setRole(store.ROLE_SPEAKER)}
            Icon={AudioLines} title="Speaker" detail="Hearing" tone="secondary"
          />
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">
          The tag is a starting guess so captions can flow on the first frame.
          Whatever they actually declare wins once the call connects.
        </p>

        {error && (
          <p className="mt-3 flex items-center gap-2 rounded-lg border border-rose/40 bg-rose/10 px-3 py-2 text-xs text-rose">
            <AlertTriangle size={14} /> {error}
          </p>
        )}

        <button type="submit" className="btn-primary mt-5 w-full py-3.5">
          Add contact
        </button>
      </form>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function MessengerView({ onChatOpenChange }) {
  const {
    profile, registration, regError, placeCall, sendChat, isOnline,
    revision, openChannel, call, diagnostic, setDiagnostic,
  } = useCall();

  const [active, setActive] = useState(null);     // selected contact handle
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [, forceRender] = useState(0);

  const scrollRef = useRef(null);

  // The store is the source of truth; `revision` from the context is the change
  // signal. Re-reading on every bump keeps this in step with messages that
  // arrived over the wire while a different pane was focused.
  const contacts = useMemo(() => store.getContacts(), [revision]);
  const thread = useMemo(
    () => (active ? store.getThread(active) : []),
    [active, revision]
  );
  const contact = active ? store.getContact(active) : null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.handle.includes(q)
    );
  }, [contacts, query]);

  // Opening a chat clears its badge and warms a channel, so the first message
  // does not have to wait for a connection handshake.
  useEffect(() => {
    if (!active) return;
    store.markRead(active);
    openChannel(active);
  }, [active, openChannel]);

  useEffect(() => {
    onChatOpenChange?.(Boolean(active));
    return () => onChatOpenChange?.(false);
  }, [active, onChatOpenChange]);

  // Pin to the newest message. Chat that does not auto-scroll reads as broken.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.length, active]);

  if (!profile) {
    return <ProfileSetup onDone={() => forceRender((n) => n + 1)} />;
  }

  function submitDraft(e) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || !active) return;
    sendChat(active, text);
    setDraft('');
  }

  const regTone = {
    online: 'text-secondary',
    connecting: 'text-amber',
    error: 'text-rose',
    idle: 'text-ink-dim',
  }[registration];

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* ── App bar ──────────────────────────────────────────────── */}
      <header className={'items-center gap-2 px-5 pb-2 pt-4 ' + (active ? 'hidden sm:flex' : 'flex')}>
        <h1 className="display text-3xl">Messages</h1>
        <span className={'pill border-subtle bg-card ' + regTone}>
          {registration === 'connecting'
            ? <Loader2 size={11} className="animate-spin" />
            : <span className="h-1.5 w-1.5 rounded-full bg-current" />}
          {registration === 'online' ? 'Online'
            : registration.charAt(0).toUpperCase() + registration.slice(1)}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
        </div>
      </header>

      {regError && (
        <p className="mx-4 mb-2 flex items-start gap-2 rounded-2xl border border-rose/40 bg-rose/10 px-3 py-2 text-xs text-rose">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span>{regError.message}</span>
        </p>
      )}

      {/* A call that dies before connecting takes the call surface down with
          it. Without this the user is bounced back to the chat with no idea
          why — the reason was computed and then thrown away. */}
      {diagnostic && call.status === 'idle' && (
        <div
          className={
            'mx-4 mb-2 flex items-start gap-2 rounded-2xl border px-3 py-2 text-xs '
            + (diagnostic.tone === 'error'
              ? 'border-rose/40 bg-rose/10 text-rose'
              : 'border-amber/40 bg-amber/10 text-amber')
          }
        >
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="flex-1">{diagnostic.message}</span>
          <button
            type="button"
            onClick={() => setDiagnostic(null)}
            aria-label="Dismiss"
            className="shrink-0 opacity-70"
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* ── Left pane: contacts / recents ──────────────────────── */}
        <aside
          className={
            'min-h-0 flex-col border-subtle sm:flex sm:w-72 sm:border-r '
            + (active ? 'hidden' : 'flex w-full')
          }
        >
          <div className="px-4 pb-2">
            <div className="flex items-center gap-2 rounded-2xl border border-subtle bg-card px-4 py-2.5 shadow-card transition focus-within:border-primary">
              <Search size={15} className="text-ink-dim" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search contacts"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
            <p className="mt-2 text-[11px] text-ink-dim">
              You are{' '}
              <code data-tour="my-id" className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono font-semibold text-primary">
                @{profile.handle}
              </code>
              {' · '}share that, not a code.
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar px-2">
            {filtered.length === 0 && (
              <div className="flex flex-col items-center px-4 py-10 text-center">
                <span className="icon-well h-14 w-14 rounded-3xl bg-primary/10 text-primary">
                  <UserPlus size={22} />
                </span>
                <p className="mt-3 text-sm font-semibold">
                  {contacts.length === 0 ? 'No contacts yet' : 'No matches'}
                </p>
                <p className="mt-1 text-xs text-ink-dim">
                  {contacts.length === 0
                    ? 'Add a friend by their handle to start chatting.'
                    : 'Nobody matches that search.'}
                </p>
              </div>
            )}

            {filtered.map((c) => (
              <button
                key={c.handle}
                type="button"
                onClick={() => setActive(c.handle)}
                className={
                  'flex w-full items-center gap-3 rounded-2xl px-2.5 py-2.5 text-left transition hover:bg-card-high/70 '
                  + (c.handle === active ? 'bg-card-high' : '')
                }
              >
                <Avatar name={c.name} role={c.role} online={isOnline(c.handle)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{c.name}</span>
                    <span className="shrink-0 text-ink-dim">
                      {c.role === store.ROLE_SPEAKER ? <AudioLines size={12} /> : <Hand size={12} />}
                    </span>
                    <span className="ml-auto shrink-0 text-[10px] text-ink-dim">
                      {timeString(c.lastAt)}
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[11px] text-ink-dim">
                      {c.lastText || `@${c.handle}`}
                    </span>
                    {c.unread > 0 && (
                      <span className="ml-auto flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-white">
                        {c.unread}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <div className="p-3">
            <button
              type="button"
              onClick={() => setAdding(true)}
              data-tour="add-friend"
              className="btn-primary w-full"
            >
              <UserPlus size={16} /> Add friend
            </button>
          </div>
        </aside>

        {/* ── Right pane: the open chat ──────────────────────────── */}
        <section
          className={
            'min-h-0 flex-1 flex-col ' + (active ? 'flex' : 'hidden sm:flex')
          }
        >
          {!contact ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
              <MessageSquare size={28} className="text-ink-dim" />
              <p className="text-sm font-semibold">Pick a conversation</p>
              <p className="max-w-xs text-xs text-ink-dim">
                Messages and calls both go straight to a handle. Nothing is
                stored on a server — a message to someone offline waits here
                until they reconnect.
              </p>
            </div>
          ) : (
            <>
              {/* Chat header, with the call button */}
              <header className="glass flex items-center gap-2 border-x-0 border-t-0 px-3 py-2.5">
                <button
                  type="button"
                  onClick={() => setActive(null)}
                  aria-label="Back to contacts"
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-card-high sm:hidden"
                >
                  <ArrowLeft size={16} />
                </button>
                <Avatar
                  name={contact.name}
                  role={contact.role}
                  online={isOnline(contact.handle)}
                  size="sm"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {contact.name}
                  </span>
                  <span className="block truncate text-[10px] text-ink-dim">
                    @{contact.handle} ·{' '}
                    {isOnline(contact.handle) ? 'connected' : 'not connected'}
                  </span>
                </span>
                <RoleTag role={contact.role} className="hidden sm:inline-flex" />

                {/* One tap dials aangika_peer_<handle>. No codes, no lobby. */}
                <button
                  type="button"
                  onClick={() => placeCall(contact.handle)}
                  disabled={registration !== 'online' || call.status !== 'idle'}
                  aria-label={`Call ${contact.name}`}
                  title={registration === 'online'
                    ? `Call ${contact.name}`
                    : 'Not registered yet'}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fill-a to-fill-b text-white shadow-glow transition active:scale-90 disabled:opacity-40"
                >
                  <Video size={18} />
                </button>
              </header>

              {/* Messages */}
              <div
                ref={scrollRef}
                className="min-h-0 flex-1 space-y-1.5 overflow-y-auto no-scrollbar px-3 py-3"
              >
                {thread.length === 0 && (
                  <p className="py-8 text-center text-xs text-ink-dim">
                    No messages yet. Say hello, or tap the camera button to call.
                  </p>
                )}
                {thread.map((m) => (
                  <Bubble key={m.id} message={m} />
                ))}
              </div>

              {/* Composer */}
              <form
                onSubmit={submitDraft}
                className="flex items-center gap-2 px-3 pb-3 pt-2"
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`Message ${contact.name}`}
                  className="min-w-0 flex-1 rounded-full border border-subtle bg-card px-4 py-3 text-sm shadow-card outline-none transition focus:border-primary focus:ring-4 focus:ring-primary/15"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  aria-label="Send"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-fill-a to-fill-b text-white shadow-glow transition active:scale-90 disabled:opacity-40"
                >
                  <Send size={17} />
                </button>
              </form>
            </>
          )}
        </section>
      </div>

      {adding && (
        <AddFriend onClose={() => setAdding(false)} onAdded={setActive} />
      )}
    </div>
  );
}

/**
 * One message.
 *
 * The tick is honest: a single clock means it is still queued on this device
 * because the other end was not reachable, one tick means it left this device,
 * two mean the far end acknowledged receiving it. There is no "read" state
 * because nothing reports that back.
 */
function Bubble({ message }) {
  const out = message.dir === 'out';
  return (
    <div className={'flex ' + (out ? 'justify-end' : 'justify-start')}>
      <div
        className={
          'max-w-[78%] rounded-3xl px-3.5 py-2 text-sm shadow-card '
          + (out
            ? 'rounded-br-md bg-gradient-to-br from-fill-a to-fill-b text-white'
            : 'rounded-bl-md border border-subtle bg-card text-ink')
        }
      >
        <p className="whitespace-pre-wrap break-words leading-snug">{message.text}</p>
        <p className={'mt-0.5 flex items-center justify-end gap-1 text-[9px] ' + (out ? 'text-white/75' : 'text-ink-dim')}>
          {timeString(message.at)}
          {out && message.status === store.PENDING && (
            <Clock size={10} aria-label="Queued — they are offline" />
          )}
          {out && message.status === store.SENT && (
            <CheckCheck size={11} aria-label="Delivered" />
          )}
          {out && message.status === store.FAILED && (
            <Check size={11} className={out ? 'text-rose-200' : 'text-rose'} aria-label="Failed" />
          )}
        </p>
      </div>
    </div>
  );
}
