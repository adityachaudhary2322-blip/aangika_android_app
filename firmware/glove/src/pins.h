// Pin map (ESP32 DevKit 30-pin), as wired.
#pragma once

// Flex sensors: 22k fixed resistor / flex divider. All on ADC1, so they keep
// working while Wi-Fi is on (ADC2 is unusable with Wi-Fi).
constexpr int PIN_FLEX[5] = {36 /*thumb*/, 39 /*index*/, 34 /*middle*/, 35 /*ring*/, 32 /*pinky*/};
constexpr int PIN_BATT = 33;          // 100k/100k divider: pin sees VBAT / 2

// MPU-6050
constexpr int PIN_SDA = 21;
constexpr int PIN_SCL = 22;
constexpr int PIN_IMU_INT = 19;       // not an RTC GPIO: cannot wake from deep sleep
constexpr uint8_t IMU_ADDR = 0x68;

// MAX98357A I2S amplifier
constexpr int PIN_I2S_LRC = 25;
constexpr int PIN_I2S_BCLK = 26;
constexpr int PIN_I2S_DIN = 27;
