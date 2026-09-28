"""Exact Python ports of packFrame and bodyNormalise from
src/services/signRecognizer.js.

"Exact" means bit-identical float32 output for the same input, which
tests/parity checks against the real JS under node. Two details make that
hold:

* JS does its arithmetic in float64 and rounds once, when the value is stored
  into a Float32Array. Here, too, everything is computed in float64 (Python
  floats / numpy float64) and cast to float32 only on store.
* Math.hypot in V8 is NOT sqrt(dx*dx + dy*dy) and not Python's math.hypot:
  it scales by the largest magnitude and uses Kahan summation. `_v8_hypot`
  reproduces it, because a 1-ulp difference in the shoulder span can flip the
  last bit of every normalised coordinate.

The constants and layout must stay in lock-step with signRecognizer.js and
public/models/vocab.json.
"""

from __future__ import annotations

import math
from typing import Any, Iterable, Optional

import numpy as np

FEATURE_DIM = 225
POSE_COUNT = 33
HAND_COUNT = 21
POSE_START = 0
LEFT_HAND_START = 99
RIGHT_HAND_START = 162

L_SHOULDER = 11
R_SHOULDER = 12


def _get(obj: Any, key: str) -> Any:
    """`obj.key` for MediaPipe landmark objects, `obj[key]` for dicts.

    A missing field is None, which, like JS `undefined`, is not finite.
    """
    if isinstance(obj, dict):
        return obj.get(key)
    return getattr(obj, key, None)


def _finite_or_zero(v: Any) -> float:
    """JS `Number.isFinite(v) ? v : 0`.

    Number.isFinite is false for anything that is not a number, including
    booleans and numeric strings, so those become 0 as well.
    """
    if isinstance(v, bool) or not isinstance(v, (int, float, np.floating, np.integer)):
        return 0.0
    v = float(v)
    return v if math.isfinite(v) else 0.0


def pack_frame(pose_landmarks: Optional[Iterable[Any]],
               hand_sets: Optional[Iterable[Any]],
               mirrored: bool = False) -> np.ndarray:
    """Port of packFrame(poseLandmarks, handSets, mirrored).

    pose_landmarks: sequence of {x,y,z} (33) or None.
    hand_sets:      sequence of {"landmarks": [...], "handedness": "Left"|"Right"}
                    (dicts or objects with those attributes).
    mirrored:       swaps MediaPipe's Left/Right labels, exactly as the app does.

    An untracked hand leaves its 63 slots at exactly 0.0.
    """
    v = np.zeros(FEATURE_DIM, dtype=np.float32)

    if pose_landmarks is not None:
        pose = list(pose_landmarks)
        n = min(POSE_COUNT, len(pose))
        for i in range(n):
            lm = pose[i]
            o = POSE_START + i * 3
            v[o] = _finite_or_zero(_get(lm, "x"))
            v[o + 1] = _finite_or_zero(_get(lm, "y"))
            v[o + 2] = _finite_or_zero(_get(lm, "z"))

    for hand in (hand_sets or []):
        label = _get(hand, "handedness")
        if not label:
            continue
        low = str(label).lower()
        if low == "left":
            is_left = not mirrored
        elif low == "right":
            is_left = mirrored
        else:
            continue

        start = LEFT_HAND_START if is_left else RIGHT_HAND_START
        points = list(_get(hand, "landmarks") or [])
        n = min(HAND_COUNT, len(points))
        for j in range(n):
            lm = points[j]
            o = start + j * 3
            v[o] = _finite_or_zero(_get(lm, "x"))
            v[o + 1] = _finite_or_zero(_get(lm, "y"))
            v[o + 2] = _finite_or_zero(_get(lm, "z"))

    return v


def _v8_hypot(*values: float) -> float:
    """V8's Math.hypot (src/builtins/math.tq), operation for operation."""
    abs_values = []
    max_v = 0.0
    one_arg_is_nan = False
    for x in values:
        a = abs(float(x))
        if math.isnan(a):
            one_arg_is_nan = True
        elif a > max_v:
            max_v = a
        abs_values.append(a)
    if max_v == math.inf:
        return math.inf
    if one_arg_is_nan:
        return math.nan
    if max_v == 0.0:
        return 0.0

    # Kahan summation of (|x| / max)^2.
    total = 0.0
    compensation = 0.0
    for a in abs_values:
        n = a / max_v
        summand = n * n - compensation
        preliminary = total + summand
        compensation = (preliminary - total) - summand
        total = preliminary
    return math.sqrt(total) * max_v


def body_normalise(frame: np.ndarray) -> np.ndarray:
    """Port of bodyNormalise(frame).

    - centre = midpoint of pose landmarks 11 and 12, applied to x, y AND z
    - scale  = 2-D shoulder span (V8 Math.hypot of dx, dy)
    - a landmark at exactly (0,0,0) is missing and stays zero
    - a frame whose span is <= 1e-6 (or NaN) becomes entirely zero
    """
    f = np.asarray(frame, dtype=np.float32)
    if f.shape != (FEATURE_DIM,):
        raise ValueError(f"expected ({FEATURE_DIM},), got {f.shape}")
    out = np.zeros(FEATURE_DIM, dtype=np.float32)

    d = f.astype(np.float64)                 # JS reads Float32Array as double
    l, r = L_SHOULDER * 3, R_SHOULDER * 3

    span = _v8_hypot(d[l] - d[r], d[l + 1] - d[r + 1])
    if not (span > 1e-6):
        return out

    cx = (d[l] + d[r]) / 2
    cy = (d[l + 1] + d[r + 1]) / 2
    cz = (d[l + 2] + d[r + 2]) / 2

    xyz = d.reshape(-1, 3)
    present = ~((xyz[:, 0] == 0) & (xyz[:, 1] == 0) & (xyz[:, 2] == 0))
    centred = (xyz - np.array([cx, cy, cz])) / span     # float64, as in JS
    res = out.reshape(-1, 3)
    res[present] = centred[present].astype(np.float32)  # one rounding, on store
    return out


def pack_and_normalise_sequence(frames_raw: np.ndarray) -> np.ndarray:
    """(T, 225) raw packed frames -> (T, 225) float32 body-normalised."""
    raw = np.asarray(frames_raw, dtype=np.float32)
    return np.stack([body_normalise(row) for row in raw]) if len(raw) else \
        np.zeros((0, FEATURE_DIM), np.float32)
