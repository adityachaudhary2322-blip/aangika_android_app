"""Phase 5: retrain the word tagger for the way the app actually runs it.

Warm-started from training/checkpoints/checkpoint_word_tagger (all weights,
same 1500-word head), so the result is a drop-in replacement: same ONNX
input/output, same vocab.json words, no app change needed to use it.

What changes is the training regime, to close the gap docs/BASELINE.md
measured (live-window mAP 0.243 vs 0.337 under the notebook's conditions):

  * LIVE WINDOWS. Each clip becomes the stream the app would see (canonical
    25 fps, reconstructed from n_frames_raw), cut into 40-frame windows at
    stride 20 exactly like useSignPipeline.js. Each window is an independent
    forward pass; a word's clip score is the max over windows and frames.
    BCE on that score (MIL) optimises the live decode directly.
  * SPEED JITTER 0.8-1.25x, so 20-31 fps cameras look familiar.
  * AUGMENTATION on RAW packed frames, before bodyNormalise: mirror (x flip +
    hand-slot swap + pose left/right swap), small rotation / scale / shift,
    per-frame hand dropout (imitates a detector losing a hand), jitter.
    Missing landmarks stay exactly 0.0 throughout.
  * RARE WORDS: BCE pos_weight = clip(sqrt(neg/pos), 1, 10) per word.
  * EARLY STOPPING on LIVE-regime mAP over the val groups of splits.json.

Labels: data.Labeller on the sentence (the reconstructed old labels). Phase 4
gloss labels plug in later via --labels.

    python training/train.py --run short --max-train 8000 --epochs 2   # minutes
    python training/train.py --run full  --epochs 15                    # hours: ask first
"""

from __future__ import annotations

import argparse
import json
import math
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

import data as D
import features as F
from evaluate import metrics, uniform_idx, WINDOW, STRIDE
from model import DEFAULT_CKPT, load_checkpoint

RUNS = D.TRAINING / "runs"
CANON_FPS = 25.0
SRC_FPS = 25.0                  # iSign native rate assumed in evaluate.py too
MAX_WINDOWS = 12                # per clip per training step (random subset)

# MediaPipe pose left/right pairs, swapped when mirroring.
POSE_PAIRS = [(1, 4), (2, 5), (3, 6), (7, 8), (9, 10), (11, 12), (13, 14), (15, 16),
              (17, 18), (19, 20), (21, 22), (23, 24), (25, 26), (27, 28), (29, 30), (31, 32)]
POSE_PERM = np.arange(33)
for a, b in POSE_PAIRS:
    POSE_PERM[a], POSE_PERM[b] = b, a


# ------------------------------------------------------------------ augment
def augment_raw(x: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """(T, 225) raw packed frames -> augmented copy. Zeros stay zeros."""
    x = x.copy()
    T = len(x)
    pts = x.reshape(T, 75, 3)
    present = ~(pts == 0).all(-1)                       # (T, 75)

    if rng.random() < 0.5:                              # mirror
        pts[..., 0] = np.where(present, 1.0 - pts[..., 0], 0.0)
        pose = pts[:, :33][:, POSE_PERM]
        left = pts[:, 33:54].copy()
        right = pts[:, 54:75].copy()
        pts[:, :33] = pose
        pts[:, 33:54] = right
        pts[:, 54:75] = left
        present = ~(pts == 0).all(-1)

    # small similarity transform about the image centre, x/y only
    ang = np.deg2rad(rng.uniform(-10, 10))
    sc = rng.uniform(0.9, 1.1)
    sh = rng.uniform(-0.05, 0.05, size=2)
    c, s = math.cos(ang) * sc, math.sin(ang) * sc
    xy = pts[..., :2] - 0.5
    nx = xy[..., 0] * c - xy[..., 1] * s + 0.5 + sh[0]
    ny = xy[..., 0] * s + xy[..., 1] * c + 0.5 + sh[1]
    pts[..., 0] = np.where(present, nx, 0.0)
    pts[..., 1] = np.where(present, ny, 0.0)
    pts[..., 2] = np.where(present, pts[..., 2] * sc, 0.0)

    # landmark jitter
    noise = rng.normal(0, 0.002, size=pts.shape).astype(np.float32)
    pts += np.where(present[..., None], noise, 0.0)

    # per-frame hand dropout: the detector losing a hand for a frame
    for lo, hi in ((33, 54), (54, 75)):
        drop = rng.random(T) < 0.05
        pts[drop, lo:hi] = 0.0
    return pts.reshape(T, 225)


# ----------------------------------------------------------------- dataset
class LiveWindows(Dataset):
    """Clip -> (windows [W, 40, 225] float32, label index list)."""

    def __init__(self, h5_path, rows, n_raw, labels, train: bool, seed=0):
        self.h5_path = str(h5_path)
        self.rows = np.asarray(rows)
        self.n_raw = n_raw
        self.labels = labels
        self.train = train
        self.seed = seed
        self._h5 = None

    def __len__(self):
        return len(self.rows)

    def _ds(self):
        if self._h5 is None:
            import h5py
            self._h5 = h5py.File(self.h5_path, "r", rdcc_nbytes=16 << 20)
        return self._h5["features"]

    def __getitem__(self, i):
        row = int(self.rows[i])
        stored = self._ds()[row].astype(np.float32)           # (192, 225) raw
        rng = np.random.default_rng((self.seed, i, int(time.time() * 1e6) % (2 ** 31))
                                    if self.train else (self.seed, i))
        speed = rng.uniform(0.8, 1.25) if self.train else 1.0
        length = max(1, round(self.n_raw[row] * CANON_FPS / SRC_FPS / speed))
        stream = stored[uniform_idx(len(stored), length)]
        if self.train:
            stream = augment_raw(stream, rng)
        norm = F.body_normalise_batch(stream)
        ends = [s for s in range(1, len(norm) + 1) if s >= WINDOW and s % STRIDE == 0]
        if self.train and len(ends) > MAX_WINDOWS:
            ends = sorted(rng.choice(ends, MAX_WINDOWS, replace=False).tolist())
        if not ends:
            return None
        wins = np.stack([norm[e - WINDOW:e] for e in ends])
        return wins, self.labels[row], row


def collate(batch):
    batch = [b for b in batch if b is not None]
    if not batch:
        return None
    wins = torch.from_numpy(np.concatenate([b[0] for b in batch]))
    owner = torch.cat([torch.full((len(b[0]),), i, dtype=torch.long) for i, b in enumerate(batch)])
    return wins, owner, [b[1] for b in batch], [b[2] for b in batch]


def clip_logits(model, wins, owner, n_clips):
    """Per-window max over frames, then per-clip max over windows."""
    per_win = model(wins).amax(dim=1)                          # (W, V)
    out = torch.full((n_clips, per_win.shape[1]), -1e4, device=per_win.device,
                     dtype=per_win.dtype)
    idx = owner.to(per_win.device).unsqueeze(1).expand_as(per_win)
    return out.scatter_reduce(0, idx, per_win, reduce="amax", include_self=True)


# -------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run", required=True, help="run name under training/runs/")
    ap.add_argument("--epochs", type=int, default=15)
    ap.add_argument("--max-train", type=int, default=None, help="subset of train clips")
    ap.add_argument("--max-val", type=int, default=None, help="subset of val clips")
    ap.add_argument("--batch", type=int, default=32, help="clips per step")
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--patience", type=int, default=3)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--ckpt", type=Path, default=DEFAULT_CKPT)
    ap.add_argument("--h5", type=Path, default=D.H5_DEFAULT)
    ap.add_argument("--seed", type=int, default=1337)
    ap.add_argument("--pos-weight-cap", type=float, default=10.0,
                    help="cap for rare-word BCE pos_weight; 1 disables balancing")
    args = ap.parse_args()

    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    out_dir = RUNS / args.run
    out_dir.mkdir(parents=True, exist_ok=True)

    vocab = D.load_vocab()
    V = len(vocab["words"])
    labeller = D.Labeller(vocab["words"])
    splits = D.load_splits()
    names, texts, n_raw = D.h5_meta(args.h5)
    labels = [labeller(t) for t in texts]
    split = np.array([D.assign(D.group_of(n), splits) for n in names])
    rng = np.random.default_rng(args.seed)
    train_rows = np.flatnonzero(split == "train")
    val_rows = np.flatnonzero(split == "val")
    if args.max_train and args.max_train < len(train_rows):
        train_rows = np.sort(rng.choice(train_rows, args.max_train, replace=False))
    if args.max_val and args.max_val < len(val_rows):
        val_rows = np.sort(rng.choice(val_rows, args.max_val, replace=False))

    # rare-word balancing from the training labels
    pos = np.zeros(V)
    for r in train_rows:
        pos[labels[r]] += 1
    neg = len(train_rows) - pos
    pos_weight = torch.tensor(np.clip(np.sqrt(neg / np.maximum(pos, 1)), 1, args.pos_weight_cap),
                              dtype=torch.float32, device=device)

    model, ck = load_checkpoint(args.ckpt, head_dropout=0.3)
    model.to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    total_steps = args.epochs * math.ceil(len(train_rows) / args.batch)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=total_steps,
                                                pct_start=0.05, anneal_strategy="cos")
    scaler = torch.amp.GradScaler("cuda", enabled=device.type == "cuda")
    bce = nn.BCEWithLogitsLoss(pos_weight=pos_weight)

    loader_kw = dict(collate_fn=collate, num_workers=args.workers,
                     persistent_workers=args.workers > 0, pin_memory=device.type == "cuda")
    train_dl = DataLoader(LiveWindows(args.h5, train_rows, n_raw, labels, True, args.seed),
                          batch_size=args.batch, shuffle=True, **loader_kw)
    val_dl = DataLoader(LiveWindows(args.h5, val_rows, n_raw, labels, False, args.seed),
                        batch_size=64, shuffle=False, **loader_kw)

    def dense(lbls):
        y = torch.zeros(len(lbls), V, device=device)
        for i, ls in enumerate(lbls):
            if ls:
                y[i, ls] = 1.0
        return y

    @torch.no_grad()
    def validate():
        model.eval()
        scores, lbls = [], []
        for b in val_dl:
            if b is None:
                continue
            wins, owner, ls, _ = b
            with torch.autocast(device.type, dtype=torch.float16, enabled=device.type == "cuda"):
                lg = clip_logits(model, wins.to(device, non_blocking=True), owner, len(ls))
            scores.append(torch.sigmoid(lg.float()).cpu().numpy())
            lbls.extend(ls)
        model.train()
        return metrics(np.concatenate(scores), lbls, vocab)

    history = []
    print(f"[train] device {device} | train {len(train_rows)} clips | val {len(val_rows)} | "
          f"epochs {args.epochs} | batch {args.batch} | lr {args.lr}")
    t_start = time.time()
    base = validate()
    print(f"[epoch 0] (warm start) live val mAP {base['mAP']:.4f} | P@3 {base['p@3']:.4f} "
          f"| R@3 {base['r@3']:.4f} | {time.time() - t_start:.0f}s")
    history.append({"epoch": 0, "val": {k: base[k] for k in ("mAP", "p@3", "r@3")}})
    best, stale = base["mAP"], 0

    def save(path, epoch, m):
        torch.save({
            "model_state_dict": model.state_dict(), "words": vocab["words"],
            "epoch": epoch, "val_mAP": m["mAP"], "threshold": vocab.get("threshold", 0.15),
            "config": {**(ck.get("config") or {}), "TRAINED_FOR": "live-windows",
                       "WINDOW": WINDOW, "STRIDE": STRIDE, "CANON_FPS": CANON_FPS},
            "trained_from": str(args.ckpt), "run": args.run,
        }, path)

    step = 0
    for epoch in range(1, args.epochs + 1):
        model.train()
        t0, run_loss, n = time.time(), 0.0, 0
        for b in train_dl:
            if b is None:
                continue
            wins, owner, ls, _ = b
            with torch.autocast(device.type, dtype=torch.float16, enabled=device.type == "cuda"):
                lg = clip_logits(model, wins.to(device, non_blocking=True), owner, len(ls))
            loss = bce(lg.float(), dense(ls))
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            scaler.step(opt)
            scaler.update()
            if step < total_steps - 1:
                sched.step()
            step += 1
            run_loss += loss.item() * len(ls)
            n += len(ls)
            if step % 200 == 0:
                print(f"  step {step} | loss {run_loss / n:.4f} | {n / (time.time() - t0):.0f} clips/s",
                      flush=True)
        m = validate()
        history.append({"epoch": epoch, "train_loss": run_loss / max(n, 1),
                        "val": {k: m[k] for k in ("mAP", "p@3", "r@3")},
                        "seconds": time.time() - t0})
        better = m["mAP"] > best + 1e-4
        print(f"[epoch {epoch}] loss {run_loss / max(n, 1):.4f} | live val mAP {m['mAP']:.4f} "
              f"| P@3 {m['p@3']:.4f} | R@3 {m['r@3']:.4f} | {time.time() - t0:.0f}s"
              f"{'  * best' if better else ''}", flush=True)
        (out_dir / "history.json").write_text(json.dumps(history, indent=1), encoding="utf-8")
        if better:
            best, stale = m["mAP"], 0
            save(out_dir / "best.pt", epoch, m)
        else:
            stale += 1
            if stale >= args.patience:
                print(f"[train] no val improvement for {stale} epochs; stopping")
                break
    save(out_dir / "last.pt", epoch, m)
    print(f"[train] done in {(time.time() - t_start) / 60:.1f} min | best live val mAP {best:.4f} "
          f"(warm start {base['mAP']:.4f}) | {out_dir}")


if __name__ == "__main__":
    main()
