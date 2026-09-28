"""Shared data plumbing: groups, the fixed split, sentence -> word labels,
and loaders for the two feature sources (Holistic .h5, Tasks extraction).
"""

from __future__ import annotations

import csv
import hashlib
import json
import os
import re
from pathlib import Path

import numpy as np

TRAINING = Path(__file__).resolve().parent
REPO = TRAINING.parent
SPLITS = TRAINING / "splits.json"
VOCAB = REPO / "public" / "models" / "vocab.json"
def _default_h5() -> Path:
    """$AANGIKA_H5, else training/data/isign_ctc_dataset.h5 (cloud), else the
    local Windows location. The file is read-only wherever it lives."""
    env = os.environ.get("AANGIKA_H5")
    if env:
        return Path(env)
    for p in (TRAINING / "data" / "isign_ctc_dataset.h5",
              Path(r"C:\dev\data\isign_ctc_dataset.h5")):
        if p.exists():
            return p
    return TRAINING / "data" / "isign_ctc_dataset.h5"


H5_DEFAULT = _default_h5()
TASKS_DEFAULT = TRAINING / "data" / "landmarks"

# ----------------------------------------------------------------- groups
# iSign uids: sentence clips "<video>-<n>" or "<video>--<n>"; word clips
# "<id>_w" (isolated sign), "<id>_e<n>" (example sentence), "<id>_d"
# (definition). The source video is the grouping unit (one signer per video),
# so every clip cut from it lands in the same split.
GROUP_RE = re.compile(r"^(?P<group>.+?)(?:-+\d+|_w|_d|_e\d+)$")


def group_of(name: str) -> str:
    stem = Path(str(name)).stem
    m = GROUP_RE.match(stem)
    return m.group("group") if m else stem


def split_of(group: str, seed: int, test_pct: int, val_pct: int) -> str:
    """Deterministic, membership-independent: a group's split never depends on
    which other groups exist, so Holistic and Tasks data split identically."""
    b = int(hashlib.sha1(f"{seed}:{group}".encode("utf-8")).hexdigest()[:8], 16) % 100
    if b < test_pct:
        return "test"
    if b < test_pct + val_pct:
        return "val"
    return "train"


def load_splits() -> dict:
    if not SPLITS.exists():
        raise SystemExit("training/splits.json missing: run training/make_splits.py")
    return json.loads(SPLITS.read_text(encoding="utf-8"))


def assign(group: str, splits: dict) -> str:
    known = splits.get("groups", {}).get(group)
    if known:
        return known
    r = splits["rule"]
    return split_of(group, r["seed"], r["test_pct"], r["val_pct"])


# ----------------------------------------------------------------- labels
TOKEN_RE = re.compile(r"[a-z0-9']+")


def _candidates(tok: str):
    """Spellings the original (undocumented) labeller may have produced.

    Reconstructed from the stems in vocab.json: possessive "india's" -> "india'",
    "always" -> "alway", "morning" -> "morn", "announced" -> "announc",
    "treated" -> "treate", "movies" -> "movy". Exact token first.
    """
    yield tok
    if tok.endswith("'s"):
        yield tok[:-1]
        yield tok[:-2]
    for suf, rep in (("ies", "y"), ("ing", ""), ("ed", ""), ("es", ""), ("s", ""),
                     ("d", ""), ("ly", "")):
        if tok.endswith(suf) and len(tok) - len(suf) >= 2:
            yield tok[: len(tok) - len(suf)] + rep


class Labeller:
    """sentence -> sorted vocab indices. APPROXIMATE: the tagger's own label
    function is in a notebook we do not have (AUDIT §1.0); evaluate.py reports
    this labeller's coverage so its effect on the metrics is visible."""

    def __init__(self, words: list[str]):
        self.words = words
        self.index = {w: i for i, w in enumerate(words)}

    def __call__(self, text: str) -> list[int]:
        out = set()
        for tok in TOKEN_RE.findall(str(text).lower()):
            for c in _candidates(tok):
                if c in self.index:
                    out.add(self.index[c])
                    break
        return sorted(out)


def load_vocab() -> dict:
    return json.loads(VOCAB.read_text(encoding="utf-8"))


# ----------------------------------------------------------------- sources
def h5_meta(path: Path = H5_DEFAULT):
    """-> names, texts, n_frames_raw (no features read)."""
    import h5py
    with h5py.File(path, "r") as h:
        dec = lambda a: [x.decode("utf-8") if isinstance(x, bytes) else str(x) for x in a]
        return dec(h["name"][:]), dec(h["text"][:]), h["n_frames_raw"][:].astype(int)


def h5_features(path: Path, rows: np.ndarray):
    """Yield (row, float32 [192,225] RAW Holistic frames). Opened read-only."""
    import h5py
    with h5py.File(path, "r") as h:
        ds = h["features"]
        for r in rows:
            yield int(r), ds[int(r)].astype(np.float32)


def tasks_index(out_dir: Path = TASKS_DEFAULT) -> list[dict]:
    with open(out_dir / "index.csv", newline="", encoding="utf-8") as fh:
        return [r for r in csv.DictReader(fh) if not r["error"]]


def tasks_features(out_dir: Path, row: dict):
    z = np.load(out_dir / row["out"])
    meta = json.loads(str(z["meta"]))
    return z["frames"].astype(np.float32), meta["fps"]
