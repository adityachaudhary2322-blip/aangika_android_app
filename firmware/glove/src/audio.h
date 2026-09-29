// MAX98357A over I2S: beeps and a few short clips stored in flash.
// The glove never streams phone speech: speech stays on the phone.
#pragma once
#include <Arduino.h>

namespace audio {

enum Clip : uint8_t {
  CLIP_CONNECTED = 0,    // rising two-note chime
  CLIP_LOW_BATTERY = 1,  // two low notes
  CLIP_RECOGNISED = 2,   // short high blip
  CLIP_CALIBRATED = 3,   // three quick notes
  CLIP_COUNT
};

bool begin();
void beep(uint16_t freqHz, uint16_t ms);   // blocking, short
void play(Clip clip);

}  // namespace audio
