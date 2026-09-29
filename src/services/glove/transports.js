/**
 * Glove transports. All share one interface so the Android app (Phase 8)
 * can plug in its native BLE plugin without touching the rest:
 *
 *   { kind, connect(), disconnect(), send(bytes), onFrame(cb), onStatus(cb) }
 *
 * frames are delivered as Uint8Array; the caller parses them.
 */

import { GLOVE_NAME, SERVICE_UUID, FRAME_UUID, CONTROL_UUID } from './protocol.js';

/** Why Web Bluetooth is unavailable here, or null if it is available. */
export function webBluetoothBlocker() {
  if (typeof navigator === 'undefined') return 'No browser.';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'iPhone and iPad browsers do not support Web Bluetooth. Use Chrome on Android or a computer, the Aangika Android app, or the glove\'s Wi-Fi mode.';
  }
  if (!navigator.bluetooth) {
    return 'This browser has no Web Bluetooth. Use Chrome or Edge (Android, Windows, macOS, ChromeOS), or the glove\'s Wi-Fi mode.';
  }
  if (typeof window !== 'undefined' && !window.isSecureContext) {
    return 'Web Bluetooth needs HTTPS (or localhost).';
  }
  return null;
}

function emitter() {
  const frames = new Set();
  const status = new Set();
  return {
    onFrame: (cb) => { frames.add(cb); return () => frames.delete(cb); },
    onStatus: (cb) => { status.add(cb); return () => status.delete(cb); },
    frame: (b) => frames.forEach((cb) => cb(b)),
    status: (s) => status.forEach((cb) => cb(s)),
  };
}

/** Chrome Web Bluetooth (Android, desktop). connect() must run from a click. */
export function webBluetoothTransport() {
  const ev = emitter();
  let device = null;
  let control = null;
  let frameChar = null;
  const onValue = (e) => ev.frame(new Uint8Array(e.target.value.buffer.slice(
    e.target.value.byteOffset, e.target.value.byteOffset + e.target.value.byteLength)));
  const onGone = () => ev.status({ state: 'disconnected' });

  return {
    kind: 'ble',
    ...ev,
    async connect() {
      const blocker = webBluetoothBlocker();
      if (blocker) throw new Error(blocker);
      ev.status({ state: 'connecting' });
      device = await navigator.bluetooth.requestDevice({
        filters: [{ name: GLOVE_NAME }, { services: [SERVICE_UUID] }],
        optionalServices: [SERVICE_UUID],
      });
      device.addEventListener('gattserverdisconnected', onGone);
      const server = await device.gatt.connect();
      const service = await server.getPrimaryService(SERVICE_UUID);
      frameChar = await service.getCharacteristic(FRAME_UUID);
      control = await service.getCharacteristic(CONTROL_UUID);
      frameChar.addEventListener('characteristicvaluechanged', onValue);
      await frameChar.startNotifications();
      ev.status({ state: 'connected', name: device.name });
    },
    async disconnect() {
      try { frameChar?.removeEventListener('characteristicvaluechanged', onValue); } catch { /* gone */ }
      try { device?.gatt?.disconnect(); } catch { /* gone */ }
      ev.status({ state: 'disconnected' });
    },
    async send(bytes) {
      if (!control) throw new Error('Glove not connected.');
      await (control.writeValueWithoutResponse
        ? control.writeValueWithoutResponse(bytes) : control.writeValue(bytes));
    },
  };
}

/** The glove's Wi-Fi mode: ws://<glove-ip>:81, same frames and commands. */
export function webSocketTransport(url) {
  const ev = emitter();
  let ws = null;
  return {
    kind: 'wifi',
    ...ev,
    connect() {
      return new Promise((resolve, reject) => {
        ev.status({ state: 'connecting' });
        ws = new WebSocket(url);
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => { ev.status({ state: 'connected', name: url }); resolve(); };
        ws.onerror = () => reject(new Error(`Could not reach the glove at ${url}. Same Wi-Fi? Note: an HTTPS page cannot open ws:// on most browsers.`));
        ws.onclose = () => ev.status({ state: 'disconnected' });
        ws.onmessage = (m) => { if (m.data instanceof ArrayBuffer) ev.frame(new Uint8Array(m.data)); };
      });
    },
    async disconnect() { try { ws?.close(); } catch { /* closed */ } },
    async send(bytes) { if (ws?.readyState === 1) ws.send(bytes); },
  };
}

/**
 * Replays recorded frames at their original timing: tests, demos and
 * development without hardware. `frames` are Uint8Array or number arrays.
 */
export function replayTransport(frames, { hz = 50, loop = false } = {}) {
  const ev = emitter();
  let timer = null;
  const sent = [];
  return {
    kind: 'replay',
    ...ev,
    sent,
    async connect() {
      ev.status({ state: 'connected', name: 'Simulated glove' });
      // Frames are due by elapsed time, not by timer ticks: when the page is
      // busy the backlog arrives in one burst, exactly as queued BLE
      // notifications do, instead of the whole glove slowing down.
      const start = performance.now();
      let i = 0;
      timer = setInterval(() => {
        const due = Math.floor(((performance.now() - start) * hz) / 1000);
        while (i <= due) {
          const k = loop ? i % frames.length : i;
          if (k >= frames.length) { clearInterval(timer); timer = null; return; }
          const f = frames[k];
          ev.frame(f instanceof Uint8Array ? f : Uint8Array.from(f));
          i += 1;
        }
      }, 1000 / hz);
    },
    async disconnect() { clearInterval(timer); timer = null; ev.status({ state: 'disconnected' }); },
    async send(bytes) { sent.push(Array.from(bytes)); },
  };
}

export default { webBluetoothTransport, webSocketTransport, replayTransport, webBluetoothBlocker };
