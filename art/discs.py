"""垫子：统一的外圈 + 厚度模板（代码画，保证五种面轮廓、边厚、高光位置逐像素一致），中间的图案可以换。

- 外圈 / 厚度：rim(kind)，kind = brass（背面）/ copper（玫瑰、骷髅）/ silver（Last Chance 碟）
- 图案：代码画的（MOTIFS）或者从 PixelLab 候选里抠出来的（motif_from_candidate）
- 32×36：上面 32×32 是正面，下面 4 行是厚度。
用法：python art/discs.py preview  → art/out/discs/
"""
from __future__ import annotations

import math
import sys

from PIL import Image

from pix import CLEAR, OUT, ascii_img, contact, mix, on_bg, rgba, up

W, H, FACE = 32, 36, 32
CX = CY = 16.0
R_OUT = 15.6      # 外轮廓（含描边）
R_RIM = 11.6      # 外圈内沿
R_GROOVE = 10.6   # 刻线
LIGHT = (-0.7071, -0.7071)

RIMS = {
    # 暗 → 主 → 亮 → 高光、侧面（暗、主）
    "brass": ["#7a4f1e", "#ad7f38", "#c99a42", "#e8b661", "#fbe3a0"],
    "copper": ["#7f3a17", "#a8501f", "#cf6a26", "#e6872f", "#f6b05a"],
    "silver": ["#5c606b", "#8a8f9b", "#a9aeb8", "#dde2ea", "#f6f8fb"],
}
FIELDS = {
    # 内底：暗、主、亮（左上被外圈挡住一圈阴影）
    "brass": ["#3d260e", "#5a3b17", "#6e4a1f"],
    "copper": ["#2e150d", "#3f1f12", "#532714"],
    "silver": ["#bdb2a0", "#efe6d6", "#fffaf0"],
}


def _d(x: int, y: int, oy: int = 0) -> float:
    return math.hypot(x + 0.5 - CX, y + 0.5 - CY - oy)


def face_mask(oy: int = 0) -> set[tuple[int, int]]:
    return {(x, y) for y in range(H) for x in range(W) if _d(x, y, oy) <= R_OUT}


def rim(kind: str) -> tuple[Image.Image, set[tuple[int, int]]]:
    """返回（只有外圈和厚度的垫子，内底像素集合）。"""
    tones = RIMS[kind]
    field = FIELDS[kind]
    im = Image.new("RGBA", (W, H), CLEAR)
    px = im.load()
    face = face_mask(0)
    side = set()
    for oy in range(1, 5):
        side |= face_mask(oy)
    side -= face
    shape = face | side
    ink = rgba("ink")

    def edge(p, s):
        x, y = p
        return any((x + dx, y + dy) not in s for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))

    inner = set()
    for (x, y) in shape:
        if edge((x, y), shape):
            px[x, y] = ink
            continue
        if (x, y) in side:
            # 厚度：左边亮一点，右边暗；最下面一行更暗
            t = (x - 2) / (W - 4)
            c = mix(rgba(tones[2]), rgba(tones[0]), t)
            bottom = all((x, y + k) in side for k in (1,)) is False
            if not any((x, y + 1 + k) in shape for k in (0,)) or (x, y + 1) not in side:
                c = mix(c, rgba("ink"), 0.35)
            # 侧面一圈竖向细纹
            if x % 3 == 0:
                c = mix(c, rgba("ink"), 0.18)
            px[x, y] = c
            continue
        d = _d(x, y)
        nx, ny = (x + 0.5 - CX) / max(d, 1e-6), (y + 0.5 - CY) / max(d, 1e-6)
        lit = nx * LIGHT[0] + ny * LIGHT[1]
        if edge((x, y), face):
            # 正面和厚度之间那条线（下半圈）用描边色
            px[x, y] = ink
        elif d > R_RIM:
            tone = 3 if lit > 0.55 else 2 if lit > 0.05 else 1 if lit > -0.55 else 0
            px[x, y] = rgba(tones[tone])
        elif d > R_GROOVE:
            # 外圈的内壁：左上背光（暗），右下迎光（亮）
            px[x, y] = rgba(tones[2]) if -lit > 0.35 else mix(rgba(tones[0]), rgba("ink"), 0.45)
        else:
            inner.add((x, y))
            # 左上一圈落影
            px[x, y] = rgba(field[0]) if (d > R_GROOVE - 1.3 and lit > 0.3) else rgba(field[1])
    # 外圈左上两颗高光
    for (x, y) in [(7, 4), (5, 6)]:
        px[x, y] = rgba(tones[4])
    return im, inner


def compose(kind: str, motif: Image.Image | None, dx: int = 0, dy: int = 0, sparkle: bool = False) -> Image.Image:
    """把图案（透明底小图）居中贴进内底。图案超出内底的部分剪掉。"""
    base, inner = rim(kind)
    if motif is not None:
        layer = Image.new("RGBA", (W, H), CLEAR)
        mx = round(CX - motif.width / 2) + dx
        my = round(CY - motif.height / 2) + dy
        layer.alpha_composite(motif, (mx, my))
        lp, bp = layer.load(), base.load()
        for (x, y) in inner:
            if lp[x, y][3] > 0:
                bp[x, y] = lp[x, y]
    if sparkle:
        bp = base.load()
        for (x, y), c in {(24, 5): "white", (25, 4): "#fffaf0", (23, 4): "#dde2ea", (25, 6): "#dde2ea", (26, 5): "#dde2ea"}.items():
            if bp[x, y][3]:
                bp[x, y] = rgba(c)
    return base


# ---------------------------------------------------------------- 代码画的图案（备选，也是 PixelLab 图案不行时的兜底）
SKULL = [
    "....ooooooo....",
    "..ooHHHHWWWoo..",
    ".oHHHWWWWWWWSo.",
    "oHHWWWWWWWWWWSo",
    "oHWWEEWWWEEWWSo",
    "oHWEeEEWEeEEWSo",
    "oWWEEEEWEEEEWSo",
    "oWWWEEWWWEEWWSo",
    ".oWWWWWEWWWWSo.",
    ".oSWWWEEEWWSSo.",
    "..oSWWWWWWWSo..",
    "..oWEWEWEWEWo..",
    "..ooooooooooo..",
]
SKULL_LEG = {"o": "ink", "H": "bone2", "W": "bone1", "S": "bone0", "E": "eye", "e": "bone2"}

ROSE = [
    "....ooooo....",
    "..ooLLRRRoo..",
    ".oLHLRRRRRDo.",
    "oLHLRDDDRRRDo",
    "oLLRDRRRDRRDo",
    "oLRDRDDRRDRDo",
    "oRRDRRDRDRDDo",
    "oRRRDDRRDRDDo",
    ".oRRRRDDRDDo.",
    ".ooDRRRRDDoo.",
    "oGGooDDDooGGo",
    "olGGGooGoGGGo",
    ".oGGgGoGogGo.",
    "..ooo.oGoo...",
    "......oGo....",
    ".......o.....",
]
ROSE_LEG = {"o": "ink", "H": "rose3", "L": "rose2", "R": "rose1", "D": "rose0", "G": "leaf1", "g": "leaf0", "l": "leaf2"}
ROSE_MUTED = {"o": "ink", "H": "#e7b9ae", "L": "#d98a7c", "R": "#b8564a", "D": "#86352f", "G": "#6f8a5a", "g": "#4b5f3c", "l": "#93ad7c"}


def swirl(field_hi="#e8b661", field_lo="#2e1c0a", hi="#fbe3a0") -> Image.Image:
    """背面的三叉漩涡（三条弯弧，不像字母或数字）。"""
    size = 21
    im = Image.new("RGBA", (size, size), CLEAR)
    px = im.load()
    c = size / 2
    pts = set()
    for k in range(3):
        a0 = k * 2 * math.pi / 3 - math.pi / 2
        for i in range(200):
            t = i / 199
            r = 2.2 + 6.9 * t
            a = a0 + 2.9 * t
            w = 0.75 + 0.35 * t
            x, y = c + r * math.cos(a), c + r * math.sin(a)
            for yy in range(size):
                for xx in range(size):
                    if math.hypot(xx + 0.5 - x, yy + 0.5 - y) <= w:
                        pts.add((xx, yy))
    for (x, y) in pts:
        px[x, y] = rgba(field_hi)
    # 浮雕：右下一侧加阴影，左上一侧加亮点
    for (x, y) in pts:
        if (x + 1, y + 1) not in pts and 0 <= x + 1 < size and 0 <= y + 1 < size and px[x + 1, y + 1][3] == 0:
            px[x + 1, y + 1] = rgba(field_lo)
        if (x - 1, y - 1) not in pts and (x, y - 1) not in pts:
            px[x, y] = rgba(hi)
    return im


def code_set() -> dict[str, Image.Image]:
    skull = ascii_img(SKULL, SKULL_LEG)
    rose = ascii_img(ROSE, ROSE_LEG)
    rose_muted = ascii_img(ROSE, ROSE_MUTED)
    return {
        "back": compose("brass", swirl()),
        "rose": compose("copper", rose),
        "skull": compose("copper", skull, dy=0),
        "lc-down": compose("silver", rose_muted),
        "lc-up": compose("silver", rose, sparkle=True),
    }


def preview(sets: dict[str, dict[str, Image.Image]], name: str) -> None:
    folder = OUT / "discs"
    folder.mkdir(parents=True, exist_ok=True)
    items = []
    for set_name, faces in sets.items():
        for face, im in faces.items():
            items.append((f"{set_name}:{face}", on_bg(im)))
    contact(items, scale=6, cols=5).save(folder / f"{name}-x6.png")
    contact(items, scale=1, cols=5, label_h=12).save(folder / f"{name}-x1.png")


if __name__ == "__main__":
    if sys.argv[1:2] == ["preview"]:
        s = code_set()
        for k, v in s.items():
            v.save(OUT / "discs" / f"code-{k}.png") if (OUT / "discs").exists() else None
        preview({"code": s}, "code")
        print("ok")


# ---------------------------------------------------------------- PixelLab 候选 → 统一轮廓 + 代码厚度
def from_candidate(cand: Image.Image, kind: str, dx: int = 0, dy: int = 0) -> Image.Image:
    """候选（32×32 俯视的圆垫子）→ 32×36：轮廓强制成同一个圆（R_OUT），外面剪掉、缺的用最近的颜色补，
    一圈 1px 描边重画；下面 4 行厚度用 rim(kind) 的侧面。这样五种面的外形、描边、厚度逐像素一致。"""
    from pix import harden
    cand = harden(cand)
    b = cand.getchannel("A").getbbox()
    src = cand.crop(b)
    layer = Image.new("RGBA", (W, FACE), CLEAR)
    layer.alpha_composite(src, ((W - src.width) // 2 + dx, (FACE - src.height) // 2 + dy))
    lp = layer.load()
    # 候选自己的描边（很暗的一圈）先去掉，换成里面一圈的颜色
    def dark(c):
        return c[3] and (c[0] + c[1] + c[2]) < 120
    base, _ = rim(kind)
    out = base.copy()
    op = out.load()
    face = face_mask(0)
    edge = {p for p in face if any((p[0] + a, p[1] + c) not in face for a, c in ((1, 0), (-1, 0), (0, 1), (0, -1)))}
    opaque = [(x, y) for y in range(FACE) for x in range(W) if lp[x, y][3] and not dark(lp[x, y])]
    for (x, y) in face:
        if (x, y) in edge:
            op[x, y] = rgba("ink")
            continue
        c = lp[x, y] if y < FACE else (0, 0, 0, 0)
        if not c[3] or (dark(c) and math.hypot(x + 0.5 - CX, y + 0.5 - CY) > R_OUT - 2.5):
            # 补：找最近的不透明、非描边像素
            nx, ny = min(opaque, key=lambda p: (p[0] - x) ** 2 + (p[1] - y) ** 2)
            c = lp[nx, ny]
        op[x, y] = c
    return out
