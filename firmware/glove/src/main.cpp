// Aangika one-hand glove firmware.
//   5 flex sensors + MPU-6050 -> 20-byte frames at 50 Hz over BLE notify
//   (and a WebSocket on port 81 when Wi-Fi is enabled). Control commands:
//   calibrate open / fist, set rate, beep, play clip, sleep, Wi-Fi setup.
//   Deep sleep after 5 minutes idle; wake on a strong flex.
#include <Arduino.h>
#include <esp_sleep.h>

#include "audio.h"
#include "links.h"
#include "pins.h"
#include "protocol.h"
#include "sensors.h"

namespace {

constexpr uint32_t IDLE_SLEEP_MS = 5UL * 60UL * 1000UL;
constexpr uint8_t ACTIVITY_THRESHOLD = 20;        // calibrated units (of 255)
constexpr uint8_t LOW_BATTERY_PCT = 15;

uint32_t periodMs = 20;                           // 50 Hz
uint32_t lastFrameAt = 0;
uint32_t lastActiveAt = 0;
uint32_t lastBattAt = 0;
uint8_t seq = 0;
uint8_t battPct = 100;
bool lowBattWarned = false;
bool wasConnected = false;

void goToSleep() {
  audio::beep(330, 120);
  // Wake on a strong flex: the flex inputs are RTC GPIOs, so ext1 can wake on
  // any of them reading HIGH. This fires only if a bent finger raises its pin
  // above the digital threshold (~2.5 V): true when the flex sensor is on the
  // HIGH side of the divider. See docs/GLOVE.md if your wiring is the other way.
  uint64_t mask = 0;
  for (int pin : PIN_FLEX) mask |= (1ULL << pin);
  esp_sleep_enable_ext1_wakeup(mask, ESP_EXT1_WAKEUP_ANY_HIGH);
  Serial.println("[glove] deep sleep");
  Serial.flush();
  esp_deep_sleep_start();
}

void handle(const links::Command& c) {
  const uint8_t* b = c.bytes;
  switch (b[0]) {
    case OP_CALIBRATE_OPEN:
      sensors::calibrateOpen();
      audio::beep(1047, 80);
      break;
    case OP_CALIBRATE_FIST:
      sensors::calibrateFist();
      audio::play(sensors::calibrated() ? audio::CLIP_CALIBRATED : audio::CLIP_RECOGNISED);
      break;
    case OP_SET_RATE:
      if (c.len >= 2) periodMs = 1000 / constrain(b[1], 5, 100);
      break;
    case OP_BEEP:
      if (c.len >= 5) audio::beep(b[1] | (b[2] << 8), b[3] | (b[4] << 8));
      break;
    case OP_PLAY_CLIP:
      if (c.len >= 2) audio::play(static_cast<audio::Clip>(b[1]));
      break;
    case OP_SLEEP:
      goToSleep();
      break;
    case OP_WIFI_SETUP:
      links::enableWifi();
      break;
    default:
      break;
  }
  lastActiveAt = millis();
}

}  // namespace

void setup() {
  Serial.begin(115200);
  const bool imu = sensors::begin();
  audio::begin();
  links::beginBle();
  links::beginWifiIfEnabled();
  battPct = sensors::batteryPercent();
  lastActiveAt = millis();
  Serial.printf("[glove] %s up: imu=%d calibrated=%d batt=%u%%\n",
                GLOVE_NAME, imu, sensors::calibrated(), battPct);
}

void loop() {
  links::loopWifi();

  links::Command cmd;
  while (links::nextCommand(cmd)) handle(cmd);

  const uint32_t now = millis();

  const bool connected = links::bleConnected() || links::wsConnected();
  if (connected && !wasConnected) audio::play(audio::CLIP_CONNECTED);
  wasConnected = connected;

  if (now - lastBattAt >= 5000) {
    lastBattAt = now;
    battPct = sensors::batteryPercent();
    if (battPct < LOW_BATTERY_PCT && !lowBattWarned) { audio::play(audio::CLIP_LOW_BATTERY); lowBattWarned = true; }
    if (battPct >= LOW_BATTERY_PCT + 5) lowBattWarned = false;
  }

  if (now - lastFrameAt < periodMs) return;
  const float dt = (now - lastFrameAt) / 1000.0f;
  lastFrameAt = now;

  Frame f = {};
  f.seq = seq++;
  sensors::readFlex(f.flex);
  float roll = 0, pitch = 0;
  sensors::readImu(f.accel, f.gyro, roll, pitch, dt);
  f.roll_cdeg = static_cast<int16_t>(constrain(roll * 100.0f, -18000.0f, 18000.0f));
  f.pitch_cdeg = static_cast<int16_t>(constrain(pitch * 100.0f, -18000.0f, 18000.0f));
  f.batt = battPct;
  f.flags = (sensors::calibrated() ? FLAG_CALIBRATED : 0) | (battPct < LOW_BATTERY_PCT ? FLAG_LOW_BATT : 0)
          | (sensors::imuOk() ? FLAG_IMU_OK : 0);

  uint8_t buf[FRAME_BYTES_EXT];
  if (links::bleConnected()) {
    // ATT payload = MTU - 3. The 24-byte frame needs MTU >= 27; else 20 bytes.
    const bool ext = links::bleMtu() >= FRAME_BYTES_EXT + 3;
    links::bleSend(buf, packFrame(f, buf, ext));
  }
  if (links::wsConnected()) {
    Frame w = f;
    w.flags |= FLAG_WIFI;
    links::wsSend(buf, packFrame(w, buf, true));
  }

  // Idle = nobody connected and the fingers barely moved.
  if (connected || sensors::flexActivity(f.flex) >= ACTIVITY_THRESHOLD) lastActiveAt = now;
  if (now - lastActiveAt >= IDLE_SLEEP_MS) goToSleep();
}
