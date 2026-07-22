#!/usr/bin/env python3
"""Generate Wander PWA icons with no third-party deps (pure-Python PNG writer).

Draws a teal-gradient tile with a white compass rose + red/white needle.
Outputs icon-192.png, icon-512.png, maskable-512.png into public/icons/.
"""
import math
import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "icons")

# brand palette
TEAL = (20, 184, 166)
TEAL_DARK = (15, 118, 110)
NAVY = (11, 17, 32)
RED = (239, 68, 68)
WHITE = (240, 245, 250)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def sign(ax, ay, bx, by, cx, cy):
    return (ax - cx) * (by - cy) - (bx - cx) * (ay - cy)


def in_triangle(px, py, a, b, c):
    d1 = sign(px, py, *a, *b)
    d2 = sign(px, py, *b, *c)
    d3 = sign(px, py, *c, *a)
    has_neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
    has_pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
    return not (has_neg and has_pos)


def draw(size, maskable=False):
    cx = cy = size / 2
    R = size * 0.5
    corner = 0 if maskable else size * 0.22  # rounded corners for standard icon
    inset = size * 0.16 if maskable else 0     # maskable safe zone padding
    ring_r = (R - inset) * 0.62
    needle = (R - inset) * 0.52
    half_w = (R - inset) * 0.12

    n_apex = (cx, cy - needle)
    s_apex = (cx, cy + needle)
    l = (cx - half_w, cy)
    r = (cx + half_w, cy)

    px = bytearray()
    for y in range(size):
        px.append(0)  # PNG filter byte: none
        for x in range(size):
            # rounded-corner alpha mask (standard icon only)
            a = 255
            if corner:
                dx = max(corner - x, x - (size - corner), 0)
                dy = max(corner - y, y - (size - corner), 0)
                if dx and dy and (dx * dx + dy * dy) > corner * corner:
                    a = 0
            # diagonal gradient background
            t = ((x + y) / (2 * size))
            col = lerp(TEAL, TEAL_DARK, t)
            # subtle vignette toward navy at far corner
            col = lerp(col, NAVY, max(0.0, (t - 0.7)) * 0.9)

            dcx, dcy = x - cx, y - cy
            dist = math.hypot(dcx, dcy)
            # compass ring
            if ring_r * 0.86 <= dist <= ring_r:
                col = WHITE
            # needle
            if in_triangle(x, y, n_apex, l, r):
                col = RED
            elif in_triangle(x, y, s_apex, l, r):
                col = WHITE
            # center hub
            if dist <= (R - inset) * 0.055:
                col = NAVY

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
    targets = [
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("maskable-512.png", 512, True),
    ]
    for name, size, maskable in targets:
        data = draw(size, maskable)
        with open(os.path.join(OUT_DIR, name), "wb") as f:
            f.write(data)
        print(f"wrote {name} ({size}x{size}, {len(data)} bytes)")


if __name__ == "__main__":
    main()
