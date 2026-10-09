"""骷髅牌：占位图生成（美术规格阶段，不调 PixelLab）。

按 art/spec.md 的清单，把每一项用正式的文件名、尺寸、帧数画到 apps/web/public/art/。
- 垫子（背面 / 玫瑰 / 骷髅 / Last Chance 碟）和垫板用代码画得基本像样，一眼能分：
  背面 = 黄铜 + 漩涡，玫瑰 = 铜红边深底 + 红圆 + R，骷髅 = 铜红边深底 + 白骷髅形，LC 碟 = 银边珍珠底 + 红圆 + LC；
- 翻面动画用这些静态面做横向压扁，首帧 = 背面、末帧 = 正面（和正式图的约定一样）；
- 其余素材是「纯色底 + 名字缩写」，动画是几帧在动的色块，一眼能看出是占位；
- 生成后把每个文件的尺寸和 sha256 写进 art/placeholders.json。出图定稿后跑 `--check`，
  还和占位哈希一样的文件会被列出来（换图验收要求一个都没有）。

用法：
  ~/miniconda3/envs/quant/bin/python art/placeholders.py          # 生成
  ~/miniconda3/envs/quant/bin/python art/placeholders.py --check  # 列出还是占位的文件
  ~/miniconda3/envs/quant/bin/python art/placeholders.py --sheet  # 另存一张总览到 art/out/（不进仓库）
"""
from __future__ import annotations

import hashlib
import json
import math
import pathlib
import random
import sys

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "web" / "public" / "art"
MANIFEST = ROOT / "art" / "placeholders.json"

# ---------------------------------------------------------------- 调色板（和 spec.md 第 2 节一致）
P = {
    "ink": "#1e0d0b",
    "night_bg": "#04050b", "night_bg2": "#180a0a",
    "wood0": "#2b140d", "wood1": "#3b1c12", "wood2": "#5d2a16", "wood3": "#7b3b19", "wood4": "#995021",
    "dwood0": "#7a3e1e", "dwood1": "#a4552a", "dwood2": "#c8883f",
    "brass0": "#865923", "brass1": "#ad7f38", "brass2": "#c99a42", "brass3": "#e8b661",
    "copper0": "#7f3a17", "copper1": "#bb6023", "copper2": "#e6872f",
    "inset0": "#3b1c12", "inset1": "#532714", "inset2": "#693a1d",
    "bone0": "#9c8a6a", "bone1": "#d2c2a1", "bone2": "#f2e6c8", "eye": "#2b140d",
    "rose0": "#8f1f1c", "rose1": "#c8352b", "rose2": "#e85a48",
    "leaf0": "#2d5320", "leaf1": "#4f8a32",
    "silver0": "#6f7480", "silver1": "#a9aeb8", "silver2": "#dde2ea", "pearl": "#efe6d6",
    "wax": "#f0c27a", "flame": "#ffcf6b", "flame_core": "#fbf6d7",
    "sun": "#fbefc2",
    "face": "#f4c66a", "face_dk": "#d9963a",
    "smoke": "#5a4a5a",
}

# 6 个座位：亮色、皮革（暗、主、亮）、动物缩写（spec 第 2.1 节）
SEATS = [
    ("red", "#e5533f", ("#421412", "#6c2115", "#843618"), "FOX"),
    ("blue", "#3b82f0", ("#16233f", "#24406e", "#33588f"), "CRW"),
    ("green", "#44b860", ("#15301b", "#24502e", "#336b3e"), "TOD"),
    ("yellow", "#f0c030", ("#3d2a08", "#6b4b12", "#8c661c"), "RAC"),
    ("purple", "#9b6ad6", ("#2a1638", "#46265e", "#5e357c"), "CAT"),
    ("cyan", "#36c2c9", ("#0f3032", "#1b5154", "#266d70"), "BDG"),
]

DISC_W, DISC_H = 32, 36
FLIP_H = 40
MAT_W, MAT_H = 56, 64


def rgba(h: str, a: int = 255) -> tuple[int, int, int, int]:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def C(name: str, a: int = 255):
    return rgba(P[name], a) if name in P else rgba(name, a)


def shade(c, f: float):
    return tuple(max(0, min(255, round(v * f))) for v in c[:3]) + (c[3],)


def lum(c) -> float:
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


# ---------------------------------------------------------------- 3×5 小字（占位标签）
F35_ROWS = {
    "A": ".#. #.# ### #.# #.#", "B": "##. #.# ##. #.# ##.", "C": ".## #.. #.. #.. .##", "D": "##. #.# #.# #.# ##.",
    "E": "### #.. ##. #.. ###", "F": "### #.. ##. #.. #..", "G": ".## #.. #.# #.# .##", "H": "#.# #.# ### #.# #.#",
    "I": "### .#. .#. .#. ###", "J": "..# ..# ..# #.# .#.", "K": "#.# #.# ##. #.# #.#", "L": "#.. #.. #.. #.. ###",
    "M": "#.# ### ### #.# #.#", "N": "##. #.# #.# #.# #.#", "O": ".#. #.# #.# #.# .#.", "P": "##. #.# ##. #.. #..",
    "Q": ".#. #.# #.# ##. .##", "R": "##. #.# ##. #.# #.#", "S": ".## #.. .#. ..# ##.", "T": "### .#. .#. .#. .#.",
    "U": "#.# #.# #.# #.# ###", "V": "#.# #.# #.# #.# .#.", "W": "#.# #.# ### ### #.#", "X": "#.# #.# .#. #.# #.#",
    "Y": "#.# #.# .#. .#. .#.", "Z": "### ..# .#. #.. ###", "0": "### #.# #.# #.# ###", "1": ".#. ##. .#. .#. ###",
    "2": "##. ..# .#. #.. ###", "3": "##. ..# .#. ..# ##.", "4": "#.# #.# ### ..# ..#", "5": "### #.. ##. ..# ##.",
    "6": ".## #.. ### #.# ###", "7": "### ..# .#. .#. .#.", "8": "### #.# ### #.# ###", "9": "### #.# ### ..# ##.",
    "-": "... ... ### ... ...", " ": "... ... ... ... ...", "+": "... .#. ### .#. ...", "?": "##. ..# .#. ... .#.",
    "!": ".#. .#. .#. ... .#.",
}
F35 = {k: v.replace(" ", "") for k, v in F35_ROWS.items()}
assert all(len(v) == 15 for v in F35.values())


def text35(img: Image.Image, text: str, cx: int, cy: int, fill, scale: int = 1, shadow=None) -> None:
    """以 (cx, cy) 为中心写 3×5 小字。"""
    text = text.upper()
    w = (len(text) * 4 - 1) * scale
    x0, y0 = cx - w // 2, cy - (5 * scale) // 2
    d = ImageDraw.Draw(img)
    for i, ch in enumerate(text):
        glyph = F35.get(ch, F35[" "])
        for r in range(5):
            for c in range(3):
                if glyph[r * 3 + c] == "#":
                    x, y = x0 + (i * 4 + c) * scale, y0 + r * scale
                    if shadow is not None:
                        d.rectangle([x + scale, y + scale, x + 2 * scale - 1, y + 2 * scale - 1], fill=shadow)
                    d.rectangle([x, y, x + scale - 1, y + scale - 1], fill=fill)


def text_color(bg) -> tuple:
    return C("ink") if lum(bg) > 140 else rgba("#fff4dc")


# ---------------------------------------------------------------- 垫子
def disc_shell(rim: str, rim_hi: str, edge: str, inset: str) -> Image.Image:
    """32×36：上面 32×32 是正面，下面 4 行是厚度。"""
    img = Image.new("RGBA", (DISC_W, DISC_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ink = C("ink")
    # 厚度：下移 4px 的圆 + 中间连起来
    d.ellipse([0, 4, 31, 35], fill=ink)
    d.rectangle([0, 15, 31, 20], fill=ink)
    d.ellipse([1, 5, 30, 34], fill=C(edge))
    d.rectangle([1, 15, 30, 20], fill=C(edge))
    # 正面
    d.ellipse([0, 0, 31, 31], fill=ink)
    d.ellipse([1, 1, 30, 30], fill=C(rim))
    # 左上亮边
    d.arc([1, 1, 30, 30], 190, 260, fill=C(rim_hi))
    d.arc([2, 2, 29, 29], 200, 250, fill=C(rim_hi))
    # 内圈刻线 + 内底
    d.ellipse([4, 4, 27, 27], fill=shade(C(rim), 0.62))
    d.ellipse([5, 5, 26, 26], fill=C(inset))
    return img


def disc_back() -> Image.Image:
    img = disc_shell("brass2", "brass3", "brass0", "brass1")
    d = ImageDraw.Draw(img)
    # 三叉漩涡：三段弧，各转 120°
    for k in range(3):
        a = k * 120
        d.arc([9, 9, 22, 22], a, a + 70, fill=C("brass3"))
        d.arc([10, 10, 21, 21], a, a + 60, fill=C("brass3"))
        ang = math.radians(a + 70)
        x, y = 15.5 + 6.5 * math.cos(ang), 15.5 + 6.5 * math.sin(ang)
        d.rectangle([round(x) - 1, round(y) - 1, round(x), round(y)], fill=C("brass3"))
    d.rectangle([15, 15, 16, 16], fill=C("brass0"))
    return img


def disc_rose(rim="copper2", hi="brass3", edge="copper0", inset="inset1", label="R", rose_main="rose1") -> Image.Image:
    img = disc_shell(rim, hi, edge, inset)
    d = ImageDraw.Draw(img)
    # 叶子
    d.polygon([(15, 20), (9, 22), (12, 24)], fill=C("leaf1"))
    d.polygon([(16, 20), (22, 22), (19, 24)], fill=C("leaf1"))
    d.line([15, 19, 15, 25], fill=C("leaf0"))
    # 红圆（玫瑰）
    d.ellipse([9, 7, 22, 20], fill=C("ink"))
    d.ellipse([10, 8, 21, 19], fill=C(rose_main))
    d.arc([10, 8, 21, 19], 180, 270, fill=C("rose2"))
    text35(img, label, 16, 14, rgba("#fff4dc"))
    return img


def disc_skull() -> Image.Image:
    img = disc_shell("copper2", "brass3", "copper0", "inset1")
    d = ImageDraw.Draw(img)
    ink, bone, bone_hi, bone_dk, eye = C("ink"), C("bone1"), C("bone2"), C("bone0"), C("eye")
    # 头骨
    d.ellipse([8, 6, 23, 20], fill=ink)
    d.rectangle([11, 17, 20, 24], fill=ink)
    d.ellipse([9, 7, 22, 19], fill=bone)
    d.rectangle([12, 17, 19, 23], fill=bone)
    d.arc([9, 7, 22, 19], 190, 260, fill=bone_hi)
    # 大眼睛
    d.ellipse([10, 11, 14, 15], fill=eye)
    d.ellipse([17, 11, 21, 15], fill=eye)
    img.putpixel((11, 12), bone_hi)
    img.putpixel((18, 12), bone_hi)
    # 鼻子、牙
    d.rectangle([15, 17, 16, 18], fill=eye)
    for x in (13, 15, 17):
        d.line([x, 21, x, 23], fill=bone_dk)
    return img


def disc_lc(up: bool) -> Image.Image:
    img = disc_rose("silver1", "silver2", "silver0", "pearl", "", "rose1" if up else "rose0")
    d = ImageDraw.Draw(img)
    text35(img, "LC", 16, 14, rgba("#fff4dc"))
    if up:  # 已翻开：两颗闪光像素
        for x, y in ((7, 8), (24, 7)):
            img.putpixel((x, y), rgba("#ffffff"))
            img.putpixel((x - 1, y), C("silver2"))
            img.putpixel((x + 1, y), C("silver2"))
    else:  # 扣着：底部一道暗线，表示「这是背面」
        d.line([10, 26, 21, 26], fill=C("silver0"))
    return img


def flip(back: Image.Image, face: Image.Image) -> Image.Image:
    """8 帧 32×40：0 扣着，1 拿起，2–3 背面压扁，4 侧面一条线，5–6 正面展开，7 平放。"""
    frames = []
    plan = [(back, 1.0, 0), (back, 1.0, 3), (back, 0.7, 4), (back, 0.35, 4),
            (None, 0.0, 4), (face, 0.35, 4), (face, 0.7, 3), (face, 1.0, 0)]
    for src, sx, lift in plan:
        fr = Image.new("RGBA", (DISC_W, FLIP_H), (0, 0, 0, 0))
        top = 4 - lift
        if lift:  # 拿起来时，原位留一块阴影
            sh = Image.new("RGBA", (DISC_W, FLIP_H), (0, 0, 0, 0))
            ImageDraw.Draw(sh).ellipse([2, 8, 29, 37], fill=rgba(P["ink"], 110))
            fr.alpha_composite(sh)
        if src is None:
            d = ImageDraw.Draw(fr)
            d.rectangle([14, top, 17, top + DISC_H - 1], fill=C("ink"))
            d.rectangle([15, top + 1, 16, top + DISC_H - 2], fill=C("brass1"))
        else:
            w = max(2, round(DISC_W * sx))
            part = src.resize((w, DISC_H), Image.NEAREST)
            fr.alpha_composite(part, ((DISC_W - w) // 2, top))
        frames.append(fr)
    return strip(frames)


# ---------------------------------------------------------------- 垫板
def mat(seat: int, flower: bool) -> Image.Image:
    _key, hexc, (dk, main, lt), _animal = SEATS[seat]
    img = Image.new("RGBA", (MAT_W, MAT_H), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    ink = C("ink")
    d.rounded_rectangle([0, 0, MAT_W - 1, MAT_H - 1], radius=4, fill=ink)
    d.rounded_rectangle([1, 1, MAT_W - 2, MAT_H - 2], radius=3, fill=rgba(dk))
    d.rounded_rectangle([2, 2, MAT_W - 3, MAT_H - 3], radius=2, fill=rgba(main))
    d.line([3, 2, MAT_W - 4, 2], fill=rgba(lt))
    d.line([2, 3, 2, MAT_H - 4], fill=rgba(lt))
    # 缝线（座位亮色虚线），内缩 4
    stitch = rgba(hexc)
    for x in range(5, MAT_W - 5, 3):
        img.putpixel((x, 4), stitch)
        img.putpixel((x, MAT_H - 5), stitch)
    for y in range(5, MAT_H - 5, 3):
        img.putpixel((4, y), stitch)
        img.putpixel((MAT_W - 5, y), stitch)
    if flower:
        gold = C("brass2")
        d.rectangle([7, 7, MAT_W - 8, MAT_H - 8], outline=gold)
        # 中间暗纹大玫瑰
        d.ellipse([16, 20, 39, 43], fill=rgba(lt))
        d.ellipse([20, 24, 35, 39], fill=rgba(main))
        # 四角红玫瑰 + 左右两边中间各一朵
        for cx, cy in ((9, 9), (MAT_W - 10, 9), (9, MAT_H - 10), (MAT_W - 10, MAT_H - 10), (8, 32), (MAT_W - 9, 32)):
            d.ellipse([cx - 2, cy - 2, cx + 2, cy + 2], fill=ink)
            d.ellipse([cx - 1, cy - 1, cx + 1, cy + 1], fill=C("rose1"))
            img.putpixel((cx, cy), C("rose2"))
            img.putpixel((cx + 2, cy + 2), C("leaf1"))
        text35(img, "F", MAT_W - 10, 50, C("brass3"))
    else:
        text35(img, "B", MAT_W - 10, 50, C("brass3"))
    # 左下角座位角标（占位：座位号；正式图是绣的小图案）
    text35(img, str(seat), 10, 50, C("brass3"))
    return img


# ---------------------------------------------------------------- 场景
def scene(day: bool, label: str, variant: int, hero: bool = False) -> Image.Image:
    w, h = 512, 288
    img = Image.new("RGBA", (w, h), C("dwood1" if day else "wood1"))
    d = ImageDraw.Draw(img)
    rnd = random.Random(label)
    woods = ["dwood0", "dwood1", "dwood2"] if day else ["wood1", "wood2", "wood3"]
    plank = 36 + variant * 8
    for i, y in enumerate(range(0, h, plank)):
        d.rectangle([0, y, w, y + plank - 1], fill=C(woods[(i + variant) % 3]))
        d.line([0, y, w, y], fill=C("ink"))
        for _ in range(6):
            gx = rnd.randrange(0, w)
            d.line([gx, y + rnd.randrange(4, plank - 4), gx + rnd.randrange(30, 120), y + rnd.randrange(4, plank - 4)],
                   fill=shade(C(woods[(i + variant) % 3]), 0.85))
    # 暗角（夜间重、白天轻）
    vig = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    vd = ImageDraw.Draw(vig)
    steps = 10
    for s in range(steps):
        a = int((150 if not day else 60) * (1 - s / steps))
        vd.rectangle([s * 10, s * 7, w - 1 - s * 10, h - 1 - s * 7], outline=(4, 5, 11, a), width=10)
    img.alpha_composite(vig)
    if day:  # 左上窗户阳光
        sun = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        ImageDraw.Draw(sun).polygon([(0, 0), (180, 0), (320, 288), (120, 288)], fill=rgba(P["sun"], 60))
        img.alpha_composite(sun)
    # 四角蜡烛
    for cx, cy in ((34, 40), (w - 34, 40), (34, h - 44), (w - 34, h - 44)):
        if not day:
            glow = Image.new("RGBA", (w, h), (0, 0, 0, 0))
            gd = ImageDraw.Draw(glow)
            for r, a in ((46, 30), (32, 45), (20, 60)):
                gd.ellipse([cx - r, cy - 10 - r, cx + r, cy - 10 + r], fill=rgba(P["flame"], a))
            img.alpha_composite(glow)
        d.rectangle([cx - 7, cy - 6, cx + 7, cy + 16], fill=C("ink"))
        d.rectangle([cx - 6, cy - 5, cx + 6, cy + 15], fill=C("wax"))
        if not day or (cx < w // 2 and cy < h // 2):
            d.ellipse([cx - 3, cy - 16, cx + 3, cy - 6], fill=C("flame"))
            d.ellipse([cx - 1, cy - 12, cx + 1, cy - 8], fill=C("flame_core"))
    if hero:
        # 样张那种构图：皮垫板 + 一摞背面 + 翻开的玫瑰和骷髅，按 3× 放大
        m = mat(0, False).resize((MAT_W * 3, MAT_H * 3), Image.NEAREST)
        img.alpha_composite(m, (w // 2 - 84, 50))
        back = disc_back().resize((96, 108), Image.NEAREST)
        for i in range(4):
            img.alpha_composite(back, (w // 2 - 48, 50 + 3 * (22 - 4 * i)))
        img.alpha_composite(disc_rose().resize((96, 108), Image.NEAREST), (w // 2 - 210, 120))
        img.alpha_composite(disc_skull().resize((96, 108), Image.NEAREST), (w // 2 + 114, 120))
    text35(img, label, w // 2, 14, rgba("#fff4dc"), scale=3, shadow=C("ink"))
    if not hero:  # 标出界面摆垫板的空区域（中间 70%）
        x0, y0, x1, y1 = int(w * 0.15), int(h * 0.15), int(w * 0.85), int(h * 0.92)
        for x in range(x0, x1, 6):
            d.point([(x, y0), (x, y1)], fill=rgba("#fff4dc", 90))
        for y in range(y0, y1, 6):
            d.point([(x0, y), (x1, y)], fill=rgba("#fff4dc", 90))
    return img.convert("RGB").convert("RGBA")


# ---------------------------------------------------------------- 通用占位
def label_tile(w: int, h: int, bg: str, label: str, shape: str = "rect") -> Image.Image:
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    base = C(bg)
    if shape == "circle":
        d.ellipse([0, 0, w - 1, h - 1], fill=C("ink"))
        d.ellipse([1, 1, w - 2, h - 2], fill=base)
    else:
        d.rectangle([0, 0, w - 1, h - 1], fill=C("ink"))
        d.rectangle([1, 1, w - 2, h - 2], fill=base)
        d.line([1, 1, w - 2, 1], fill=shade(base, 1.2))
    scale = 2 if w >= 48 and len(label) * 8 <= w - 4 else 1
    text35(img, label, w // 2, h // 2, text_color(base), scale=scale)
    return img


def strip(frames: list[Image.Image]) -> Image.Image:
    fw, fh = frames[0].size
    out = Image.new("RGBA", (fw * len(frames), fh), (0, 0, 0, 0))
    for i, fr in enumerate(frames):
        out.alpha_composite(fr, (i * fw, 0))
    return out


def anim(fw: int, fh: int, n: int, color: str, label: str, motion: str, blank_last: bool) -> Image.Image:
    """几帧在动的色块：motion = spin / grow / rise / twinkle / flame / bob / fall / sweep。"""
    frames = []
    base = C(color)
    count = n - 1 if blank_last else n
    for i in range(n):
        fr = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
        if i < count:
            d = ImageDraw.Draw(fr)
            t = i / max(1, count - 1) if count > 1 else 0
            cx, cy = fw // 2, fh // 2
            if motion == "grow":
                r = max(2, round(min(fw, fh) / 2 * (0.25 + 0.75 * t)) - 1)
                d.ellipse([cx - r, cy - r, cx + r - 1, cy + r - 1], outline=C("ink"), width=2)
                d.ellipse([cx - r + 2, cy - r + 2, cx + r - 3, cy + r - 3], outline=base, width=max(1, r // 4))
            elif motion == "rise":
                y = round((fh - 10) * (1 - t)) + 2
                for k in range(3):
                    x = 4 + k * (fw - 8) // 2
                    d.rectangle([x - 2, y - 2 + k * 2, x + 2, y + 2 + k * 2], fill=base, outline=C("ink"))
            elif motion == "fall":
                for k in range(5):
                    x = (k * 13 + i * 3) % (fw - 4)
                    y = (k * 11 + i * fh // n) % (fh - 4)
                    d.rectangle([x, y, x + 3, y + 2], fill=base, outline=C("ink"))
            elif motion == "twinkle":
                r = [1, 3, 5, 6, 4, 2, 1, 3][i % 8]
                d.line([cx - r, cy, cx + r, cy], fill=base)
                d.line([cx, cy - r, cx, cy + r], fill=base)
                fr.putpixel((cx, cy), rgba("#ffffff"))
            elif motion == "flame":
                hgt = [9, 11, 8, 12][i % 4]
                d.rectangle([cx - 4, fh - 16, cx + 3, fh - 1], fill=C("ink"))
                d.rectangle([cx - 3, fh - 15, cx + 2, fh - 2], fill=C("wax"))
                d.ellipse([cx - 3, fh - 16 - hgt, cx + 2, fh - 16], fill=base)
                d.ellipse([cx - 1, fh - 16 - hgt // 2, cx, fh - 17], fill=C("flame_core"))
            elif motion == "sweep":
                x = round((fw - 6) * t)
                d.rectangle([0, 0, fw - 1, fh - 1], outline=rgba(P["brass3"], 160), width=2)
                d.rectangle([x, 0, x + 5, fh - 1], fill=rgba(P["brass3"], 200))
            elif motion == "spin":
                ang = i * (360 / n)
                d.rectangle([2, 2, fw - 3, fh - 3], fill=base, outline=C("ink"))
                ex = cx + round((fw / 2 - 3) * math.cos(math.radians(ang)))
                ey = cy + round((fh / 2 - 3) * math.sin(math.radians(ang)))
                d.rectangle([ex - 1, ey - 1, ex + 1, ey + 1], fill=C("ink"))
            else:  # bob
                dy = [0, -1, -2, -1, 0, 1, 2, 1][i % 8]
                d.rectangle([2, 2 + dy + 2, fw - 3, fh - 3 + dy - 2], fill=base, outline=C("ink"))
            if fw >= 16 and motion not in ("twinkle", "flame", "fall"):
                text35(fr, label, cx, cy, text_color(base))
            if motion != "twinkle":
                fr.putpixel((min(fw - 1, 1 + i), fh - 1), C("ink"))  # 帧号小点，看得出在换帧
        frames.append(fr)
    return strip(frames)


def burst(fw: int, n: int, colors: list[str], label: str) -> Image.Image:
    """一次性爆开：环 + 往外飞的小块，最后一帧全空。"""
    frames = []
    rnd = random.Random(label)
    bits = [(rnd.uniform(0, 2 * math.pi), rnd.uniform(0.5, 1.0), rnd.choice(colors)) for _ in range(12)]
    for i in range(n):
        fr = Image.new("RGBA", (fw, fw), (0, 0, 0, 0))
        if i < n - 1:
            d = ImageDraw.Draw(fr)
            t = (i + 1) / (n - 1)
            c = fw // 2
            r = round((fw / 2 - 3) * t)
            if r > 2:
                d.ellipse([c - r, c - r, c + r - 1, c + r - 1], outline=C(colors[0], max(60, 255 - i * 25)), width=2)
            for ang, sp, col in bits:
                rr = (fw / 2 - 4) * t * sp
                x, y = round(c + rr * math.cos(ang)), round(c + rr * math.sin(ang))
                d.rectangle([x - 1, y - 1, x + 1, y + 1], fill=C(col), outline=C("ink"))
            if i == 0:
                text35(fr, label, c, c, rgba("#fff4dc"), shadow=C("ink"))
        frames.append(fr)
    return strip(frames)


def out_candle(fw: int = 32, fh: int = 32, flame: int = 0) -> Image.Image:
    """熄灭的蜡烛（flame=0）或点着的蜡烛（flame>0，火苗高度）。fh 可以比 32 高，上面多出来的给火苗。"""
    img = Image.new("RGBA", (fw, fh), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    top = fh - 32
    # 烛台
    d.ellipse([4, top + 25, 27, 31 + top], fill=C("ink"))
    d.ellipse([5, top + 26, 26, 30 + top], fill=C("brass1"))
    # 蜡烛
    d.rectangle([11, top + 10, 20, top + 27], fill=C("ink"))
    d.rectangle([12, top + 11, 19, top + 26], fill=C("wax") if flame else C("bone0"))
    d.line([15, top + 7, 15, top + 10], fill=C("ink"))
    if flame:
        d.ellipse([12, top + 7 - flame, 18, top + 8], fill=C("flame"))
        d.ellipse([14, top + 4 - flame // 2, 16, top + 6], fill=C("flame_core"))
    else:  # 一缕烟
        for k, (x, y) in enumerate(((16, top + 5), (17, top + 3), (16, top + 1), (15, top + 0))):
            if 0 <= y:
                img.putpixel((x, y), C("smoke", 200 - k * 30))
        text35(img, "OUT", 16, top + 19, C("ink"))
    return img


def snuff() -> Image.Image:
    frames = []
    for i, fl in enumerate([8, 10, 7, 9, 4, 2, 0, 0]):
        fr = Image.new("RGBA", (32, 48), (0, 0, 0, 0))
        if i < 7:
            c = out_candle(32, 48, fl) if fl else out_candle(32, 48, 0)
            if not fl:  # 刚熄灭：烟更浓
                d = ImageDraw.Draw(c)
                d.ellipse([12, 6, 20, 14], fill=C("smoke", 150))
            fr.alpha_composite(c)
        else:
            fr.alpha_composite(out_candle(32, 32, 0), (0, 16))  # 最后一帧 = ui/out，下面 32×32 对齐
        frames.append(fr)
    return strip(frames)


def lose_disc() -> Image.Image:
    back = disc_back()
    frames = []
    for i in range(8):
        fr = Image.new("RGBA", (DISC_W, FLIP_H), (0, 0, 0, 0))
        if i < 7:
            k = i / 6
            if i < 5:
                part = back.copy()
                alpha = part.getchannel("A").point(lambda a: int(a * (1 - 0.18 * i)))
                part.putalpha(alpha)
                fr.alpha_composite(part, (0, 4))
                d = ImageDraw.Draw(fr)
                for j in range(i):  # 裂纹
                    d.line([16, 20, 16 + (j - 2) * 5, 6 + j * 6], fill=C("ink"))
            d = ImageDraw.Draw(fr)
            for j in range(6):  # 烟
                x = 6 + j * 4
                y = round(30 - k * 26) + (j % 2) * 3
                r = 1 + round(k * 3)
                d.ellipse([x - r, y - r, x + r, y + r], fill=C("smoke", int(220 * (1 - k * 0.7))))
        frames.append(fr)
    return strip(frames)


def emote(label: str, kind: str) -> Image.Image:
    """4 帧 32×32：物件类（rose/skull）用对应的垫子图案，小脸类用蜡黄圆脸 + 缩写，帧间上下跳。"""
    frames = []
    for i in range(4):
        dy = [0, -2, -3, -1][i]
        fr = Image.new("RGBA", (32, 32), (0, 0, 0, 0))
        d = ImageDraw.Draw(fr)
        if kind == "rose":
            src = disc_rose().crop((8, 6, 24, 26)).resize((24, 30), Image.NEAREST)
            fr.alpha_composite(src, (4 + [0, 1, 0, -1][i], 1))
        elif kind == "skull":
            src = disc_skull().crop((8, 6, 24, 25)).resize((24, 28), Image.NEAREST)
            fr.alpha_composite(src, (4, 2 + (1 if i % 2 else 0)))
        else:
            d.ellipse([3, 4 + dy, 28, 29 + dy], fill=C("ink"))
            d.ellipse([4, 5 + dy, 27, 28 + dy], fill=C("face"))
            d.arc([4, 5 + dy, 27, 28 + dy], 20, 160, fill=C("face_dk"))
            d.ellipse([9, 11 + dy, 12, 14 + dy], fill=C("eye"))
            d.ellipse([19, 11 + dy, 22, 14 + dy], fill=C("eye"))
            text35(fr, label, 16, 22 + dy, C("ink"))
        fr.putpixel((1 + i, 31), C("ink"))  # 帧号小点
        frames.append(fr)
    return strip(frames)


def bubble() -> Image.Image:
    img = Image.new("RGBA", (40, 44), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, 39, 39], radius=6, fill=C("ink"))
    d.polygon([(6, 38), (6, 43), (14, 38)], fill=C("ink"))
    d.rounded_rectangle([1, 1, 38, 38], radius=5, fill=rgba("#fff4dc"))
    d.polygon([(7, 38), (7, 41), (12, 38)], fill=rgba("#fff4dc"))
    d.rectangle([4, 4, 35, 35], outline=rgba("#e8d8b8"))  # 表情贴在 (4,4) 的 32×32
    return img


def frame9() -> Image.Image:
    img = Image.new("RGBA", (24, 24), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 23, 23], fill=C("ink"))
    d.rectangle([1, 1, 22, 22], fill=C("wood2"))
    d.rectangle([3, 3, 20, 20], fill=C("wood3"))
    d.rectangle([6, 6, 17, 17], fill=C("ink"))
    d.rectangle([7, 7, 16, 16], fill=(0, 0, 0, 0))
    for x, y in ((1, 1), (17, 1), (1, 17), (17, 17)):  # 黄铜包角
        d.rectangle([x, y, x + 5, y + 5], fill=C("brass2"))
        img.putpixel((x + 1, y + 1), C("brass3"))
    return img


def ribbon() -> Image.Image:
    img = Image.new("RGBA", (96, 24), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pts = [(0, 4), (12, 4), (12, 0), (83, 0), (83, 4), (95, 4), (89, 13), (95, 22), (76, 22), (76, 19),
           (19, 19), (19, 22), (0, 22), (6, 13)]
    d.polygon(pts, fill=C("ink"))
    inner = [(2, 5), (13, 5), (13, 1), (82, 1), (82, 5), (93, 5), (88, 13), (93, 21), (77, 21), (77, 18),
             (18, 18), (18, 21), (2, 21), (7, 13)]
    d.polygon(inner, fill=C("rose1"))
    d.line([14, 2, 81, 2], fill=C("rose2"))
    text35(img, "RIBBON", 48, 10, rgba("#fff4dc"))
    return img


def trophy() -> Image.Image:
    img = Image.new("RGBA", (48, 48), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(10, 12), (37, 12), (31, 28), (16, 28)], fill=C("ink"))
    d.polygon([(11, 13), (36, 13), (30, 27), (17, 27)], fill=C("brass2"))
    d.rectangle([21, 27, 26, 38], fill=C("ink"))
    d.rectangle([22, 28, 25, 37], fill=C("brass1"))
    d.rectangle([14, 38, 33, 43], fill=C("ink"))
    d.rectangle([15, 39, 32, 42], fill=C("brass2"))
    d.ellipse([19, 4, 28, 13], fill=C("ink"))
    d.ellipse([20, 5, 27, 12], fill=C("rose1"))
    text35(img, "WIN", 24, 19, C("ink"))
    return img


# ---------------------------------------------------------------- 清单（和 spec.md 第 9 节一致）
EMOTES = [("rose", "RO", "rose"), ("skull", "SK", "skull"), ("taunt", "TA", "face"), ("shrug", "SH", "face"),
          ("think", "TH", "face"), ("laugh", "LA", "face"), ("sweat", "SW", "face"), ("shock", "SO", "face")]


def build() -> dict[str, Image.Image]:
    files: dict[str, Image.Image] = {}
    back, rose, skull = disc_back(), disc_rose(), disc_skull()
    lc_down, lc_up = disc_lc(False), disc_lc(True)
    # 垫子
    files["discs/back.png"] = back
    files["discs/rose.png"] = rose
    files["discs/skull.png"] = skull
    files["discs/lc-down.png"] = lc_down
    files["discs/lc-up.png"] = lc_up
    # 垫板
    for s in range(6):
        files[f"mats/mat-{s}-blank.png"] = mat(s, False)
        files[f"mats/mat-{s}-flower.png"] = mat(s, True)
    # 场景
    files["scene/night-0.png"] = scene(False, "NIGHT 0", 0)
    files["scene/night-1.png"] = scene(False, "NIGHT 1", 1)
    files["scene/day-0.png"] = scene(True, "DAY 0", 0)
    files["scene/day-1.png"] = scene(True, "DAY 1", 1)
    files["scene/hero.png"] = scene(False, "HERO", 2, hero=True)
    # 界面小图
    files["ui/disc.png"] = label_tile(16, 16, "brass2", "D", "circle")
    files["ui/stack.png"] = label_tile(16, 16, "brass1", "ST")
    files["ui/bell.png"] = label_tile(16, 16, "brass3", "BL", "circle")
    files["ui/pass.png"] = label_tile(16, 16, "bone1", "PS")
    files["ui/key.png"] = label_tile(16, 16, "brass2", "K")
    files["ui/rose.png"] = label_tile(16, 16, "rose1", "R", "circle")
    files["ui/eye.png"] = label_tile(16, 16, "bone2", "EY", "circle")
    files["ui/ready.png"] = label_tile(16, 16, "leaf1", "OK")
    files["ui/lc.png"] = label_tile(16, 16, "silver2", "LC", "circle")
    files["ui/thinking.png"] = anim(16, 16, 4, "wax", "TH", "spin", blank_last=False)
    files["ui/lantern.png"] = label_tile(32, 32, "flame", "LAMP")
    files["ui/out.png"] = out_candle(32, 32, 0)
    files["ui/trophy.png"] = trophy()
    files["ui/ribbon.png"] = ribbon()
    files["ui/bubble.png"] = bubble()
    files["ui/frame.png"] = frame9()
    # 头像
    for s, (_key, hexc, _leather, animal) in enumerate(SEATS):
        files[f"avatars/avatar-{s}.png"] = label_tile(32, 32, hexc, animal, "circle")
    # 快捷表情
    for eid, abbr, kind in EMOTES:
        files[f"emotes/{eid}.png"] = emote(abbr, kind)
    # 动画和特效
    files["fx/flip-rose.png"] = flip(back, rose)
    files["fx/flip-skull.png"] = flip(back, skull)
    files["fx/flip-lc.png"] = flip(lc_down, lc_up)
    files["fx/skull-hit.png"] = burst(64, 8, ["bone2", "smoke", "bone1"], "HIT")
    files["fx/rose-pop.png"] = burst(48, 6, ["rose1", "rose2", "brass3"], "POP")
    files["fx/success.png"] = burst(96, 8, ["brass3", "rose1", "rose2", "flame"], "WIN")
    files["fx/mat-win.png"] = anim(56, 64, 8, "brass3", "MW", "sweep", blank_last=True)
    files["fx/lose-disc.png"] = lose_disc()
    files["fx/snuff.png"] = snuff()
    files["fx/candle.png"] = anim(16, 32, 4, "flame", "", "flame", blank_last=False)
    files["fx/petals.png"] = anim(64, 64, 8, "rose1", "", "fall", blank_last=False)
    files["fx/sparkle.png"] = anim(16, 16, 6, "brass3", "", "twinkle", blank_last=False)
    return files


def sha(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def generate() -> None:
    files = build()
    manifest = {}
    for rel, img in files.items():
        path = OUT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, optimize=True)
        manifest[rel] = {"size": list(img.size), "sha256": sha(path)}
        print(f"{rel:28s} {img.size[0]}×{img.size[1]}")
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n")
    print(f"共 {len(files)} 个文件 → {OUT}；哈希表 {MANIFEST}")


def check() -> int:
    manifest = json.loads(MANIFEST.read_text())
    still, missing, wrong = [], [], []
    for rel, info in manifest.items():
        path = OUT / rel
        if not path.exists():
            missing.append(rel)
            continue
        with Image.open(path) as im:
            if list(im.size) != info["size"]:
                wrong.append(f"{rel} 是 {im.size[0]}×{im.size[1]}，spec 要 {info['size'][0]}×{info['size'][1]}")
        if sha(path) == info["sha256"]:
            still.append(rel)
    for title, items in (("还是占位图", still), ("缺文件", missing), ("尺寸和 spec 不一样", wrong)):
        print(f"{title}：{len(items)}")
        for item in items:
            print("  ", item)
    return 1 if still or missing or wrong else 0


def sheet() -> None:
    """把所有占位图按 2 倍拼成一张总览，存到 art/out/（不进仓库），给自己看。"""
    files = build()
    pad, x, y, row_h, width = 8, 8, 8, 0, 1600
    placed = []
    for rel, img in files.items():
        big = img.resize((img.width * 2, img.height * 2), Image.NEAREST) if img.width < 600 else img
        if x + big.width > width:
            x, y, row_h = 8, y + row_h + pad, 0
        placed.append((big, x, y))
        x += big.width + pad
        row_h = max(row_h, big.height)
    canvas = Image.new("RGBA", (width, y + row_h + 8), rgba("#3a2a24"))
    for big, px, py in placed:
        canvas.alpha_composite(big, (px, py))
    out = ROOT / "art" / "out" / "placeholders-sheet.png"
    out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(out)
    print(out)


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(check())
    if "--sheet" in sys.argv:
        sheet()
    else:
        generate()
