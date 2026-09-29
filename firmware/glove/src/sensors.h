// Flex sensors (with calibration in NVS), MPU-6050, battery.
#pragma once
#include <Arduino.h>

namespace sensors {

bool begin();                       // returns true if the IMU answered
void readFlexRaw(uint16_t raw[5]);  // averaged millivolts per finger
void readFlex(uint8_t out[5]);      // calibrated 0 (open) .. 255 (fist)
bool calibrated();
void calibrateOpen();               // store the current raw values as "open"
void calibrateFist();               // ... as "fist"

bool imuOk();
// Raw accel / gyro counts, and the complementary-filtered roll/pitch (deg).
void readImu(int16_t accel[3], int16_t gyro[3], float& rollDeg, float& pitchDeg, float dt);

uint8_t batteryPercent();

// Largest per-finger change since the last call, in calibrated units: used to
// decide whether the glove is idle.
uint8_t flexActivity(const uint8_t now[5]);

}  // namespace sensors
