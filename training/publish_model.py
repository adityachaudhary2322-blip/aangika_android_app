"""Publish an approved model version for the app to download (models/index.json).

    python training/publish_model.py --onnx runs/full2/model.onnx \
        --entry runs/full2/entry.json --approved-by "Aditya"

Refuses to run without --approved-by: a model reaches users only after the
owner has looked at its evaluation against the previous version.

- copies the ONNX to public/models/<id>_v<version>.onnx (a NEW file name:
  /models/* is served immutable, so an in-place replacement would never
  reach devices that cached the old one);
- writes or updates public/models/index.json, which the app checks in the
  background (src/services/modelUpdates.js).
Then commit the two files yourself (git add + commit) to release.

entry.json: the registry fields for the model (id, version, name, language,
kind, runtime, engine, input, decode, vocabUrl, vocabSize, licence,
sourceUrl, accuracy, ...); `files` is filled in here.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
MODELS = REPO / "public" / "models"
INDEX = MODELS / "index.json"
REQUIRED = ["id", "version", "name", "language", "kind", "runtime", "engine", "input",
            "decode", "licence", "sourceUrl", "accuracy"]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--onnx", type=Path, required=True)
    ap.add_argument("--entry", type=Path, required=True)
    ap.add_argument("--approved-by", required=True,
                    help="who approved this release after reviewing the evaluation")
    args = ap.parse_args()

    entry = json.loads(args.entry.read_text(encoding="utf-8"))
    missing = [k for k in REQUIRED if k not in entry]
    if missing:
        raise SystemExit(f"entry.json is missing {missing}")
    if not entry.get("accuracy", {}).get("measuredOn"):
        raise SystemExit("accuracy.measuredOn is required: publish measured numbers only")

    name = f"{entry['id']}_v{int(entry['version'])}.onnx"
    dest = MODELS / name
    if dest.exists():
        raise SystemExit(f"{dest} already exists: bump the version")
    shutil.copyfile(args.onnx, dest)
    files = [{"url": f"/models/{name}", "bytes": dest.stat().st_size, "role": "weights"}]
    if entry.get("vocabUrl"):
        vocab = REPO / "public" / entry["vocabUrl"].lstrip("/")
        files.append({"url": entry["vocabUrl"], "bytes": vocab.stat().st_size if vocab.exists() else 0,
                      "role": "vocabulary"})
    entry["files"] = files
    entry["approvedBy"] = args.approved_by
    entry["publishedAt"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")

    index = json.loads(INDEX.read_text(encoding="utf-8")) if INDEX.exists() else {"schema": 1, "models": []}
    index["models"] = [m for m in index["models"] if not (m["id"] == entry["id"] and m["version"] == entry["version"])]
    index["models"].append(entry)
    INDEX.write_text(json.dumps(index, indent=2) + "\n", encoding="utf-8")
    print(f"[publish] {dest.name} ({dest.stat().st_size / 2**20:.1f} MiB) + {INDEX.relative_to(REPO)}")
    print("[publish] release it with:  git add public/models && git commit -m \"release: ...\" && git push")


if __name__ == "__main__":
    main()
