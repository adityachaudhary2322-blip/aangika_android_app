"""Build a CLEAN test set: iSign clips the current tagger never saw.

isign_ctc_dataset.h5 (which the old tagger was trained on) is missing ~4k of
iSign's 127,237 clips: the Kaggle build dropped them (network errors, 3,727)
or never matched them. Those clips exist in the raw pose archive on the
user's Drive. Scoring old and new models on them is the only comparison here
that memorisation cannot inflate.

Read-only: members are read out of the byte-split zip in place, nothing on
the Drive is written. Coordinates are processed exactly like the .h5 build
(Kaggle notebook Cell 2): conf == 0 -> 0.0, x/w, y/h, z/w, leading/trailing
frames without pose trimmed. Unlike the .h5, frames are kept at their NATIVE
rate with the clip's fps, so the live regime can be reproduced exactly.

    python training/extract_clean.py --n 1000
    python training/extract_clean.py --verify 20     # parser vs stored .h5 rows
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import struct
import time
import zipfile
from pathlib import Path

import numpy as np

import data as D
from evaluate import uniform_idx

ARCHIVE_DIR = Path(r"G:\My Drive\isl_dataset")
OUT = D.TRAINING / "data" / "clean"
PARTS = [f"iSign-poses_v1.1_part_{s}" for s in ("aa", "ab", "ac", "ad")]


class Concat(io.RawIOBase):
    """Read-only view of the byte-split zip as one seekable file."""

    def __init__(self, paths):
        self.fs = [open(p, "rb") for p in paths]
        self.sz = [os.path.getsize(p) for p in paths]
        self.off = [sum(self.sz[:i]) for i in range(len(paths))]
        self.size = sum(self.sz)
        self.pos = 0

    def readable(self): return True
    def seekable(self): return True
    def tell(self): return self.pos

    def seek(self, o, whence=0):
        self.pos = o if whence == 0 else self.pos + o if whence == 1 else self.size + o
        return self.pos

    def readinto(self, b):
        n, out = len(b), 0
        while out < n and self.pos < self.size:
            i = max(k for k in range(len(self.off)) if self.off[k] <= self.pos)
            f = self.fs[i]
            f.seek(self.pos - self.off[i])
            chunk = f.read(min(n - out, self.sz[i] - (self.pos - self.off[i])))
            if not chunk:
                break
            b[out:out + len(chunk)] = chunk
            out += len(chunk)
            self.pos += len(chunk)
        return out


def parse_pose(blob: bytes):
    """pose-format v0.1 -> (data [T, P, 3] float32 with conf==0 zeroed,
    components [(name, n_points)], width, height, fps)."""
    mv = memoryview(blob)
    off = 4                                            # version float
    w, h, _d = struct.unpack_from("<HHH", mv, off); off += 6
    nc = struct.unpack_from("<H", mv, off)[0]; off += 2
    comps, total, dims = [], 0, 0

    def s():
        nonlocal off
        ln = struct.unpack_from("<H", mv, off)[0]; off += 2
        v = bytes(mv[off:off + ln]).decode("utf-8", "replace"); off += ln
        return v

    for _ in range(nc):
        name, fmt = s(), s()
        npts, nl, ncol = struct.unpack_from("<HHH", mv, off); off += 6
        for _ in range(npts):
            s()
        off += nl * 4 + ncol * 6
        comps.append((name, npts))
        total += npts
        dims = max(dims, len(fmt) - 1)
    fps, frames, people = struct.unpack_from("<HHH", mv, off); off += 6
    need = frames * people * total * (dims + 1) * 4
    if len(blob) - off != need:
        raise ValueError(f"unexpected body size ({len(blob) - off} != {need})")
    nd = frames * people * total * dims
    data = np.frombuffer(blob, np.float32, nd, off).reshape(frames, people, total, dims)[:, 0]
    conf = np.frombuffer(blob, np.float32, frames * people * total, off + nd * 4)
    conf = conf.reshape(frames, people, total)[:, 0]
    data = np.where(conf[..., None] > 0, data, 0.0).astype(np.float32)[..., :3]
    return data, comps, float(w), float(h), float(fps)


def packed_frames(blob: bytes):
    """-> (raw packed [T, 225] float32, fps), processed like the .h5 build."""
    data, comps, w, h, fps = parse_pose(blob)
    slots, acc = {}, 0
    for name, n in comps:
        slots[name.upper()] = (acc, acc + n)
        acc += n
    T = len(data)
    out = np.zeros((T, 225), np.float32)
    for name, lo in (("POSE_LANDMARKS", 0), ("LEFT_HAND_LANDMARKS", 99),
                     ("RIGHT_HAND_LANDMARKS", 162)):
        a, b = slots[name]
        out[:, lo:lo + (b - a) * 3] = data[:, a:b].reshape(T, -1)
    if w > 1 and h > 1:
        out *= np.tile(np.array([1 / w, 1 / h, 1 / w], np.float32), 75)
    np.nan_to_num(out, copy=False, nan=0.0, posinf=0.0, neginf=0.0)
    active = np.abs(out[:, :99]).sum(1) > 0
    if active.any():
        lo = int(np.argmax(active))
        hi = int(len(active) - np.argmax(active[::-1]))
        out = out[lo:hi]
    return out, fps


def open_archive():
    reader = io.BufferedReader(Concat([ARCHIVE_DIR / p for p in PARTS]), 1 << 20)
    zf = zipfile.ZipFile(reader)
    by_stem = {Path(i.filename).stem: i for i in zf.infolist() if not i.is_dir()}
    return zf, by_stem


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=1000)
    ap.add_argument("--verify", type=int, default=0,
                    help="instead: check the parser against N clips stored in the .h5")
    ap.add_argument("--seed", type=int, default=20260928)
    args = ap.parse_args()

    names, texts_h5, _ = D.h5_meta(D.H5_DEFAULT)
    h5_stems = [Path(n).stem for n in names]
    t0 = time.time()
    zf, by_stem = open_archive()
    print(f"[archive] {len(by_stem)} members indexed in {time.time() - t0:.1f}s")

    if args.verify:
        import h5py
        rng = np.random.default_rng(1)
        rows = sorted(rng.choice(len(names), args.verify, replace=False).tolist())
        worst = 0.0
        with h5py.File(D.H5_DEFAULT, "r") as h:
            for r in rows:
                raw, _ = packed_frames(zf.read(by_stem[h5_stems[r]]))
                mine = raw[uniform_idx(len(raw), 192)].astype(np.float16).astype(np.float32)
                stored = h["features"][r].astype(np.float32)
                worst = max(worst, float(np.abs(mine - stored).max()))
        print(f"[verify] {len(rows)} clips: max |parser - stored .h5| = {worst:.2e} "
              f"({'MATCH' if worst < 2e-3 else 'MISMATCH'})")
        return

    with open(ARCHIVE_DIR / "iSign_v1.1.csv", encoding="utf-8") as fh:
        text_of = {r["uid"]: r["text"] for r in csv.DictReader(fh)}
    seen = set(h5_stems)
    clean = sorted(u for u in text_of if u not in seen and u in by_stem)
    print(f"[clean] {len(clean)} iSign clips are absent from the .h5 (never seen by the old tagger)")
    rng = np.random.default_rng(args.seed)
    pick = sorted(rng.choice(len(clean), min(args.n, len(clean)), replace=False).tolist())
    uids = [clean[i] for i in pick]

    OUT.mkdir(parents=True, exist_ok=True)
    frames, offsets, fps_list, kept, texts, errors = [], [0], [], [], [], []
    for k, uid in enumerate(uids, 1):
        try:
            raw, fps = packed_frames(zf.read(by_stem[uid]))
            if len(raw) < 8:
                raise ValueError(f"only {len(raw)} tracked frames")
            frames.append(raw.astype(np.float16))
            offsets.append(offsets[-1] + len(raw))
            fps_list.append(fps)
            kept.append(uid)
            texts.append(text_of[uid])
        except Exception as exc:                               # noqa: BLE001
            errors.append((uid, f"{type(exc).__name__}: {exc}"))
        if k % 50 == 0 or k == len(uids):
            el = time.time() - t0
            print(f"[clean] {k}/{len(uids)} | kept {len(kept)} | errors {len(errors)} | "
                  f"{el:.0f}s, eta {el / k * (len(uids) - k):.0f}s", flush=True)

    path = OUT / f"clean_{len(kept)}.npz"
    np.savez_compressed(path, frames=np.concatenate(frames), offsets=np.array(offsets),
                        fps=np.array(fps_list, np.float32), uids=np.array(kept),
                        texts=np.array(texts, dtype=object))
    (OUT / "errors.json").write_text(json.dumps(errors, indent=1), encoding="utf-8")
    print(f"[clean] wrote {path} ({len(kept)} clips, {len(errors)} errors)")


if __name__ == "__main__":
    main()
