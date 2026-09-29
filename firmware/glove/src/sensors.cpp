#include "sensors.h"

#include <Preferences.h>
#include <Wire.h>
#include <math.h>

#include "pins.h"

namespace sensors {
namespace {

constexpr int ADC_SAMPLES = 8;          // averaged per channel per read
constexpr float ALPHA = 0.98f;          // complementary filter: gyro weight
constexpr float ACCEL_LSB_PER_G = 16384.0f;   // +-2 g
constexpr float GYRO_LSB_PER_DPS = 65.5f;     // +-500 deg/s

Preferences prefs;
uint16_t openMv[5] = {0};
uint16_t fistMv[5] = {0};
bool haveOpen = false;
bool haveFist = false;
bool imuPresent = false;
float roll = 0, pitch = 0;
bool filterPrimed = false;
uint8_t lastFlex[5] = {0};

void imuWrite(uint8_t reg, uint8_t val) {
  Wire.beginTransmission(IMU_ADDR);
  Wire.write(reg);
  Wire.write(val);
  Wire.endTransmission();
}

bool imuRead(uint8_t reg, uint8_t* buf, size_t n) {
  Wire.beginTransmission(IMU_ADDR);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(static_cast<int>(IMU_ADDR), static_cast<int>(n)) != static_cast<int>(n)) return false;
  for (size_t i = 0; i < n; i++) buf[i] = Wire.read();
  return true;
}

void loadCalibration() {
  prefs.begin("glove", true);
  haveOpen = prefs.getBytes("open", openMv, sizeof(openMv)) == sizeof(openMv);
  haveFist = prefs.getBytes("fist", fistMv, sizeof(fistMv)) == sizeof(fistMv);
  prefs.end();
}

}  // namespace

bool begin() {
  for (int pin : PIN_FLEX) analogSetPinAttenuation(pin, ADC_11db);
  analogSetPinAttenuation(PIN_BATT, ADC_11db);
  loadCalibration();

  Wire.begin(PIN_SDA, PIN_SCL, 400000);
  uint8_t who = 0;
  imuPresent = imuRead(0x75, &who, 1) && (who == 0x68 || who == 0x70 || who == 0x72);
  if (imuPresent) {
    imuWrite(0x6B, 0x00);   // PWR_MGMT_1: wake, internal clock
    imuWrite(0x1A, 0x03);   // CONFIG: DLPF ~44 Hz
    imuWrite(0x1B, 0x08);   // GYRO_CONFIG: +-500 deg/s
    imuWrite(0x1C, 0x00);   // ACCEL_CONFIG: +-2 g
  }
  return imuPresent;
}

void readFlexRaw(uint16_t raw[5]) {
  for (int f = 0; f < 5; f++) {
    uint32_t sum = 0;
    for (int s = 0; s < ADC_SAMPLES; s++) sum += analogReadMilliVolts(PIN_FLEX[f]);
    raw[f] = static_cast<uint16_t>(sum / ADC_SAMPLES);
  }
}

bool calibrated() { return haveOpen && haveFist; }

void readFlex(uint8_t out[5]) {
  uint16_t raw[5];
  readFlexRaw(raw);
  for (int f = 0; f < 5; f++) {
    if (!calibrated()) {                       // uncalibrated: raw scaled 0..3300 mV
      out[f] = static_cast<uint8_t>(constrain(raw[f] * 255L / 3300, 0L, 255L));
      continue;
    }
    // Works whichever way the divider is wired (voltage rising OR falling).
    const long lo = openMv[f], hi = fistMv[f];
    const long span = hi - lo;
    long v = span == 0 ? 0 : (static_cast<long>(raw[f]) - lo) * 255L / span;
    out[f] = static_cast<uint8_t>(constrain(v, 0L, 255L));
  }
}

void calibrateOpen() {
  readFlexRaw(openMv);
  prefs.begin("glove", false);
  prefs.putBytes("open", openMv, sizeof(openMv));
  prefs.end();
  haveOpen = true;
}

void calibrateFist() {
  readFlexRaw(fistMv);
  prefs.begin("glove", false);
  prefs.putBytes("fist", fistMv, sizeof(fistMv));
  prefs.end();
  haveFist = true;
}

bool imuOk() { return imuPresent; }

void readImu(int16_t accel[3], int16_t gyro[3], float& rollDeg, float& pitchDeg, float dt) {
  uint8_t b[14];
  if (!imuPresent || !imuRead(0x3B, b, sizeof(b))) {
    for (int i = 0; i < 3; i++) { accel[i] = 0; gyro[i] = 0; }
    rollDeg = roll; pitchDeg = pitch;
    return;
  }
  for (int i = 0; i < 3; i++) accel[i] = static_cast<int16_t>((b[2 * i] << 8) | b[2 * i + 1]);
  for (int i = 0; i < 3; i++) gyro[i] = static_cast<int16_t>((b[8 + 2 * i] << 8) | b[9 + 2 * i]);

  const float ax = accel[0] / ACCEL_LSB_PER_G, ay = accel[1] / ACCEL_LSB_PER_G, az = accel[2] / ACCEL_LSB_PER_G;
  const float accRoll = atan2f(ay, az) * 57.29578f;
  const float accPitch = atan2f(-ax, sqrtf(ay * ay + az * az)) * 57.29578f;
  if (!filterPrimed) { roll = accRoll; pitch = accPitch; filterPrimed = true; }
  roll = ALPHA * (roll + (gyro[0] / GYRO_LSB_PER_DPS) * dt) + (1 - ALPHA) * accRoll;
  pitch = ALPHA * (pitch + (gyro[1] / GYRO_LSB_PER_DPS) * dt) + (1 - ALPHA) * accPitch;
  rollDeg = roll;
  pitchDeg = pitch;
}

uint8_t batteryPercent() {
  uint32_t sum = 0;
  for (int s = 0; s < ADC_SAMPLES; s++) sum += analogReadMilliVolts(PIN_BATT);
  const float vbat = (sum / static_cast<float>(ADC_SAMPLES)) * 2.0f / 1000.0f;   // divider 1:2
  // LiPo 3.30 V (LDO dropout, effectively empty) .. 4.20 V (full), linear.
  const float pct = (vbat - 3.30f) / (4.20f - 3.30f) * 100.0f;
  return static_cast<uint8_t>(constrain(static_cast<int>(pct + 0.5f), 0, 100));
}

uint8_t flexActivity(const uint8_t now[5]) {
  uint8_t most = 0;
  for (int f = 0; f < 5; f++) {
    const uint8_t d = now[f] > lastFlex[f] ? now[f] - lastFlex[f] : lastFlex[f] - now[f];
    if (d > most) most = d;
    lastFlex[f] = now[f];
  }
  return most;
}

}  // namespace sensors
