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
        y = mat.height - 22  # 左边、左下角玫瑰的上面（花面四角有玫瑰）
    out.alpha_composite(b, (x, y))
    return out


# ---------------------------------------------------------------- 代码画的垫板（备选 + PixelLab 的 init_image）
import math as _m
import random as _r

from pix import CLEAR as _CLEAR, outline as _outline


def _rr(w, h, r):
    pts = set()
    for y in range(h):
        for x in range(w):
            cx = min(max(x + 0.5, r), w - r)
            cy = min(max(y + 0.5, r), h - r)
            if _m.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r:
                pts.add((x, y))
    return pts


ROSE7 = [
    ".ooo.",
    "oLRDo",
    "oRDRo",
    "oDRDo",
    ".ooo.",
]
ROSE_SM = [
    "..ooo..",
    ".oLLRo.",
    "oLRDDRo",
    "oRDRRDo",
    "oDRRDDo",
    ".oDDDo.",
    "oGoooGo",
    ".oGoGo.",
    "..ooo..",
]
ROSE_LEG = {"o": "#1e0d0b", "L": "#e85a48", "R": "#c8352b", "D": "#8f1f1c", "G": "#4f8a32"}


def code_mat(flower: bool, seat: int = 0, w: int = 56, h: int = 64, seed: int = 3) -> Image.Image:
    """皮垫板：圆角、左上亮右下暗、细微皮纹和划痕、一圈虚线缝线（座位亮色）；花面加金线刺绣边、四角玫瑰、中间暗纹玫瑰。"""
    _, hexc, leather = SEATS[seat]
    dark, main, light = (rgba(c) for c in leather)
    rnd = _r.Random(seed)
    shape = _rr(w, h, 4.5)
    im = Image.new("RGBA", (w, h), _CLEAR)
    px = im.load()
    for (x, y) in shape:
        # 左上亮、右下暗的大渐变 + 皮纹噪点
        t = (x / w + y / h) / 2
        c = mix(light, main, min(1, t * 1.6)) if t < 0.6 else mix(main, dark, (t - 0.6) / 0.4 * 0.7)
        n = rnd.random()
        if n < 0.08:
            c = mix(c, dark, 0.35)
        elif n > 0.95:
            c = mix(c, light, 0.4)
        px[x, y] = c
    # 几道浅浅的折痕
    for _ in range(3):
        x0, y0 = rnd.randint(8, w - 8), rnd.randint(8, h - 8)
        ang = rnd.uniform(0, _m.pi)
        for k in range(rnd.randint(5, 10)):
            x, y = int(x0 + k * _m.cos(ang)), int(y0 + k * _m.sin(ang))
            if (x, y) in shape:
                px[x, y] = mix(px[x, y], dark, 0.45)
                if (x + 1, y) in shape:
                    px[x + 1, y] = mix(px[x + 1, y], light, 0.25)
    # 外沿：描边 + 内侧一圈暗边（厚度感）
    for (x, y) in shape:
        if any((x + a, y + b) not in shape for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            px[x, y] = rgba("ink")
        elif any((x + a, y + b) not in shape for a, b in ((2, 0), (0, 2))):
            px[x, y] = mix(px[x, y], dark, 0.6)
        elif any((x + a, y + b) not in shape for a, b in ((-2, 0), (0, -2))):
            px[x, y] = mix(px[x, y], light, 0.35)
    # 缝线：离边 3px 的一圈虚线
    seam = []
    for x in range(5, w - 5):
        seam += [(x, 3), (x, h - 4)]
    for y in range(5, h - 5):
        seam += [(3, y), (w - 4, y)]
    for (x, y) in seam:
        if (x + y) % 3 != 0:
            px[x, y] = rgba(hexc)
            # 缝线下面一点阴影
            if (x + 1, y + 1) in shape and (x + 1, y + 1) not in seam:
                px[x + 1, y + 1] = mix(px[x + 1, y + 1], dark, 0.5)
    if flower:
        gold, gold_d, gold_h = rgba("#e8b661"), rgba("#9a6a24"), rgba("#fbe3a0")
        # 金线刺绣边：离边 5px 一圈实线 + 每隔 4px 一个小结
        for x in range(7, w - 7):
            for y in (5, h - 6):
                px[x, y] = gold if x % 4 else gold_h
                px[x, y + 1] = gold_d
        for y in range(7, h - 7):
            for x in (5, w - 6):
                px[x, y] = gold if y % 4 else gold_h
                px[x + 1, y] = gold_d
        # 中间暗纹大玫瑰（浮雕：只用皮革的暗、亮）
        cx, cy = w / 2, h / 2
        for y in range(h):
            for x in range(w):
                d = _m.hypot(x + 0.5 - cx, y + 0.5 - cy)
                a = _m.atan2(y + 0.5 - cy, x + 0.5 - cx)
                if d < 12 and (x, y) in shape:
                    # 螺旋花瓣的线
                    if abs(((d - 2.2 * a) % 4.0) - 2) < 0.5 or 11 < d < 12:
                        px[x, y] = mix(px[x, y], dark, 0.55)
                    elif abs(((d - 2.2 * a) % 4.0) - 1) < 0.5:
                        px[x, y] = mix(px[x, y], light, 0.25)
        # 左右两边各一朵小玫瑰（被 5 张垫子盖住中间时也露得出来）
        rose = ascii_img(ROSE_SM, ROSE_LEG)
        for (x, y) in ((1, h // 2 - 4), (w - 8, h // 2 - 4)):
            pass
        corner = ascii_img(ROSE_SM, ROSE_LEG)
        for (x, y) in ((2, 2), (w - 9, 2), (2, h - 11), (w - 9, h - 11)):
            im.alpha_composite(corner, (x, y))
        side = ascii_img(ROSE7, ROSE_LEG)
        for (x, y) in ((3, h // 2 - 2), (w - 8, h // 2 - 2)):
            im.alpha_composite(side, (x, y))
    return im
