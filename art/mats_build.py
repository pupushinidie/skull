"""垫板定稿候选：PixelLab（代码底图当 init_image）出的红色空白面 + 花面 → 套圆角和描边 → 按 6 个座位换皮革和缝线色 → 左侧加座位小角标。

PAIRS 里每一组是一个候选（同一个种子的空白面和花面），整套 12 张作为画廊里的一个选项。
用法：python art/mats_build.py → out/mats/pair-<名>/mat-<座位>-<blank|flower>.png 和总览 out/review/mats-pairs.png
"""
from __future__ import annotations

import colorsys
import math

from PIL import Image

import mats
from pix import CLEAR, OUT, SEATS, mix, rgba

R1 = OUT / "r1" / "pixflux"
W, H = 56, 64
SHAPE = {(x, y) for y in range(H) for x in range(W)
         if Image.open(OUT / "mats" / "code-blank-0.png").convert("RGBA").getpixel((x, y))[3]}

PAIRS = {
    "s521": ("mat-blank-i-s521", "mat-flower-i-s521"),
    "s522": ("mat-blank-i-s522", "mat-flower-i-s522"),
    "s523": ("mat-blank-i-s523", "mat-flower-i-s523"),
}

# 花面上不能被换色的地方：四角玫瑰（代码底图的位置 (2,2) 等 7×9）、左右小玫瑰（5×5），各放宽 1px
PROTECT = set()
for (x0, y0, w, h) in ((2, 2, 7, 9), (W - 9, 2, 7, 9), (2, H - 11, 7, 9), (W - 9, H - 11, 7, 9),
                       (3, H // 2 - 2, 5, 5), (W - 8, H // 2 - 2, 5, 5)):
    for y in range(y0 - 1, y0 + h + 1):
        for x in range(x0 - 1, x0 + w + 1):
            PROTECT.add((x, y))


def hsv(c):
    h, s, v = colorsys.rgb_to_hsv(c[0] / 255, c[1] / 255, c[2] / 255)
    return h * 360, s, v


def shape_it(im: Image.Image) -> Image.Image:
    """套代码底图的圆角外形：外面透明，最外一圈换成描边色。"""
    out = im.convert("RGBA").copy()
    px = out.load()
    for y in range(H):
        for x in range(W):
            if (x, y) not in SHAPE:
                px[x, y] = CLEAR
            elif any((x + a, y + b) not in SHAPE for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                px[x, y] = rgba("ink")
            else:
                c = px[x, y]
                px[x, y] = (c[0], c[1], c[2], 255)
    return out


def stitch_mask(im: Image.Image, flower: bool) -> set:
    px = im.load()
    out = set()
    for (x, y) in SHAPE:
        edge = min(x, y, W - 1 - x, H - 1 - y)
        if not 2 <= edge <= 4:
            continue
        if flower and (x, y) in PROTECT:
            continue
        hue, s, v = hsv(px[x, y])
        if v > 0.62 and s > 0.45 and (hue < 25 or hue > 340):
            out.add((x, y))
    return out


def protect_mask(im: Image.Image) -> set:
    """四角、左右小玫瑰的方框里，只保护玫瑰本身（玫瑰红、叶子绿、玫瑰的深色描边），周围的皮革照样换色。"""
    px = im.load()
    out = set()
    for (x, y) in PROTECT:
        if (x, y) not in SHAPE:
            continue
        hue, s, v = hsv(px[x, y])
        rose = (hue > 340 or hue < 9) and s > 0.55 and v > 0.3
        leaf = 60 < hue < 170 and s > 0.3
        if rose or leaf or v < 0.2:
            out.add((x, y))
    return out


def build(pair: str) -> dict[str, Image.Image]:
    b_name, f_name = PAIRS[pair]
    res = {}
    for kind, name in (("blank", b_name), ("flower", f_name)):
        base = shape_it(Image.open(R1 / f"{name}.png"))
        st = stitch_mask(base, kind == "flower")
        prot = protect_mask(base) if kind == "flower" else None
        for seat in range(6):
            # 红座位也走一遍：缝线换成座位亮色，和别的座位同一种画法
            im = mats.recolor(base, seat, st, prot)
            im = mats.add_badge(im, seat, x=3, y=H - 22)
            res[f"mat-{seat}-{kind}"] = im
    return res


def sheet(sets: dict[str, dict[str, Image.Image]]) -> Image.Image:
    """每组两行（空白、花面）× 6 座位，3× 放大，左半夜间底、右边加一份白天底的 1×/2×。"""
    k = 3
    cell = (W * k + 8, H * k + 8)
    rows = len(sets) * 2
    out = Image.new("RGBA", (cell[0] * 6 + 260, cell[1] * rows), rgba("#2b140d"))
    day = rgba("#f3e7cf")
    for r, (name, s) in enumerate(sets.items()):
        for j, kind in enumerate(("blank", "flower")):
            y = (r * 2 + j) * cell[1]
            for seat in range(6):
                im = s[f"mat-{seat}-{kind}"]
                out.alpha_composite(im.resize((W * k, H * k), Image.NEAREST), (seat * cell[0] + 4, y + 4))
            x0 = cell[0] * 6
            for yy in range(y, y + cell[1]):
                for xx in range(x0, out.width):
                    out.putpixel((xx, yy), day)
            for seat in range(3):
                im = s[f"mat-{seat}-{kind}"]
                out.alpha_composite(im.resize((W * 2, H * 2), Image.NEAREST), (x0 + 4 + seat * 0, y + 4)) if seat == 0 else None
                out.alpha_composite(im, (x0 + 130 + seat * 40, y + 4)) if seat else None
    return out


if __name__ == "__main__":
    sets = {}
    for pair in PAIRS:
        s = build(pair)
        folder = OUT / "mats" / f"pair-{pair}"
        folder.mkdir(parents=True, exist_ok=True)
        for k, v in s.items():
            v.save(folder / f"{k}.png")
        sets[pair] = s
    (OUT / "review").mkdir(exist_ok=True)
    sheet(sets).save(OUT / "review" / "mats-pairs.png")
    print("ok")
