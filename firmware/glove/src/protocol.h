// Wire protocol shared by BLE and the Wi-Fi WebSocket. The app's parser
// (src/services/glove.js) is tested against byte arrays built from this file.
//
// Frame, little-endian, 20 bytes (fits the default BLE ATT payload of 20):
//   off size field
//     0   1  seq        u8, wraps at 255
//     1   5  flex[5]    u8 each, 0 = open .. 255 = fully bent (after calibration)
//                        order: thumb, index, middle, ring, pinky
//     6   6  accel[3]   i16, raw MPU-6050 counts, +-2 g range (16384 / g)
//    12   6  gyro[3]    i16, raw counts, +-500 deg/s (65.5 / (deg/s))
//    18   1  batt_pct   u8, 0-100
//    19   1  flags      u8, see FLAG_*
// Extended frame (flags & FLAG_EXTENDED), 24 bytes, sent only when the
// negotiated ATT MTU allows it (MTU >= 27) and always over Wi-Fi:
//    20   2  roll       i16, centi-degrees (complementary filter)
//    22   2  pitch      i16, centi-degrees
#pragma once
#include <stdint.h>

#define GLOVE_NAME            "Aangika-Glove"
#define GLOVE_SERVICE_UUID    "6a1e0001-4b1a-4c2e-9f5e-a4a9e0c0d100"
#define GLOVE_FRAME_UUID      "6a1e0002-4b1a-4c2e-9f5e-a4a9e0c0d100"
#define GLOVE_CONTROL_UUID    "6a1e0003-4b1a-4c2e-9f5e-a4a9e0c0d100"

constexpr int FRAME_BYTES = 20;
constexpr int FRAME_BYTES_EXT = 24;

enum FrameFlags : uint8_t {
  FLAG_CALIBRATED = 1 << 0,   // open + fist calibration stored in NVS
  FLAG_LOW_BATT   = 1 << 1,   // battery below 15 %
  FLAG_IMU_OK     = 1 << 2,   // MPU-6050 answered at boot
  FLAG_WIFI       = 1 << 3,   // this frame travelled over the WebSocket
  FLAG_EXTENDED   = 1 << 7,   // roll/pitch appended (24-byte frame)
};

// Control characteristic / WebSocket commands: opcode byte + arguments (LE).
enum ControlOp : uint8_t {
  OP_CALIBRATE_OPEN = 0x01,   // no args: record the open hand
  OP_CALIBRATE_FIST = 0x02,   // no args: record the fist
  OP_SET_RATE       = 0x03,   // u8 hz, 5..100
  OP_BEEP           = 0x04,   // u16 freq_hz, u16 duration_ms
  OP_PLAY_CLIP      = 0x05,   // u8 clip id (see audio.h)
  OP_SLEEP          = 0x06,   // no args: deep sleep now
  OP_WIFI_SETUP     = 0x07,   // no args: enable Wi-Fi and open the setup portal
};

struct Frame {
  uint8_t seq;
  uint8_t flex[5];
  int16_t accel[3];
  int16_t gyro[3];
  uint8_t batt;
  uint8_t flags;
  int16_t roll_cdeg;
  int16_t pitch_cdeg;
};

// Explicit little-endian packing (never memcpy a struct: padding and
// endianness must not depend on the compiler).
inline int packFrame(const Frame& f, uint8_t* out, bool extended) {
  auto put16 = [&](int at, int16_t v) {
    out[at] = static_cast<uint8_t>(v & 0xff);
    out[at + 1] = static_cast<uint8_t>((static_cast<uint16_t>(v) >> 8) & 0xff);
  };
  out[0] = f.seq;
  for (int i = 0; i < 5; i++) out[1 + i] = f.flex[i];
  for (int i = 0; i < 3; i++) put16(6 + 2 * i, f.accel[i]);
  for (int i = 0; i < 3; i++) put16(12 + 2 * i, f.gyro[i]);
  out[18] = f.batt;
  out[19] = extended ? (f.flags | FLAG_EXTENDED) : static_cast<uint8_t>(f.flags & ~FLAG_EXTENDED);
  if (!extended) return FRAME_BYTES;
  put16(20, f.roll_cdeg);
  put16(22, f.pitch_cdeg);
  return FRAME_BYTES_EXT;
}
