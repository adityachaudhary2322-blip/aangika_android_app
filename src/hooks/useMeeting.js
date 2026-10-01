import { useCallback, useEffect, useRef, useState } from 'react';
import cameraManager from '../services/cameraManager.js';
import { buildIceServers } from '../services/iceConfig.js';
import { peerServerOptions } from '../services/peerServer.js';
import { publicOrigin } from '../services/platform.js';

/**
 * Group meetings over PeerJS.
 *
 * Topology: the HOST registers the peer id `aangika_room_<code>` and is the
 * room's directory and message relay; media is a full mesh. A joiner:
 *   1. registers its own throwaway peer id,
 *   2. opens a data connection to the host, which replies with the roster,
 *   3. places a media call to every peer on the roster.
 * Everyone answers any call that carries this room's code. Captions, chat and
 * mic/camera state travel as small messages through the host, which stamps
 * the sender and forwards them, so nobody needs a data link to everyone.
 *
 * Calls are one to one (MAX_PEOPLE 2): a signer and a speaker, each end
 * running its own translation (Meet.jsx). The mesh code still works for more,
 * but captions and voice are designed for a pair.
 * When the host leaves, the meeting ends for everyone, and the UI says so.
 *
 * People are CREATED only by a join or the roster. Everything else (media
 * events, captions, mic/camera state) only UPDATES someone already there: a
 * late 'close' from a connection that has already left used to re-create a
 * nameless person stuck on "connecting".
 */

export const ROOM_PREFIX = 'aangika_room_';
const MEMBER_PREFIX = 'aangika_meet_';
export const MAX_PEOPLE = 2;

const CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

/** A new random room code, e.g. "k7m2qp". */
export function newRoomCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

/** What a typed code or a pasted link becomes: [a-z0-9_] only. */
export function normaliseCode(raw) {
  let text = String(raw || '').trim();
  const m = text.match(/[?&]room=([^&#\s]+)/i);
  if (m) text = decodeURIComponent(m[1]);
  return text.toLowerCase().replace(/[^a-z0-9_]/g, '');
}

/** "k7m2qp" -> "K7M-2QP" for reading aloud; longer codes stay as typed. */
export function formatCode(code) {
  return code.length === 6 ? `${code.slice(0, 3)}-${code.slice(3)}`.toUpperCase() : code;
}

export function inviteLink(code) {
  // From the Android app, window.location is https://localhost: share the website instead.
  return `${publicOrigin()}/?room=${encodeURIComponent(code)}`;
}

function peerErrorText(err, code) {
  const type = err?.type || '';
  if (type === 'peer-unavailable') return `No meeting with code ${formatCode(code)} is running. Check the code, or ask the host to start it.`;
  if (type === 'unavailable-id') return 'That room is already running on another device.';
  if (type === 'network' || type === 'server-error' || type === 'socket-error') return 'Could not reach the meeting server. Check your connection.';
  if (type === 'browser-incompatible') return 'This browser cannot do video meetings.';
  return err?.message || 'The meeting connection failed.';
}

/** Camera from cameraManager (shared with the rest of the app) plus a mic. */
async function acquireLocalMedia() {
  const tracks = [];
  let audio = null;
  try {
    await cameraManager.start();
    const cam = cameraManager.getStream();
    if (cam) tracks.push(...cam.getVideoTracks());
  } catch { /* no camera: join with audio only */ }
  try {
    audio = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    tracks.push(...audio.getAudioTracks());
  } catch { /* no mic: join with video only */ }
  return { stream: new MediaStream(tracks), audio };
}

export default function useMeeting(me) {
  const [status, setStatus] = useState('idle');   // idle | starting | live | ended | error
  const [error, setError] = useState(null);
  const [code, setCode] = useState('');
  const [isHost, setIsHost] = useState(false);
  const [people, setPeople] = useState({});        // id -> { id, name, role, stream, caption, mic, cam }
  const [messages, setMessages] = useState([]);
  const [localStream, setLocalStream] = useState(null);
  const [mic, setMicState] = useState(true);
  const [cam, setCamState] = useState(true);

  const peerRef = useRef(null);
  const hostConnRef = useRef(null);           // joiner -> host
  const connsRef = useRef(new Map());         // host: id -> DataConnection
  const callsRef = useRef(new Map());         // id -> MediaConnection
  const localRef = useRef(null);
  const audioRef = useRef(null);
  const selfIdRef = useRef('');
  const leavingRef = useRef(false);
  const meRef = useRef(me);
  meRef.current = me;
  const peopleRef = useRef({});
  peopleRef.current = people;

  /** Update someone already in the room; `create` only for a join / roster. */
  const patchPerson = useCallback((id, patch, create = false) => {
    setPeople((all) => (all[id] || create ? { ...all, [id]: { id, ...all[id], ...patch } } : all));
  }, []);
  const dropPerson = useCallback((id) => {
    setPeople((all) => {
      const next = { ...all };
      delete next[id];
      return next;
    });
    const call = callsRef.current.get(id);
    if (call) { try { call.close(); } catch { /* gone */ } }
    callsRef.current.delete(id);
  }, []);

  // ── Applying messages (the same on host and joiners) ──────────────────
  const apply = useCallback((msg) => {
    switch (msg.t) {
      case 'join':
        patchPerson(msg.peer.id, { name: msg.peer.name, role: msg.peer.role }, true);
        setMessages((m) => [...m, { system: true, text: `${msg.peer.name} joined`, at: Date.now() }]);
        break;
      case 'leave': {
        const who = peopleRef.current[msg.id]?.name;
        if (who) setMessages((m) => [...m, { system: true, text: `${who} left`, at: Date.now() }]);
        dropPerson(msg.id);
        break;
      }
      case 'caption':
        patchPerson(msg.from, { caption: { text: msg.text, kind: msg.kind, final: Boolean(msg.final), lang: msg.lang, at: Date.now() } });
        break;
      case 'chat':
        setMessages((m) => [...m, { from: msg.from, name: msg.name, text: msg.text, at: msg.at }]);
        break;
      case 'state':
        patchPerson(msg.from, { mic: msg.mic, cam: msg.cam });
        break;
      default:
    }
  }, [patchPerson, dropPerson]);

  /** Send to the room: the host fans out; a joiner goes through the host. */
  const send = useCallback((msg) => {
    const stamped = { ...msg, from: selfIdRef.current };
    if (hostConnRef.current) {
      try { hostConnRef.current.send(stamped); } catch { /* host gone */ }
    } else {
      for (const conn of connsRef.current.values()) {
        try { conn.send(stamped); } catch { /* member gone */ }
      }
    }
    return stamped;
  }, []);

  // ── Media ─────────────────────────────────────────────────────────────
  const wireCall = useCallback((call, meta = {}) => {
    callsRef.current.set(call.peer, call);
    if (meta.name) patchPerson(call.peer, { name: meta.name, role: meta.role }, true);
    // The media can arrive before the join message: it may create the person.
    call.on('stream', (stream) => patchPerson(call.peer, { stream, ...(meta.name ? { name: meta.name, role: meta.role } : {}) }, true));
    call.on('close', () => patchPerson(call.peer, { stream: null }));
    call.on('error', () => patchPerson(call.peer, { stream: null }));
  }, [patchPerson]);

  const answerCalls = useCallback((peer, roomCode) => {
    peer.on('call', (call) => {
      if (call.metadata?.room !== roomCode) { try { call.close(); } catch { /* ignore */ } return; }
      call.answer(localRef.current || undefined);
      wireCall(call, call.metadata);
    });
  }, [wireCall]);

  // ── Tear down ─────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    for (const c of callsRef.current.values()) { try { c.close(); } catch { /* gone */ } }
    callsRef.current.clear();
    for (const c of connsRef.current.values()) { try { c.close(); } catch { /* gone */ } }
    connsRef.current.clear();
    try { hostConnRef.current?.close(); } catch { /* gone */ }
    hostConnRef.current = null;
    try { peerRef.current?.destroy(); } catch { /* gone */ }
    peerRef.current = null;
    // Only the mic is ours to stop; the camera belongs to cameraManager.
    audioRef.current?.getTracks().forEach((t) => t.stop());
    audioRef.current = null;
    localRef.current = null;
    setLocalStream(null);
  }, []);

  const leave = useCallback(() => {
    leavingRef.current = true;
    if (!hostConnRef.current && connsRef.current.size) {
      // Host: tell everyone first, and give the message a moment to leave.
      send({ t: 'end' });
      setTimeout(cleanup, 250);
    } else {
      cleanup();
    }
    setPeople({});
    setStatus('idle');
    setCode('');
    setIsHost(false);
    setMessages([]);
  }, [cleanup, send]);

  useEffect(() => () => { leavingRef.current = true; cleanup(); }, [cleanup]);

  // ── Start: host or join ───────────────────────────────────────────────
  const start = useCallback(async (roomCode, asHost) => {
    const codeN = normaliseCode(roomCode);
    if (codeN.length < 3) { setError('Room codes have at least 3 characters.'); setStatus('error'); return; }
    leavingRef.current = false;
    setError(null);
    setStatus('starting');
    setCode(codeN);
    setIsHost(asHost);
    setMessages([]);

    const media = await acquireLocalMedia();
    localRef.current = media.stream;
    audioRef.current = media.audio;
    setLocalStream(media.stream);
    setMicState(media.stream.getAudioTracks().length > 0);
    setCamState(media.stream.getVideoTracks().length > 0);

    const { default: Peer } = await import('peerjs');
    const myId = asHost
      ? ROOM_PREFIX + codeN
      : `${MEMBER_PREFIX}${codeN}_${newRoomCode()}`;
    selfIdRef.current = myId;
    const self = { id: myId, name: meRef.current.name, role: meRef.current.role, self: true };
    setPeople({ [myId]: { ...self, stream: media.stream, mic: true, cam: true } });

    const peer = new Peer(myId, {
      ...peerServerOptions(),
      config: { iceServers: buildIceServers(), iceCandidatePoolSize: 4 },
      debug: 1,
    });
    peerRef.current = peer;
    answerCalls(peer, codeN);

    // Once the call is up, the media and messages flow phone to phone: losing
    // the (free, public) signalling server for a moment must not end the call.
    // Reconnect to it instead; only a failure while STARTING is fatal.
    let up = false;
    peer.on('open', () => { up = true; });
    peer.on('disconnected', () => {
      if (leavingRef.current || peer.destroyed) return;
      setTimeout(() => { try { if (!peer.destroyed && peer.disconnected) peer.reconnect(); } catch { /* next drop retries */ } }, 1000);
    });
    peer.on('error', (err) => {
      if (leavingRef.current) return;
      if (up && ['network', 'socket-error', 'socket-closed', 'server-error', 'disconnected'].includes(err?.type)) {
        console.warn('[meet] signalling server lost; the call continues, reconnecting:', err?.type);
        return;
      }
      // A member that vanished mid-call is not fatal; a missing host is.
      if (err?.type === 'peer-unavailable' && (asHost || hostConnRef.current?.open)) return;
      setError(peerErrorText(err, codeN));
      setStatus('error');
      cleanup();
    });

    /** Everyone already here except the recipient. */
    const sendRoster = (conn) => {
      const roster = [
        { id: myId, name: meRef.current.name, role: meRef.current.role },
        ...[...connsRef.current.values()]
          .filter((c) => c.peer !== conn.peer)
          .map((c) => ({ id: c.peer, name: c.metadata?.name || 'Guest', role: c.metadata?.role })),
      ];
      try { conn.send({ t: 'roster', peers: roster }); } catch { /* gone */ }
    };

    peer.on('open', () => {
      if (asHost) {
        setStatus('live');
        peer.on('connection', (conn) => {
          let refused = false;
          conn.on('open', () => {
            // The same person again (a rejoin before their old link timed
            // out): replace the old link rather than calling the room full.
            const uid = conn.metadata?.uid;
            for (const [id, old] of connsRef.current) {
              if (uid && old.metadata?.uid === uid) {
                connsRef.current.delete(id);
                try { old.close(); } catch { /* gone */ }
                apply({ t: 'leave', id });
              }
            }
            if (connsRef.current.size + 1 >= MAX_PEOPLE) {
              // A message sent the instant the channel opens can be lost, so
              // keep the link a few seconds and answer every 'hello' with 'full'.
              refused = true;
              try { conn.send({ t: 'full' }); } catch { /* not ready */ }
              setTimeout(() => conn.close(), 4000);
              return;
            }
            const member = { id: conn.peer, name: conn.metadata?.name || 'Guest', role: conn.metadata?.role };
            // Roster first, so the newcomer calls everyone already here.
            sendRoster(conn);
            for (const other of connsRef.current.values()) {
              try { other.send({ t: 'join', peer: member }); } catch { /* gone */ }
            }
            connsRef.current.set(conn.peer, conn);
            apply({ t: 'join', peer: member });
          });
          conn.on('data', (msg) => {
            if (!msg || typeof msg !== 'object') return;
            if (refused) { if (msg.t === 'hello') { try { conn.send({ t: 'full' }); } catch { /* gone */ } } return; }
            // A roster sent the instant the channel opened can be lost before
            // the joiner's side is ready; the joiner asks again with 'hello'.
            if (msg.t === 'hello') { sendRoster(conn); return; }
            const stamped = { ...msg, from: conn.peer };     // never trust a claimed sender
            for (const [id, other] of connsRef.current) {
              if (id !== conn.peer) { try { other.send(stamped); } catch { /* gone */ } }
            }
            apply(stamped);
          });
          conn.on('close', () => {
            if (!connsRef.current.has(conn.peer)) return;
            connsRef.current.delete(conn.peer);
            const msg = { t: 'leave', id: conn.peer };
            for (const other of connsRef.current.values()) { try { other.send(msg); } catch { /* gone */ } }
            apply(msg);
          });
        });
        return;
      }

      // Joiner: reach the host.
      const conn = peer.connect(ROOM_PREFIX + codeN, {
        reliable: true,
        metadata: { name: meRef.current.name, role: meRef.current.role, uid: meRef.current.uid },
      });
      hostConnRef.current = conn;
      const timeout = setTimeout(() => {
        if (!conn.open && !leavingRef.current) {
          setError(`No answer from meeting ${formatCode(codeN)}. Check the code, or ask the host to start it.`);
          setStatus('error');
          cleanup();
        }
      }, 15000);
      let gotRoster = false;
      let hello = null;
      conn.on('open', () => {
        clearTimeout(timeout);
        // Ask for the roster, and keep asking until it arrives.
        const ask = () => { if (!gotRoster) { try { conn.send({ t: 'hello' }); } catch { /* closed */ } } };
        ask();
        hello = setInterval(() => (gotRoster ? clearInterval(hello) : ask()), 2500);
      });
      conn.on('data', (msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (msg.t === 'roster') {
          if (gotRoster) return;             // a repeat answer to 'hello'
          gotRoster = true;
          clearInterval(hello);
          setStatus('live');
          for (const p of msg.peers) {
            patchPerson(p.id, { name: p.name, role: p.role }, true);
            const call = peer.call(p.id, localRef.current, {
              metadata: { room: codeN, name: meRef.current.name, role: meRef.current.role },
            });
            if (call) wireCall(call, p);
          }
          return;
        }
        if (msg.t === 'full') {
          leavingRef.current = true;          // the host's hang-up must not read as 'ended'
          clearInterval(hello);
          setError('That call already has two people. Calls are one to one.');
          setStatus('error');
          cleanup();
          return;
        }
        if (msg.t === 'end') {
          leavingRef.current = true;
          cleanup();
          setStatus('ended');
          return;
        }
        apply(msg);
      });
      conn.on('close', () => {
        clearInterval(hello);
        if (leavingRef.current) return;
        leavingRef.current = true;
        cleanup();
        setStatus('ended');
      });
    });
  }, [answerCalls, apply, cleanup, patchPerson, wireCall]);

  const host = useCallback((roomCode) => start(roomCode, true), [start]);
  const join = useCallback((roomCode) => start(roomCode, false), [start]);

  // ── Controls ──────────────────────────────────────────────────────────
  const setMic = useCallback((on) => {
    localRef.current?.getAudioTracks().forEach((t) => { t.enabled = on; });
    setMicState(on);
    const msg = send({ t: 'state', mic: on, cam });
    patchPerson(msg.from, { mic: on });
  }, [send, cam, patchPerson]);

  const setCam = useCallback((on) => {
    localRef.current?.getVideoTracks().forEach((t) => { t.enabled = on; });
    setCamState(on);
    const msg = send({ t: 'state', mic, cam: on });
    patchPerson(msg.from, { cam: on });
  }, [send, mic, patchPerson]);

  /** kind 'sign' | 'speech'; final: a finished sentence (spoken aloud by the other end). */
  const sendCaption = useCallback((text, kind, { final = false, lang } = {}) => {
    const msg = send({ t: 'caption', text, kind, final, lang });
    apply(msg);
  }, [send, apply]);

  const sendChat = useCallback((text) => {
    const msg = send({ t: 'chat', text, name: meRef.current.name, at: Date.now() });
    apply(msg);
  }, [send, apply]);

  return {
    status, error, code, isHost, people, messages, localStream, mic, cam,
    selfId: selfIdRef.current,
    host, join, leave, setMic, setCam, sendCaption, sendChat,
  };
}
