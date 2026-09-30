# ISL word tagger v2: can decoding alone improve accuracy? (2026-09-30)

Measured on the 996-clip clean set (clips the model never saw), in the live
regime the app uses (40-frame windows, stride 20). Tools:
`training/evaluate.py --dump-scores` and `training/calibrate_thresholds.py`.

**Answer: no.** The current decode (one threshold 0.15, top 8 words) is
already about as good as this model allows. None of the changes below is
shipped; better recognition needs better training data (the contributions
loop), not a decode tweak.

## Per-word thresholds

Tuned on one random half of the clips, measured on the other half, 10 splits.

| Decode | Precision | Recall | F1 | Words/clip |
|---|---:|---:|---:|---:|
| global 0.15 (current) | 0.448 ± 0.011 | 0.222 ± 0.011 | **0.297** | 1.80 |
| best single threshold (tuned) | 0.329 ± 0.028 | 0.288 ± 0.022 | 0.306 | 3.23 |
| per-word (>= 3 examples) | 0.386 ± 0.010 | 0.235 ± 0.014 | 0.292 | 2.21 |
| per-word (>= 8 examples) | 0.427 ± 0.009 | 0.225 ± 0.013 | 0.294 | 1.91 |
| raise-only (fewer false alarms) | 0.457 ± 0.012 | 0.213 ± 0.013 | 0.290 | 1.69 |

- Per-word thresholds beat 0.15 on F1 in 1 of 10 splits (and the variants in
  0 of 10): with ~1,000 clips most words have a handful of examples, so their
  tuned thresholds fit noise.
- Raise-only improves precision on all 10 splits (+0.9 points) but loses more
  recall; not worth it.
- A lower single threshold raises F1 slightly but a third of the words shown
  would then be wrong; for a translator, the current precision is the better
  trade.

## Mirror test-time augmentation

Each live window also run mirrored (the model was trained with mirroring)
and the per-frame scores averaged:

| | mAP | Precision (app) | Recall (app) |
|---|---:|---:|---:|
| current | 0.2979 | 0.442 | 0.217 |
| + mirror TTA | 0.2992 | 0.444 | 0.216 |

Within noise, at twice the compute. Not shipped.

## What did improve this session

- SignBridge handshapes: smoothing and palm-scaled thresholds
  (docs/RESULTS_SIGNBRIDGE.md: flicker 6-10 -> 2 changes per sign, no wrong
  or missed spoken signs under synthetic noise).
- Whole sentences: phrase rules give correct English, Hindi and Hinglish for
  common everyday sequences, offline (scripts/test-phrases.mjs).
