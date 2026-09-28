"""Three sanity checks on extract.py output.

1. integrity    shape (T,225) float16, finite, t_ms exactly k*1000/fps,
                src_ms non-decreasing, index `frames` == T
2. missingness  a hand block is either entirely 0.0 (untracked) or fully
                populated; shoulder span > 1e-6 wherever pose is present
3. handedness   the LEFT-hand slot's wrist lies nearer to pose landmark 15
                (the signer's left wrist) than to 16, and vice versa for the
                right slot. This proves the mirrored label swap puts each hand
                on the side the pose model says it is on.

    python training/check_extract.py [--out training/data/landmarks] [--n 200]
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np

TRAINING = Path(__file__).resolve().parent
sys.path.insert(0, str(TRAINING))
import features as F  # noqa: E402

L_WRIST_POSE, R_WRIST_POSE = 15, 16


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=TRAINING / "data" / "landmarks")
    ap.add_argument("--n", type=int, default=200)
    args = ap.parse_args()

    with open(args.out / "index.csv", newline="", encoding="utf-8") as fh:
        rows = [r for r in csv.DictReader(fh)]
    ok_rows = [r for r in rows if not r["error"]]
    errors = {}
    for r in rows:
        if r["error"]:
            errors[r["error"].split(":")[0]] = errors.get(r["error"].split(":")[0], 0) + 1
    print(f"[index] {len(rows)} rows | ok {len(ok_rows)} | errors {errors}")

    rng = np.random.default_rng(0)
    sample = [ok_rows[i] for i in rng.choice(len(ok_rows), min(args.n, len(ok_rows)),
                                              replace=False)] if ok_rows else []

    bad_integrity, partial_hand, frames_total = [], 0, 0
    pose_frames = span_ok = 0
    side = {"left_ok": 0, "left_n": 0, "right_ok": 0, "right_n": 0}
    for r in sample:
        z = np.load(args.out / r["out"])
        x, t, s = z["frames"], z["t_ms"], z["src_ms"]
        meta = json.loads(str(z["meta"]))
        fps = meta["fps"]
        # 1. integrity
        problems = []
        if x.dtype != np.float16 or x.ndim != 2 or x.shape[1] != F.FEATURE_DIM:
            problems.append(f"shape/dtype {x.shape} {x.dtype}")
        if not np.isfinite(x.astype(np.float32)).all():
            problems.append("non-finite")
        if len(t) != len(x) or len(s) != len(x) or int(r["frames"]) != len(x):
            problems.append("length mismatch")
        if not np.allclose(t, np.arange(len(t)) * 1000.0 / fps, atol=1e-2):
            problems.append("t_ms not on the canonical grid")
        if np.any(np.diff(s) < 0):
            problems.append("src_ms decreasing")
        if problems:
            bad_integrity.append((r["path"], problems))
            continue

        f = x.astype(np.float32)
        frames_total += len(f)
        # 2. missingness
        for a, b in ((F.LEFT_HAND_START, F.RIGHT_HAND_START),
                     (F.RIGHT_HAND_START, F.FEATURE_DIM)):
            blk = f[:, a:b].reshape(len(f), -1, 3)
            zero_pts = (blk == 0).all(-1).sum(1)
            partial_hand += int(((zero_pts > 0) & (zero_pts < F.HAND_COUNT)).sum())
        pose = f[:, :F.LEFT_HAND_START].reshape(len(f), -1, 3)
        has_pose = np.abs(pose).sum((1, 2)) > 0
        pose_frames += int(has_pose.sum())
        span = np.hypot(pose[:, 11, 0] - pose[:, 12, 0], pose[:, 11, 1] - pose[:, 12, 1])
        span_ok += int((has_pose & (span > 1e-6)).sum())
        # 3. handedness vs pose wrists
        for name, start in (("left", F.LEFT_HAND_START), ("right", F.RIGHT_HAND_START)):
            wrist = f[:, start:start + 2]
            present = has_pose & (np.abs(f[:, start:start + 63]).sum(1) > 0)
            if not present.any():
                continue
            dl = np.linalg.norm(wrist[present] - pose[present, L_WRIST_POSE, :2], axis=1)
            dr = np.linalg.norm(wrist[present] - pose[present, R_WRIST_POSE, :2], axis=1)
            near = (dl < dr) if name == "left" else (dr < dl)
            side[f"{name}_ok"] += int(near.sum())
            side[f"{name}_n"] += int(present.sum())

    print(f"[1 integrity]   {len(sample) - len(bad_integrity)}/{len(sample)} clips pass"
          + (f"; first failures: {bad_integrity[:3]}" if bad_integrity else ""))
    print(f"[2 missingness] partially-zero hand blocks: {partial_hand} of "
          f"{2 * frames_total} (expect ~0) | pose present in "
          f"{pose_frames / max(frames_total, 1):.1%} of frames | span>1e-6 in "
          f"{span_ok / max(pose_frames, 1):.1%} of pose frames")
    for name in ("left", "right"):
        n = side[f"{name}_n"]
        frac = side[f"{name}_ok"] / n if n else float("nan")
        verdict = "OK" if frac > 0.9 else ("SWAPPED" if frac < 0.1 else "MIXED")
        print(f"[3 handedness]  {name} slot nearer the pose's {name} wrist in "
              f"{frac:.1%} of {n} frames -> {verdict}")


if __name__ == "__main__":
    main()
