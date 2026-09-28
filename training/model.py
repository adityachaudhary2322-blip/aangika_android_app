"""The word tagger, rebuilt from its checkpoint, plus an ONNX equivalence check.

Architecture (CLAUDE.md, and Cell 3 of the Kaggle notebook's shared backbone):
    frontend  Conv1d(225,C,3,p=1) BN ReLU Dropout  Conv1d(C,C,3,p=1) BN ReLU Dropout
    lstm      BiLSTM, L layers, hidden H
    head      Linear(2H, V), applied per frame  -> frame_logits (B, T, V)

Every size is read off the state dict itself (conv channels, H, L, V), and the
checkpoint's `config` is only printed for cross-checking, because its key
names are not documented.

    python training/model.py                       # load + ONNX check
    python training/model.py --ckpt path/to/ckpt  # a file, or an unzipped dir
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import zipfile
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn

TRAINING = Path(__file__).resolve().parent
REPO = TRAINING.parent
DEFAULT_CKPT = TRAINING / "checkpoints" / "checkpoint_word_tagger"
DEFAULT_ONNX = REPO / "public" / "models" / "sanketvani_word_tagger.onnx"


class WordTagger(nn.Module):
    def __init__(self, feature_dim=225, conv_channels=256, hidden_dim=256,
                 lstm_layers=3, num_words=1500, conv_dropout=0.2,
                 lstm_dropout=0.3, head_name="head"):
        super().__init__()
        self.frontend = nn.Sequential(
            nn.Conv1d(feature_dim, conv_channels, kernel_size=3, padding=1),
            nn.BatchNorm1d(conv_channels),
            nn.ReLU(inplace=True),
            nn.Dropout(conv_dropout),
            nn.Conv1d(conv_channels, conv_channels, kernel_size=3, padding=1),
            nn.BatchNorm1d(conv_channels),
            nn.ReLU(inplace=True),
            nn.Dropout(conv_dropout),
        )
        self.lstm = nn.LSTM(conv_channels, hidden_dim, num_layers=lstm_layers,
                            batch_first=True, bidirectional=True,
                            dropout=lstm_dropout if lstm_layers > 1 else 0.0)
        self.head_name = head_name
        setattr(self, head_name, nn.Linear(2 * hidden_dim, num_words))

    def forward(self, x):                        # (B, T, 225) -> (B, T, V)
        x = self.frontend(x.transpose(1, 2)).transpose(1, 2)
        x, _ = self.lstm(x)
        return getattr(self, self.head_name)(x)


def _torch_load(path: Path):
    """torch.load for a checkpoint file, or for one already unzipped to a dir."""
    if path.is_dir():
        # A torch zip unpacked in place: <dir>/{data.pkl, data/, version, ...}
        # possibly nested one level. Re-pack in memory under a single top dir.
        root = path
        if not (root / "data.pkl").exists():
            inner = [p for p in root.iterdir() if (p / "data.pkl").exists()]
            if len(inner) != 1:
                sys.exit(f"{path}: no data.pkl found (not an unzipped torch checkpoint)")
            root = inner[0]
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
            for f in sorted(root.rglob("*")):
                if f.is_file():
                    zf.write(f, f"archive/{f.relative_to(root).as_posix()}")
        buf.seek(0)
        return torch.load(buf, map_location="cpu", weights_only=False)
    return torch.load(path, map_location="cpu", weights_only=False)


def load_checkpoint(path: Path = DEFAULT_CKPT, verbose: bool = True):
    """-> (model in eval mode, checkpoint dict)."""
    if not path.exists():
        sys.exit(f"checkpoint not found: {path}\n"
                 "Unzip Downloads/checkpoint_word_tagger.zip there (git-ignored), or pass --ckpt.")
    ck = _torch_load(path)
    sd = ck["model_state_dict"]
    sd = {re.sub(r"^(_orig_mod|module)\.", "", k): v for k, v in sd.items()}

    conv_c, feat = sd["frontend.0.weight"].shape[:2]
    hidden = sd["lstm.weight_hh_l0"].shape[1]
    layers = len({k for k in sd if re.fullmatch(r"lstm\.weight_ih_l\d+", k)})
    heads = [k[:-len(".weight")] for k, v in sd.items()
             if k.endswith(".weight") and v.ndim == 2 and v.shape[1] == 2 * hidden
             and not k.startswith("lstm")]
    if len(heads) != 1:
        sys.exit(f"cannot identify the head layer among {heads}")
    head = heads[0]
    num_words = sd[f"{head}.weight"].shape[0]

    model = WordTagger(feature_dim=feat, conv_channels=conv_c, hidden_dim=hidden,
                       lstm_layers=layers, num_words=num_words, head_name=head)
    model.load_state_dict(sd, strict=True)      # raises on any key/shape mismatch
    model.eval()
    if verbose:
        print(f"[model] frontend {feat}->{conv_c} | BiLSTM {layers}x{hidden} | "
              f"head '{head}' -> {num_words} words")
        print(f"[ckpt] keys {sorted(k for k in ck if k != 'model_state_dict')} | "
              f"epoch {ck.get('epoch')} | val_mAP {ck.get('val_mAP')} | "
              f"threshold {ck.get('threshold')}")
        print(f"[ckpt] config {ck.get('config')}")
    return model, ck


def check_onnx(model: nn.Module, onnx_path: Path = DEFAULT_ONNX, seed: int = 0) -> bool:
    import onnxruntime as ort
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    ins, outs = sess.get_inputs(), sess.get_outputs()
    print(f"[onnx] inputs {[(i.name, i.shape) for i in ins]} | "
          f"outputs {[(o.name, o.shape) for o in outs]}")
    rng = np.random.default_rng(seed)
    ok = True
    # random landmark-like input, the app's live window, the notebook length, odd length
    for batch, frames in ((1, 40), (1, 192), (1, 97), (2, 40)):
        x = rng.normal(0, 1, (batch, frames, 225)).astype(np.float32)
        x[:, :, 99:162][rng.random((batch, frames)) < 0.3] = 0.0     # missing hands
        try:
            out = sess.run(["frame_logits"], {"landmarks": x})[0]
        except Exception as exc:                               # noqa: BLE001
            print(f"[onnx] ({batch},{frames}) failed in onnxruntime: {exc}")
            ok = False
            continue
        with torch.no_grad():
            ref = model(torch.from_numpy(x)).numpy()
        diff = float(np.abs(out - ref).max())
        agree = float((out.argmax(-1) == ref.argmax(-1)).mean())
        pass_ = out.shape == ref.shape and diff < 1e-4
        ok &= pass_
        print(f"[onnx] ({batch},{frames},225) -> {out.shape} | max|onnx-torch| "
              f"{diff:.2e} | argmax agree {agree:.1%} | {'OK' if pass_ else 'MISMATCH'}")
    print(f"[onnx] {'EQUIVALENT' if ok else 'NOT EQUIVALENT'} to the checkpoint")
    return ok


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ckpt", type=Path, default=DEFAULT_CKPT)
    ap.add_argument("--onnx", type=Path, default=DEFAULT_ONNX)
    args = ap.parse_args()
    model, ck = load_checkpoint(args.ckpt)

    import json
    vocab = json.loads((REPO / "public" / "models" / "vocab.json").read_text(encoding="utf-8"))
    words = ck.get("words")
    if words is not None:
        same = list(words) == vocab["words"]
        print(f"[vocab] checkpoint words == vocab.json words: {same}")
    sys.exit(0 if check_onnx(model, args.onnx) else 1)


if __name__ == "__main__":
    main()
