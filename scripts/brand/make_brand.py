"""Every icon and splash image, generated from the one logo file.

    training\.venv\Scripts\python.exe scripts\brand\make_brand.py
    training\.venv\Scripts\python.exe scripts\brand\make_brand.py --android-res ..\aangika-android\android\app\src\main\res

Source: brand/aangika_logo.png (square, dark background: the "A" with two
hands on top, the AANGIKA wordmark and team line below).

- The MARK (the A with hands) is cut out above the wordmark and used where the
  logo is small: favicon, PWA icons, the in-app brand mark, launcher icons.
  Text would be unreadable at those sizes.
- The FULL logo is used where there is room: the About card and the Android
  splash screen.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[2]
SRC = REPO / "brand" / "aangika_logo.png"
PUBLIC = REPO / "public"


def background(im: Image.Image) -> tuple[int, int, int]:
    """Median colour of the outer border: the logo's backdrop."""
    a = np.asarray(im.convert("RGB"))
    border = np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3), a[:, :8].reshape(-1, 3), a[:, -8:].reshape(-1, 3)])
    return tuple(int(v) for v in np.median(border, axis=0))


def mark_box(im: Image.Image) -> tuple[int, int, int, int]:
    """Bounding box of the mark: bright pixels above the first empty band of rows."""
    a = np.asarray(im.convert("L")).astype(int) > 40
    rows = a.sum(1) > 3
    top = int(np.argmax(rows))
    y = top
    while y < len(rows) and rows[y]:        # the mark ends at the first empty row
        y += 1
    cols = np.where(a[top:y].sum(0) > 3)[0]
    return int(cols.min()), top, int(cols.max()) + 1, y


def square(img: Image.Image, fill: float, bg, size: int) -> Image.Image:
    """`img` centred on a `size` square, its longer side `fill` of the square."""
    scale = size * fill / max(img.size)
    w, h = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    canvas = Image.new("RGB", (size, size), bg)
    canvas.paste(img.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    return canvas


# The backdrop is not pure black: a faint vignette reaches ~27/255 near the
# mark (p99), which otherwise shows as a ghost rectangle on light surfaces.
def unblend(img: Image.Image, floor: int = 30) -> Image.Image:
    """Transparent version of art drawn on black.

    The logo is light on a black backdrop, so each pixel is (colour x alpha)
    over black: alpha = its brightest channel, colour = pixel / alpha. Glows
    keep their soft falloff instead of a hard cut-out edge; the near-black
    noise below `floor` becomes fully transparent.
    """
    a = np.asarray(img.convert("RGB")).astype(np.float32)
    alpha = np.clip((a.max(axis=2) - floor) / (255 - floor), 0, 1)
    rgb = np.where(alpha[..., None] > 0, a / 255 / np.maximum(alpha[..., None], 1e-6), 0)
    out = np.dstack([np.clip(rgb, 0, 1) * 255, alpha * 255]).round().astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def square_rgba(img: Image.Image, fill: float, size: int) -> Image.Image:
    """Like square(), on a transparent canvas."""
    scale = size * fill / max(img.size)
    w, h = max(1, round(img.width * scale)), max(1, round(img.height * scale))
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(img.resize((w, h), Image.LANCZOS), ((size - w) // 2, (size - h) // 2))
    return canvas


def rounded(img: Image.Image, radius: float) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, img.width - 1, img.height - 1), radius=radius * img.width, fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def circle(img: Image.Image) -> Image.Image:
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, img.width - 1, img.height - 1), fill=255)
    out = img.convert("RGBA")
    out.putalpha(mask)
    return out


def save(img: Image.Image, path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, optimize=True)
    print(f"  {path.relative_to(path.parents[2]) if len(path.parents) > 2 else path}  {img.size[0]}x{img.size[1]}")


def web(logo, mark, bg):
    print("[web] public/")
    clear = unblend(mark)
    # Home-screen icons stay on the logo's dark backdrop: launchers put
    # transparent icons on white or grey plates, which washes the glow out.
    save(square(mark, 0.84, bg, 512), PUBLIC / "icon-512.png")
    save(square(mark, 0.84, bg, 192), PUBLIC / "icon-192.png")
    # Maskable: launchers crop to a circle or squircle; keep the mark in the 80% safe zone.
    save(square(mark, 0.66, bg, 512), PUBLIC / "icon-maskable-512.png")
    save(square(mark, 0.84, bg, 180), PUBLIC / "apple-touch-icon.png")
    # Transparent: browser tab and the in-app mark sit on any theme.
    save(square_rgba(clear, 0.96, 64), PUBLIC / "favicon.png")
    save(square_rgba(clear, 0.96, 256), PUBLIC / "brand" / "mark-256.png")
    # Full-size transparent mark for slides and documents (not shipped in the app).
    save(clear, REPO / "brand" / "aangika_mark_transparent.png")
    # The full logo is opaque and photographic (glows): JPEG is a fraction of the PNG.
    full = logo.resize((720, 720), Image.LANCZOS)
    path = PUBLIC / "brand" / "logo-720.jpg"
    full.save(path, quality=86, optimize=True, progressive=True)
    print(f"  {path.name}  720x720  {path.stat().st_size // 1024} KB")


def android(res: Path, logo, mark, bg):
    print(f"[android] {res}")
    legacy = {"ldpi": 36, "mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
    for d, px in legacy.items():
        icon = square(mark, 0.8, bg, px)
        save(rounded(icon, 0.18), res / f"mipmap-{d}" / "ic_launcher.png")
        save(circle(icon), res / f"mipmap-{d}" / "ic_launcher_round.png")
    # Adaptive icon foreground: 108 dp canvas, only the central 66 dp is always
    # visible. Transparent, as Android expects, over the backdrop colour below.
    clear = unblend(mark)
    for d, dp1 in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
        save(square_rgba(clear, 0.58, round(108 * dp1)), res / f"mipmap-{d}" / "ic_launcher_foreground.png")
    hexbg = "#{:02X}{:02X}{:02X}".format(*bg)
    (res / "values" / "ic_launcher_background.xml").write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
        f'    <color name="ic_launcher_background">{hexbg}</color>\n</resources>\n', encoding="utf-8")
    print(f"  values/ic_launcher_background.xml  {hexbg}")
    # Splash: the full logo, centred, on the logo's own background.
    for p in sorted(res.glob("drawable*/splash.png")):
        w, h = Image.open(p).size
        side = round(min(w, h) * 0.72)
        canvas = Image.new("RGB", (w, h), bg)
        canvas.paste(logo.resize((side, side), Image.LANCZOS), ((w - side) // 2, (h - side) // 2))
        save(canvas, p)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, default=SRC)
    ap.add_argument("--android-res", type=Path, default=None)
    ap.add_argument("--skip-web", action="store_true")
    args = ap.parse_args()

    logo = Image.open(args.src).convert("RGB")
    bg = background(logo)
    box = mark_box(logo)
    pad = round(0.02 * logo.width)
    mark = logo.crop((box[0] - pad, box[1] - pad, box[2] + pad, box[3] + pad))
    print(f"[brand] {args.src.name} {logo.size}, background {bg}, mark box {box}")
    if not args.skip_web:
        web(logo, mark, bg)
    if args.android_res:
        android(args.android_res, logo, mark, bg)


if __name__ == "__main__":
    main()
