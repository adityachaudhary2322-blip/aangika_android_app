#!/usr/bin/env bash
# Create training/.venv (Python 3.10-3.12), install requirements, then torch:
# the CUDA build when nvidia-smi works, the CPU build otherwise.
# Run from anywhere:  bash training/setup.sh
set -euo pipefail
cd "$(dirname "$0")"

pick_python() {
  for v in 3.12 3.11 3.10; do
    if command -v py >/dev/null 2>&1 && py "-$v" -c "" >/dev/null 2>&1; then
      echo "py -$v"; return
    fi
    if command -v "python$v" >/dev/null 2>&1; then
      echo "python$v"; return
    fi
  done
  if command -v python >/dev/null 2>&1 &&
     python -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)'; then
    echo "python"; return
  fi
  echo "no Python 3.10-3.12 found" >&2; exit 1
}

PY=$(pick_python)
echo "[setup] using: $PY ($($PY --version))"
[ -d .venv ] || $PY -m venv .venv

if [ -x .venv/Scripts/python.exe ]; then VPY=.venv/Scripts/python.exe; else VPY=.venv/bin/python; fi
"$VPY" -m pip install --upgrade pip
"$VPY" -m pip install -r requirements.txt

if nvidia-smi >/dev/null 2>&1; then
  echo "[setup] nvidia-smi OK -> CUDA torch"
  "$VPY" -m pip install torch --index-url https://download.pytorch.org/whl/cu124
else
  echo "[setup] no working nvidia-smi -> CPU torch"
  "$VPY" -m pip install torch --index-url https://download.pytorch.org/whl/cpu
fi

"$VPY" - <<'EOF'
import sys, torch, mediapipe, numpy
print(f"[setup] python {sys.version.split()[0]} | torch {torch.__version__} "
      f"cuda={torch.cuda.is_available()} | mediapipe {mediapipe.__version__} "
      f"| numpy {numpy.__version__}")
EOF
