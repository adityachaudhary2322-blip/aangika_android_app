# Tagger v2: retrained for the live window

**Released 2026-09-28 as `public/models/sanketvani_word_tagger_v2.onnx`** (user-approved).
It is a drop-in replacement: same input `landmarks [batch, N, 225]`, same output
`frame_logits [batch, N, 1500]`, same 1500 words in `vocab.json`. The file name
is versioned because `/models/*` is served `immutable`.

## What changed

`training/train.py`, run `full1`:

- **Warm start:** all weights from v1.
- **Training regime = the app's:** 40-frame windows, stride 20, each window an
  independent forward pass, clip score = max over windows (MIL, BCE).
- **Canonical 25 fps**, with speed jitter 0.8-1.25×.
- **Raw-frame augmentation before bodyNormalise:**
  - mirror (with hand-slot and pose left/right swap);
  - ±10° rotation, 0.9-1.1 scale, ±0.05 shift;
  - 5% per-frame hand dropout, landmark jitter.
- **Optimiser:** lr 5e-5, one-cycle cosine, AMP, no rare-word weighting.
  The short trials favoured this; pos_weight lowered val mAP.
- **Early stopping on live val mAP:** best at epoch 6 of 9, 23.6 min on an RTX 4050.
- **Labels:** the reconstructed old word labels (`data.Labeller`). The Gemini
  gloss labels (Phase 4) are not used yet.

## How it was measured, and why this set

The old tagger was almost certainly trained on a random clip split of the same
`.h5`. Our test groups were therefore mostly in its training set, which
inflates its scores (see BASELINE.md caveat 1). To compare honestly,
`training/extract_clean.py` pulled **996 iSign clips that are not in the `.h5`
at all** from the raw pose archive, so neither model ever saw them. The parser
was first verified to reproduce stored `.h5` rows exactly (max diff 0.0 on 20
clips).

These clips keep their native 25 / 29.97 fps, so the live stream is exact:
resampled by time to 25 fps, then 40/20 windows, as `useSignPipeline.js` does.

## Results: 996 never-seen clips

| Regime | Model | mAP | P@3 | R@3 | P / R / words per clip at thr 0.15, top-8 |
|---|---|---|---|---|---|
| notebook (192 frames) | v1 | 0.298 | 0.320 | 0.248 | 0.449 / 0.219 / 1.78 |
| notebook (192 frames) | **v2** | 0.302 | 0.325 | 0.249 | 0.509 / 0.195 / 1.40 |
| **live (the app)** | v1 | 0.280 | 0.306 | 0.240 | 0.374 / 0.223 / 2.18 |
| **live (the app)** | **v2** | **0.298** | **0.321** | **0.250** | **0.442 / 0.217 / 1.79** |

**Paired bootstrap:** live regime, 300 resamples of the same 996 clips.

| | v2 − v1 | 95% CI | v2 better in |
|---|---|---|---|
| mAP | **+0.018** | [+0.012, +0.024] | 100% of resamples |
| precision at 0.15 | **+0.074** | [+0.062, +0.087] | 100% of resamples |

## What this means

- **The live-window penalty is essentially gone.** v2's live mAP (0.298) matches
  its whole-clip mAP (0.302). v1 lost 0.018 going live.
- **Users see fewer wrong words.** At the shipped threshold, 1.79 words per clip
  instead of 2.18, with precision 0.37 → 0.44, while recall is about the same
  (0.223 → 0.217).
- **The model itself is still weak.** About 22% of signed content words are
  recovered. That is a data and label problem (iSign news vocabulary,
  approximate bag-of-words labels, Holistic vs the app's Tasks landmarks), not
  a window problem any more.

### Per word

476 words with ≥ 3 positives in the clean set: 259 improved, 162 worse, the
rest unchanged. Individual swings are noisy at 3-10 examples per word.

- **Most improved:** course 0.53→0.87, delay 0.35→0.67, terrorist 0.28→0.55,
  fill 0.46→0.72, fall 0.09→0.34, border 0.14→0.38.
- **Most worse:** today 0.36→0.03, pm 0.83→0.57, tiger 0.34→0.10, photo 0.42→0.18.
- **Top confusions (v2):** say→people, one→people, indian→india, whether→said,
  said→minister, eat→food. Most are news-sentence co-occurrence, not visual
  similarity.

Full lists: `training/runs/compare/clean_{old,new}_details.json` (git-ignored).

## Limits

- **Holistic, not Tasks.** Train and test landmarks are MediaPipe Holistic, while
  the app runs MediaPipe Tasks. BASELINE cells C and D, the detector gap, are
  still unmeasured: they need iSign videos.
- **One test set.** 996 clips from the same news domain as training.
  Conversational signing will score differently.
- **Uncalibrated.** Threshold 0.15 and `vocab.json`'s `operating_curve` are still
  v1's. A live-regime threshold sweep for v2 is part of Phase 6.

## Next

- Retrain with the Phase 4 gloss labels, once the free-tier quota allows, and
  compare on this same clean set.
- Measure the Holistic → Tasks gap with a small set of iSign videos.
