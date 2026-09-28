"""Video -> RAW packed landmark frames, exactly as the app would see them.

MediaPipe Tasks HandLandmarker + PoseLandmarker (lite), VIDEO mode, the same
thresholds and model files as src/services/landmarker.js, packed by
features.pack_frame with the app's default mirrored=True. Frames are sampled
by TIME at a canonical fps, so every clip has the same temporal scale whatever
its source frame rate.

Input is a manifest CSV with columns   path,labels,group,kind
  path    video file, absolute or relative to --root
  labels  free text passed through (e.g. "hello|my|name" or a sentence)
  group   signer or source-video id, used later for leakage-free splits
  kind    isolated | sentence

Per clip:  <out>/clips/<id>.npz
  frames   float16 [T, 225]  RAW packed (NOT body-normalised; normalise at load)
  t_ms     float32 [T]       canonical sample times, k * 1000 / fps
  src_ms   float32 [T]       timestamp of the source frame actually used
Index:     <out>/index.csv   one row per manifest entry (resumable; see below)

Resumable: rows already in index.csv with an empty `error` and an existing
.npz are skipped. Failed rows are retried only with --retry-errors.

    python training/extract.py --manifest m.csv --root D:/videos --limit 50 --bench 1,2,4,8
    python training/extract.py --manifest m.csv --root D:/videos --workers 6
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import os
import sys
import time
import traceback
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import numpy as np

TRAINING = Path(__file__).resolve().parent
sys.path.insert(0, str(TRAINING))
import features as F  # noqa: E402

DEFAULT_OUT = TRAINING / "data" / "landmarks"
MODELS = TRAINING / "models"

# landmarker.js, verbatim.
HAND_OPTS = dict(num_hands=2, min_hand_detection_confidence=0.5,
                 min_hand_presence_confidence=0.5, min_tracking_confidence=0.5)
POSE_OPTS = dict(num_poses=1, min_pose_detection_confidence=0.5,
                 min_pose_presence_confidence=0.5, min_tracking_confidence=0.5)

INDEX_FIELDS = ["path", "labels", "group", "kind", "out", "frames", "hand_frames",
                "pose_frames", "src_fps", "src_frames", "duration_s", "width",
                "height", "seconds", "error"]


# ------------------------------------------------------------------ helpers
def clip_id(path: str) -> str:
    return hashlib.sha1(path.replace("\\", "/").encode("utf-8")).hexdigest()[:20]


def read_manifest(path: Path) -> list[dict]:
    with open(path, newline="", encoding="utf-8") as fh:
        rows = list(csv.DictReader(fh))
    need = {"path", "labels", "group", "kind"}
    if rows and not need <= set(rows[0]):
        sys.exit(f"manifest needs columns {sorted(need)}, has {sorted(rows[0])}")
    for r in rows:
        if r["kind"] not in ("isolated", "sentence"):
            sys.exit(f"bad kind {r['kind']!r} for {r['path']}")
    return rows


def read_index(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    with open(path, newline="", encoding="utf-8") as fh:
        return {r["path"]: r for r in csv.DictReader(fh)}   # last row wins


def model_buffers() -> tuple[bytes, bytes]:
    meta = MODELS / "models.json"
    if not meta.exists():
        sys.exit("training/models/models.json missing: run training/download_models.py")
    rec = json.loads(meta.read_text(encoding="utf-8"))
    hand = (MODELS / rec["HAND_MODEL"]["file"]).read_bytes()
    pose = (MODELS / rec["POSE_MODEL"]["file"]).read_bytes()
    for key, data in (("HAND_MODEL", hand), ("POSE_MODEL", pose)):
        if hashlib.sha256(data).hexdigest() != rec[key]["sha256"]:
            sys.exit(f"{key} does not match models.json sha256; re-download")
    return hand, pose


# ------------------------------------------------------------------- worker
_W: dict = {}


def _init_worker(hand_buf: bytes, pose_buf: bytes) -> None:
    import cv2
    cv2.setNumThreads(1)
    _W["hand_buf"], _W["pose_buf"] = hand_buf, pose_buf


def _landmarkers():
    """Fresh landmarkers per clip: VIDEO mode tracks across calls and has no
    reset, and a new clip must not inherit the previous clip's tracking."""
    from mediapipe.tasks.python import BaseOptions
    from mediapipe.tasks.python import vision

    def base(buf):
        return BaseOptions(model_asset_buffer=buf, delegate=BaseOptions.Delegate.CPU)

    hand = vision.HandLandmarker.create_from_options(vision.HandLandmarkerOptions(
        base_options=base(_W["hand_buf"]), running_mode=vision.RunningMode.VIDEO,
        **HAND_OPTS))
    pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=base(_W["pose_buf"]), running_mode=vision.RunningMode.VIDEO,
        **POSE_OPTS))
    return hand, pose


def _detect(hand_lm, pose_lm, rgb, ts_ms: int, mirrored: bool) -> np.ndarray:
    """landmarker.detect + packFrame. Pose first, then hands, as in the app."""
    import mediapipe as mp
    image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    pose = None
    pr = pose_lm.detect_for_video(image, ts_ms)
    if pr.pose_landmarks:
        pose = pr.pose_landmarks[0]
    hands = []
    hr = hand_lm.detect_for_video(image, ts_ms)
    for i, lms in enumerate(hr.hand_landmarks or []):
        cats = hr.handedness[i] if hr.handedness and i < len(hr.handedness) else []
        hands.append({"landmarks": lms,
                      "handedness": cats[0].category_name if cats else None})
    return F.pack_frame(pose, hands, mirrored)


def process_clip(job: dict) -> dict:
    import cv2
    row = {k: job.get(k, "") for k in ("path", "labels", "group", "kind")}
    t0 = time.perf_counter()
    src = Path(job["abs_path"])
    out = Path(job["out_dir"]) / "clips" / f"{clip_id(job['path'])}.npz"
    row["out"] = str(out.relative_to(job["out_dir"])).replace("\\", "/")
    try:
        if not src.exists():
            raise FileNotFoundError(str(src))
        if src.stat().st_size == 0:
            raise ValueError("0-byte file")
        cap = cv2.VideoCapture(str(src))
        if not cap.isOpened():
            raise ValueError("cv2 cannot open file")
        src_fps = float(cap.get(cv2.CAP_PROP_FPS) or 0.0)
        if not (1.0 <= src_fps <= 240.0):
            raise ValueError(f"implausible source fps {src_fps}")
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        fps = float(job["fps"])
        hand_lm, pose_lm = _landmarkers()
        frames, t_ms, src_ms = [], [], []
        k = 0                 # next canonical sample index
        i = 0                 # current source frame index
        last_vec = None
        try:
            while True:
                ok = cap.grab()
                if not ok:
                    break
                ti = i * 1000.0 / src_fps
                # source frame nearest to canonical time k: floor(t*src/1000 + 0.5)
                want = math.floor(k * 1000.0 / fps * src_fps / 1000.0 + 0.5)
                if want == i:
                    ok, bgr = cap.retrieve()
                    if not ok:
                        break
                    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
                    last_vec = _detect(hand_lm, pose_lm, rgb, int(round(ti)),
                                       job["mirrored"])
                    # every canonical sample mapping to this frame reuses it
                    while math.floor(k * 1000.0 / fps * src_fps / 1000.0 + 0.5) == i:
                        frames.append(last_vec)
                        t_ms.append(k * 1000.0 / fps)
                        src_ms.append(ti)
                        k += 1
                i += 1
        finally:
            cap.release()
            hand_lm.close()
            pose_lm.close()

        if not frames:
            raise ValueError(f"no frames decoded ({i} source frames)")
        arr = np.stack(frames)
        hand_frames = int((np.abs(arr[:, F.LEFT_HAND_START:]).sum(1) > 0).sum())
        pose_frames = int((np.abs(arr[:, :F.LEFT_HAND_START]).sum(1) > 0).sum())

        out.parent.mkdir(parents=True, exist_ok=True)
        tmp = out.with_name(out.stem + ".tmp.npz")
        np.savez(tmp, frames=arr.astype(np.float16),
                 t_ms=np.asarray(t_ms, np.float32), src_ms=np.asarray(src_ms, np.float32),
                 meta=np.array(json.dumps({
                     "path": job["path"], "fps": fps, "src_fps": src_fps,
                     "mirrored": job["mirrored"], "width": width, "height": height,
                     "models": job["models"]})))
        os.replace(tmp, out)
        row.update(frames=len(arr), hand_frames=hand_frames, pose_frames=pose_frames,
                   src_fps=round(src_fps, 3), src_frames=i,
                   duration_s=round(i / src_fps, 3), width=width, height=height,
                   error="")
    except Exception as exc:                                   # noqa: BLE001
        row.update(frames=0, hand_frames=0, pose_frames=0,
                   error=f"{type(exc).__name__}: {exc}".replace("\n", " ")[:300])
        if job.get("debug"):
            traceback.print_exc()
    row["seconds"] = round(time.perf_counter() - t0, 3)
    return row


# --------------------------------------------------------------------- main
def run(jobs: list[dict], workers: int, index_path: Path, bufs) -> tuple[int, float]:
    """Process jobs, appending to index.csv as they finish. -> (n, wall_seconds)"""
    new_file = not index_path.exists()
    t0 = time.perf_counter()
    with open(index_path, "a", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=INDEX_FIELDS)
        if new_file:
            w.writeheader()
        done = 0
        with ProcessPoolExecutor(max_workers=workers, initializer=_init_worker,
                                 initargs=bufs) as pool:
            futs = [pool.submit(process_clip, j) for j in jobs]
            for fut in as_completed(futs):
                row = fut.result()
                w.writerow(row)
                fh.flush()
                done += 1
                if done % 25 == 0 or done == len(jobs):
                    el = time.perf_counter() - t0
                    print(f"[extract] {done}/{len(jobs)}  {done / el:.2f} clips/s", flush=True)
    return len(jobs), time.perf_counter() - t0


def compact_index(index_path: Path) -> None:
    rows = read_index(index_path)
    tmp = index_path.with_suffix(".tmp")
    with open(tmp, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=INDEX_FIELDS)
        w.writeheader()
        w.writerows(rows.values())
    os.replace(tmp, index_path)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--manifest", type=Path, required=True)
    ap.add_argument("--root", type=Path, default=None,
                    help="base directory for relative manifest paths (read-only)")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUT)
    ap.add_argument("--fps", type=float, default=25.0,
                    help="canonical sampling rate (default 25)")
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--limit", type=int, default=None,
                    help="process a seeded random subset of this many pending clips")
    ap.add_argument("--bench", type=str, default=None,
                    help="comma list of worker counts; runs --limit NEW clips per count")
    ap.add_argument("--no-mirrored", dest="mirrored", action="store_false",
                    help="pack with mirrored=False (the app default is True)")
    ap.add_argument("--retry-errors", action="store_true")
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--debug", action="store_true")
    args = ap.parse_args()

    manifest = read_manifest(args.manifest)
    args.out.mkdir(parents=True, exist_ok=True)
    index_path = args.out / "index.csv"
    index = read_index(index_path)

    def is_done(r):
        prev = index.get(r["path"])
        if prev is None:
            return False
        if prev["error"]:
            return not args.retry_errors
        return (args.out / prev["out"]).exists()

    pending = [r for r in manifest if not is_done(r)]
    print(f"[extract] manifest {len(manifest)} | already done {len(manifest) - len(pending)}"
          f" | pending {len(pending)} | fps {args.fps} | mirrored {args.mirrored}")

    rng = np.random.default_rng(args.seed)
    counts = [int(c) for c in args.bench.split(",")] if args.bench else [args.workers]
    if args.limit:
        take = min(len(pending), args.limit * len(counts))
        pending = [pending[i] for i in sorted(rng.choice(len(pending), take, replace=False))]

    bufs = model_buffers()
    models = json.loads((MODELS / "models.json").read_text(encoding="utf-8"))
    models = {k: v["url"] for k, v in models.items()}

    def job(r):
        p = Path(r["path"])
        abs_p = p if p.is_absolute() or args.root is None else args.root / p
        return {**r, "abs_path": str(abs_p), "out_dir": str(args.out), "fps": args.fps,
                "mirrored": args.mirrored, "models": models, "debug": args.debug}

    total_pending_before = len([r for r in manifest if not is_done(r)])
    rates = {}
    step = args.limit or len(pending)
    for n, wk in enumerate(counts):
        chunk = pending[n * step:(n + 1) * step]
        if not chunk:
            break
        done, wall = run([job(r) for r in chunk], wk, index_path, bufs)
        rates[wk] = done / wall
        print(f"[bench] workers={wk}: {done} clips in {wall:.1f}s -> {rates[wk]:.2f} clips/s")

    compact_index(index_path)
    if rates:
        best = max(rates, key=rates.get)
        remaining = max(0, total_pending_before - sum(
            len(pending[n * step:(n + 1) * step]) for n in range(len(rates))))
        eta_h = remaining / rates[best] / 3600
        print(f"[eta] best workers={best} at {rates[best]:.2f} clips/s; "
              f"{remaining} clips remaining -> ~{eta_h:.1f} h")


if __name__ == "__main__":
    main()
