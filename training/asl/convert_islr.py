"""Convert the ASL ISLR 1st-place TFLite model to ONNX and prove equivalence.

Run in the separate TensorFlow venv (TF's protobuf clashes with MediaPipe's):

    training/.venv-tf/Scripts/python training/asl/convert_islr.py

Inputs : training/models/asl/islr-1st/model.tflite (+ sign_to_prediction_index_map.json)
         from https://huggingface.co/sign/kaggle-asl-signs-1st-place (MIT)
Outputs: public/models/asl/islr-1st/model.onnx and vocab.json
         (NOT committed until the user approves the model files)

Equivalence: the TFLite interpreter and onnxruntime must agree on the same
inputs, including the cases the app produces (missing face, one hand
missing, both hands missing in some frames, various clip lengths).
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "training" / "models" / "asl" / "islr-1st"
OUT = ROOT / "public" / "models" / "asl" / "islr-1st"

# Display text for the dataset's run-together labels (the rest are used as-is).
DISPLAY = {
    "TV": "TV", "callonphone": "call on phone", "frenchfries": "french fries",
    "glasswindow": "window", "haveto": "have to", "hesheit": "he/she/it",
    "icecream": "ice cream", "minemy": "my", "thankyou": "thank you", "weus": "we",
    "owie": "hurt (owie)", "shhh": "shh", "yourself": "yourself",
}


def sample_inputs(rng):
    """Landmark clips shaped like the app's: [T, 543, 3] with NaN gaps."""
    cases = []
    for T, drop in ((8, "none"), (30, "face"), (30, "left"), (45, "right_some"), (64, "none"), (96, "face")):
        x = rng.uniform(0.2, 0.8, size=(T, 543, 3)).astype(np.float32)
        x[..., 2] = rng.normal(0, 0.05, size=(T, 543)).astype(np.float32)
        # smooth motion, so it resembles tracked landmarks rather than noise
        x += np.cumsum(rng.normal(0, 0.003, size=(T, 1, 3)), axis=0).astype(np.float32)
        if drop == "face":
            x[:, 0:468] = np.nan
        if drop == "left":
            x[:, 468:489] = np.nan
        if drop == "right_some":
            x[rng.random(T) < 0.4, 522:543] = np.nan
        cases.append((f"T={T} missing={drop}", x))
    return cases


def main():
    import onnxruntime as ort
    import tensorflow as tf
    import tf2onnx

    tfl = SRC / "model.tflite"
    if not tfl.exists():
        sys.exit(f"missing {tfl}")
    OUT.mkdir(parents=True, exist_ok=True)
    onnx_path = OUT / "model.onnx"

    t0 = time.time()
    model_proto, _ = tf2onnx.convert.from_tflite(str(tfl), opset=17, output_path=str(onnx_path))
    print(f"[convert] {onnx_path} ({onnx_path.stat().st_size / 2**20:.1f} MiB) in {time.time() - t0:.1f}s")

    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    ins, outs = sess.get_inputs(), sess.get_outputs()
    print(f"[onnx] inputs {[(i.name, i.shape) for i in ins]} | outputs {[(o.name, o.shape) for o in outs]}")

    runner = tf.lite.Interpreter(model_path=str(tfl)).get_signature_runner("serving_default")
    rng = np.random.default_rng(0)
    worst, agree, rows = 0.0, 0, []
    for name, x in sample_inputs(rng):
        ref = runner(inputs=x)["outputs"]
        got = sess.run(None, {ins[0].name: x})[0]
        diff = float(np.nanmax(np.abs(np.asarray(got).reshape(-1) - np.asarray(ref).reshape(-1))))
        same_top = int(np.argmax(got)) == int(np.argmax(ref))
        worst = max(worst, diff)
        agree += same_top
        rows.append((name, diff, same_top, float(np.sum(ref))))
    for name, diff, same, total in rows:
        print(f"  {name:28s} max|onnx-tflite| {diff:.2e}  top-1 {'same' if same else 'DIFFERENT'}  sum(out)={total:.3f}")
    ok = worst < 1e-3 and agree == len(rows)
    print(f"[parity] {'EQUIVALENT' if ok else 'NOT EQUIVALENT'}: worst {worst:.2e}, top-1 agree {agree}/{len(rows)}")

    labels_map = json.loads((SRC / "sign_to_prediction_index_map.json").read_text(encoding="utf-8"))
    labels = [None] * len(labels_map)
    for sign, idx in labels_map.items():
        labels[idx] = sign
    sums = [r[3] for r in rows]
    vocab = {
        "name": "ASL isolated signs (Kaggle ISLR 1st place)",
        "labels": labels,
        "display": {k: v for k, v in DISPLAY.items() if k in labels_map},
        "output_is": "probabilities" if all(abs(s - 1) < 1e-3 for s in sums) else "scores",
        "input": {"name": ins[0].name, "shape": ["frames", 543, 3],
                  "layout": "face 0-467, left_hand 468-488, pose 489-521, right_hand 522-542; NaN = missing"},
        "source": "https://huggingface.co/sign/kaggle-asl-signs-1st-place",
        "licence": {"weights": "MIT", "data": "PopSign ASL v1.0, CC BY 4.0"},
    }
    (OUT / "vocab.json").write_text(json.dumps(vocab, indent=1), encoding="utf-8")
    print(f"[vocab] {len(labels)} labels, output is {vocab['output_is']}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
