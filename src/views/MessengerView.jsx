import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft, Video, Send, UserPlus, Search, Check, CheckCheck, Clock,
  Settings as SettingsIcon, X, Loader2, AlertTriangle, MessageSquare,
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
      {signer ? '🤟' : '🗣️'} {signer ? 'Signer' : 'Speaker'}
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

// ── Profile gate ─────────────────────────────────────────────────────────────

/**
 * First run. Nothing works without a handle, because the handle IS the peer id.
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
    <form onSubmit={submit} className="flex h-full flex-col justify-center gap-4 px-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Set up your profile</h1>
        <p className="mt-1 text-xs text-ink-dim">
          Your handle is your address. Friends call you by typing it — there are
          no room codes to share.
        </p>
      </div>

      <div className="surface-card p-4">
        <label className="block text-xs font-semibold uppercase tracking-wider text-ink-dim">
          Display name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Asha Kumar"
          className="mt-2 w-full rounded-lg border border-subtle bg-surface px-3 py-2 text-sm outline-none focus:border-secondary"
        />

        <label className="mt-4 block text-xs font-semibold uppercase tracking-wider text-ink-dim">
          Handle
        </label>
        <input
          value={handle}
          onChange={(e) => { setHandle(e.target.value); setError(null); }}
          placeholder="asha"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="mt-2 w-full rounded-lg border border-subtle bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-secondary"
        />
        <p className="mt-1.5 text-[11px] text-ink-dim">
          Lowercase letters, digits and underscores.
          {preview && (
            <>
              {' '}You will be reachable as{' '}
              <code className="rounded bg-card-high px-1 py-0.5 font-mono text-primary">
                {store.peerIdFor(preview)}
              </code>
            </>
          )}
        </p>

        <p className="mt-4 text-xs font-semibold uppercase tracking-wider text-ink-dim">
          I am a
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <RolePick
            active={role === store.ROLE_SIGNER}
            onClick={() => setRole(store.ROLE_SIGNER)}
            emoji="🤟"
            title="Signer"
            detail="Deaf / hard of hearing"
            tone="primary"
          />
          <RolePick
            active={role === store.ROLE_SPEAKER}
            onClick={() => setRole(store.ROLE_SPEAKER)}
            emoji="🗣️"
            title="Speaker"
            detail="Hearing"
            tone="secondary"
          />
        </div>
      </div>

      {error && (
        <p className="flex items-center gap-2 rounded-xl border border-rose/40 bg-rose/10 px-3 py-2 text-xs text-rose">
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      <button
        type="submit"
        className="rounded-xl bg-primary py-3 font-semibold text-white"
      >
        Start messaging
      </button>
    </form>
  );
}

function RolePick({ active, onClick, emoji, title, detail, tone }) {
  const ring = tone === 'primary'
    ? 'border-primary bg-primary/10 text-primary'
    : 'border-secondary bg-secondary/10 text-secondary';
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'rounded-xl border p-3 text-left '
        + (active ? ring : 'border-subtle bg-card-high text-ink-dim')
      }
    >
      <span className="text-lg">{emoji}</span>
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
    <div className="absolute inset-0 z-40 flex items-end bg-black/50 sm:items-center sm:justify-center">
      <form
        onSubmit={submit}
        className="w-full rounded-t-3xl bg-card p-4 sm:max-w-sm sm:rounded-3xl"
      >
        <div className="flex items-center gap-2">
          <h2 className="text-base font-bold">Add a friend</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-full bg-card-high"
          >
            <X size={16} />
          </button>
        </div>

        <label className="mt-3 block text-xs font-semibold uppercase tracking-wider text-ink-dim">
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
          className="mt-2 w-full rounded-lg border border-subtle bg-surface px-3 py-2 font-mono text-sm outline-none focus:border-secondary"
        />

        <label className="mt-3 block text-xs font-semibold uppercase tracking-wider text-ink-dim">
          Name (optional)
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ravi"
          className="mt-2 w-full rounded-lg border border-subtle bg-surface px-3 py-2 text-sm outline-none focus:border-secondary"
        />

        <p className="mt-3 text-xs font-semibold uppercase tracking-wider text-ink-dim">
          They are a
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <RolePick
            active={role === store.ROLE_SIGNER}
            onClick={() => setRole(store.ROLE_SIGNER)}
            emoji="🤟" title="Signer" detail="Deaf / HoH" tone="primary"
          />
          <RolePick
            active={role === store.ROLE_SPEAKER}
            onClick={() => setRole(store.ROLE_SPEAKER)}
            emoji="🗣️" title="Speaker" detail="Hearing" tone="secondary"
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

        <button
          type="submit"
          className="mt-4 w-full rounded-xl bg-primary py-3 font-semibold text-white"
        >
          Add contact
        </button>
      </form>
    </div>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────────

export default function MessengerView({ onNavigate }) {
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
    online: 'text-primary',
    connecting: 'text-amber',
    error: 'text-rose',
    idle: 'text-ink-dim',
  }[registration];

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* ── App bar ──────────────────────────────────────────────── */}
      <header className="flex items-center gap-2 px-4 py-3">
        <h1 className="text-lg font-bold">Aangika</h1>
        <span className={'pill border-subtle ' + regTone}>
          {registration === 'connecting' && <Loader2 size={11} className="animate-spin" />}
          {registration === 'online' ? 'ONLINE' : registration.toUpperCase()}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate('dashboard')}
            aria-label="Tools"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-card-high"
          >
            <SettingsIcon size={16} />
          </button>
          <ThemeToggle />
        </div>
      </header>

      {regError && (
        <p className="mx-4 mb-2 flex items-start gap-2 rounded-xl border border-rose/40 bg-rose/10 px-3 py-2 text-xs text-rose">
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
            'mx-4 mb-2 flex items-start gap-2 rounded-xl border px-3 py-2 text-xs '
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
            <div className="flex items-center gap-2 rounded-xl border border-subtle bg-card-high px-3 py-2">
              <Search size={14} className="text-ink-dim" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search contacts"
                className="w-full bg-transparent text-sm outline-none"
              />
            </div>
            <p className="mt-2 text-[11px] text-ink-dim">
              You are{' '}
              <code className="rounded bg-card-high px-1 py-0.5 font-mono text-primary">
                @{profile.handle}
              </code>
              {' · '}share that, not a code.
            </p>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar px-2">
            {filtered.length === 0 && (
              <p className="px-2 py-8 text-center text-xs text-ink-dim">
                {contacts.length === 0
                  ? 'No contacts yet. Add a friend by their handle.'
                  : 'Nobody matches that search.'}
              </p>
            )}

            {filtered.map((c) => (
              <button
                key={c.handle}
                type="button"
                onClick={() => setActive(c.handle)}
                className={
                  'flex w-full items-center gap-3 rounded-xl px-2 py-2.5 text-left '
                  + (c.handle === active ? 'bg-card-high' : '')
                }
              >
                <Avatar name={c.name} role={c.role} online={isOnline(c.handle)} />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{c.name}</span>
                    <span className="shrink-0 text-xs">
                      {c.role === store.ROLE_SPEAKER ? '🗣️' : '🤟'}
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
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-3 text-sm font-semibold text-white"
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
              <header className="flex items-center gap-2 border-b border-subtle px-3 py-2.5">
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
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary text-white shadow-glow transition active:scale-90 disabled:opacity-40"
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
                    No messages yet. Say hello, or tap the green button to call.
                  </p>
                )}
                {thread.map((m) => (
                  <Bubble key={m.id} message={m} />
                ))}
              </div>

              {/* Composer */}
              <form
                onSubmit={submitDraft}
                className="flex items-center gap-2 border-t border-subtle px-3 py-2.5"
              >
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={`Message ${contact.name}`}
                  className="min-w-0 flex-1 rounded-full border border-subtle bg-card-high px-4 py-2.5 text-sm outline-none focus:border-secondary"
                />
                <button
                  type="submit"
                  disabled={!draft.trim()}
                  aria-label="Send"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-white transition active:scale-90 disabled:opacity-40"
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
          'max-w-[78%] rounded-2xl px-3 py-2 text-sm '
          + (out
            ? 'rounded-br-sm bg-primary/15 text-ink'
            : 'rounded-bl-sm bg-card-high text-ink')
        }
      >
        <p className="whitespace-pre-wrap break-words leading-snug">{message.text}</p>
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[9px] text-ink-dim">
          {timeString(message.at)}
          {out && message.status === store.PENDING && (
            <Clock size={10} aria-label="Queued — they are offline" />
          )}
          {out && message.status === store.SENT && (
            <CheckCheck size={11} aria-label="Delivered" />
          )}
          {out && message.status === store.FAILED && (
            <Check size={11} className="text-rose" aria-label="Failed" />
          )}
        </p>
      </div>
    </div>
  );
}
