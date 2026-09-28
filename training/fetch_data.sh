#!/usr/bin/env bash
# Fetch the large, git-ignored inputs for a fresh (cloud) checkout:
#   training/data/isign_ctc_dataset.h5
#   training/checkpoints/checkpoint_word_tagger/   (unzipped torch checkpoint)
#
# They live in a PRIVATE Hugging Face dataset repo uploaded by the user.
# Requires env vars: HF_TOKEN, AANGIKA_HF_REPO (e.g. "username/aangika-data").
# Idempotent: files already present are skipped.
set -euo pipefail
cd "$(dirname "$0")"

: "${HF_TOKEN:?set HF_TOKEN in the environment}"
: "${AANGIKA_HF_REPO:?set AANGIKA_HF_REPO, e.g. username/aangika-data}"

python3 -m pip install -q "huggingface_hub>=0.24"
mkdir -p data checkpoints

fetch() {  # fetch <file-in-repo> <local-dir>
  if [ -e "$2/$1" ]; then echo "[fetch] $2/$1 exists, skipping"; return; fi
  python3 - "$1" "$2" <<'EOF'
import os, sys
from huggingface_hub import hf_hub_download
name, local_dir = sys.argv[1], sys.argv[2]
p = hf_hub_download(os.environ["AANGIKA_HF_REPO"], name, repo_type="dataset",
                    token=os.environ["HF_TOKEN"], local_dir=local_dir)
print(f"[fetch] {name} -> {p} ({os.path.getsize(p) / 2**30:.2f} GiB)")
EOF
}

fetch isign_ctc_dataset.h5 data
if [ ! -d checkpoints/checkpoint_word_tagger ]; then
  fetch checkpoint_word_tagger.zip checkpoints
  python3 -m zipfile -e checkpoints/checkpoint_word_tagger.zip checkpoints/
  rm checkpoints/checkpoint_word_tagger.zip
fi
ls -la data checkpoints
