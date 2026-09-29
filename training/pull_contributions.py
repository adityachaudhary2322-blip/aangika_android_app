"""Fetch REVIEWED (approved) contributions from Supabase for retraining.

    python training/pull_contributions.py            # all approved, new since last pull
    python training/pull_contributions.py --status approved --model isl-aangika-v2

Needs, in the environment or the repo's gitignored .env:
    SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   (service role: server-side only)

Writes training/data/contributions/<model_id>.npz (git-ignored):
    windows  float32 [N, frames, feature_dim]   the model's input, as sent
    labels   str [N]      ids str [N]      sign_language str [N]
Only rows with review_status = 'approved' are ever downloaded by default.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np

TRAINING = Path(__file__).resolve().parent
OUT = TRAINING / "data" / "contributions"


def env(name: str) -> str:
    v = os.environ.get(name, "")
    dotenv = TRAINING.parent / ".env"
    if not v and dotenv.exists():
        for line in dotenv.read_text(encoding="utf-8-sig").splitlines():
            m = re.match(rf"\s*{name}\s*=\s*(.+?)\s*$", line)
            if m:
                v = m.group(1).strip("'\"")
    if not v:
        raise SystemExit(f"{name} not set (environment or .env)")
    return v


def fetch(url: str, key: str, status: str, model: str | None):
    cols = "id,label,sign_language,model_id,model_version,landmarks,frames,feature_dim,review_status"
    q = {"select": cols, "review_status": f"eq.{status}", "order": "created_at.asc"}
    if model:
        q["model_id"] = f"eq.{model}"
    rows, start, page = [], 0, 500
    while True:
        req = urllib.request.Request(
            f"{url}/rest/v1/contributions?{urllib.parse.urlencode(q)}",
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Range": f"{start}-{start + page - 1}"})
        with urllib.request.urlopen(req, timeout=60) as r:
            batch = json.loads(r.read())
        rows.extend(batch)
        if len(batch) < page:
            return rows
        start += page


def decode(row) -> np.ndarray:
    raw = base64.b64decode(row["landmarks"])
    arr = np.frombuffer(raw, dtype="<f2").astype(np.float32)
    return arr.reshape(int(row["frames"]), int(row["feature_dim"]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--status", default="approved", choices=["approved"],
                    help="only reviewed + approved samples are pulled")
    ap.add_argument("--model", default=None)
    args = ap.parse_args()

    rows = fetch(env("SUPABASE_URL").rstrip("/"), env("SUPABASE_SERVICE_ROLE_KEY"), args.status, args.model)
    rows = [r for r in rows if r.get("review_status") == "approved"]      # belt and braces
    OUT.mkdir(parents=True, exist_ok=True)
    by_model: dict[str, list] = {}
    for r in rows:
        by_model.setdefault(r["model_id"], []).append(r)
    for model_id, rs in by_model.items():
        wins = [decode(r) for r in rs]
        shapes = {w.shape for w in wins}
        if len(shapes) != 1:
            print(f"[pull] {model_id}: mixed window shapes {shapes}; keeping the most common")
            common = max(shapes, key=lambda s: sum(w.shape == s for w in wins))
            keep = [i for i, w in enumerate(wins) if w.shape == common]
            wins, rs = [wins[i] for i in keep], [rs[i] for i in keep]
        path = OUT / f"{model_id}.npz"
        np.savez_compressed(path, windows=np.stack(wins), labels=np.array([r["label"] for r in rs]),
                            ids=np.array([r["id"] for r in rs]),
                            sign_language=np.array([r["sign_language"] for r in rs]))
        print(f"[pull] {model_id}: {len(rs)} approved samples -> {path}")
    if not rows:
        print("[pull] no approved contributions yet")


if __name__ == "__main__":
    main()
