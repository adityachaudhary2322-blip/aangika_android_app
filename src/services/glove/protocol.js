/**
 * Glove wire protocol (mirror of firmware/glove/src/protocol.h).
 *
 * Frame, little-endian: 20 bytes, or 24 with FLAG_EXTENDED (roll/pitch).
 *   0 seq u8 | 1..5 flex[5] u8 | 6..11 accel[3] i16 | 12..17 gyro[3] i16
 *   18 batt_pct u8 | 19 flags u8 | [20 roll i16 cdeg | 22 pitch i16 cdeg]
 */

export const GLOVE_NAME = 'Aangika-Glove';
export const SERVICE_UUID = '6a1e0001-4b1a-4c2e-9f5e-a4a9e0c0d100';
export const FRAME_UUID = '6a1e0002-4b1a-4c2e-9f5e-a4a9e0c0d100';
export const CONTROL_UUID = '6a1e0003-4b1a-4c2e-9f5e-a4a9e0c0d100';

export const FRAME_BYTES = 20;
export const FRAME_BYTES_EXT = 24;
export const FLAGS = { CALIBRATED: 1, LOW_BATT: 2, IMU_OK: 4, WIFI: 8, EXTENDED: 128 };
export const FINGERS = ['thumb', 'index', 'middle', 'ring', 'pinky'];

const ACCEL_LSB_PER_G = 16384;
const GYRO_LSB_PER_DPS = 65.5;

/**
 * Bytes -> frame object. Accepts a DataView, ArrayBuffer or Uint8Array.
 * Throws on a malformed frame (wrong length) rather than guessing.
 */
export function parseFrame(input) {
  const dv = input instanceof DataView ? input
    : new DataView(input.buffer ? input.buffer : input, input.byteOffset || 0, input.byteLength);
  if (dv.byteLength !== FRAME_BYTES && dv.byteLength !== FRAME_BYTES_EXT) {
    throw new Error(`glove frame must be ${FRAME_BYTES} or ${FRAME_BYTES_EXT} bytes, got ${dv.byteLength}`);
  }
  const flags = dv.getUint8(19);
  const extended = Boolean(flags & FLAGS.EXTENDED);
  if (extended && dv.byteLength < FRAME_BYTES_EXT) throw new Error('extended flag set on a 20-byte frame');
  const accel = [dv.getInt16(6, true), dv.getInt16(8, true), dv.getInt16(10, true)];
  const gyro = [dv.getInt16(12, true), dv.getInt16(14, true), dv.getInt16(16, true)];
  const frame = {
    seq: dv.getUint8(0),
    flex: [1, 2, 3, 4, 5].map((i) => dv.getUint8(i)),
    accel,
    gyro,
    battery: dv.getUint8(18),
    flags,
    calibrated: Boolean(flags & FLAGS.CALIBRATED),
    lowBattery: Boolean(flags & FLAGS.LOW_BATT),
    imuOk: Boolean(flags & FLAGS.IMU_OK),
    viaWifi: Boolean(flags & FLAGS.WIFI),
    extended,
    // g and deg/s for display and features
    accelG: accel.map((v) => v / ACCEL_LSB_PER_G),
    gyroDps: gyro.map((v) => v / GYRO_LSB_PER_DPS),
  };
  if (extended) {
    frame.roll = dv.getInt16(20, true) / 100;
    frame.pitch = dv.getInt16(22, true) / 100;
  } else {
    // No filtered angles on a 20-byte frame: derive them from gravity.
    const [ax, ay, az] = frame.accelG;
    frame.roll = (Math.atan2(ay, az) * 180) / Math.PI;
    frame.pitch = (Math.atan2(-ax, Math.hypot(ay, az)) * 180) / Math.PI;
  }
  return frame;
}

/** Frame object -> bytes (used by the simulator and tests). */
export function encodeFrame(f, { extended = false } = {}) {
  const buf = new ArrayBuffer(extended ? FRAME_BYTES_EXT : FRAME_BYTES);
  const dv = new DataView(buf);
  dv.setUint8(0, f.seq & 0xff);
  f.flex.forEach((v, i) => dv.setUint8(1 + i, Math.max(0, Math.min(255, Math.round(v)))));
  f.accel.forEach((v, i) => dv.setInt16(6 + 2 * i, v, true));
  f.gyro.forEach((v, i) => dv.setInt16(12 + 2 * i, v, true));
  dv.setUint8(18, f.battery ?? 100);
  const flags = (f.flags ?? 0) & ~FLAGS.EXTENDED;
  dv.setUint8(19, extended ? flags | FLAGS.EXTENDED : flags);
  if (extended) {
    dv.setInt16(20, Math.round((f.roll ?? 0) * 100), true);
    dv.setInt16(22, Math.round((f.pitch ?? 0) * 100), true);
  }
  return new Uint8Array(buf);
}

// ── Control commands ────────────────────────────────────────────────────────
const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
export const commands = {
  calibrateOpen: () => Uint8Array.of(0x01),
  calibrateFist: () => Uint8Array.of(0x02),
  setRate: (hz) => Uint8Array.of(0x03, Math.max(5, Math.min(100, Math.round(hz)))),
  beep: (freqHz = 880, ms = 120) => Uint8Array.of(0x04, ...u16(freqHz), ...u16(ms)),
  playClip: (id) => Uint8Array.of(0x05, id & 0xff),
  sleep: () => Uint8Array.of(0x06),
  wifiSetup: () => Uint8Array.of(0x07),
};
export const CLIPS = { CONNECTED: 0, LOW_BATTERY: 1, RECOGNISED: 2, CALIBRATED: 3 };

export default { parseFrame, encodeFrame, commands, CLIPS, FLAGS, FINGERS };
