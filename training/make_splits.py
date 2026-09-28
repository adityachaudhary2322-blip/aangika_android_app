"""Create the fixed, group-disjoint split used by every evaluation from now on.

Groups are iSign source videos (uid minus its segment number). A group's split
is a hash of (seed, group), so it is stable, reproducible, and identical for
Holistic (.h5) and Tasks-extracted copies of the same clips.

    python training/make_splits.py            # refuses to overwrite
    python training/make_splits.py --force    # only if you mean to reset every result
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

import data as D

SEED = 20260928
TEST_PCT = 10
VAL_PCT = 5


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--h5", type=Path, default=D.H5_DEFAULT)
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()
    if D.SPLITS.exists() and not args.force:
        sys.exit(f"{D.SPLITS} exists; the split is fixed. Use --force only to reset it.")

    names, texts, _ = D.h5_meta(args.h5)
    groups = [D.group_of(n) for n in names]
    per_group = collections.Counter(groups)
    assignment = {g: D.split_of(g, SEED, TEST_PCT, VAL_PCT) for g in per_group}

    clips = collections.Counter(assignment[g] for g in groups)
    grp = collections.Counter(assignment.values())
    # sentence overlap between train and test: exact duplicates that leak content
    norm = [" ".join(t.lower().split()) for t in texts]
    train_s = {s for s, g in zip(norm, groups) if assignment[g] == "train"}
    test_s = [s for s, g in zip(norm, groups) if assignment[g] == "test"]
    overlap = sum(s in train_s for s in test_s)

    out = {
        "rule": {"seed": SEED, "test_pct": TEST_PCT, "val_pct": VAL_PCT,
                 "group": "iSign uid minus -<n> / --<n> / _w / _d / _e<n> (data.GROUP_RE)",
                 "hash": "sha1(f'{seed}:{group}')[:8] as int % 100"},
        "source": str(args.h5),
        "counts": {"clips": dict(clips), "groups": dict(grp),
                   "test_sentences_also_in_train": overlap},
        "groups": dict(sorted(assignment.items())),
    }
    D.SPLITS.write_text(json.dumps(out, indent=1), encoding="utf-8")
    print(f"[splits] {len(per_group)} groups from {len(names)} clips "
          f"(median {sorted(per_group.values())[len(per_group) // 2]} clips/group)")
    print(f"[splits] clips {dict(clips)} | groups {dict(grp)}")
    print(f"[splits] test clips whose exact sentence also occurs in train: {overlap}")
    if len(per_group) > 0.5 * len(names):
        print("[splits] WARNING: most groups hold a single clip; the uid pattern may "
              "not encode the source video. Check GROUP_RE in data.py.")


if __name__ == "__main__":
    main()
