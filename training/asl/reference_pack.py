"""Independent reference for the 543-landmark input layout.

Written from the Kaggle ISLR data spec, not from the app's JS: each frame is
the rows of a parquet file sorted by (type, landmark_index) with types in the
order face (468), left_hand (21), pose (33), right_hand (21), and NaN for any
part not detected. Hands are assigned to the SIGNER's left/right; the app's
MediaPipe Tasks labels are swapped when the frame is mirrored.

Reads fixture frames (JSON on stdin), writes the packed arrays (JSON on stdout,
NaN encoded as null) so scripts/test-asl.mjs can compare with the JS packer.
"""

import json
import math
import sys

TYPES = [("face", 468), ("left_hand", 21), ("pose", 33), ("right_hand", 21)]


def signer_side(label, mirrored):
    label = str(label or "").lower()
    if label == "left":
        return "right_hand" if mirrored else "left_hand"
    if label == "right":
        return "left_hand" if mirrored else "right_hand"
    return None


def pack(frame):
    parts = {"face": frame.get("face"), "pose": frame.get("pose")}
    for hand in frame.get("hands") or []:
        side = signer_side(hand.get("handedness"), frame.get("mirrored", False))
        if side:                     # a later hand on the same side wins, as in packFrame
            parts[side] = hand.get("landmarks")
    rows = []
    for name, count in TYPES:
        pts = parts.get(name)
        for i in range(count):
            p = pts[i] if pts is not None and i < len(pts) else None
            for k in ("x", "y", "z"):
                v = None if p is None else p.get(k)
                rows.append(v if isinstance(v, (int, float)) and math.isfinite(v) else None)
    return rows


if __name__ == "__main__":
    frames = json.load(sys.stdin)
    json.dump([pack(f) for f in frames], sys.stdout)
