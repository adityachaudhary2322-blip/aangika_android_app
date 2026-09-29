/**
 * Native Bluetooth LE for the glove, via @capacitor-community/bluetooth-le.
 * Same interface as the web transports (src/services/glove/transports.js):
 *   { kind, connect(), disconnect(), send(bytes), onFrame(cb), onStatus(cb) }
 * Works on Android without Chrome's Web Bluetooth, and asks for the Android
 * Bluetooth permissions itself.
 */
import { BleClient } from '@capacitor-community/bluetooth-le';
import {
  GLOVE_NAME, SERVICE_UUID, FRAME_UUID, CONTROL_UUID,
} from '../services/glove/protocol.js';

export function capacitorBleTransport() {
  const frames = new Set();
  const status = new Set();
  const emitStatus = (s) => status.forEach((cb) => cb(s));
  let deviceId = null;

  return {
    kind: 'ble',
    onFrame: (cb) => { frames.add(cb); return () => frames.delete(cb); },
    onStatus: (cb) => { status.add(cb); return () => status.delete(cb); },

    async connect() {
      emitStatus({ state: 'connecting' });
      await BleClient.initialize({ androidNeverForLocation: true });
      const device = await BleClient.requestDevice({
        services: [SERVICE_UUID],
        namePrefix: GLOVE_NAME,
      });
      deviceId = device.deviceId;
      await BleClient.connect(deviceId, () => emitStatus({ state: 'disconnected' }));
      await BleClient.startNotifications(deviceId, SERVICE_UUID, FRAME_UUID, (value) => {
        const bytes = new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
        frames.forEach((cb) => cb(bytes));
      });
      emitStatus({ state: 'connected', name: device.name || GLOVE_NAME });
    },

    async disconnect() {
      if (!deviceId) return;
      try { await BleClient.stopNotifications(deviceId, SERVICE_UUID, FRAME_UUID); } catch { /* gone */ }
      try { await BleClient.disconnect(deviceId); } catch { /* gone */ }
      deviceId = null;
      emitStatus({ state: 'disconnected' });
    },

    async send(bytes) {
      if (!deviceId) throw new Error('Glove not connected.');
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      await BleClient.writeWithoutResponse(deviceId, SERVICE_UUID, CONTROL_UUID, view);
    },
  };
}

export default capacitorBleTransport;
