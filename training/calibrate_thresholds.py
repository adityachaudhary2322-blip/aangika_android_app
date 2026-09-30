"""Per-word decision thresholds for the ISL word tagger, measured honestly.

    python training/evaluate.py --source clean --regimes live \
        --ckpt training/runs/full1/best.pt --out training/runs/calib \
        --dump-scores training/runs/calib/clean_v2_live.npz
    python training/calibrate_thresholds.py training/runs/calib/clean_v2_live.npz \
        --write public/models/thresholds_v2.json

The app decodes every word with one threshold (0.15). Words differ a lot in
how confident the model is when it is right, so a per-word threshold can keep
the words it gets right and drop the ones that mostly fire by mistake.

Method (no test data leaks into the choice):
  * split the clips 50/50 at random, 10 times (seeded);
  * on the tuning half, per word with >= MIN_POS positives: the threshold on
    GRID that maximises that word's F1; a word that fired >= MIN_FP times and
    was never right gets RAISE; every other word keeps the global 0.15;
  * score the OTHER half with the app's decode (per-word threshold + top-8),
    against the same half decoded with 0.15 and with the best single
    threshold tuned on the tuning half (the fair baseline).
Reports the mean and spread over the 10 splits. --write fits on ALL clips
and saves the thresholds the app will use (only if you approve the release).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np

GRID = np.round(np.arange(0.05, 0.651, 0.025), 3)
GLOBAL = 0.15
TOP_K = 8
MIN_POS = 3
MIN_FP = 3
RAISE = 0.35


def decode(probs, thr):
    """App decode: p >= threshold(word), keep the top-k per clip."""
    pred = probs >= thr[None, :]
    rank = np.argsort(np.argsort(-probs, axis=1), axis=1)
    return pred & (rank < TOP_K)


def prf(pred, y):
    tp = int((pred & y).sum())
    np_ = int(pred.sum())
    pos = int(y.sum())
    p = tp / np_ if np_ else 0.0
    r = tp / pos if pos else 0.0
    f = 2 * p * r / (p + r) if p + r else 0.0
    return {"precision": p, "recall": r, "f1": f, "words_per_clip": np_ / len(y)}


def fit(probs, y, min_pos=None, raise_only=False):
    """Per-word thresholds from these clips.
    raise_only: a word's threshold may only go UP (fewer false alarms), and
    only when that clearly helps its F1 on these clips."""
    min_pos = min_pos or MIN_POS
    v = probs.shape[1]
    thr = np.full(v, GLOBAL, np.float32)
    for c in range(v):
        pos = y[:, c]
        n_pos = int(pos.sum())
        s = probs[:, c]
        if raise_only:
            fired = s >= GLOBAL
            if int(fired.sum()) < MIN_FP:
                continue
            tp0 = int((fired & pos).sum())
            p0 = tp0 / int(fired.sum())
            r0 = tp0 / n_pos if n_pos else 0.0
            f0 = 2 * p0 * r0 / (p0 + r0) if p0 + r0 else 0.0
            if n_pos == 0 or tp0 == 0:
                thr[c] = RAISE                     # fires, never right
                continue
            best, best_t = f0, GLOBAL
            for t in GRID[GRID > GLOBAL]:
                f_ = s >= t
                tp = int((f_ & pos).sum())
                if not f_.any():
                    continue
                p, r = tp / int(f_.sum()), tp / n_pos
                f = 2 * p * r / (p + r) if p + r else 0.0
                if f > best + 0.05:                # only a clear gain
                    best, best_t = f, t
            thr[c] = best_t
            continue
        if n_pos >= min_pos:
            best, best_t = -1.0, GLOBAL
            for t in GRID:
                fired = s >= t
                tp = int((fired & pos).sum())
                if not fired.any():
                    continue
                p, r = tp / int(fired.sum()), tp / n_pos
                f = 2 * p * r / (p + r) if p + r else 0.0
                if f > best + 1e-9:
                    best, best_t = f, t
            thr[c] = best_t
        elif n_pos == 0 and int((s >= GLOBAL).sum()) >= MIN_FP:
            thr[c] = RAISE
    return thr


def best_global(probs, y):
    scores = [(prf(decode(probs, np.full(probs.shape[1], t, np.float32)), y)["f1"], t) for t in GRID]
    return max(scores)[1]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scores", type=Path)
    ap.add_argument("--splits", type=int, default=10)
    ap.add_argument("--write", type=Path, default=None, help="fit on all clips and save for the app")
    args = ap.parse_args()

    z = np.load(args.scores, allow_pickle=True)
    with np.errstate(over="ignore"):
        probs = 1 / (1 + np.exp(-z["live_logits"].astype(np.float64)))
    y = z["labels"].astype(bool)
    words = [str(w) for w in z["words"]]
    n = len(y)
    print(f"[calib] {n} clips, {y.shape[1]} words, {int(y.sum())} word labels")

    rows = {"global 0.15": [], "best single threshold": [], "per-word": [],
            "per-word (>= 8 pos)": [], "raise-only": []}
    rng = np.random.default_rng(7)
    for k in range(args.splits):
        idx = rng.permutation(n)
        tune, test = idx[: n // 2], idx[n // 2:]
        g = best_global(probs[tune], y[tune])
        rows["global 0.15"].append(prf(decode(probs[test], np.full(y.shape[1], GLOBAL, np.float32)), y[test]))
        rows["best single threshold"].append({**prf(decode(probs[test], np.full(y.shape[1], g, np.float32)), y[test]), "t": g})
        rows["per-word"].append(prf(decode(probs[test], fit(probs[tune], y[tune])), y[test]))
        rows["per-word (>= 8 pos)"].append(prf(decode(probs[test], fit(probs[tune], y[tune], min_pos=8)), y[test]))
        rows["raise-only"].append(prf(decode(probs[test], fit(probs[tune], y[tune], raise_only=True)), y[test]))

    report = {}
    print(f"\n  held-out halves, mean ± sd over {args.splits} random splits")
    print("  decode                   precision        recall           F1               words/clip")
    for name, rs in rows.items():
        agg = {m: (float(np.mean([r[m] for r in rs])), float(np.std([r[m] for r in rs])))
               for m in ("precision", "recall", "f1", "words_per_clip")}
        report[name] = agg
        print(f"  {name:<24} " + "  ".join(f"{agg[m][0]:.4f} ± {agg[m][1]:.4f}" for m in ("precision", "recall", "f1"))
              + f"  {agg['words_per_clip'][0]:.2f}")
    for name in ("per-word", "per-word (>= 8 pos)", "raise-only"):
        wins = sum(p["f1"] > g["f1"] for p, g in zip(rows[name], rows["global 0.15"]))
        winp = sum(p["precision"] > g["precision"] for p, g in zip(rows[name], rows["global 0.15"]))
        print(f"  {name}: F1 better than 0.15 on {wins}/{args.splits} splits, precision better on {winp}/{args.splits}")
        report[f"{name}: f1_wins_vs_0.15"] = wins
    out = args.scores.with_name(args.scores.stem + "_calibration.json")
    out.write_text(json.dumps(report, indent=1), encoding="utf-8")
    print(f"[calib] report -> {out}")

    if args.write:
        thr = fit(probs, y)
        changed = {words[c]: float(thr[c]) for c in range(len(words)) if abs(thr[c] - GLOBAL) > 1e-6}
        args.write.parent.mkdir(parents=True, exist_ok=True)
        args.write.write_text(json.dumps({
            "format": "aangika-thresholds/1",
            "model": "sanketvani_word_tagger_v2.onnx",
            "default": GLOBAL,
            "top_k": TOP_K,
            "method": "per-word F1-optimal on the 996-clip clean set (>= 3 positives); "
                      "never-correct frequent words raised to 0.35; see training/calibrate_thresholds.py",
            "held_out_estimate": report["per-word"],
            "thresholds": changed,
        }, indent=1, ensure_ascii=False), encoding="utf-8")
        print(f"[calib] {len(changed)} per-word thresholds -> {args.write}")


if __name__ == "__main__":
    main()
