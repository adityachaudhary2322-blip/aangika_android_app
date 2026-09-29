#include "audio.h"

#include <driver/i2s.h>
#include <math.h>

#include "pins.h"

namespace audio {
namespace {

constexpr i2s_port_t PORT = I2S_NUM_0;
constexpr int RATE = 16000;
constexpr int16_t AMPLITUDE = 6000;       // well below full scale: small speaker
bool ready = false;

struct Note { uint16_t hz; uint16_t ms; };

// Clips live in flash as tiny note tables (no audio files needed).
const Note CONNECTED[] PROGMEM = {{880, 90}, {0, 30}, {1320, 140}};
const Note LOW_BATT[] PROGMEM = {{440, 180}, {0, 60}, {330, 260}};
const Note RECOGNISED[] PROGMEM = {{1760, 60}};
const Note CALIBRATED[] PROGMEM = {{1047, 70}, {0, 30}, {1319, 70}, {0, 30}, {1568, 110}};

struct ClipDef { const Note* notes; uint8_t n; };
const ClipDef CLIPS[CLIP_COUNT] = {
  {CONNECTED, sizeof(CONNECTED) / sizeof(Note)},
  {LOW_BATT, sizeof(LOW_BATT) / sizeof(Note)},
  {RECOGNISED, sizeof(RECOGNISED) / sizeof(Note)},
  {CALIBRATED, sizeof(CALIBRATED) / sizeof(Note)},
};

void tone(uint16_t hz, uint16_t ms) {
  const int total = RATE * ms / 1000;
  const int fade = RATE / 200;             // 5 ms ramps: no clicks
  int16_t buf[256];
  size_t written = 0;
  for (int i = 0; i < total;) {
    int n = 0;
    for (; n < 256 && i < total; n++, i++) {
      float env = 1.0f;
      if (i < fade) env = static_cast<float>(i) / fade;
      else if (total - i < fade) env = static_cast<float>(total - i) / fade;
      buf[n] = hz ? static_cast<int16_t>(AMPLITUDE * env * sinf(2.0f * PI * hz * i / RATE)) : 0;
    }
    i2s_write(PORT, buf, n * sizeof(int16_t), &written, portMAX_DELAY);
  }
}

}  // namespace

bool begin() {
  i2s_config_t cfg = {};
  cfg.mode = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_TX);
  cfg.sample_rate = RATE;
  cfg.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  cfg.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
  cfg.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  cfg.intr_alloc_flags = 0;
  cfg.dma_buf_count = 4;
  cfg.dma_buf_len = 256;
  cfg.tx_desc_auto_clear = true;
  i2s_pin_config_t pins = {};
  pins.mck_io_num = I2S_PIN_NO_CHANGE;
  pins.bck_io_num = PIN_I2S_BCLK;
  pins.ws_io_num = PIN_I2S_LRC;
  pins.data_out_num = PIN_I2S_DIN;
  pins.data_in_num = I2S_PIN_NO_CHANGE;
  ready = i2s_driver_install(PORT, &cfg, 0, nullptr) == ESP_OK && i2s_set_pin(PORT, &pins) == ESP_OK;
  if (ready) i2s_zero_dma_buffer(PORT);
  return ready;
}

void beep(uint16_t freqHz, uint16_t ms) {
  if (!ready) return;
  tone(constrain(freqHz, 100, 8000), constrain(ms, 10, 2000));
  tone(0, 20);
}

void play(Clip clip) {
  if (!ready || clip >= CLIP_COUNT) return;
  const ClipDef& c = CLIPS[clip];
  for (uint8_t i = 0; i < c.n; i++) {
    Note note;
    memcpy_P(&note, &c.notes[i], sizeof(Note));
    tone(note.hz, note.ms);
  }
  tone(0, 20);
}

}  // namespace audio
