/**
 * The connected glove: one instance for the whole app.
 *
 * connect(transport) wires a transport (BLE / Wi-Fi / replay), parses every
 * frame, keeps the latest one plus a 2-second history for recognition, and
 * notifies listeners. UI listeners are throttled to ~12 Hz; recognition
 * listeners (onFrame) get every frame.
 */

import { parseFrame, commands } from './protocol.js';

const HISTORY = 100;                 // 2 s at 50 Hz

let transport = null;
let state = { status: 'disconnected', name: null, kind: null, frame: null, error: null, rateHz: 0 };
const ui = new Set();
const frameListeners = new Set();
const history = [];
let lastUiAt = 0;
let rateCount = 0;
let rateStart = 0;
let unsubs = [];

function emit(patch, force = true) {
  state = { ...state, ...patch };
  const now = Date.now();
  if (!force && now - lastUiAt < 80) return;
  lastUiAt = now;
  for (const fn of ui) { try { fn(state); } catch { /* listener bug */ } }
}

export const getState = () => state;
export const getHistory = () => history;

/** UI state (throttled). */
export function subscribe(fn) {
  ui.add(fn);
  fn(state);
  return () => ui.delete(fn);
}

/** Every parsed frame, for recognition. */
export function onFrame(fn) {
  frameListeners.add(fn);
  return () => frameListeners.delete(fn);
}

function handleBytes(bytes) {
  let frame;
  try {
    frame = parseFrame(bytes);
  } catch (err) {
    emit({ error: err.message });
    return;
  }
  frame.at = Date.now();
  history.push(frame);
  if (history.length > HISTORY) history.shift();
  const now = frame.at;
  if (!rateStart) rateStart = now;
  rateCount += 1;
  if (now - rateStart >= 1000) {
    state.rateHz = Math.round((rateCount * 1000) / (now - rateStart));
    rateCount = 0;
    rateStart = now;
  }
  for (const fn of frameListeners) { try { fn(frame); } catch { /* listener bug */ } }
  emit({ frame }, false);
}

export async function connect(t) {
  await disconnect();
  transport = t;
  history.length = 0;
  unsubs = [
    t.onFrame(handleBytes),
    t.onStatus((s) => emit({ status: s.state, name: s.name ?? state.name })),
  ];
  emit({ status: 'connecting', kind: t.kind, error: null });
  try {
    await t.connect();
  } catch (err) {
    emit({ status: 'disconnected', error: err.message });
    throw err;
  }
}

export async function disconnect() {
  if (!transport) return;
  const t = transport;
  transport = null;
  unsubs.forEach((u) => u());
  unsubs = [];
  try { await t.disconnect(); } catch { /* already gone */ }
  emit({ status: 'disconnected', frame: null, rateHz: 0 });
}

export const isConnected = () => state.status === 'connected';

async function send(bytes) {
  if (!transport) throw new Error('Glove not connected.');
  await transport.send(bytes);
}

export const calibrateOpen = () => send(commands.calibrateOpen());
export const calibrateFist = () => send(commands.calibrateFist());
export const beep = (hz, ms) => send(commands.beep(hz, ms));
export const playClip = (id) => send(commands.playClip(id));
export const setRate = (hz) => send(commands.setRate(hz));
export const sleep = () => send(commands.sleep());
export const wifiSetup = () => send(commands.wifiSetup());

export default {
  connect, disconnect, subscribe, onFrame, getState, getHistory, isConnected,
  calibrateOpen, calibrateFist, beep, playClip, setRate, sleep, wifiSetup,
};
