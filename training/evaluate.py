"""Evaluate the word tagger on the fixed held-out split, in two regimes.

  notebook  whole clip resampled to 192 frames (floor(linspace + 0.5)), body-
            normalised, one forward pass: the conditions the tagger was
            trained and validated under.
  live      exactly what src/hooks/useSignPipeline.js does: frames arrive one
            by one, bodyNormalise per frame, a 40-frame buffer, inference when
            the buffer is full and the frame counter is a multiple of 20, each
            window an independent forward pass; clip score = max over windows.
            A clip shorter than 40 frames yields no inference at all (as in
            the app, which shows nothing).

Sources:
  h5     Holistic features from isign_ctc_dataset.h5 (read-only). Stored clips
         are already 192-resampled; the live stream is reconstructed at
         --live-fps from n_frames_raw assuming --h5-src-fps (approximate when
         n_frames_raw > 192, since frames were dropped at build time).
  tasks  MediaPipe Tasks features from training/extract.py (canonical fps).

Crossing the two gives the attribution in docs/BASELINE.md:
  h5/notebook -> h5/live     = window mismatch alone
  h5/notebook -> tasks/notebook = detector mismatch alone
  tasks/live                 = what users get

    python training/evaluate.py --source h5 --limit 500          # quick
    python training/evaluate.py --source h5 --regimes notebook,live
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import torch

import data as D
import features as F
from model import DEFAULT_CKPT, load_checkpoint

NOTEBOOK_FRAMES = 192
WINDOW = 40           # useSignPipeline.js WINDOW
STRIDE = 20           # useSignPipeline.js STRIDE
THRESHOLDS = [round(0.05 * k, 2) for k in range(1, 11)]     # 0.05 .. 0.50


# ------------------------------------------------------------------ regimes
def uniform_idx(n: int, t: int) -> np.ndarray:
    return np.floor(np.linspace(0, n - 1, t) + 0.5).astype(np.int64)


def normalise(frames: np.ndarray) -> np.ndarray:
    return np.stack([F.body_normalise(f) for f in frames]).astype(np.float32)


def live_windows(stream_norm: np.ndarray) -> list[np.ndarray]:
    """useSignPipeline.js: seen counts frames from 1; after pushing frame `seen`
    the buffer holds the last min(seen, 40); infer iff buffer is full and
    seen % STRIDE == 0."""
    out = []
    for seen in range(1, len(stream_norm) + 1):
        if seen >= WINDOW and seen % STRIDE == 0:
            out.append(stream_norm[seen - WINDOW:seen])
    return out


@torch.no_grad()
def forward_max(model, seqs: list[np.ndarray], device, batch: int = 64, mirrored=None) -> np.ndarray:
    """Max-over-time logits for equal-length sequences -> (len(seqs), V).
    With `mirrored` (the same windows mirrored), per-frame logits of the two
    are averaged before the max: test-time augmentation."""
    res = []
    for i in range(0, len(seqs), batch):
        x = torch.from_numpy(np.stack(seqs[i:i + batch])).to(device)
        out = model(x)
        if mirrored is not None:
            xm = torch.from_numpy(np.stack(mirrored[i:i + batch])).to(device)
            out = (out + model(xm)) / 2
        res.append(out.amax(dim=1).float().cpu().numpy())
    return np.concatenate(res) if res else np.zeros((0, 0), np.float32)


# MediaPipe pose left/right pairs (as train.py), for mirroring.
_POSE_PERM = np.arange(33)
for _a, _b in [(1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16),
               (17, 18), (19, 20), (21, 22), (23, 24), (25, 26), (27, 28), (29, 30), (31, 32)]:
    _POSE_PERM[_a], _POSE_PERM[_b] = _b, _a


def mirror_raw(x: np.ndarray) -> np.ndarray:
    """(T, 225) raw packed frames mirrored: x -> 1 - x, pose left/right and the
    two hand slots swapped; missing points stay exactly 0 (train.py's mirror)."""
    pts = x.reshape(len(x), 75, 3).copy()
    present = ~(pts == 0).all(-1)
    pts[..., 0] = np.where(present, 1.0 - pts[..., 0], 0.0)
    out = pts.copy()
    out[:, :33] = pts[:, :33][:, _POSE_PERM]
    out[:, 33:54], out[:, 54:75] = pts[:, 54:75], pts[:, 33:54]
    return out.reshape(len(x), 225)


# ------------------------------------------------------------------ metrics
def average_precision(scores: np.ndarray, pos: np.ndarray) -> float:
    order = np.argsort(-scores, kind="stable")
    hits = pos[order]
    if not hits.any():
        return math.nan
    cum = np.cumsum(hits)
    prec = cum / np.arange(1, len(hits) + 1)
    return float(prec[hits].mean())


def metrics(probs: np.ndarray, labels: list[list[int]], vocab: dict) -> dict:
    n, v = probs.shape
    y = np.zeros((n, v), bool)
    for i, ls in enumerate(labels):
        y[i, ls] = True
    aps = [average_precision(probs[:, c], y[:, c]) for c in range(v) if y[:, c].any()]
    labelled = y.any(1)

    top3 = np.argsort(-probs, axis=1)[:, :3]
    hit3 = np.take_along_axis(y, top3, 1).sum(1)
    p3 = float((hit3[labelled] / 3).mean())
    r3 = float((hit3[labelled] / y[labelled].sum(1)).mean())

    def op(th, top_k=None):
        pred = probs >= th
        if top_k is not None:
            rank = np.argsort(np.argsort(-probs, axis=1), axis=1)
            pred &= rank < top_k
        tp = int((pred & y).sum())
        np_ = int(pred.sum())
        return {"threshold": th, "top_k": top_k,
                "precision": tp / np_ if np_ else math.nan,
                "recall": tp / int(y.sum()) if y.sum() else math.nan,
                "words_per_clip": np_ / n}

    return {
        "clips": n, "labelled_clips": int(labelled.sum()),
        "classes_with_positives": len(aps),
        "mAP": float(np.nanmean(aps)) if aps else math.nan,
        "p@3": p3, "r@3": r3,
        "curve": [op(t) for t in THRESHOLDS],
        "app_decode": op(vocab.get("threshold", 0.15), vocab.get("top_k", 8)),
    }


# --------------------------------------------------------------------- main
def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--source", choices=["h5", "tasks", "clean"], required=True)
    ap.add_argument("--clean", type=Path, default=None,
                    help="clean-set .npz from extract_clean.py (source=clean)")
    ap.add_argument("--tag", default=None, help="name for the output json")
    ap.add_argument("--details", action="store_true",
                    help="also write per-word AP (worst first) and top confusions")
    ap.add_argument("--regimes", default="notebook,live")
    ap.add_argument("--split", default="test")
    ap.add_argument("--limit", type=int, default=None, help="seeded subset of the split")
    ap.add_argument("--live-fps", type=float, default=25.0,
                    help="frame rate the live pipeline sees (detections/second)")
    ap.add_argument("--h5-src-fps", type=float, default=25.0,
                    help="assumed native fps of iSign videos (h5 live reconstruction)")
    ap.add_argument("--h5", type=Path, default=D.H5_DEFAULT)
    ap.add_argument("--tasks-dir", type=Path, default=D.TASKS_DEFAULT)
    ap.add_argument("--ckpt", type=Path, default=DEFAULT_CKPT)
    ap.add_argument("--out", type=Path, default=D.TRAINING / "runs" / "baseline")
    ap.add_argument("--tta", choices=["none", "mirror"], default="none",
                    help="live regime: also run each window mirrored and average")
    ap.add_argument("--dump-scores", type=Path, default=None,
                    help="save live max-logits + labels (.npz) for calibrate_thresholds.py")
    args = ap.parse_args()
    regimes = args.regimes.split(",")

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model, _ = load_checkpoint(args.ckpt)
    model.to(device)
    vocab = D.load_vocab()
    labeller = D.Labeller(vocab["words"])
    splits = D.load_splits()

    # ---- select clips of the split
    if args.source == "h5":
        names, texts, n_raw = D.h5_meta(args.h5)
        rows = [i for i, n in enumerate(names) if D.assign(D.group_of(n), splits) == args.split]
        items = [{"row": i, "text": texts[i], "n_raw": int(n_raw[i])} for i in rows]
    elif args.source == "clean":
        # Clips the old tagger never saw (extract_clean.py): every one is held out.
        path = args.clean or sorted((D.TRAINING / "data" / "clean").glob("clean_*.npz"))[-1]
        z = np.load(path, allow_pickle=True)
        off, fps_arr = z["offsets"], z["fps"]
        clean_frames = z["frames"]
        items = [{"row": i, "text": str(z["texts"][i]), "uid": str(z["uids"][i]),
                  "span": (int(off[i]), int(off[i + 1])), "fps": float(fps_arr[i])}
                 for i in range(len(fps_arr))]
        args.split = f"clean{len(items)}"
    else:
        idx = D.tasks_index(args.tasks_dir)
        items = [{"row": r, "text": r["labels"]} for r in idx
                 if D.assign(r["group"] or D.group_of(r["path"]), splits) == args.split]
    if args.limit and args.limit < len(items):
        rng = np.random.default_rng(0)
        items = [items[i] for i in sorted(rng.choice(len(items), args.limit, replace=False))]
    labels = [labeller(it["text"]) for it in items]
    print(f"[eval] source {args.source} | split {args.split} | {len(items)} clips | "
          f"labelled {sum(bool(l) for l in labels)} | mean words/clip "
          f"{np.mean([len(l) for l in labels]):.2f} (approximate labeller)")

    # ---- features per clip -> per-regime inputs, run in chunks to bound memory
    t0 = time.perf_counter()
    V = len(vocab["words"])
    nb_best = np.full((len(items), V), -np.inf, np.float32)
    live_best = np.full((len(items), V), -np.inf, np.float32)
    nb_seqs, nb_owner, live_seqs, live_owner, short = [], [], [], [], 0
    live_mirror = []

    def flush(force=False):
        nonlocal nb_seqs, nb_owner, live_seqs, live_owner, live_mirror
        if nb_seqs and (force or len(nb_seqs) >= 256):
            nb_best[np.array(nb_owner)] = forward_max(model, nb_seqs, device)
            nb_seqs, nb_owner = [], []
        if live_seqs and (force or len(live_seqs) >= 1024):
            np.maximum.at(live_best, np.array(live_owner),
                          forward_max(model, live_seqs, device,
                                      mirrored=live_mirror if args.tta == "mirror" else None))
            live_seqs, live_owner, live_mirror = [], [], []

    if args.source == "h5":
        feats = D.h5_features(args.h5, np.array([it["row"] for it in items]))
    elif args.source == "clean":
        feats = ((None, (clean_frames[it["span"][0]:it["span"][1]].astype(np.float32),
                         it["fps"])) for it in items)
    else:
        feats = ((None, D.tasks_features(args.tasks_dir, it["row"])) for it in items)
    for ci, (it, (_, payload)) in enumerate(zip(items, feats)):
        if args.source == "h5":
            stored = payload                                   # (192, 225) raw
            nb_raw = stored
            length = max(1, round(it["n_raw"] * args.live_fps / args.h5_src_fps))
            stream_raw = stored[uniform_idx(len(stored), length)]
        else:
            frames, fps = payload
            nb_raw = frames[uniform_idx(len(frames), NOTEBOOK_FRAMES)]
            length = max(1, round(len(frames) * args.live_fps / fps))
            stream_raw = frames if length == len(frames) else \
                frames[uniform_idx(len(frames), length)]
        if "notebook" in regimes:
            nb_seqs.append(normalise(nb_raw))
            nb_owner.append(ci)
        if "live" in regimes:
            wins = live_windows(normalise(stream_raw))
            short += not wins
            live_seqs.extend(wins)
            live_owner.extend([ci] * len(wins))
            if args.tta == "mirror":
                live_mirror.extend(live_windows(normalise(mirror_raw(stream_raw))))
        flush()
        if (ci + 1) % 1000 == 0:
            print(f"[eval] {ci + 1}/{len(items)} clips "
                  f"({time.perf_counter() - t0:.0f}s)", flush=True)
    flush(force=True)
    print(f"[eval] inference done in {time.perf_counter() - t0:.1f}s | "
          f"clips too short for one live window {short}")

    results = {"source": args.source, "split": args.split, "clips": len(items),
               "live_fps": args.live_fps, "h5_src_fps": args.h5_src_fps,
               "labeller": "approximate (data.Labeller)", "regimes": {}}
    with np.errstate(over="ignore"):
        if "notebook" in regimes:
            results["regimes"]["notebook"] = metrics(1 / (1 + np.exp(-nb_best)), labels, vocab)
        if "live" in regimes:
            # a clip with no live window keeps -inf -> probability 0 (the app shows nothing)
            results["regimes"]["live"] = metrics(1 / (1 + np.exp(-live_best)), labels, vocab)
            results["regimes"]["live"]["clips_without_window"] = short

    args.out.mkdir(parents=True, exist_ok=True)
    tag = args.tag or (f"{args.source}_{args.split}" + (f"_n{args.limit}" if args.limit else ""))
    path = args.out / f"{tag}.json"
    path.write_text(json.dumps(results, indent=1), encoding="utf-8")
    for name, m in results["regimes"].items():
        print(f"\n== {args.source} / {name} ==  mAP {m['mAP']:.4f} | P@3 {m['p@3']:.4f} "
              f"| R@3 {m['r@3']:.4f} | classes {m['classes_with_positives']}")
        print("   thr   prec    rec   words/clip")
        for row in m["curve"]:
            print(f"   {row['threshold']:.2f}  {row['precision']:.4f}  {row['recall']:.4f}"
                  f"  {row['words_per_clip']:.2f}")
        a = m["app_decode"]
        print(f"   app decode (thr {a['threshold']}, top_k {a['top_k']}): "
              f"P {a['precision']:.4f} R {a['recall']:.4f} words/clip {a['words_per_clip']:.2f}")
    print(f"\n[eval] wrote {path}")
    if args.dump_scores and "live" in regimes:
        args.dump_scores.parent.mkdir(parents=True, exist_ok=True)
        y = np.zeros(live_best.shape, bool)
        for i, ls in enumerate(labels):
            y[i, ls] = True
        np.savez_compressed(args.dump_scores, live_logits=live_best, labels=y,
                            words=np.array(vocab["words"]))
        print(f"[eval] scores -> {args.dump_scores}")
    if args.details and "live" in regimes:
        with np.errstate(over="ignore"):
            write_details(1 / (1 + np.exp(-live_best)), labels, vocab,
                          args.out / f"{tag}_details.json")


def write_details(probs, labels, vocab, path, top=40):
    """Per-word AP (worst first, words with >= 3 positives) and the most
    frequent confusions at the app threshold: a true word missed while another
    word fired in the same clip."""
    words = vocab["words"]
    n, v = probs.shape
    y = np.zeros((n, v), bool)
    for i, ls in enumerate(labels):
        y[i, ls] = True
    per_word = []
    for c in range(v):
        npos = int(y[:, c].sum())
        if npos >= 3:
            per_word.append({"word": words[c], "positives": npos,
                             "ap": average_precision(probs[:, c], y[:, c])})
    per_word.sort(key=lambda r: r["ap"])
    pred = probs >= vocab.get("threshold", 0.15)
    conf = {}
    for i in range(n):
        missed = np.flatnonzero(y[i] & ~pred[i])
        wrong = np.flatnonzero(pred[i] & ~y[i])
        for a in missed:
            for b in wrong:
                conf[(a, b)] = conf.get((a, b), 0) + 1
    confusions = sorted(conf.items(), key=lambda kv: -kv[1])[:top]
    path.write_text(json.dumps({
        "per_word_ap_worst_first": per_word,
        "top_confusions": [{"true": words[a], "predicted": words[b], "clips": k}
                           for (a, b), k in confusions],
    }, indent=1), encoding="utf-8")
    print(f"[eval] details -> {path} | worst: "
          + ", ".join(f"{r['word']} {r['ap']:.2f}" for r in per_word[:8]))


if __name__ == "__main__":
    main()
