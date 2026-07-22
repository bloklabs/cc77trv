#!/usr/bin/env python3
"""Generate Wander PWA icons with no third-party deps (pure-Python PNG writer).

A soft sakura (cherry blossom) on warm washi paper — calm, muted, gentle.
Outputs icon-192.png, icon-512.png, maskable-512.png into public/icons/.
"""
import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "icons")

# soft washi + sakura palette
WASHI_HI = (253, 249, 243)
WASHI_LO = (240, 231, 217)
PETAL = (236, 194, 204)      # soft sakura pink
PETAL_EDGE = (224, 170, 184)  # gentle deeper edge
CENTER = (222, 158, 172)      # blossom heart
STAMEN = (230, 205, 150)      # soft gold
INK = (110, 92, 84)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def draw(size, maskable=False):
    cx = cy = (size - 1) / 2
    R = size / 2
    corner = 0 if maskable else size * 0.22
    inset = size * 0.14 if maskable else 0
    rad = R - inset

    pd = rad * 0.30    # petal-center distance
    pa = rad * 0.36    # petal length (radial)
    pb = rad * 0.21    # petal width (tangential)
    rc = rad * 0.13    # blossom heart radius
    angles = [math.radians(-90 + 72 * k) for k in range(5)]  # 5 petals, first points up

    petals = []
    notches = []
    for a in angles:
        ux, uy = math.cos(a), math.sin(a)
        petals.append((cx + ux * pd, cy + uy * pd, math.cos(a), math.sin(a)))
        notches.append((cx + ux * (pd + pa * 0.80), cy + uy * (pd + pa * 0.80), pb * 0.60))
    stamens = []
    for a in angles:
        aa = a + math.radians(36)
        stamens.append((cx + math.cos(aa) * rc * 1.15, cy + math.sin(aa) * rc * 1.15, rad * 0.028))

    px = bytearray()
    for y in range(size):
        px.append(0)  # PNG filter byte
        for x in range(size):
            # rounded-corner alpha (standard icon only)
            a = 255
            if corner:
                dx = max(corner - x, x - (size - corner), 0)
                dy = max(corner - y, y - (size - corner), 0)
                if dx and dy and (dx * dx + dy * dy) > corner * corner:
                    a = 0
            # washi radial gradient
            dist_c = math.hypot(x - cx, y - cy) / R
            col = lerp(WASHI_HI, WASHI_LO, min(1.0, dist_c))

            # petals (rotated ellipses)
            for (pcx, pcy, ca, sa) in petals:
                ddx, ddy = x - pcx, y - pcy
                xr = ddx * ca + ddy * sa
                yr = -ddx * sa + ddy * ca
                e = (xr / pa) ** 2 + (yr / pb) ** 2
                if e <= 1.0:
                    col = PETAL_EDGE if e > 0.78 else PETAL
                    break
            # notch at each petal tip (carve back to paper)
            for (nx, ny, nr) in notches:
                if (x - nx) ** 2 + (y - ny) ** 2 <= nr * nr:
                    col = lerp(WASHI_HI, WASHI_LO, min(1.0, dist_c))
                    break
            # blossom heart + stamens
            if (x - cx) ** 2 + (y - cy) ** 2 <= rc * rc:
                col = CENTER
            for (sx, sy, sr) in stamens:
                if (x - sx) ** 2 + (y - sy) ** 2 <= sr * sr:
                    col = STAMEN
                    break

            px.extend((col[0], col[1], col[2], a))
    return png_bytes(size, size, bytes(px))


def png_bytes(w, h, raw_rgba):
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)  # 8-bit RGBA
    idat = zlib.compress(raw_rgba, 9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, size, maskable in [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("maskable-512.png", 512, True),
    ]:
        data = draw(size, maskable)
        with open(os.path.join(OUT_DIR, name), "wb") as f:
            f.write(data)
        print(f"wrote {name} ({size}x{size}, {len(data)} bytes)")


if __name__ == "__main__":
    main()
