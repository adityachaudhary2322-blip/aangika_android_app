# Aangika glove: firmware guide (Windows)

One-hand data glove: five flex sensors, an MPU-6050 and a MAX98357A speaker on
an ESP32 DevKit (30-pin). It streams 20-byte frames at 50 Hz over Bluetooth LE
(and optionally a Wi-Fi WebSocket) to the Aangika app.

**Status:** the firmware **compiles** (PlatformIO, espressif32 6.9.0: RAM
17.5 %, flash 38 %). It has **not been run on the hardware yet**. Follow
"First power-on checks" below the first time.

## Pin map

| Part | Signal | GPIO |
|---|---|---|
| Flex: thumb / index / middle / ring / pinky | 22 kΩ + flex divider → ADC1 | 36 / 39 / 34 / 35 / 32 |
| Battery | 100 kΩ / 100 kΩ divider (pin sees VBAT/2) | 33 |
| MPU-6050 | SDA / SCL / INT, address 0x68 | 21 / 22 / 19 |
| MAX98357A | LRC / BCLK / DIN | 25 / 26 / 27 |
| Power | LiPo → TP4056 → switch → 3.3 V LDO → 3V3 pin | |

All analog inputs are on ADC1, so they keep working while Wi-Fi is on.

## Flash it (PowerShell)

```powershell
# one-time: PlatformIO CLI in its own venv
py -3.11 -m venv C:\dev\pio-venv
C:\dev\pio-venv\Scripts\pip install platformio

cd C:\dev\aangika\firmware\glove
C:\dev\pio-venv\Scripts\pio run                   # build
C:\dev\pio-venv\Scripts\pio run -t upload         # flash (USB cable, CP210x/CH340 driver)
C:\dev\pio-venv\Scripts\pio device monitor        # logs at 115200
```

If upload stalls at "Connecting…", hold the board's **BOOT** button until the
upload starts. If no COM port appears, install the USB-serial driver (CP210x or
CH340, whichever chip is on your board).

## First power-on checks

1. The serial monitor should print `[glove] Aangika-Glove up: imu=1 calibrated=0 batt=NN%`.
   - `imu=0`: check the SDA 21 / SCL 22 wiring and that the MPU-6050 has 3.3 V.
   - `batt` stuck at 0 or 100: check the 100 k / 100 k divider on GPIO 33.
2. In the app: Settings → Glove → Connect. The glove plays a two-note chime.
3. Calibrate (below). The finger bars should move 0 → 255 from open to fist.

## Calibration

Stored in the ESP32's NVS flash, so it survives power-off.
- **Open:** hold the hand flat and relaxed, then press *Calibrate open* (one beep).
- **Fist:** close the hand fully, then press *Calibrate fist* (three-note chime when both are stored).

It works whichever way a divider is wired (voltage rising or falling with bend).
Recalibrate if a sensor is re-glued or the glove is worn by someone else.

## Protocol

BLE device name `Aangika-Glove`, service `6a1e0001-4b1a-4c2e-9f5e-a4a9e0c0d100`.

| Characteristic | UUID | Use |
|---|---|---|
| frame | `6a1e0002-…d100` | NOTIFY, 50 Hz |
| control | `6a1e0003-…d100` | WRITE: opcode + arguments |

**Frame**, little-endian, 20 bytes:

| offset | size | field | notes |
|---|---|---|---|
| 0 | 1 | seq | u8, wraps |
| 1 | 5 | flex[5] | u8 each, 0 open … 255 fist; thumb, index, middle, ring, pinky |
| 6 | 6 | accel[3] | i16 raw, ±2 g (16384 / g) |
| 12 | 6 | gyro[3] | i16 raw, ±500 °/s (65.5 per °/s) |
| 18 | 1 | batt_pct | 0-100 |
| 19 | 1 | flags | bit0 calibrated, bit1 low battery, bit2 IMU ok, bit3 via Wi-Fi, bit7 extended |

- **Extended 24-byte frame** (flag bit7): adds roll and pitch as i16 centi-degrees at offsets 20/22.
  - Over BLE it is sent only if the phone negotiated an MTU of at least 27 (the firmware asks for 185).
  - Over Wi-Fi it is always sent.
  - Otherwise the plain 20-byte frame is the fallback.

**Control opcodes:**
- `0x01` calibrate open
- `0x02` calibrate fist
- `0x03 hz` set rate (5-100)
- `0x04 f_lo f_hi ms_lo ms_hi` beep
- `0x05 id` play clip (0 connected, 1 low battery, 2 recognised, 3 calibrated)
- `0x06` deep sleep now
- `0x07` enable Wi-Fi + open the setup portal

## Wi-Fi fallback

1. Send `0x07` (Settings → Glove → *Wi-Fi setup*). The glove opens a hotspot, **Aangika-Glove-Setup**.
2. Join it from the phone, pick your network and enter its password. It is remembered.
3. Frames are then also available at `ws://<glove-ip>:81`, and the same commands are accepted there as binary messages.

## Speaker

Only short tones and clips stored in flash: connected, low battery, sign
recognised, calibrated. **Phone speech is never streamed to the glove.** The
phone speaks through its own speaker (Sarvam or browser voices).

## Sleep and wake

- **When it sleeps:** after **5 minutes** with no app connected and no finger movement, the glove beeps once and deep-sleeps (a few µA on the ESP32; the LDO and TP4056 draw more).
- **How it wakes:** a **strong flex**. The flex pins are RTC GPIOs, so the ESP32 wakes when any of them reads HIGH (above ~2.5 V). That works only if a bent finger *raises* its pin voltage, i.e. the flex sensor is on the upper side of the divider.
  - **If your dividers are the other way round** (voltage falls with bend), the glove will not wake by flexing. Use the board's **EN/reset** button instead, or swap the flex and the 22 kΩ on one finger (say the index) so that finger can wake it.
- The MPU-6050 INT pin (GPIO 19) is not an RTC pin, so motion cannot wake the ESP32 without rewiring INT to an RTC GPIO (e.g. 4, 12-15, 25-27).

## Troubleshooting

| Symptom | Check |
|---|---|
| Glove not found in the app | Chrome on Android or desktop (Web Bluetooth); iPhone Safari cannot. Bluetooth on; glove not asleep (flex hard or press EN). |
| Connects, then drops | Power: the LDO must supply ~250 mA peaks (BLE + speaker). A weak battery browns out on beeps. |
| A finger always reads 0 or 255 | Calibrate again; check that finger's solder joint and its 22 kΩ resistor. |
| Finger bars noisy | Long unshielded wires. Keep the divider near the ESP32; 8-sample averaging is already on. |
| No sound | MAX98357A: GAIN/SD pins per its datasheet, 3.3-5 V supply, speaker between OUT+ and OUT-. |
| Wi-Fi portal never appears | It opens only after command `0x07`, or at boot when Wi-Fi was enabled and no saved network is reachable. |
