# Baseline: the current word tagger, measured before any change

> **Status (2026-09-28):** cells **A and B are measured** on the full test split
> (11,960 clips, 417 source videos). Cells C and D are **blocked**: they need
> Tasks-extracted iSign video, and the videos are not downloaded.
> Raw output: `training/runs/baseline/h5_test.json` (git-ignored).

## What is measured

Model: `training/checkpoints/checkpoint_word_tagger`. Before anything else,
`model.py` checks that `public/models/sanketvani_word_tagger.onnx` gives the same
logits (max abs diff < 1e-4 on random input at T = 40, 97 and 192), so results for
the checkpoint apply to the shipped graph.

Split: `training/splits.json`, fixed with seed 20260928. Groups are iSign source
videos (the uid minus its segment number), and a group's split is
`sha1(seed:group) % 100`: under 10 → test, 10-14 → val, the rest → train. All
evaluations use the **test** groups.

Two feature sources × two regimes:

|                      | **notebook** (whole clip → 192 frames) | **live** (useSignPipeline.js: 40-frame windows, stride 20, max over windows) |
|----------------------|------|------|
| **Holistic** (`.h5`) | A. training conditions | B. window mismatch only |
| **Tasks** (`extract.py`) | C. detector mismatch only | D. what the app actually delivers |

**Attribution:**
- **A → B:** cost of the live window (temporal scale, fragments, BiLSTM context).
- **A → C:** cost of the MediaPipe Holistic → Tasks switch.
- **A → D:** the total gap, where D − A ≈ (B − A) + (C − A) + an interaction term.
- **A itself:** the model's own limit.

## Caveats that shape interpretation

1. **Test data was probably in the old model's training set.** The tagger's own
   split is unknown. The only notebook we have used a random clip-level split of
   this same `.h5` (AUDIT §1.2 N1). About 95% of our test clips were likely
   training clips for the old model. So **absolute** numbers for A-D are
   optimistic. The **differences** between regimes are still informative,
   because contamination inflates all four roughly alike. The retrained model
   will be the first one scored on genuinely held-out groups.
2. **Labels are approximate.** The tagger's sentence → word-bag function lives in
   a notebook we don't have. `data.Labeller` reconstructs it from the stems in
   vocab.json (possessive `'s` → `'`, `-ing` / `-ed` / `-s` / `-ies` stripping).
   Label mismatches depress A-D equally.
3. **B is reconstructed.** The `.h5` stores 192 resampled frames. The live stream
   is rebuilt from `n_frames_raw` at an assumed source rate of 25 fps. For clips
   longer than 192 raw frames, the dropped frames can't be recovered.
4. **C and D need Tasks-extracted iSign clips**, which need the iSign videos (not
   downloaded; AUDIT §5). Until then only A and B can be run.

## Preconditions (all verified)

- **Parity:** `pytest training/tests/parity` passes (6 tests, 4,500 cases, bit-exact
  float32). It is mutation-checked: swapping in Python's `math.hypot`, a naive
  sqrt hypot, dropping the mirrored swap, or float32 arithmetic in normalise each
  make it fail.
- **ONNX:** the checkpoint rebuilt in torch matches the shipped ONNX to ≤ 7.6e-6
  max abs at T = 40, 97, 192 and batch 2, with 100% argmax agreement. Checkpoint
  `words` == `vocab.json` words.
- **Checkpoint metadata:** epoch 29, `val_mAP` 0.2329, own `threshold` 0.075 (the
  app ships 0.15), config `BODY_NORMALISE: True`, `HEAD_DROPOUT: 0.3`.
- **Split:** 4,311 groups → train 105,241 / val 5,918 / test 11,960 clips (3,673 /
  221 / 417 groups). 556 test clips (4.6%) have an exact sentence that also occurs
  in train, mostly trivial ("1", "2", "blank").

## Results (full test split)

Labeller: `data.Labeller` (approximate), 4.1 labelled words/clip.
1,479 classes have ≥ 1 positive.

| Cell | mAP | P@3 | R@3 | App decode (thr 0.15, top-8): P / R / words per clip |
|---|---|---|---|---|
| A. Holistic / notebook | **0.337** | 0.421 | 0.322 | 0.565 / 0.294 / 2.14 |
| B. Holistic / live | **0.243** | 0.350 | 0.264 | 0.425 / 0.262 / 2.53 |
| C. Tasks / notebook | blocked | — | — | — |
| D. Tasks / live | blocked | — | — | — |

63 of 11,960 clips (0.5%) are too short for even one live window, so the app would
show nothing for them.

**Threshold curves** (precision / recall / words per clip):

| thr | A. notebook | B. live |
|---|---|---|
| 0.05 | 0.340 / 0.414 / 5.01 | 0.241 / 0.375 / 6.41 |
| 0.10 | 0.478 / 0.339 / 2.92 | 0.350 / 0.306 / 3.60 |
| 0.15 | 0.563 / 0.295 / 2.16 | 0.419 / 0.265 / 2.61 |
| 0.20 | 0.628 / 0.263 / 1.72 | 0.476 / 0.236 / 2.04 |
| 0.25 | 0.672 / 0.235 / 1.44 | 0.521 / 0.212 / 1.67 |
| 0.30 | 0.711 / 0.212 / 1.23 | 0.558 / 0.191 / 1.41 |
| 0.35 | 0.744 / 0.192 / 1.06 | 0.592 / 0.173 / 1.20 |
| 0.40 | 0.767 / 0.173 / 0.93 | 0.623 / 0.156 / 1.03 |
| 0.45 | 0.788 / 0.155 / 0.81 | 0.652 / 0.140 / 0.88 |
| 0.50 | 0.811 / 0.139 / 0.71 | 0.679 / 0.126 / 0.77 |

## Interpretation: where the gap comes from

1. **Window mismatch alone (A → B) costs 28% of mAP** (0.337 → 0.243), and
   precision at the shipped threshold falls from 0.56 to 0.42. The live regime also
   emits *more* words per clip (2.53 vs 2.14) with fewer correct. Each 40-frame
   window gets its own chance to fire a false positive, and max-over-windows keeps
   all of them. This loss is caused entirely by how the app feeds the model; the
   weights are identical.
2. **Detector mismatch (A → C) is unmeasured.** Holistic → Tasks lite needs the iSign
   videos. Expect it to add to the gap, not offset it. Until it's measured, B is an
   **upper bound** on what users see.
3. **The model's own ceiling (A) is itself modest and inflated.** 0.337 mAP is
   above the checkpoint's own `val_mAP` 0.233, which is consistent with caveat 1:
   most test clips were probably in its training set, plus mAP-definition and
   labeller differences. At the shipped threshold, recall is 0.29 even under training
   conditions, so about 71% of true words are missed. The model itself is also a
   large part of the problem.
4. **Recall barely moves between regimes** (0.294 vs 0.262) while precision drops
   14 points. Tuning the threshold cannot fix that: at equal words/clip (~2.1), live
   precision is ~0.48 against 0.56 for notebook. The fix is to **train on the serving
   window** (Phase 5 item 2), not to re-tune the app.

**For Phase 5:** early-stop on the *live* regime, and report new models on these same
417 test groups. The new model will be genuinely held out there, so its numbers
will be honest where this baseline's are flattered.

## Commands

```bash
python training/model.py                                    # load + ONNX equivalence
python training/make_splits.py                              # once; the split is then fixed
python training/evaluate.py --source h5 --limit 500         # quick check (< 10 min)
python training/evaluate.py --source h5                     # A and B, full test split
python training/evaluate.py --source tasks                  # C and D, after extraction
```
