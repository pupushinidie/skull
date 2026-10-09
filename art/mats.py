"""垫板：选中一块红色（座位 0）的空白面和花面，按座位换皮革色、缝线色，加左下角的座位小角标。

recolor(mat, seat, stitch_mask)  只换皮革（按亮度映射到座位皮革三档色），缝线换成座位亮色，金线和玫瑰不动
BADGES[seat]  左下角 7×8 以内的金线小图案（色盲辅助）：0 爪印、1 羽毛、2 睡莲叶、3 星星、4 月牙、5 橡果
"""
from __future__ import annotations

import colorsys

from PIL import Image

from pix import SEATS, ascii_img, mix, rgba

GOLD = {"g": "#e8b661", "d": "#9a6a24", "h": "#fbe3a0"}

BADGES = [
    [  # 0 狐狸爪印
        ".g.g.g.",
        ".g.g.g.",
        ".......",
        "..hgg..",
        ".hgggg.",
        ".ggggd.",
        "..g.d..",
    ],
    [  # 1 羽毛
        ".....hg",
        "....hgg",
        "...hggd",
        "..hggd.",
        ".hggd..",
        ".gdd...",
        "g......",
    ],
    [  # 2 睡莲叶（上面缺一个口）
        ".hg.gg.",
        "hgg.ggg",
        "ggggggg",
        "ggggggd",
        "gggggdd",
        ".ggddd.",
    ],
    [  # 3 星星
        "...h...",
        "...g...",
        "hgggggd",
        ".hgggd.",
        "..ggd..",
        ".gd.gd.",
        "gd...dd",
    ],
    [  # 4 月牙
        "..hggg.",
        ".hgg...",
        "hgg....",
        "ggg....",
        "ggd....",
        ".gdd...",
        "..dddd.",
    ],
    [  # 5 橡果
        "...d...",
        ".hgggg.",
        "hggggggd",
        ".ddddddd",
        ".hgggd.",
        ".ggggd.",
        "..ggd..",
        "...d...",
    ],
]


def badge(seat: int) -> Image.Image:
    return ascii_img(BADGES[seat], GOLD)


def _hsv(c):
    return colorsys.rgb_to_hsv(c[0] / 255, c[1] / 255, c[2] / 255)


def is_leather(c) -> bool:
    h, s, v = _hsv(c)
    hue = h * 360
    return (hue >= 340 or hue <= 28) and s >= 0.35 and 0.12 <= v <= 0.75


def recolor(mat: Image.Image, seat: int, stitch: set[tuple[int, int]] | None = None,
            protect: set[tuple[int, int]] | None = None) -> Image.Image:
    """皮革按亮度映射到座位的 暗→主→亮；stitch 里的像素换成座位亮色；protect 里的像素不动。"""
    _, hexc, leather = SEATS[seat]
    dark, main, light = (rgba(c) for c in leather)
    out = mat.copy()
    px = out.load()
    src = mat.load()
    w, h = mat.size
    vals = [(_hsv(src[x, y])[2]) for y in range(h) for x in range(w) if src[x, y][3] and is_leather(src[x, y])]
    if not vals:
        return out
    vals.sort()
    lo, mid, hi = vals[len(vals) // 10], vals[len(vals) // 2], vals[len(vals) * 9 // 10]
    deep = mix(dark, rgba("ink"), 0.5)
    hilite = mix(light, rgba(hexc), 0.25)
    for y in range(h):
        for x in range(w):
            c = src[x, y]
            if not c[3] or (protect and (x, y) in protect):
                continue
            if stitch and (x, y) in stitch:
                v = _hsv(c)[2]
                px[x, y] = rgba(hexc) if v > 0.55 else mix(rgba(hexc), dark, 0.45)
                continue
            if not is_leather(c):
                continue
            v = _hsv(c)[2]
            if v <= lo:
                t = max(0.0, (v - vals[0]) / max(1e-6, lo - vals[0]))
                px[x, y] = mix(deep, dark, t)
            elif v <= mid:
                px[x, y] = mix(dark, main, (v - lo) / max(1e-6, mid - lo))
            elif v <= hi:
                px[x, y] = mix(main, light, (v - mid) / max(1e-6, hi - mid))
            else:
                px[x, y] = mix(light, hilite, min(1.0, (v - hi) / max(1e-6, vals[-1] - hi)))
    return out


def add_badge(mat: Image.Image, seat: int, x: int = 3, y: int | None = None) -> Image.Image:
    b = badge(seat)
    out = mat.copy()
    if y is None:
        y = mat.height - 4 - b.height
    out.alpha_composite(b, (x, y))
    return out
