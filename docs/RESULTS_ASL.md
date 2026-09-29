# Measured results: ASL, sentences, glove, Android (2026-09-29)

Every figure below was measured in this repository. Anything not measured says
so. Environment: Windows laptop, Node 24, headless Chromium (software
rendering, no GPU) for browser runs. Real phones with GPU landmarkers will be
faster, so re-measure on the demo phone.

## Recognition models

| Model | What was measured | Result |
|---|---|---|
| ISL tagger v2 | live windows, 996 iSign clips never seen in training | mAP 0.298, precision 0.44, recall 0.22 at thr 0.15 (v1: 0.280 / 0.37 / 0.22); bootstrap: v2 better in 100% of 300 resamples (docs/RESULTS_v2.md) |
| ASL ISLR (1st place, ONNX) | conversion parity vs the original TFLite | max diff 2.7e-6, top-1 identical on 6 clips (8-96 frames, missing face / hands) |
| ASL ISLR | onnxruntime-web (wasm, 1 thread, laptop) | 18-29 ms per 30-60-frame window |
| ASL ISLR | input mapping vs independent Python reference | identical on 8 fixtures, NaN positions included |
| ASL ISLR | **per-word accuracy on held-out signs** | **not measured**: needs the Kaggle ISLR data (account required). Reported by the original authors on Holistic landmarks; this app uses MediaPipe Tasks. |
| ASL ISLR | on random landmarks | top probability 0.03: it does not invent words from noise |
| Face landmarker (needed by ASL) | landmark time per frame, headless Chromium | ISL (hands + pose) 348-351 ms → ASL (+ face) 395-489 ms, i.e. +14-39 %; +3.8 MB download |
| SignBridge 20 rules | synthetic hands | 20/20; **real-hand accuracy not measured** |
| My signs (camera) | 100 taught signs, synthetic hands | right sign 40/40; 0.03 ms/frame (p99 0.055) |

## Sentences

| Path | Result |
|---|---|
| Offline rules, ASL and ISL | ≤ 1 ms per sentence; 16/16 ASL test sentences correct (scripts/test-sentences.mjs) |
| Gemini free tier (2026-09-29) | HTTP 503 "high demand" on every model; the app fell back to the rules correctly in 1.9-3.2 s |
| Sarvam | **not measured here**: its key is only in the browser. Measure on the demo phone. |
| Sentence boundary | 1.2 s pause, or 0.4 s hands down (camera); pause only with the glove |

## Glove

| What | Result |
|---|---|
| Firmware build | compiles; RAM 17.5 %, flash 38 % (**not yet run on the hardware**) |
| Frame parser | hand-written byte arrays: LE signed fields, extended frame, malformed rejected (29/29 tests) |
| Static k-NN (synthetic takes) | 3/3 new takes recognised; relaxed hand and an in-between shape refused |
| Motion DTW (synthetic Z) | recognised; a held handshape refused; 0.18 ms per check |
| End to end, simulated glove in the real app | DOCTOR HELP NEED → "I need a doctor's help.", 3/3 runs |

## Android

| What | Result |
|---|---|
| Debug APK | builds (Gradle, JDK 21): 56.6 MB; bundles ISL v2, onnxruntime wasm, MediaPipe wasm + 3 pinned .task files (verified inside the APK) |
| On-phone tests (airplane mode, BLE glove, Meet, speech) | **not run**: needs your phone over adb |
