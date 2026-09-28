# CLAUDE.md

## Project

Aangika (package `isl-web`) is a Vite + React PWA for Indian Sign Language (ISL) communication.

Camera sign recognition lives in:
- `src/services/landmarker.js`
- `src/services/signRecognizer.js`
- `src/hooks/useSignPipeline.js`

**Current goal:** retrain the existing model. Do NOT replace the app architecture.

## Model contract

`public/models/vocab.json` is the source of truth. Anything new has to stay compatible with it.

- **ONNX I/O:** input `"landmarks"` float32 `[batch, N, 225]` → output `"frame_logits"` `[batch, N, V]`.
- **Feature layout (225 per frame):**
  - pose: 33 × (x,y,z) → slots `0..98`
  - left hand: 21 × 3 → slots `99..161`
  - right hand: 21 × 3 → slots `162..224`
  - A missing landmark is exactly `0.0`.
- **bodyNormalise:**
  - centre = shoulder midpoint (pose 11, 12), subtracted from x, y and z
  - scale = 2-D shoulder span
  - zeros stay zero
  - a frame with span `<= 1e-6` becomes all zeros
- **Decode:** sigmoid → max over time per word → threshold + top_k → order by peak frame.

## Existing weights

`training/checkpoints/checkpoint_word_tagger` (torch zip format).

- **Checkpoint keys:** `model_state_dict`, `words`, `epoch`, `val_mAP`, `threshold`, `config`.
- **Architecture:**
  - frontend: `Conv1d(225,256,3)` → BN → ReLU → Dropout(0.2) → `Conv1d(256,256,3)` → BN → ReLU → Dropout
    (state keys `frontend.0`, `.1`, `.4`, `.5`)
  - 3-layer BiLSTM, hidden 256, dropout 0.3
  - head: `Linear(512, 1500)`, applied per frame

## Rules

- Datasets are **READ-ONLY**: never move, modify or rewrite them.
  - `isign_ctc_dataset.h5` (iSign Holistic landmarks, 192-frame resampled, 5.6 GB). It is found via `$AANGIKA_H5`, then `training/data/isign_ctc_dataset.h5`, then `C:\dev\data\`.
  - The raw iSign pose archive: `G:\My Drive\isl_dataset` on the user's PC. It is not reachable from cloud sessions. See AUDIT §2.0.
- Never commit `training/data`, `training/runs`, `*.pt`, or videos.
- Only commit model files in `public/models` after the user approves a release.
- The Python feature code must match `packFrame` / `bodyNormalise` in `signRecognizer.js` exactly. A Python-vs-node parity test must pass before any training.
- `reference/signcam/` is reference code to borrow from. Do not ship it.
- Ask before running any job expected to take longer than 10 minutes.
- Work on `main` (feature/v2 was merged in on 2026-09-28). Commit once per phase, then stop at the end of each phase with a summary.

## Handoff status (2026-09-28)

Work continues in **Claude Code on the web** from branch `feature/v2`. Phases 1-3
are committed there as **code only: none of it has been executed or tested**,
because the shell was blocked in the session that wrote it.

- **Phase 1:** `docs/AUDIT.md`.
  - `reference/old_notebook.ipynb` built the `.h5` and trained a *failed CTC model*.
    It is **not** the tagger's training notebook, which is still missing.
  - §2.0 records the raw dataset: complete, 127,237 clips, 25 or 29.97 fps, no videos.
- **Phase 2:** `training/{setup.sh, requirements.txt, features.py,
  download_models.py, extract.py, check_extract.py}`, `training/tests/parity/`,
  pinned model URLs in `landmarker.js`, and `.gitignore`.
  - `extract.py` has no video source yet: iSign videos are a 53.9 GiB HF download.
- **Phase 3:** `training/{model.py, data.py, make_splits.py, evaluate.py}` and
  `docs/BASELINE.md` (results pending).
- **Missing:** `reference/signcam/` does not exist, so the parity test uses its own
  harness.

**Large files are not in git.** Fetch them at the start of each cloud session with
`bash training/fetch_data.sh`, which needs `HF_TOKEN` and `AANGIKA_HF_REPO` set in
the cloud environment. It downloads to (all gitignored):
- `training/data/isign_ctc_dataset.h5`
- `training/checkpoints/checkpoint_word_tagger`

**Next, in order:**
1. Run `bash training/fetch_data.sh`, then `bash training/setup.sh`, then
   `pytest training/tests/parity -q`. Fix any parity failure before anything else.
   Commit the fixes.
2. Run `python training/download_models.py`, then `python training/model.py`
   (checkpoint load plus ONNX equivalence).
3. Run `python training/make_splits.py`, then `python training/inspect_h5.py`.
   Fold the inspect output into AUDIT §2.
4. Run `python training/evaluate.py --source h5 --limit 500`. Report the results,
   then ask before running the full test split.
5. Stop at the end of each phase with a summary and a commit.
