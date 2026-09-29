# ASL models: comparison and choice (Phase 2)

Researched 2026-09-29. Only the chosen model's files were downloaded (11 MB).

## The candidates

| | **ISLR 1st place (Hoyeol Sohn)** | ISLR, AI4Bharat OpenHands | Fingerspelling 1st place (Henkel et al.) | Fingerspelling, community HF uploads |
|---|---|---|---|---|
| Task | 250 isolated ASL signs | isolated signs; WLASL (ASL, 2000) and INCLUDE (ISL, 263) checkpoints | landmark sequence → letters | letters / phrases |
| Code licence | MIT ([repo][islr1]) | Apache-2.0 ([repo][openhands]) | Apache-2.0 ([repo][fs1]) | MIT / Apache-2.0 |
| **Weights published?** | **Yes**: `sign/kaggle-asl-signs-1st-place` on Hugging Face, **MIT**, 11.2 MB TFLite ([HF][hfislr]) | Yes (PyTorch checkpoints) | **No**: training code only; retraining takes days on multi-GPU | Yes, but **no accuracy reported** by either candidate checked |
| Training data licence | PopSign ASL v1.0 (Georgia Tech), **CC BY 4.0**: commercial use OK with attribution ([PopSign][popsign]) | per dataset (WLASL: research use; INCLUDE: see dataset) | FSboard (Google), check terms on Kaggle ([FSboard][fsboard]) | same Kaggle data |
| Runtime | TFLite, **built-in ops only** (inspected: CONV_2D, FULLY_CONNECTED, BATCH_MATMUL, IF…), so it converts to ONNX | PyTorch → ONNX export needed | TFLite (if trained) | Keras .h5 (autoregressive) / TFLite over 64×64 images |
| Input | `[frames, 543, 3]`: all MediaPipe Holistic landmarks (face 468, left hand 21, pose 33, right hand 21), NaN = missing. Internally selects ~118 points: **lips + hands + a few face/pose points** | pose + hands (27-point graph) | hands, lips, pose (Holistic) | hand (+ pose) |
| Needs face landmarks | **Yes (lips)** | No | Yes (lips) | No |
| Reported accuracy | ~0.89 private leaderboard (Kaggle, not re-verified here); a secondary source reports ~80% validation | WLASL2000 top-1 well below ISLR's (see the paper; exact figure not re-verified here) | normalised Levenshtein ~0.8 (Kaggle) | none |
| Maintained | archived competition code | "No longer actively maintained" | archived | hobby uploads |

## Recommendation and decision

1. **Isolated signs: ISLR 1st place** (`sign/kaggle-asl-signs-1st-place`). It is the only candidate that has published weights, a permissive licence on both the weights (MIT) and the data (CC BY 4.0), is small (11 MB), and has strong reported accuracy. Its 250 signs include demo-friendly words: hello, thankyou, please, yes, no, water, drink, food, hungry, mom, dad, where, who, why, tomorrow, sick, home.
   - **Cost:** it needs lip landmarks, so MediaPipe **FaceLandmarker** must run alongside hands + pose (≈3.6 MB model plus per-frame CPU; measured below before enabling).
   - **Runtime:** convert TFLite → ONNX with tf2onnx and reuse onnxruntime-web (already shipped, cached offline). The fallback is the TFLite web runtime, loaded lazily.
2. **Continuous fingerspelling: not integrated for now.** There are no trustworthy published weights: the winner released code only, and the community uploads report no accuracy. Retraining is days of GPU time, not feasible before the demo. **Instead:** fingerspelling uses **taught letter handshapes** (My signs k-NN, which already works, one handshape per letter), plus the glove in Phase 5. This is honest: it only recognises letters the user has taught.
3. **OpenHands:** not chosen for ASL (lower accuracy, unmaintained). Its **INCLUDE (ISL, 263 signs)** checkpoint is worth a later look as a second ISL model.

## Landmark mapping (this app → model input)

| Model slot | Source in the app | Missing |
|---|---|---|
| 0-467 face | FaceLandmarker `faceLandmarks[0][0..467]` (it returns 478 with irises; the first 468 are the Holistic mesh order) | NaN |
| 468-488 left hand | HandLandmarker, **signer's left** (same mirrored rule as packFrame) | NaN |
| 489-521 pose | PoseLandmarker (lite) 33 points | NaN |
| 522-542 right hand | HandLandmarker, signer's right | NaN |

The competition's landmarks came from MediaPipe **Holistic** (legacy); the app uses **Tasks**. That is the same detector gap as the ISL model, and accuracy under Tasks has to be measured, not assumed.

## Sources
[islr1]: https://github.com/hoyso48/Google---Isolated-Sign-Language-Recognition-1st-place-solution
[hfislr]: https://huggingface.co/sign/kaggle-asl-signs-1st-place
[popsign]: https://signdata.cc.gatech.edu/res/doc/popsign_v1_0/popsign_v1_0_supplemental.pdf
[openhands]: https://github.com/AI4Bharat/OpenHands
[fs1]: https://github.com/ChristofHenkel/kaggle-asl-fingerspelling-1st-place-solution
[fsboard]: https://www.kaggle.com/datasets/googleai/fsboard
- ISLR competition: https://www.kaggle.com/competitions/asl-signs
- Fingerspelling competition: https://www.kaggle.com/competitions/asl-fingerspelling
- Community fingerspelling models checked: https://huggingface.co/ColdSlim/ASL-TFLite-Edge, https://huggingface.co/basmalaazab/asl-fingerspelling-transformer
