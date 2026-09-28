"""Python features.py vs the real signRecognizer.js under node: exact float32.

Run:  training/.venv/Scripts/python -m pytest training/tests/parity -q

Every output float32 must match bit for bit. The only allowance is NaN vs
NaN, whose payload bits are platform noise rather than logic (reachable only
from non-finite input to bodyNormalise).
"""

from __future__ import annotations

import base64
import json
import math
import shutil
import subprocess
import sys
import warnings
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
TRAINING = HERE.parents[1]
sys.path.insert(0, str(TRAINING))

import features as F  # noqa: E402

SEED = 20260928
N_PACK = 1500
N_NORM = 1500
N_PACK_NORM = 1500
N_HYPOT = 5000

MISSING = object()  # sentinel: omit the key entirely (JS `undefined`)


# ------------------------------------------------------------------ encoding
def _enc_num(v):
    if isinstance(v, float):
        if math.isnan(v):
            return {"$num": "NaN"}
        if math.isinf(v):
            return {"$num": "Infinity" if v > 0 else "-Infinity"}
        if v == 0.0 and math.copysign(1.0, v) < 0:
            return {"$num": "-0"}
    return v


def _enc(obj):
    if isinstance(obj, dict):
        return {k: _enc(v) for k, v in obj.items() if v is not MISSING}
    if isinstance(obj, list):
        return [_enc(v) for v in obj]
    return _enc_num(obj)


# ----------------------------------------------------------------- generators
def _coord(rng):
    r = rng.random()
    if r < 0.80:
        return float(rng.uniform(-0.5, 1.5))          # full double precision
    if r < 0.84:
        return 0.0
    if r < 0.86:
        return -0.0
    if r < 0.88:
        return math.nan
    if r < 0.89:
        return math.inf
    if r < 0.90:
        return -math.inf
    if r < 0.92:
        return None                                    # JSON null
    if r < 0.94:
        return MISSING                                 # key absent
    if r < 0.95:
        return "0.5"                                   # not a number
    if r < 0.96:
        return True                                    # not a number either
    if r < 0.97:
        return float(rng.choice([1e40, -1e40]))       # overflows float32
    return float(np.float32(rng.uniform(0, 1)))         # already float32


def _landmark(rng):
    return {"x": _coord(rng), "y": _coord(rng), "z": _coord(rng)}


def _clean_landmark(rng):
    return {k: float(rng.uniform(0.0, 1.0)) for k in ("x", "y", "z")}


def _points(rng, nominal, clean):
    r = rng.random()
    if r < 0.75:
        n = nominal
    elif r < 0.85:
        n = int(rng.integers(0, nominal))
    elif r < 0.92:
        n = nominal + int(rng.integers(1, 6))
    else:
        n = 0
    make = _clean_landmark if clean else _landmark
    return [make(rng) for _ in range(n)]


LABELS = ["Left", "Right", "left", "right", "LEFT", "RIGHT", "", None, "Unknown", MISSING]


def _hand(rng, clean):
    if clean:
        label = str(rng.choice(["Left", "Right"]))
    else:
        label = LABELS[int(rng.integers(0, len(LABELS)))]
    lm = _points(rng, F.HAND_COUNT, clean) if rng.random() > 0.03 else None
    return {"landmarks": lm, "handedness": label}


def _pack_case(rng, clean=False):
    pose = None if rng.random() < 0.1 else _points(rng, F.POSE_COUNT, clean)
    hands = [_hand(rng, clean) for _ in range(int(rng.integers(0, 4)))]
    if rng.random() < 0.05:
        hands = None
    return {"pose": pose, "hands": hands, "mirrored": bool(rng.random() < 0.5)}


def _norm_frame(rng):
    """A float32 frame with realistic structure plus the edge cases."""
    f = rng.uniform(0.0, 1.0, F.FEATURE_DIM).astype(np.float32)
    kind = rng.random()
    if kind < 0.2:                                     # float16 grid, like the .h5
        f = f.astype(np.float16).astype(np.float32)
    xyz = f.reshape(-1, 3)
    for i in rng.choice(75, size=int(rng.integers(0, 40)), replace=False):
        xyz[i] = 0.0                                    # missing landmarks
    if rng.random() < 0.15:
        xyz[int(rng.integers(0, 75))] = -0.0            # -0 triple is also missing
    if rng.random() < 0.15:
        xyz[int(rng.integers(0, 75)), int(rng.integers(0, 3))] = 0.0  # partial zero: present
    l, r = F.L_SHOULDER, F.R_SHOULDER
    s = rng.random()
    if s < 0.08:
        xyz[r] = xyz[l]                                  # span exactly 0
    elif s < 0.14:
        xyz[r, :2] = xyz[l, :2] + np.float32(rng.uniform(-1e-6, 1e-6))  # near threshold
    elif s < 0.18:
        xyz[l] = 0.0                                     # one shoulder missing
    elif s < 0.20:
        xyz[l, 0] = np.nan                               # NaN span -> all zero
    elif s < 0.22:
        xyz[r, 1] = np.inf
    return [float(x) for x in f]


def _hypot_pair(rng):
    r = rng.random()
    if r < 0.6:
        return [float(np.float32(rng.uniform(-1, 1))), float(np.float32(rng.uniform(-1, 1)))]
    if r < 0.8:
        return [float(rng.uniform(-1, 1)) * 10 ** float(rng.uniform(-8, 2)),
                float(rng.uniform(-1, 1)) * 10 ** float(rng.uniform(-8, 2))]
    return [float(rng.choice([0.0, -0.0, 1e-300, 1e300, 3.0, 4.0])),
            float(rng.choice([0.0, 1e-7, 5e-7, 1e-6, 2e-6, 4.0]))]


def _build_cases():
    rng = np.random.default_rng(SEED)
    cases, py_inputs = [], []
    for _ in range(N_PACK):
        c = _pack_case(rng)
        cases.append({"kind": "pack", **c})
    for _ in range(N_NORM):
        cases.append({"kind": "norm", "frame": _norm_frame(rng)})
    for _ in range(N_PACK_NORM):
        c = _pack_case(rng, clean=rng.random() < 0.7)
        cases.append({"kind": "pack_norm", **c})
    hyp = [_hypot_pair(rng) for _ in range(N_HYPOT)]
    return cases, hyp


# ------------------------------------------------------------------- python side
def _strip_missing(obj):
    """What the JS side sees after JSON: MISSING keys are simply absent."""
    if isinstance(obj, dict):
        return {k: _strip_missing(v) for k, v in obj.items() if v is not MISSING}
    if isinstance(obj, list):
        return [_strip_missing(v) for v in obj]
    return obj


def _python_result(case):
    c = _strip_missing(case)
    if c["kind"] == "pack":
        return F.pack_frame(c["pose"], c["hands"], c["mirrored"])
    if c["kind"] == "norm":
        return F.body_normalise(np.array(c["frame"], dtype=np.float32))
    return F.body_normalise(F.pack_frame(c["pose"], c["hands"], c["mirrored"]))


def _same_bits(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    eq = a.view(np.uint32) == b.view(np.uint32)
    return eq | (np.isnan(a) & np.isnan(b))


# ----------------------------------------------------------------------- tests
@pytest.fixture(scope="module")
def js_run():
    node = shutil.which("node")
    if node is None:
        pytest.fail("node is not on PATH: the parity test is mandatory, not optional")
    cases, hyp = _build_cases()
    payload = json.dumps({"cases": _enc(cases), "hypot": _enc(hyp)})
    proc = subprocess.run([node, str(HERE / "run_js.mjs")], input=payload,
                          capture_output=True, text=True, encoding="utf-8", timeout=300)
    if proc.returncode != 0:
        pytest.fail(f"node harness failed:\n{proc.stderr}")
    return cases, hyp, json.loads(proc.stdout)


def test_constants_match(js_run):
    _, _, out = js_run
    assert out["constants"] == {
        "FEATURE_DIM": F.FEATURE_DIM, "POSE_COUNT": F.POSE_COUNT,
        "HAND_COUNT": F.HAND_COUNT, "LEFT_HAND_START": F.LEFT_HAND_START,
        "RIGHT_HAND_START": F.RIGHT_HAND_START,
    }


def test_hypot_matches_v8(js_run):
    _, hyp, out = js_run
    bad = []
    for (a, b), enc in zip(hyp, out["hypot"]):
        js = np.frombuffer(base64.b64decode(enc), dtype="<f8")[0]
        py = F._v8_hypot(a, b)
        if not (np.float64(py).view(np.uint64) == js.view(np.uint64)
                or (math.isnan(py) and math.isnan(js))):
            bad.append((a, b, py, float(js)))
    assert not bad, f"{len(bad)} hypot mismatches, first: {bad[:3]}"


@pytest.mark.parametrize("kind", ["pack", "norm", "pack_norm"])
def test_exact_float32_parity(js_run, kind):
    cases, _, out = js_run
    checked, failures = 0, []
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)   # float32 overflow cases
        for i, (case, enc) in enumerate(zip(cases, out["results"])):
            if case["kind"] != kind:
                continue
            js = np.frombuffer(base64.b64decode(enc), dtype="<f4")
            py = _python_result(case)
            assert js.shape == py.shape == (F.FEATURE_DIM,)
            same = _same_bits(py, js)
            if not same.all():
                j = int(np.argmin(same))
                failures.append(f"case {i} slot {j}: py={py[j]!r} js={js[j]!r}")
            checked += 1
    assert checked > 0
    assert not failures, f"{len(failures)}/{checked} {kind} cases differ:\n" + \
        "\n".join(failures[:10])


def test_mirrored_swap_semantics():
    """Documented behaviour, independent of node: mirrored swaps the labels."""
    hand = [{"x": 0.1 * (j + 1), "y": 0.2, "z": 0.0} for j in range(21)]
    plain = F.pack_frame(None, [{"landmarks": hand, "handedness": "Left"}], mirrored=False)
    swapped = F.pack_frame(None, [{"landmarks": hand, "handedness": "Left"}], mirrored=True)
    assert plain[F.LEFT_HAND_START] != 0 and not plain[F.RIGHT_HAND_START:].any()
    assert swapped[F.RIGHT_HAND_START] != 0 and not swapped[F.LEFT_HAND_START:F.RIGHT_HAND_START].any()
