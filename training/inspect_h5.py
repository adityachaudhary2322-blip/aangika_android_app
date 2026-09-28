"""Read-only inspection of the iSign .h5 (completes docs/AUDIT.md §2 and the
dataset-overlap half of §3).

    python training/inspect_h5.py
"""
import collections
import json
import re
import time
from pathlib import Path

import h5py
import numpy as np

import data as D

REPO = Path(__file__).resolve().parent.parent
P = str(D.H5_DEFAULT)                 # $AANGIKA_H5 or training/data/ (read-only)

t0 = time.time()
with h5py.File(P, "r") as h:
    print("keys", list(h.keys()))
    for k in h:
        print(k, h[k].shape, h[k].dtype, h[k].chunks, h[k].compression)
    print("attrs", {k: (v.item() if hasattr(v, "item") else v) for k, v in h.attrs.items()})
    N = h["features"].shape[0]
    dec = lambda a: [x.decode() if isinstance(x, bytes) else x for x in a]
    names, texts = dec(h["name"][:]), dec(h["text"][:])
    raw = h["n_frames_raw"][:]
    print("N", N, "| name samples", names[:5], names[-3:])
    print("n_frames_raw pctl [0,5,25,50,75,95,99,100]",
          np.percentile(raw, [0, 5, 25, 50, 75, 95, 99, 100]).tolist(), "mean", raw.mean())
    rng = np.random.default_rng(0)
    idx = sorted(set([0, N - 1] + rng.choice(N, 50, replace=False).tolist()))
    bad, stats = 0, []
    for i in idx:                                   # includes the LAST row: truncation check
        x = h["features"][i].astype(np.float32)
        bad += not np.isfinite(x).all()
        pose = np.abs(x[:, :99]).sum(1) > 0
        lh = np.abs(x[:, 99:162]).sum(1) > 0
        rh = np.abs(x[:, 162:]).sum(1) > 0
        stats.append((pose.mean(), lh.mean(), rh.mean(), x.min(), x.max()))
    s = np.array(stats)
    print(f"sampled {len(idx)} rows incl. first+last | non-finite rows {bad}")
    print("frac frames with pose / left / right:", s[:, :3].mean(0).round(3).tolist())
    print("value range over sample", float(s[:, 3].min()), float(s[:, 4].max()))

pref = collections.Counter(re.sub(r"[-_]\d+$", "", n) for n in names)
print("groups (uid minus trailing -N):", len(pref), "| top", pref.most_common(5))
tn = [" ".join(t.lower().split()) for t in texts]
c = collections.Counter(tn)
print("unique sentences", len(c), "| clips sharing a sentence",
      sum(v for v in c.values() if v > 1), "| top", c.most_common(8))

V = json.load(open(REPO / "public" / "models" / "vocab.json", encoding="utf-8"))["words"]
tok = collections.Counter(w for t in tn for w in re.findall(r"[a-z0-9']+", t))
print("distinct tokens", len(tok), "| vocab words found verbatim",
      sum(w in tok for w in V), "/", len(V))
print("vocab words never verbatim (first 80):", [w for w in V if w not in tok][:80])
print("counts:", {w: tok.get(w, 0) for w in ["hello", "hi", "namaste", "my", "you", "what",
      "where", "how", "why", "who", "no", "not", "sorry", "aditya", "name", "thank",
      "please", "help", "deaf"]})
Vs = set(V)
print("frequent tokens NOT in vocab (top 120):",
      [(w, n) for w, n in tok.most_common(3000) if w not in Vs][:120])
print("elapsed", round(time.time() - t0, 1), "s")
