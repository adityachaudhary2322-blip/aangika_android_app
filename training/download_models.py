"""Download the exact .task files src/services/landmarker.js loads.

The URLs are read out of landmarker.js itself, so the two can never drift.
Files land in training/models/ (git-ignored) with a models.json recording
URL, size and SHA-256.

    python training/download_models.py
"""

from __future__ import annotations

import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

TRAINING = Path(__file__).resolve().parent
REPO = TRAINING.parent
LANDMARKER_JS = REPO / "src" / "services" / "landmarker.js"
MODELS = TRAINING / "models"


def model_urls() -> dict[str, str]:
    js = LANDMARKER_JS.read_text(encoding="utf-8")
    urls = {}
    for const in ("HAND_MODEL", "POSE_MODEL"):
        m = re.search(rf"const {const}\s*=\s*'([^']+)'", js)
        if not m:
            sys.exit(f"{const} not found in {LANDMARKER_JS}")
        url = m.group(1)
        if "/latest/" in url:
            sys.exit(f"{const} is unpinned ({url}); pin it in landmarker.js first")
        urls[const] = url
    return urls


def main() -> None:
    MODELS.mkdir(parents=True, exist_ok=True)
    record = {}
    for const, url in model_urls().items():
        dest = MODELS / url.rsplit("/", 1)[1]
        if not dest.exists():
            print(f"[models] {const}: {url}")
            tmp = dest.with_suffix(".part")
            urllib.request.urlretrieve(url, tmp)
            tmp.replace(dest)
        data = dest.read_bytes()
        record[const] = {"url": url, "file": dest.name, "bytes": len(data),
                         "sha256": hashlib.sha256(data).hexdigest()}
        print(f"[models] {dest.name}: {len(data)} bytes sha256 {record[const]['sha256'][:16]}…")
    (MODELS / "models.json").write_text(json.dumps(record, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
