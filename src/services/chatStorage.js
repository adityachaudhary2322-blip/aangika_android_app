/**
 * Local profile, contacts and message threads.
 *
 * THE POINT OF THIS FILE IS THE HANDLE. The old call flow asked the broker for
 * a random id and made the user copy-paste it to their friend, which meant the
 * id changed on every reload and no one could ever be called twice. Here the
 * user picks a handle once, and their PeerJS id is derived from it:
 *
 *     handle "asha"  ->  peer id "aangika_peer_asha"
 *
 * That makes signalling DETERMINISTIC: knowing someone's handle is enough to
 * call them, forever, with no code exchange. The cost is that the id is a
 * public namespace on a shared broker — two people who pick "asha" collide, and
 * the second one gets a hard 'unavailable-id' from the broker rather than a
 * silent hijack. CallContext surfaces that instead of hiding it.
 *
 * Everything is localStorage. There is no server, so there is no delivery
 * guarantee and no history sync: a message to someone who is offline stays
 * 'pending' on this device and is retried when they next come online. Saying
 * that plainly in the UI is the honest option; pretending it was delivered is
 * not.
 */

const KEY_PROFILE = 'aangika.profile';
const KEY_CONTACTS = 'aangika.contacts';
const KEY_THREAD = 'aangika.thread.';

/** PeerJS ids are a restricted alphabet; this prefix keeps ours inside it. */
export const PEER_PREFIX = 'aangika_peer_';

export const ROLE_SIGNER = 'signer';
export const ROLE_SPEAKER = 'speaker';

/** Message delivery states. There is no 'read' — nothing reports that back. */
export const SENT = 'sent';
export const PENDING = 'pending';
export const FAILED = 'failed';

// ── Handles ──────────────────────────────────────────────────────────────────

/**
 * Fold a typed handle to its canonical form.
 *
 * Lowercase and [a-z0-9_] only, because the derived peer id has to survive the
 * broker's own validation. A handle that differs only in case would otherwise
 * produce two different peer ids and two people who cannot reach each other
 * while both believing they typed the same thing.
 */
export function normaliseHandle(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '');
}

export function validateHandle(raw) {
  const handle = normaliseHandle(raw);
  if (!handle) return { ok: false, handle, reason: 'Pick a handle first.' };
  if (handle.length < 3) {
    return { ok: false, handle, reason: 'Handles need at least 3 characters.' };
  }
  if (handle.length > 20) {
    return { ok: false, handle, reason: 'Handles are at most 20 characters.' };
  }
  return { ok: true, handle, reason: null };
}

/** The one place a peer id is constructed. Never build it inline. */
export function peerIdFor(handle) {
  return PEER_PREFIX + normaliseHandle(handle);
}

/** Inverse of peerIdFor, for attributing an inbound connection to a contact. */
export function handleFromPeerId(peerId) {
  const id = String(peerId || '');
  return id.startsWith(PEER_PREFIX) ? id.slice(PEER_PREFIX.length) : '';
}

// ── Storage plumbing ─────────────────────────────────────────────────────────

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    // Corrupt JSON or storage disabled. Returning the fallback keeps the app
    // usable; throwing here would white-screen it on a bad write from an
    // earlier version.
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ── Change notification ──────────────────────────────────────────────────────

const listeners = new Set();

/** Subscribe to any profile/contact/thread change. Returns an unsubscribe. */
export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) {
    try {
      fn();
    } catch {
      // A broken subscriber must not stop the others from updating.
    }
  }
}

// ── Profile ──────────────────────────────────────────────────────────────────

export function getProfile() {
  const p = read(KEY_PROFILE, null);
  if (!p || !p.handle) return null;
  return {
    name: p.name || p.handle,
    handle: normaliseHandle(p.handle),
    role: p.role === ROLE_SPEAKER ? ROLE_SPEAKER : ROLE_SIGNER,
  };
}

export function hasProfile() {
  return getProfile() !== null;
}

export function saveProfile({ name, handle, role }) {
  const check = validateHandle(handle);
  if (!check.ok) throw new Error(check.reason);
  const profile = {
    name: String(name || '').trim() || check.handle,
    handle: check.handle,
    role: role === ROLE_SPEAKER ? ROLE_SPEAKER : ROLE_SIGNER,
  };
  write(KEY_PROFILE, profile);
  notify();
  return profile;
}

/** Change only the role, leaving name and handle (and thus the peer id) alone. */
export function setProfileRole(role) {
  const current = getProfile();
  if (!current) return null;
  return saveProfile({ ...current, role });
}

// ── Contacts ─────────────────────────────────────────────────────────────────

/**
 * Contacts, most recently active first.
 *
 * The sort is on lastAt so the list behaves like a messenger's "recents" rather
 * than an address book: whoever you last spoke to is at the top.
 */
export function getContacts() {
  const list = read(KEY_CONTACTS, []);
  if (!Array.isArray(list)) return [];
  return list
    .filter((c) => c && c.handle)
    .map((c) => ({
      handle: normaliseHandle(c.handle),
      name: c.name || c.handle,
      role: c.role === ROLE_SPEAKER ? ROLE_SPEAKER : ROLE_SIGNER,
      addedAt: c.addedAt || 0,
      lastAt: c.lastAt || c.addedAt || 0,
      lastText: c.lastText || '',
      unread: c.unread || 0,
    }))
    .sort((a, b) => b.lastAt - a.lastAt);
}

export function getContact(handle) {
  const h = normaliseHandle(handle);
  return getContacts().find((c) => c.handle === h) || null;
}

export function addContact({ handle, name, role }) {
  const check = validateHandle(handle);
  if (!check.ok) throw new Error(check.reason);

  const me = getProfile();
  if (me && me.handle === check.handle) {
    throw new Error('That is your own handle.');
  }

  const list = getContacts();
  if (list.some((c) => c.handle === check.handle)) {
    throw new Error(`@${check.handle} is already in your contacts.`);
  }

  const contact = {
    handle: check.handle,
    name: String(name || '').trim() || check.handle,
    role: role === ROLE_SPEAKER ? ROLE_SPEAKER : ROLE_SIGNER,
    addedAt: Date.now(),
    lastAt: Date.now(),
    lastText: '',
    unread: 0,
  };
  write(KEY_CONTACTS, [...list, contact]);
  notify();
  return contact;
}

/**
 * Add a contact we have never seen before because they messaged or called us.
 *
 * Returns the existing contact untouched if we already know them, so an inbound
 * event can call this unconditionally.
 */
export function ensureContact(handle, { name, role } = {}) {
  const existing = getContact(handle);
  if (existing) return existing;
  try {
    return addContact({ handle, name, role });
  } catch {
    return getContact(handle);
  }
}

export function updateContact(handle, patch) {
  const h = normaliseHandle(handle);
  const list = getContacts();
  const next = list.map((c) => (c.handle === h ? { ...c, ...patch } : c));
  write(KEY_CONTACTS, next);
  notify();
  return next.find((c) => c.handle === h) || null;
}

export function removeContact(handle) {
  const h = normaliseHandle(handle);
  write(KEY_CONTACTS, getContacts().filter((c) => c.handle !== h));
  try {
    localStorage.removeItem(KEY_THREAD + h);
  } catch { /* nothing stored */ }
  notify();
}

// ── Threads ──────────────────────────────────────────────────────────────────

export function getThread(handle) {
  const list = read(KEY_THREAD + normaliseHandle(handle), []);
  return Array.isArray(list) ? list : [];
}

function writeThread(handle, messages) {
  write(KEY_THREAD + normaliseHandle(handle), messages);
}

let messageSeq = 0;

export function newMessageId() {
  messageSeq += 1;
  return `${Date.now().toString(36)}-${messageSeq.toString(36)}`;
}

/**
 * Append a message and roll the contact's recents preview forward in one step.
 *
 * The two have to move together: a thread whose last line disagrees with the
 * contact row is the bug everyone notices immediately.
 */
export function appendMessage(handle, message) {
  const h = normaliseHandle(handle);
  const full = {
    id: message.id || newMessageId(),
    dir: message.dir === 'out' ? 'out' : 'in',
    text: String(message.text || ''),
    at: message.at || Date.now(),
    status: message.status || (message.dir === 'out' ? PENDING : SENT),
    kind: message.kind || 'chat',
  };

  writeThread(h, [...getThread(h), full]);

  const contact = getContact(h);
  if (contact) {
    updateContact(h, {
      lastAt: full.at,
      lastText: full.text,
      unread: full.dir === 'in' ? (contact.unread || 0) + 1 : contact.unread || 0,
    });
  } else {
    notify();
  }
  return full;
}

export function setMessageStatus(handle, id, status) {
  const h = normaliseHandle(handle);
  const thread = getThread(h);
  let changed = false;
  const next = thread.map((m) => {
    if (m.id !== id || m.status === status) return m;
    changed = true;
    return { ...m, status };
  });
  if (!changed) return;
  writeThread(h, next);
  notify();
}

/** Outgoing messages still 'pending', oldest first — the retry queue. */
export function pendingFor(handle) {
  return getThread(handle).filter((m) => m.dir === 'out' && m.status === PENDING);
}

export function markRead(handle) {
  const contact = getContact(handle);
  if (!contact || !contact.unread) return;
  updateContact(handle, { unread: 0 });
}

export function totalUnread() {
  return getContacts().reduce((n, c) => n + (c.unread || 0), 0);
}

export default {
  PEER_PREFIX, ROLE_SIGNER, ROLE_SPEAKER, SENT, PENDING, FAILED,
  normaliseHandle, validateHandle, peerIdFor, handleFromPeerId,
  subscribe,
  getProfile, hasProfile, saveProfile, setProfileRole,
  getContacts, getContact, addContact, ensureContact, updateContact, removeContact,
  getThread, appendMessage, setMessageStatus, pendingFor, markRead, totalUnread,
  newMessageId,
};
