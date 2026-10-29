#!/usr/bin/env python3
"""
Draw the app icons (a bell curve on multising's dark background) into
public/icons/. Needs numpy, so run it with the fixtures venv:

    .venv/bin/python -I tools/make_icons.py
"""

import struct
import zlib
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "icons"

BG = np.array([0x11, 0x15, 0x1A]) / 255
ACCENT = np.array([0xFF, 0xD2, 0x7A]) / 255
SUPERSAMPLE = 4


def curve(x):
    """The bell, as a height in [0, 1] over x in [0, 1]."""
    return np.exp(-((x - 0.5) / 0.2) ** 2)


def draw(size, *, rounded, inset):
    """RGBA float image. inset: fraction of the canvas the curve may use."""
    n = size * SUPERSAMPLE
    ys, xs = (np.mgrid[0:n, 0:n] + 0.5) / n

    if rounded:
        r = 0.22
        cx = np.clip(xs, r, 1 - r)
        cy = np.clip(ys, r, 1 - r)
        inside = (xs - cx) ** 2 + (ys - cy) ** 2 <= r * r
    else:
        inside = np.ones_like(xs, dtype=bool)

    left, right = 0.5 - inset / 2, 0.5 + inset / 2
    base, height = 0.5 + inset * 0.28, inset * 0.56
    u = (xs - left) / (right - left)
    within = (u >= 0) & (u <= 1)
    fy = base - height * curve(u)
    slope = np.gradient(fy, axis=1) * n
    dist = np.abs(ys - fy) / np.sqrt(1 + slope**2)

    half = inset * 0.032
    # Round caps: anything within half a stroke of either end of the curve.
    caps = np.minimum((xs - left) ** 2, (xs - right) ** 2) + (ys - base) ** 2 <= half * half
    stroke = (within & (dist <= half)) | caps
    under = within & (ys > fy) & (ys <= base)

    rgb = np.broadcast_to(BG, (n, n, 3)).copy()
    rgb[under] = BG * 0.65 + ACCENT * 0.35
    rgb[stroke] = ACCENT
    alpha = inside.astype(float)

    # Average each SUPERSAMPLE x SUPERSAMPLE block (premultiplied, so the
    # rounded corners antialias cleanly).
    pre = np.dstack([rgb * alpha[..., None], alpha])
    pre = pre.reshape(size, SUPERSAMPLE, size, SUPERSAMPLE, 4).mean(axis=(1, 3))
    a = pre[..., 3:4]
    out = np.where(a > 0, pre[..., :3] / np.maximum(a, 1e-9), 0)
    return np.dstack([out, a])


def write_png(path, img):
    data = (np.clip(img, 0, 1) * 255 + 0.5).astype(np.uint8)
    h, w, _ = data.shape
    raw = b"".join(b"\x00" + data[y].tobytes() for y in range(h))

    def chunk(kind, payload):
        body = kind + payload
        return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    path.write_bytes(png)
    print(f"wrote {path.relative_to(ROOT)}")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    write_png(OUT / "icon-192.png", draw(192, rounded=True, inset=0.7))
    write_png(OUT / "icon-512.png", draw(512, rounded=True, inset=0.7))
    # Maskable: full bleed, art inside the central safe circle.
    write_png(OUT / "maskable-512.png", draw(512, rounded=False, inset=0.55))
    # iOS rounds the corners itself and shows transparency as black.
    write_png(OUT / "apple-touch-icon.png", draw(180, rounded=False, inset=0.66))


if __name__ == "__main__":
    main()
