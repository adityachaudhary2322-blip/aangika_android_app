# Baseline: the current word tagger, measured before any change

> **Status: NOT YET RUN.** Every number below is pending. The code exists
> (`training/model.py`, `make_splits.py`, `evaluate.py`), but no command could be
> executed in the session that wrote it. Nothing in this file is a measurement yet.

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

## Results

*Pending.* Filled from `training/runs/baseline/*.json`.

| Cell | mAP | P@3 | R@3 | App decode (thr 0.15, top-8): P / R / words per clip |
|---|---|---|---|---|
| A. Holistic / notebook | — | — | — | — |
| B. Holistic / live | — | — | — | — |
| C. Tasks / notebook | — | — | — | — |
| D. Tasks / live | — | — | — | — |

Threshold curves (0.05-0.50) for each cell go here.

## Commands

```bash
python training/model.py                                    # load + ONNX equivalence
python training/make_splits.py                              # once; the split is then fixed
python training/evaluate.py --source h5 --limit 500         # quick check (< 10 min)
python training/evaluate.py --source h5                     # A and B, full test split
python training/evaluate.py --source tasks                  # C and D, after extraction
```
