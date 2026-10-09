"""骷髅牌：简洁版美术（首发上线用，不调 PixelLab，不用任何外部图片）。

按 art/spec.md 的清单，用代码把每一项按正式的文件名、尺寸、帧数画到 apps/web/public/art/。
正式美术定稿后同名覆盖；简洁版的哈希记在 art/simple.json，`--check` 列出还是简洁版的文件。

画法约定（和 spec 第 1、2 节一致）：
- 硬边像素，1px 深棕描边 #1e0d0b（先画填色，再沿外轮廓自动描边），左上来光；
- 图里不写任何字（数字、文字都交给界面用 HTML 写）；
- 半透明只用在烟、光晕、影子上，每样不超过 3 档。

用法：
  ~/miniconda3/envs/quant/bin/python art/simple.py            # 画全部，写 art/simple.json
  ~/miniconda3/envs/quant/bin/python art/simple.py --check    # 列出 public/art 里还是简洁版的文件
  ~/miniconda3/envs/quant/bin/python art/simple.py --preview  # 总览 + 真实尺寸的牌桌模拟图（存到 pipeline 的 assets/）
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
MANIFEST = ROOT / "art" / "simple.json"
PREVIEW_DIR = pathlib.Path.home() / "projects" / "pipeline" / "games" / "skull" / "assets"

Px = tuple[int, int, int, int]

# ---------------------------------------------------------------- 调色板（spec 第 2 节）
P = {
    "ink": "#1e0d0b",
    "night_bg": "#04050b", "night_bg2": "#180a0a",
    "wood0": "#2b140d", "wood1": "#3b1c12", "wood2": "#5d2a16", "wood3": "#7b3b19", "wood4": "#995021",
    "dwood0": "#7a3e1e", "dwood1": "#a4552a", "dwood2": "#c8883f", "dwood3": "#d9a05a",
    "brass0": "#865923", "brass1": "#ad7f38", "brass2": "#c99a42", "brass3": "#e8b661",
    "copper0": "#7f3a17", "copper1": "#bb6023", "copper2": "#e6872f",
    "inset0": "#2b140d", "inset1": "#532714", "inset2": "#693a1d",
    "bone0": "#9c8a6a", "bone1": "#d2c2a1", "bone2": "#f2e6c8", "eye": "#2b140d",
    "rose0": "#8f1f1c", "rose1": "#c8352b", "rose2": "#e85a48",
    "leaf0": "#2d5320", "leaf1": "#4f8a32", "leaf2": "#74ad48",
    "silver0": "#6f7480", "silver1": "#a9aeb8", "silver2": "#dde2ea", "pearl": "#efe6d6", "pearl0": "#cfc3ad",
    "wax": "#f0c27a", "wax0": "#c98f4a", "flame": "#ffcf6b", "flame_core": "#fbf6d7", "flame_out": "#e6872f",
    "sun": "#fbefc2", "cream": "#fff4dc",
    "face": "#f4c66a", "face_hi": "#fde4a0", "face_dk": "#d9963a",
    "skin": "#f2cf9a", "skin_dk": "#d6a46a",
    "smoke": "#6a5a6a", "smoke_lt": "#9a8a9a",
    "white": "#ffffff", "pink": "#e8907a", "tongue": "#d9604f", "mouth": "#5a1c18", "tear": "#8fd0f0",
    "green_ok": "#44b860", "green_dk": "#1f6a33",
}

# 6 个座位：key、亮色、皮革（暗、主、亮）
SEATS = [
    ("red", "#e5533f", ("#421412", "#6c2115", "#843618")),
    ("blue", "#3b82f0", ("#16233f", "#24406e", "#33588f")),
    ("green", "#44b860", ("#15301b", "#24502e", "#336b3e")),
    ("yellow", "#f0c030", ("#3d2a08", "#6b4b12", "#8c661c")),
    ("purple", "#9b6ad6", ("#2a1638", "#46265e", "#5e357c")),
    ("cyan", "#36c2c9", ("#0f3032", "#1b5154", "#266d70")),
]

DISC_W, DISC_H, FLIP_H = 32, 36, 40
MAT_W, MAT_H = 56, 64
CLEAR: Px = (0, 0, 0, 0)


def rgba(h: str, a: int = 255) -> Px:
    h = h.lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def C(name: str, a: int = 255) -> Px:
    return rgba(P[name], a) if name in P else rgba(name, a)


def mix(a: Px, b: Px, t: float) -> Px:
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)


def shade(c: Px, f: float) -> Px:
    return tuple(max(0, min(255, round(v * f))) for v in c[:3]) + (c[3],)


def new(w: int, h: int, fill: Px = CLEAR) -> Image.Image:
    return Image.new("RGBA", (w, h), fill)


def strip(frames: list[Image.Image]) -> Image.Image:
    fw, fh = frames[0].size
    out = new(fw * len(frames), fh)
    for i, fr in enumerate(frames):
        out.alpha_composite(fr, (i * fw, 0))
    return out


def outline(img: Image.Image, color: Px | None = None, diag: bool = False) -> Image.Image:
    """沿不透明区域的外轮廓描 1px 边（只描在透明像素上）。"""
    color = color or C("ink")
    w, h = img.size
    src = img.load()
    out = img.copy()
    dst = out.load()
    nb = [(-1, 0), (1, 0), (0, -1), (0, 1)] + ([(-1, -1), (1, 1), (-1, 1), (1, -1)] if diag else [])
    for y in range(h):
        for x in range(w):
            if src[x, y][3] > 0:
                continue
            for dx, dy in nb:
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3] >= 200:
                    dst[x, y] = color
                    break
    return out


def stamp(img: Image.Image, rows: list[str], x0: int, y0: int, cmap: dict[str, Px]) -> None:
    for r, row in enumerate(rows):
        for c, ch in enumerate(row):
            if ch in cmap:
                x, y = x0 + c, y0 + r
                if 0 <= x < img.width and 0 <= y < img.height:
                    img.putpixel((x, y), cmap[ch])


def blob(img: Image.Image, cx: float, cy: float, rx: float, ry: float, base: Px, hi: Px | None = None,
         lo: Px | None = None, k_hi: float = -0.55, k_lo: float = 0.55) -> None:
    """实心椭圆，左上亮、右下暗（按到中心的方向分 3 档）。"""
    px = img.load()
    for y in range(math.floor(cy - ry) - 1, math.ceil(cy + ry) + 2):
        for x in range(math.floor(cx - rx) - 1, math.ceil(cx + rx) + 2):
            if not (0 <= x < img.width and 0 <= y < img.height):
                continue
            dx, dy = (x - cx) / rx, (y - cy) / ry
            d2 = dx * dx + dy * dy
            if d2 > 1.0:
                continue
            col = base
            proj = (dx + dy) / 1.4142
            if lo is not None and proj > k_lo and d2 > 0.35:
                col = lo
            elif hi is not None and proj < k_hi and d2 > 0.3:
                col = hi
            px[x, y] = col


def rect(img: Image.Image, x0: int, y0: int, x1: int, y1: int, col: Px) -> None:
    ImageDraw.Draw(img).rectangle([x0, y0, x1, y1], fill=col)


# ---------------------------------------------------------------- 小图案（ASCII）
ROSE_BLOOM = [
    "...oooooo...",
    ".ooLLRRRRoo.",
    "oLLRRoooRRDo",
    "oLRoDLLDoRDo",
    "oLRoDRoDoRDo",
    "oRRRooDoRRDo",
    "oRRRRRRRRDDo",
    ".oDRRRRRDDo.",
    "..ooDDDDoo..",
    "....oooo....",
]
ROSE_LEAVES = [
    ".....oGo.....",
    ".ooo.oGo.ooo.",
    "oHGGooGooGGHo",
    "ogGGGoGoGGGgo",
    ".oogggGgggoo.",
    "....ooGoo....",
    ".....ooo.....",
]


def rose_cmap(muted: bool = False) -> dict[str, Px]:
    if muted:  # 白镴浮雕：玫瑰压暗
        return {"o": C("ink"), "L": C("rose1"), "R": C("rose0"), "D": shade(C("rose0"), 0.75),
                "G": C("leaf0"), "g": shade(C("leaf0"), 0.8), "H": C("leaf1")}
    return {"o": C("ink"), "L": C("rose2"), "R": C("rose1"), "D": C("rose0"),
            "G": C("leaf1"), "g": C("leaf0"), "H": C("leaf2")}


def draw_rose(img: Image.Image, x0: int, y0: int, muted: bool = False) -> None:
    """12×16 的玫瑰（花 + 叶），(x0, y0) 是花的左上角。"""
    cm = rose_cmap(muted)
    stamp(img, ROSE_LEAVES, x0, y0 + 9, cm)
    stamp(img, ROSE_BLOOM, x0, y0, cm)


def skull_layer(w: int, h: int, cx: float, top: int, s: float = 1.0, jaw: int = 0, blink: bool = False) -> Image.Image:
    """卡通大眼骷髅（不描边的填色层 + 内部细节），s 是缩放（1.0 ≈ 14×15）。jaw 是下巴张开的像素。"""
    lay = new(w, h)
    bone, hi, lo, eye = C("bone1"), C("bone2"), C("bone0"), C("eye")
    rx, ry = 7.0 * s, 6.2 * s
    hcy = top + ry
    blob(lay, cx, hcy, rx, ry, bone, hi, lo)
    # 颧骨到下巴
    jw = round(4.5 * s)
    jt = round(hcy + ry * 0.55)
    jb = round(hcy + ry + 2.5 * s)
    rect(lay, round(cx - jw), jt, round(cx + jw) - 1, round(hcy + ry) - 1, bone)
    rect(lay, round(cx - jw) + 1, round(hcy + ry) + jaw, round(cx + jw) - 2, jb + jaw, bone)
    rect(lay, round(cx + jw) - 2, jt, round(cx + jw) - 1, round(hcy + ry) - 1, lo)
    lay = outline(lay)
    px = lay.load()
    # 眼睛
    er = 2.5 * s
    for ex in (cx - 3.2 * s, cx + 3.2 * s):
        ey = hcy + 0.6 * s
        if blink:
            rect(lay, round(ex - er), round(ey), round(ex + er) - 1, round(ey) + max(0, round(s) - 1), eye)
            continue
        for y in range(h):
            for x in range(w):
                if ((x - ex + 0.5) / er) ** 2 + ((y - ey + 0.5) / (er * 1.05)) ** 2 <= 1.0:
                    px[x, y] = eye
        hx, hy = round(ex - er * 0.45), round(ey - er * 0.45)
        if 0 <= hx < w and 0 <= hy < h:
            px[hx, hy] = hi
    # 鼻子
    nx, ny = round(cx) - 1, round(hcy + ry * 0.62)
    rect(lay, nx, ny, nx + 1, ny + max(0, round(s) - 1), eye)
    # 牙缝
    ty0, ty1 = round(hcy + ry) + jaw, jb + jaw - 1
    for tx in range(round(cx - jw) + 2, round(cx + jw) - 2, max(2, round(2 * s))):
        rect(lay, tx, ty0, tx, ty1, lo)
    if jaw:
        rect(lay, round(cx - jw) + 1, round(hcy + ry), round(cx + jw) - 2, round(hcy + ry) + jaw - 1, eye)
    return lay


# ---------------------------------------------------------------- 垫子
def coin(w: int, h: int, d: int, thick: int, rim: tuple[Px, Px, Px], edge: tuple[Px, Px], inset: tuple[Px, Px, Px],
         ring: int, x0: int = 0, y0: int = 0, reeded: bool = True) -> Image.Image:
    """斜上方看的一枚圆片：上面 d×d 是正面，下面 thick 行是厚度。rim/inset = (主, 亮, 暗)。"""
    img = new(w, h)
    px = img.load()
    r = d / 2
    cx, cy = x0 + r - 0.5, y0 + r - 0.5
    # 厚度：下移 thick 的圆和中间连接带
    for y in range(h):
        for x in range(w):
            inside_lo = ((x - cx) ** 2 + (y - cy - thick) ** 2) <= (r - 0.5) ** 2
            band = cy <= y <= cy + thick and abs(x - cx) <= r - 0.5
            if inside_lo or band:
                col = edge[0]
                if reeded and (x - x0) % 3 == 2:
                    col = edge[1]
                if x > cx + r * 0.55:
                    col = edge[1]
                px[x, y] = col
    # 正面
    for y in range(h):
        for x in range(w):
            dx, dy = x - cx, y - cy
            dist = math.hypot(dx, dy)
            if dist > r - 0.5:
                continue
            proj = (dx + dy) / max(dist, 0.01)
            if dist > r - 0.5 - ring:  # 外圈
                col = rim[0]
                if proj < -0.9:
                    col = rim[1]
                elif proj > 0.9:
                    col = rim[2]
                px[x, y] = col
            elif dist > r - 1.5 - ring:  # 刻线
                px[x, y] = rim[2] if proj < 0.6 else rim[1]
            else:  # 凹下去的内底：左上内壁暗、右下亮
                col = inset[0]
                if dist > r - 2.6 - ring:
                    col = inset[2] if proj < -0.3 else (inset[1] if proj > 0.5 else inset[0])
                px[x, y] = col
    img = outline(img)
    # 外圈高光点
    hx, hy = round(cx - r * 0.55), round(cy - r * 0.62)
    if 0 <= hx < w and 0 <= hy < h:
        px = img.load()
        px[hx, hy] = C("white")
        if hx + 1 < w:
            px[hx + 1, hy] = rim[1]
    return img


def disc_base(kind: str) -> Image.Image:
    if kind == "brass":
        return coin(DISC_W, DISC_H, 32, 4, (C("brass2"), C("brass3"), C("brass0")), (C("brass1"), C("brass0")),
                    (C("brass1"), C("brass2"), C("brass0")), 3)
    if kind == "silver":
        return coin(DISC_W, DISC_H, 32, 4, (C("silver1"), C("silver2"), C("silver0")),
                    (C("silver1"), C("silver0")), (C("pearl"), C("white"), C("pearl0")), 3)
    return coin(DISC_W, DISC_H, 32, 4, (C("copper2"), C("brass3"), C("copper0")), (C("copper1"), C("copper0")),
                (C("inset1"), C("inset2"), C("inset0")), 3)


def swirl(img: Image.Image, cx: float, cy: float, rmax: float, hi: Px, lo: Px, arms: int = 3, turn: float = 2.3) -> None:
    """刻出来的三叉漩涡：先画右下 1px 的暗影，再画亮线。"""
    pts: list[tuple[int, int]] = []
    for a in range(arms):
        base = a * 2 * math.pi / arms - math.pi / 2
        t = 0.0
        while t <= 1.0:
            rr = 1.2 + (rmax - 1.2) * t
            th = base + turn * t
            p = (round(cx + rr * math.cos(th)), round(cy + rr * math.sin(th)))
            if p not in pts:
                pts.append(p)
            t += 0.01
    px = img.load()
    for x, y in pts:
        if (x + 1, y + 1) not in pts:
            px[x + 1, y + 1] = lo
    for x, y in pts:
        px[x, y] = hi
    px[round(cx), round(cy)] = lo


def disc_back() -> Image.Image:
    img = disc_base("brass")
    swirl(img, 15.5, 15.5, 8.4, C("brass3"), C("brass0"))
    return img


def disc_rose() -> Image.Image:
    img = disc_base("copper")
    draw_rose(img, 10, 7)
    return img


def disc_skull() -> Image.Image:
    img = disc_base("copper")
    img.alpha_composite(skull_layer(32, 36, 16, 7, 1.0))
    return img


def disc_lc(up: bool) -> Image.Image:
    img = disc_base("silver")
    draw_rose(img, 10, 7, muted=not up)
    px = img.load()
    if up:  # 已翻开：亮闪闪
        for x, y in ((6, 9), (25, 7), (24, 24)):
            px[x, y] = C("white")
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                px[x + dx, y + dy] = C("silver2")
    else:  # 扣着：内圈多一道浮雕细线
        ImageDraw.Draw(img).arc([7, 7, 24, 24], 200, 340, fill=C("pearl0"))
    return img


def flip(back: Image.Image, face: Image.Image) -> Image.Image:
    """8 帧 32×40：0 扣着，1 拿起，2–3 背面压扁，4 侧面，5–6 正面展开，7 平放（= 正面静态图）。"""
    plan = [(back, 1.0, 0), (back, 1.0, 4), (back, 0.72, 4), (back, 0.38, 4),
            (None, 0.0, 4), (face, 0.38, 4), (face, 0.72, 3), (face, 1.0, 0)]
    frames = []
    for src, sx, lift in plan:
        fr = new(DISC_W, FLIP_H)
        top = 4 - lift
        if lift:  # 原位留一块影子（两档）
            sh = new(DISC_W, FLIP_H)
            ImageDraw.Draw(sh).ellipse([2, 10, 29, 39], fill=rgba(P["ink"], 70))
            ImageDraw.Draw(sh).ellipse([6, 14, 25, 35], fill=rgba(P["ink"], 120))
            fr.alpha_composite(sh)
        if src is None:  # 侧面：一条带厚度的竖条
            lay = new(DISC_W, FLIP_H)
            rect(lay, 15, top + 1, 16, top + DISC_H - 3, C("brass2"))
            rect(lay, 17, top + 1, 17, top + DISC_H - 3, C("brass0"))
            lay = outline(lay)
            fr.alpha_composite(lay)
        else:
            w = max(4, round(DISC_W * sx))
            part = src.resize((w, DISC_H), Image.NEAREST)
            if sx < 1:  # 压扁的时候侧边露出来一点（翻动的感觉）
                lay = new(DISC_W, FLIP_H)
                lay.alpha_composite(part, ((DISC_W - w) // 2, top))
                fr.alpha_composite(lay)
            else:
                fr.alpha_composite(part, (0, top))
        frames.append(fr)
    return strip(frames)


# ---------------------------------------------------------------- 垫板
SEAT_MARKS = [  # 左下角的座位小图案（7×7，金线绣），色盲也能分座位
    [".o...o.", "ooo.ooo", ".o...o.", "...o...", "..ooo..", ".ooooo.", "..ooo.."],  # 0 爪印
    ["....oo.", "...ooo.", "..oo.o.", ".oo.o..", ".o.o...", "o.o....", "oo....."],  # 1 羽毛
    ["..ooo..", ".ooooo.", "ooo.ooo", "oo...oo", "ooo.ooo", ".ooooo.", "..ooo.."],  # 2 睡莲叶（缺口圆）
    ["...o...", "...o...", "ooooooo", ".ooooo.", "..ooo..", ".oo.oo.", "o.....o"],  # 3 星星
    ["..ooo..", ".oo....", "oo.....", "oo.....", "oo.....", ".oo....", "..ooo.."],  # 4 月牙
    ["..o....", ".ooooo.", "ooooooo", ".ooooo.", ".ooooo.", "..ooo..", "...o..."],  # 5 橡果
]
BIG_ROSE = [  # 花面中间的暗纹大玫瑰（20×18，只用皮革亮色）
    "......oooooooo......",
    "....oo........oo....",
    "...o...oooooo...o...",
    "..o..oo......oo..o..",
    ".o..o...oooo...o..o.",
    ".o.o...o....o...o.o.",
    "o..o..o..oo..o..o..o",
    "o..o..o.o..o.o..o..o",
    "o..o..o..o...o..o..o",
    "o...o..o....o..o...o",
    ".o...o..oooo..o...o.",
    ".o....oo....oo....o.",
    "..o.....oooo.....o..",
    "...oo..........oo...",
    ".....oooooooooo.....",
    "........o..o........",
    "......oo....oo......",
    ".....o........o.....",
]
ROSE_BIG = [  # 表情用的大玫瑰（16×14）
    ".....oooooo.....",
    "...ooLLLRRRoo...",
    "..oLLRRRRRRRDo..",
    ".oLRRRooooRRRDo.",
    ".oLRRoDLLDoRRDo.",
    "oLRRoDRRRRDoRDDo",
    "oLRRoDRooRDoRDDo",
    "oRRRoDRRoDDoRDDo",
    "oRRRRoDDDDoRRDDo",
    ".oRRRRooooRRRDo.",
    ".oDRRRRRRRRRDDo.",
    "..oDDRRRRRRDDo..",
    "...ooDDDDDDoo...",
    ".....oooooo.....",
]
CORNER_ROSE = [".oo.", "oLRo", "oRDo", ".oG."]


def mat(seat: int, flower: bool) -> Image.Image:
    _key, hexc, (dk, main, lt) = SEATS[seat]
    dk_c, main_c, lt_c, stitch = rgba(dk), rgba(main), rgba(lt), rgba(hexc)
    img = new(MAT_W, MAT_H)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([1, 1, MAT_W - 2, MAT_H - 2], radius=4, fill=main_c)
    px = img.load()
    rnd = random.Random(100 + seat)
    # 皮革纹理：稀疏的暗点和亮点
    for _ in range(90):
        x, y = rnd.randrange(3, MAT_W - 3), rnd.randrange(3, MAT_H - 3)
        px[x, y] = mix(main_c, dk_c, 0.55) if rnd.random() < 0.6 else mix(main_c, lt_c, 0.5)
    # 立体：左上亮边、右下暗边
    for x in range(3, MAT_W - 3):
        px[x, 1] = lt_c
        px[x, MAT_H - 2] = dk_c
        px[x, MAT_H - 3] = mix(main_c, dk_c, 0.5)
    for y in range(3, MAT_H - 3):
        px[1, y] = lt_c
        px[MAT_W - 2, y] = dk_c
    img = outline(img)
    px = img.load()
    # 缝线：座位亮色，2 亮 1 空
    for i, x in enumerate(range(4, MAT_W - 4)):
        if i % 3 != 2:
            px[x, 4] = stitch
            px[x, MAT_H - 5] = stitch
    for i, y in enumerate(range(4, MAT_H - 4)):
        if i % 3 != 2:
            px[4, y] = stitch
            px[MAT_W - 5, y] = stitch
    gold, gold_dk = C("brass3"), C("brass1")
    if flower:
        # 金色刺绣边框（双线）
        d = ImageDraw.Draw(img)
        d.rectangle([7, 7, MAT_W - 8, MAT_H - 8], outline=gold_dk)
        d.rectangle([8, 8, MAT_W - 9, MAT_H - 9], outline=gold)
        # 中间暗纹大玫瑰
        stamp(img, BIG_ROSE, (MAT_W - 20) // 2, 22, {"o": mix(main_c, lt_c, 0.9)})
        # 四角 + 左右中间的小红玫瑰
        cm = {"o": C("ink"), "L": C("rose2"), "R": C("rose1"), "D": C("rose0"), "G": C("leaf1")}
        for x, y in ((6, 6), (MAT_W - 10, 6), (6, MAT_H - 10), (MAT_W - 10, MAT_H - 10), (6, 30), (MAT_W - 10, 30)):
            stamp(img, CORNER_ROSE, x, y, cm)
    # 座位小图案（左下角，避开四角的玫瑰）
    mark_cm = {"o": gold}
    stamp(img, SEAT_MARKS[seat], 12 if flower else 8, MAT_H - (19 if flower else 15), mark_cm)
    return img


# ---------------------------------------------------------------- 场景
def candle_sprite(flame_h: int, sway: int = 0, lit: bool = True, w: int = 16, h: int = 32, wax_h: int = 12) -> Image.Image:
    """小蜡烛：铜烛台 + 蜡 + 火苗（火苗不描边）。烛台底在最下面。"""
    img = new(w, h)
    cx = w // 2
    body = new(w, h)
    # 烛台托盘
    blob(body, cx - 0.5, h - 3, w / 2 - 1.5, 2.2, C("brass2"), C("brass3"), C("brass0"))
    # 蜡（带一道流下来的蜡泪）
    bx0, bx1 = cx - 3, cx + 2
    rect(body, bx0, h - 4 - wax_h, bx1, h - 4, C("wax"))
    rect(body, bx1, h - 4 - wax_h, bx1, h - 4, C("wax0"))
    rect(body, bx0, h - 4 - wax_h, bx0, h - 4 - wax_h + 4, C("cream"))
    body = outline(body)
    img.alpha_composite(body)
    px = img.load()
    top = h - 5 - wax_h
    px[cx - 1, top] = C("ink")  # 烛芯
    if lit:
        for y in range(flame_h):
            t = y / max(1, flame_h - 1)  # 0 = 尖，1 = 底
            half = round(2.4 * math.sin(t * math.pi * 0.9) + 0.2)
            off = round(sway * (1 - t))
            yy = top - flame_h + y
            for x in range(cx - 1 - half + off, cx - 1 + half + off + 1):
                if 0 <= x < w and 0 <= yy < h:
                    edge = x in (cx - 1 - half + off, cx - 1 + half + off) or y == 0
                    px[x, yy] = C("flame_out") if edge else (C("flame_core") if t > 0.55 and abs(x - cx + 1 - off) < 1 else C("flame"))
    return img


def scene(day: bool, variant: int, hero: bool = False) -> Image.Image:
    w, h = 512, 288
    img = new(w, h, C("wood1"))
    px = img.load()
    rnd = random.Random(f"scene{day}{variant}")
    tones = [C("dwood0"), C("dwood1"), C("dwood2")] if day else [C("wood1"), C("wood2"), C("wood2")]
    plank = 40 if variant == 0 else 48
    seam = C("dwood0") if day else C("wood0")
    # 横向木板，每块一种底色，木纹是长短不一的细线，偶尔一个木节
    y = -(plank // 3) * variant
    i = 0
    while y < h:
        base = tones[(i + variant) % 3]
        grain_dk = mix(base, seam, 0.45)
        grain_lt = mix(base, C("dwood3") if day else C("wood3"), 0.35)
        rect(img, 0, max(0, y), w - 1, min(h - 1, y + plank - 1), base)
        for _ in range(26):
            gy = y + rnd.randrange(3, plank - 3)
            gx = rnd.randrange(-40, w)
            ln = rnd.randrange(30, 160)
            col = grain_dk if rnd.random() < 0.65 else grain_lt
            for x in range(max(0, gx), min(w, gx + ln)):
                if 0 <= gy < h:
                    px[x, gy] = col
        for _ in range(2):
            kx, ky = rnd.randrange(20, w - 20), y + rnd.randrange(8, plank - 8)
            if 0 <= ky < h:
                ImageDraw.Draw(img).ellipse([kx - 5, ky - 2, kx + 5, ky + 2], outline=grain_dk)
                ImageDraw.Draw(img).ellipse([kx - 2, ky - 1, kx + 2, ky + 1], fill=grain_dk)
        # 木板接缝 + 下面一行亮边，竖向的板头接缝错开
        if 0 <= y < h:
            rect(img, 0, y, w - 1, y, seam)
            if y + 1 < h:
                rect(img, 0, y + 1, w - 1, y + 1, grain_lt)
        jx = rnd.randrange(60, w - 60)
        rect(img, jx, max(0, y + 1), jx, min(h - 1, y + plank - 1), seam)
        y += plank
        i += 1
    # 中间一块深色皮质桌垫（让垫板区域更干净）
    if not hero:
        pad = new(w, h)
        pd = ImageDraw.Draw(pad)
        leather = rgba("#2e1812") if not day else rgba("#c9a06a")
        pd.rounded_rectangle([56, 34, w - 57, h - 26], radius=10, fill=C("ink"))
        pd.rounded_rectangle([57, 35, w - 58, h - 27], radius=9, fill=leather)
        ppx = pad.load()
        for k in range(120):
            x, yy = rnd.randrange(64, w - 64), rnd.randrange(42, h - 34)
            ppx[x, yy] = shade(leather, 0.82)
        for x in range(62, w - 62):  # 金色压线
            if (x // 2) % 2 == 0:
                ppx[x, 40] = C("brass1") if not day else C("brass0")
                ppx[x, h - 32] = C("brass1") if not day else C("brass0")
        for yy in range(42, h - 32):
            if (yy // 2) % 2 == 0:
                ppx[62, yy] = C("brass1") if not day else C("brass0")
                ppx[w - 63, yy] = C("brass1") if not day else C("brass0")
        img.alpha_composite(pad)
    # 光：夜间四角烛光（同心圆分 3 档），白天左上窗光
    light = new(w, h)
    ld = ImageDraw.Draw(light)
    corners = [(30, 46), (w - 30, 46), (30, h - 40), (w - 30, h - 40)]
    if day:
        for k, a in enumerate((34, 26, 18)):
            off = k * 26
            ld.polygon([(0 + off, 0), (150 + off, 0), (330 + off, h), (170 + off, h)], fill=rgba(P["sun"], a))
    else:
        for cx, cy in corners:
            for r, a in ((54, 24), (36, 32), (20, 42)):
                ld.ellipse([cx - r, cy - 8 - r, cx + r, cy - 8 + r], fill=rgba(P["flame"], a))
    img.alpha_composite(light)
    # 暗角：边缘 3 档压暗
    vig = new(w, h)
    vd = ImageDraw.Draw(vig)
    dark = (4, 5, 11) if not day else (60, 30, 15)
    for k, a in enumerate((150, 95, 50) if not day else (70, 45, 25)):
        vd.rectangle([k * 10, k * 7, w - 1 - k * 10, h - 1 - k * 7], outline=dark + (a,), width=10)
    img.alpha_composite(vig)
    # 蜡烛（夜间四根都点着；白天只点左下一根）
    for idx, (cx, cy) in enumerate(corners):
        lit = (not day) or idx == 2
        c = candle_sprite(9 if lit else 0, sway=(idx % 2), lit=lit)
        img.alpha_composite(c, (cx - 8, cy - 22))
    if not hero:
        # 散落的玫瑰花瓣，只在边上
        for _ in range(7):
            side = rnd.choice(["top", "bottom"])
            x = rnd.randrange(90, w - 90)
            yy = rnd.randrange(8, 26) if side == "top" else rnd.randrange(h - 22, h - 8)
            pet = new(8, 6)
            stamp(pet, [".oo..", "oLRo.", "oRRDo", ".oDo."], 0, 0,
                  {"o": C("ink"), "L": C("rose2"), "R": C("rose1"), "D": C("rose0")})
            img.alpha_composite(pet.resize((16, 12), Image.NEAREST), (x, yy))
    if hero:
        m = mat(0, False).resize((MAT_W * 3, MAT_H * 3), Image.NEAREST)
        mx, my = w // 2 - 84, 46
        img.alpha_composite(m, (mx, my))
        back = disc_back().resize((96, 108), Image.NEAREST)
        for i in range(4):
            img.alpha_composite(back, (mx + 36, my + 3 * (22 - 4 * i)))
        img.alpha_composite(disc_rose().resize((96, 108), Image.NEAREST), (w // 2 - 214, 112))
        img.alpha_composite(disc_skull().resize((96, 108), Image.NEAREST), (w // 2 + 118, 112))
    return img.convert("RGB").convert("RGBA")


# ---------------------------------------------------------------- 界面小图标（16×16）
def icon(draw_fn) -> Image.Image:
    lay = new(16, 16)
    detail = draw_fn(lay)
    lay = outline(lay)
    if detail:
        detail(lay)
    return lay


def ui_disc() -> Image.Image:
    img = coin(16, 16, 15, 0, (C("brass2"), C("brass3"), C("brass0")), (C("brass1"), C("brass0")),
               (C("brass1"), C("brass2"), C("brass0")), 2, 0, 0, reeded=False)
    swirl(img, 7.0, 7.0, 3.6, C("brass3"), C("brass0"), turn=2.0)
    return img


def ui_stack() -> Image.Image:
    """三枚侧着叠起来的小垫子。"""
    lay = new(16, 16)
    for k, y in enumerate((11, 7, 3)):
        top = new(16, 16)
        blob(top, 7.5, y + 2, 6.5, 2.4, C("brass0"))  # 厚度
        rect(top, 1, y, 14, y + 2, C("brass1"))
        rect(top, 10, y, 14, y + 2, C("brass0"))
        blob(top, 7.5, y, 6.5, 2.4, C("brass2"), C("brass3"), None)
        top = outline(top)
        lay.alpha_composite(top)
    px = lay.load()
    px[4, 2] = C("white")
    return lay


def ui_bell() -> Image.Image:
    def body(lay):
        blob(lay, 7.5, 10.5, 5.5, 5.5, C("brass2"), C("brass3"), C("brass0"))
        rect(lay, 0, 11, 15, 15, CLEAR)
        rect(lay, 1, 11, 14, 12, C("brass1"))
        rect(lay, 2, 13, 13, 14, C("wood3"))
        rect(lay, 7, 2, 8, 4, C("brass2"))
        return lambda im: (im.putpixel((5, 7), C("white")), im.putpixel((7, 2), C("brass3")))
    return icon(body)


def ui_pass() -> Image.Image:
    def body(lay):
        skin, dk = C("skin"), C("skin_dk")
        for x0, top in ((3, 4), (6, 2), (9, 1), (12, 3)):
            rect(lay, x0, top, x0 + 1, 9, skin)
        rect(lay, 3, 7, 13, 12, skin)
        rect(lay, 1, 8, 2, 10, skin)  # 拇指
        rect(lay, 0, 7, 1, 8, skin)
        rect(lay, 4, 13, 12, 14, skin)
        rect(lay, 13, 7, 13, 12, dk)
        rect(lay, 4, 13, 12, 13, dk)
        return lambda im: [im.putpixel((x, 11), dk) for x in (6, 7, 8)]
    return icon(body)


def ui_key() -> Image.Image:
    def body(lay):
        blob(lay, 4.5, 5.5, 3.6, 3.6, C("brass2"), C("brass3"), C("brass0"))
        rect(lay, 6, 5, 14, 6, C("brass2"))
        rect(lay, 6, 6, 14, 6, C("brass0"))
        rect(lay, 11, 7, 12, 9, C("brass2"))
        rect(lay, 13, 7, 14, 8, C("brass2"))
        return lambda im: (im.putpixel((4, 5), C("ink")), im.putpixel((4, 6), C("ink")), im.putpixel((3, 4), C("white")))
    return icon(body)


def ui_rose() -> Image.Image:
    img = new(16, 16)
    stamp(img, ["......oGo.......", "..ooo.oGo.ooo...", ".oGGGooGooGGGo..", "..oooooGoooo....", "......ooo......."], 0, 11,
          {"o": C("ink"), "G": C("leaf1")})
    stamp(img, ROSE_BLOOM, 1, 1, rose_cmap())
    return img


def ui_eye() -> Image.Image:
    def body(lay):
        blob(lay, 7.5, 8.0, 7.0, 4.2, C("cream"), None, C("bone1"))
        return lambda im: (
            blob(im, 7.5, 8.0, 3.0, 3.0, rgba("#3b82f0"), None, rgba("#173d80")),
            blob(im, 7.5, 8.0, 1.5, 1.5, C("ink")),
            im.putpixel((6, 6), C("white")),
        )
    return icon(body)


def ui_ready() -> Image.Image:
    img = new(16, 16)
    c = coin(14, 14, 12, 2, (C("brass2"), C("brass3"), C("brass0")), (C("brass1"), C("brass0")),
             (C("brass1"), C("brass2"), C("brass0")), 2, 1, 1, reeded=False)
    img.alpha_composite(c, (0, 1))
    chk = new(16, 16)
    for x, y in ((7, 10), (8, 11), (9, 12), (10, 11), (11, 10), (12, 9), (13, 8), (14, 7)):
        rect(chk, x, y - 1, x, y, C("green_ok"))
    chk = outline(chk, diag=True)
    img.alpha_composite(chk)
    return img


def ui_lc() -> Image.Image:
    img = coin(16, 16, 15, 0, (C("silver1"), C("silver2"), C("silver0")), (C("silver1"), C("silver0")),
               (C("pearl"), C("white"), C("pearl0")), 2, 0, 0, reeded=False)
    stamp(img, [".oo.", "oLRo", "oRDo", ".oo."], 5, 5,
          {"o": C("ink"), "L": C("rose2"), "R": C("rose1"), "D": C("rose0")})
    return img


def ui_thinking() -> Image.Image:
    frames = []
    sand = [(5, 0), (3, 2), (0, 5), (0, 5)]
    for i, (top_sand, bot_sand) in enumerate(sand):
        fr = new(16, 16)
        lay = new(16, 16)
        rect(lay, 3, 1, 12, 2, C("wood3"))
        rect(lay, 3, 13, 12, 14, C("wood3"))
        for y in range(3, 13):  # 玻璃：上宽下窄再变宽
            half = max(1, abs(y - 7.5) * 0.9 + 0.2)
            rect(lay, round(7.5 - half), y, round(7.5 + half) - 1, y, C("cream", 255))
        lay = outline(lay)
        px = lay.load()
        for y in range(3, 3 + top_sand):  # 上面的沙
            half = max(1, abs(y - 7.5) * 0.9 + 0.2) - 1
            for x in range(round(7.5 - half), round(7.5 + half)):
                px[x, y + (5 - top_sand)] = C("brass2")
        for y in range(13 - bot_sand, 13):
            half = max(1, abs(y - 7.5) * 0.9 + 0.2) - 1
            for x in range(round(7.5 - half), round(7.5 + half)):
                px[x, y] = C("brass2")
        if 0 < top_sand < 5:
            px[7, 8] = C("brass2")
            px[7, 10] = C("brass2")
        if i == 3:
            lay = lay.rotate(90, resample=Image.NEAREST)
        fr.alpha_composite(lay)
        frames.append(fr)
    return strip(frames)


# ---------------------------------------------------------------- 32 / 48 / 大图标
def ui_lantern() -> Image.Image:
    lay = new(32, 32)
    # 提环
    ImageDraw.Draw(lay).arc([11, 0, 20, 9], 180, 360, fill=C("brass1"), width=2)
    rect(lay, 10, 5, 21, 7, C("brass2"))  # 顶盖
    rect(lay, 12, 3, 19, 5, C("brass1"))
    rect(lay, 9, 8, 22, 25, C("flame"))  # 玻璃（亮）
    rect(lay, 9, 26, 22, 28, C("brass2"))  # 底座
    rect(lay, 11, 29, 20, 30, C("brass1"))
    lay = outline(lay)
    px = lay.load()
    for y in range(8, 26):  # 框条
        px[9, y] = C("brass1")
        px[22, y] = C("brass0")
        px[15, y] = C("brass1") if y % 4 else C("brass2")
        px[16, y] = C("brass1") if y % 4 else C("brass2")
    for x in range(10, 22):
        if x not in (15, 16):
            px[x, 8] = mix(C("flame"), C("flame_out"), 0.5)
    # 火苗
    for y, (a, b) in enumerate(((12, 12), (11, 13), (11, 13), (10, 14), (10, 14), (11, 13)), start=13):
        for x in range(a, b + 1):
            px[x, y] = C("flame_out") if x in (a, b) else C("flame_core")
    for y, (a, b) in enumerate(((19, 19), (18, 20), (18, 20), (17, 21), (17, 21), (18, 20)), start=13):
        for x in range(a, b + 1):
            px[x, y] = C("flame_out") if x in (a, b) else C("flame_core")
    for x in range(10, 22):
        px[x, 26] = C("brass3")
    px[11, 10] = C("white")
    return lay


def out_candle(h: int = 32, smoke: int = 2) -> Image.Image:
    """熄灭的蜡烛 + 一缕烟（下面 32 行对齐 ui/out）。"""
    img = new(32, h)
    body = candle_sprite(0, lit=False, w=32, h=32, wax_h=16)
    img.alpha_composite(body, (0, h - 32))
    px = img.load()
    top = h - 32 + 32 - 5 - 16
    curl = [(0, -1), (1, -2), (1, -3), (0, -4), (-1, -5), (-1, -6), (0, -7), (1, -8)]
    for k, (dx, dy) in enumerate(curl[: 4 + smoke * 2]):
        x, y = 15 + dx, top + dy
        if 0 <= y < h:
            px[x, y] = C("smoke_lt") if k < 4 else C("smoke")
    return img


def ui_trophy() -> Image.Image:
    lay = new(48, 48)
    d = ImageDraw.Draw(lay)
    # 杯身
    for y in range(12, 29):
        t = (y - 12) / 16
        half = round(12 - 7 * t * t)
        rect(lay, 24 - half, y, 23 + half, y, C("brass2"))
    # 把手
    d.arc([4, 12, 14, 24], 90, 270, fill=C("brass2"), width=2)
    d.arc([33, 12, 43, 24], 270, 90, fill=C("brass2"), width=2)
    rect(lay, 21, 29, 26, 37, C("brass2"))  # 杯脚
    rect(lay, 15, 38, 32, 41, C("brass2"))  # 底座
    rect(lay, 13, 42, 34, 44, C("brass1"))
    lay = outline(lay)
    px = lay.load()
    for y in range(12, 29):  # 右侧阴影、左侧高光
        t = (y - 12) / 16
        half = round(12 - 7 * t * t)
        px[23 + half, y] = C("brass0")
        px[22 + half, y] = C("brass1")
        if y < 25:
            px[26 - half, y] = C("brass3")
    for x in range(12, 36):
        px[x, 12] = C("brass3")
    for y in range(29, 38):
        px[26, y] = C("brass0")
        px[21, y] = C("brass3")
    for x in range(15, 33):
        px[x, 38] = C("brass3")
    # 杯里插一朵玫瑰
    draw_rose(lay, 18, 0)
    px[15, 16] = C("white")
    px[16, 15] = C("white")
    return lay


def ui_ribbon() -> Image.Image:
    lay = new(96, 24)
    d = ImageDraw.Draw(lay)
    # 两头燕尾（暗一档，在后面）
    d.polygon([(1, 6), (16, 6), (16, 21), (1, 21), (7, 13)], fill=C("rose0"))
    d.polygon([(94, 6), (79, 6), (79, 21), (94, 21), (88, 13)], fill=C("rose0"))
    lay = outline(lay)
    front = new(96, 24)
    rect(front, 12, 1, 83, 18, C("rose1"))
    front = outline(front)
    px = front.load()
    for x in range(12, 84):
        px[x, 2] = C("rose2")
        px[x, 17] = C("rose0")
        px[x, 4] = C("brass2") if x % 2 == 0 else C("rose1")
        px[x, 15] = C("brass2") if x % 2 == 0 else C("rose1")
    lay.alpha_composite(front)
    # 折角的阴影
    for y in range(19, 22):
        lay.putpixel((15, y), C("ink"))
        lay.putpixel((80, y), C("ink"))
    return lay


def ui_bubble() -> Image.Image:
    img = new(40, 44)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([1, 1, 38, 38], radius=6, fill=C("cream"))
    d.polygon([(7, 38), (7, 42), (13, 38)], fill=C("cream"))
    img = outline(img)
    px = img.load()
    for x in range(4, 36):  # 右下暗边
        px[x, 37] = C("bone1")
    for y in range(4, 36):
        px[37, y] = C("bone1")
    px[4, 3] = C("white")
    px[5, 3] = C("white")
    px[3, 4] = C("white")
    return img


def ui_frame() -> Image.Image:
    img = new(24, 24)
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, 23, 23], fill=C("ink"))
    d.rectangle([1, 1, 22, 22], fill=C("wood2"))
    d.rectangle([2, 2, 21, 21], fill=C("wood3"))
    d.line([2, 2, 21, 2], fill=C("wood4"))
    d.line([2, 2, 2, 21], fill=C("wood4"))
    d.rectangle([5, 5, 18, 18], fill=C("brass1"))
    d.rectangle([6, 6, 17, 17], fill=C("ink"))
    d.rectangle([7, 7, 16, 16], fill=CLEAR)
    for x, y in ((1, 1), (17, 1), (1, 17), (17, 17)):  # 黄铜包角
        d.rectangle([x, y, x + 5, y + 5], fill=C("brass2"))
        d.line([x, y, x + 5, y], fill=C("brass3"))
        d.line([x, y, x, y + 5], fill=C("brass3"))
        img.putpixel((x + 2, y + 2), C("brass0"))
    return img


# ---------------------------------------------------------------- 头像（32×32，围巾是座位色）
def eyes(px, coords, r: float = 1.6, iris: Px | None = None, slit: bool = False) -> None:
    for ex, ey in coords:
        for y in range(round(ey - r) - 1, round(ey + r) + 2):
            for x in range(round(ex - r) - 1, round(ex + r) + 2):
                if (x - ex) ** 2 + (y - ey) ** 2 <= r * r:
                    px[x, y] = iris or C("eye")
        if slit:
            px[round(ex), round(ey)] = C("eye")
            px[round(ex), round(ey) - 1] = C("eye")
            px[round(ex), round(ey) + 1] = C("eye")
        px[round(ex - r * 0.5), round(ey - r * 0.5)] = C("white")


def scarf(lay: Image.Image, hexc: str) -> None:
    c = rgba(hexc)
    dk = shade(c, 0.62)
    lt = mix(c, C("white"), 0.35)
    rect(lay, 7, 24, 24, 27, c)
    rect(lay, 5, 28, 26, 31, c)
    px = lay.load()
    for x in range(7, 25):
        px[x, 24] = lt
        px[x, 27] = dk
    rect(lay, 18, 26, 21, 31, dk)  # 垂下来的一头
    rect(lay, 19, 26, 20, 30, c)


def avatar(seat: int) -> Image.Image:
    _key, hexc, _leather = SEATS[seat]
    lay = new(32, 32)
    d = ImageDraw.Draw(lay)
    post = None
    if seat == 0:  # 狐狸
        fur, fur_hi, fur_lo, cream = rgba("#d9752f"), rgba("#f0a050"), rgba("#a8521f"), C("cream")
        d.polygon([(5, 3), (12, 9), (6, 13)], fill=fur)
        d.polygon([(26, 3), (19, 9), (25, 13)], fill=fur)
        blob(lay, 15.5, 15, 10.5, 9, fur, fur_hi, fur_lo)
        d.polygon([(8, 16), (15, 25), (16, 25), (23, 16), (16, 19), (15, 19)], fill=cream)
        scarf(lay, hexc)

        def post(px):
            for x, y in ((7, 6), (8, 7), (24, 6), (23, 7)):
                px[x, y] = rgba("#5a2a12")
            eyes(px, [(11.5, 14.5), (19.5, 14.5)], 1.9)
            px[15, 21], px[16, 21] = C("ink"), C("ink")
    elif seat == 1:  # 乌鸦
        feather, hi, lo = rgba("#33324a"), rgba("#55547a"), rgba("#201f30")
        blob(lay, 15.5, 14, 10, 10, feather, hi, lo)
        d.polygon([(13, 4), (15, 0), (17, 3), (19, 1), (19, 6)], fill=feather)
        d.polygon([(13, 17), (18, 17), (15, 24)], fill=rgba("#d9a441"))
        scarf(lay, hexc)

        def post(px):
            for (ex, ey) in ((10.5, 13.5), (20.5, 13.5)):
                for y in range(11, 17):
                    for x in range(round(ex) - 3, round(ex) + 3):
                        if (x - ex) ** 2 + (y - ey) ** 2 <= 6.5:
                            px[x, y] = C("cream")
            eyes(px, [(10.5, 13.5), (20.5, 13.5)], 1.6)
            for x in range(14, 18):
                px[x, 17] = rgba("#f0c860")
            px[15, 21] = rgba("#a87420")
    elif seat == 2:  # 蛤蟆（棕色疣皮）
        skin, hi, lo = rgba("#8a6a3a"), rgba("#b08c52"), rgba("#634a26")
        blob(lay, 15.5, 17, 13, 8, skin, hi, lo)
        blob(lay, 9.5, 9.5, 4.5, 4.5, skin, hi, lo)
        blob(lay, 21.5, 9.5, 4.5, 4.5, skin, hi, lo)
        blob(lay, 15.5, 21, 9, 3, rgba("#c8b07a"))
        scarf(lay, hexc)

        def post(px):
            eyes(px, [(9.5, 9.5), (21.5, 9.5)], 2.6, iris=rgba("#e8b640"))
            for (ex, ey) in ((9.5, 9.5), (21.5, 9.5)):
                for x in range(round(ex) - 2, round(ex) + 2):
                    px[x, round(ey)] = C("eye")
                px[round(ex) - 1, round(ey) - 2] = C("white")
            for x in range(8, 24):  # 宽嘴
                px[x, 18 + (1 if 11 < x < 20 else 0)] = C("ink")
            for x, y in ((6, 15), (25, 16), (12, 13), (19, 14), (4, 19), (27, 19)):  # 疣
                px[x, y] = lo
    elif seat == 3:  # 浣熊
        fur, hi, lo = rgba("#8c8a94"), rgba("#b4b2bc"), rgba("#64626c")
        blob(lay, 7.5, 6.5, 3.5, 3.5, fur, hi, lo)
        blob(lay, 23.5, 6.5, 3.5, 3.5, fur, hi, lo)
        blob(lay, 15.5, 15, 11, 9.5, fur, hi, lo)
        blob(lay, 15.5, 20, 5, 3.5, C("cream"))
        scarf(lay, hexc)

        def post(px):
            for y in range(12, 17):  # 黑眼罩
                for x in range(6, 26):
                    if not (14 <= x <= 17 and y < 14):
                        px[x, y] = rgba("#2a2830")
            for x in range(8, 24):
                px[x, 10] = C("cream")
            eyes(px, [(10.5, 14), (20.5, 14)], 1.6, iris=C("cream"))
            eyes(px, [(10.5, 14), (20.5, 14)], 1.0)
            px[7, 6], px[24, 6] = rgba("#2a2830"), rgba("#2a2830")
            px[15, 19], px[16, 19] = C("ink"), C("ink")
    elif seat == 4:  # 黑猫
        fur, hi, lo = rgba("#2e2838"), rgba("#4a4258"), rgba("#1f1a26")
        d.polygon([(5, 2), (13, 8), (6, 13)], fill=fur)
        d.polygon([(26, 2), (18, 8), (25, 13)], fill=fur)
        blob(lay, 15.5, 15, 11, 9.5, fur, hi, lo)
        scarf(lay, hexc)

        def post(px):
            for x, y in ((7, 6), (8, 7), (24, 6), (23, 7)):
                px[x, y] = C("pink")
            eyes(px, [(11, 14), (20, 14)], 2.3, iris=rgba("#c8e04a"), slit=True)
            px[15, 18], px[16, 18] = C("pink"), C("pink")
            for x, y in ((3, 17), (4, 18), (27, 17), (26, 18), (3, 20), (28, 20)):  # 胡须
                px[x, y] = rgba("#9a90a8")
    else:  # 獾
        fur, hi, lo = rgba("#7c7a80"), rgba("#a4a2a8"), rgba("#58565c")
        blob(lay, 7.5, 7.5, 3, 3, fur, hi, lo)
        blob(lay, 23.5, 7.5, 3, 3, fur, hi, lo)
        blob(lay, 15.5, 15.5, 11, 9.5, fur, hi, lo)
        scarf(lay, hexc)

        def post(px):
            for y in range(6, 23):  # 白脸 + 两道黑条
                for x in range(4, 28):
                    if px[x, y][3] and not (24 <= y):
                        dx = abs(x - 15.5)
                        if dx < 2.5:
                            px[x, y] = C("cream")
                        elif dx < 6.5:
                            px[x, y] = rgba("#25232a")
                        elif dx < 9 and y > 12:
                            px[x, y] = C("cream")
            eyes(px, [(11, 14.5), (20, 14.5)], 1.5, iris=C("cream"))
            eyes(px, [(11, 14.5), (20, 14.5)], 0.9)
            px[15, 20], px[16, 20] = C("ink"), C("ink")
    lay = outline(lay)
    if post:
        post(lay.load())
    return lay


# ---------------------------------------------------------------- 快捷表情（4 帧 32×32）
def face_base(dy: int = 0, dx: int = 0) -> Image.Image:
    lay = new(32, 32)
    blob(lay, 15.5 + dx, 16.5 + dy, 11.5, 11, C("face"), C("face_hi"), C("face_dk"))
    return lay


def put(px, pts, col):
    for x, y in pts:
        if 0 <= x < 32 and 0 <= y < 32:
            px[x, y] = col


def big_eye(px, ex: int, ey: int, look: tuple[int, int] = (0, 0), size: int = 4) -> None:
    """白眼 + 黑眼珠，size = 4 是 4×5。"""
    for y in range(ey, ey + size + 1):
        for x in range(ex, ex + size):
            corner = (x in (ex, ex + size - 1)) and (y in (ey, ey + size))
            if not corner:
                px[x, y] = C("white")
    put(px, [(ex - 1, y) for y in range(ey + 1, ey + size)] + [(ex + size, y) for y in range(ey + 1, ey + size)]
        + [(x, ey - 1) for x in range(ex + 1, ex + size - 1)] + [(x, ey + size + 1) for x in range(ex + 1, ex + size - 1)], C("ink"))
    put(px, [(ex, ey), (ex + size - 1, ey), (ex, ey + size), (ex + size - 1, ey + size)], C("ink"))
    bx, by = ex + 1 + look[0], ey + 1 + look[1]
    put(px, [(bx, by), (bx + 1, by), (bx, by + 1), (bx + 1, by + 1), (bx, by + 2), (bx + 1, by + 2)], C("eye"))
    put(px, [(bx, by)], C("white"))


def closed_eye(px, ex: int, ey: int, happy: bool = True) -> None:
    if happy:  # ^ 形
        put(px, [(ex, ey + 2), (ex + 1, ey + 1), (ex + 2, ey + 1), (ex + 3, ey + 2)], C("ink"))
    else:
        put(px, [(ex, ey + 2), (ex + 1, ey + 2), (ex + 2, ey + 2), (ex + 3, ey + 2)], C("ink"))


def hand(lay: Image.Image, x: int, y: int) -> None:
    blob(lay, x, y, 2.6, 2.3, C("face"), C("face_hi"), C("face_dk"))


def emote_face(kind: str, i: int) -> Image.Image:
    if kind == "shock":
        dy = [0, -3, -4, -1][i]
    elif kind == "laugh":
        dy = [0, -1, 0, -1][i]
    elif kind == "shrug":
        dy = [0, -1, -1, 0][i]
    elif kind == "taunt":
        dy = [0, -1, 0, -1][i]
    else:
        dy = 0
    dx = [0, 1, 0, -1][i] if kind == "laugh" else 0
    lay = face_base(dy, dx)
    extra = new(32, 32)
    if kind == "shrug":  # 两只小手，掌心朝上，一耸一耸
        hy = 22 + dy - [0, 2, 3, 1][i]
        hand(extra, 3, hy)
        hand(extra, 28, hy)
    if kind == "think":  # 托下巴的手
        hand(extra, 21, 27)
    lay.alpha_composite(extra)
    lay = outline(lay)
    px = lay.load()
    y0 = 12 + dy
    cx = 15 + dx
    if kind == "taunt":
        closed_eye(px, cx - 7, y0, happy=False)
        big_eye(px, cx + 3, y0 - 1, (1, 0))
        brow = [0, -2, 0, -2][i]
        put(px, [(cx + 3, y0 - 3 + brow), (cx + 4, y0 - 4 + brow), (cx + 5, y0 - 4 + brow), (cx + 6, y0 - 3 + brow)], C("ink"))
        put(px, [(cx - 7, y0 - 2), (cx - 6, y0 - 2), (cx - 5, y0 - 2), (cx - 4, y0 - 1)], C("ink"))
        put(px, [(cx - 3, y0 + 9), (cx - 2, y0 + 9), (cx - 1, y0 + 9), (cx, y0 + 9), (cx + 1, y0 + 8), (cx + 2, y0 + 8),
                 (cx + 3, y0 + 7), (cx + 4, y0 + 6)], C("ink"))
        put(px, [(cx + 1, y0 + 9), (cx + 2, y0 + 9), (cx + 1, y0 + 10), (cx + 2, y0 + 10)], C("tongue"))
        put(px, [(cx, y0 + 10), (cx + 3, y0 + 10), (cx + 1, y0 + 11), (cx + 2, y0 + 11)], C("ink"))
    elif kind == "shrug":
        big_eye(px, cx - 7, y0, (0, 1))
        big_eye(px, cx + 3, y0, (0, 1))
        put(px, [(cx - 8, y0 - 3), (cx - 7, y0 - 3), (cx - 6, y0 - 2), (cx + 4, y0 - 2), (cx + 5, y0 - 3), (cx + 6, y0 - 3)], C("ink"))
        put(px, [(x, y0 + 9) for x in range(cx - 3, cx + 4)] + [(cx - 4, y0 + 10), (cx + 4, y0 + 10)], C("ink"))
    elif kind == "think":
        big_eye(px, cx - 7, y0, (1, -1))
        big_eye(px, cx + 3, y0, (1, -1))
        put(px, [(cx + 3, y0 - 3), (cx + 4, y0 - 3), (cx + 5, y0 - 3), (cx + 6, y0 - 2)], C("ink"))
        put(px, [(cx - 1, y0 + 9), (cx, y0 + 9), (cx + 1, y0 + 9), (cx + 2, y0 + 8)], C("ink"))
        for k in range(i):  # 头顶的三个小点一个一个出现
            put(px, [(22 + k * 3, 3), (23 + k * 3, 3), (22 + k * 3, 4), (23 + k * 3, 4)], C("cream"))
            put(px, [(21 + k * 3, 3), (21 + k * 3, 4), (24 + k * 3, 3), (24 + k * 3, 4),
                     (22 + k * 3, 2), (23 + k * 3, 2), (22 + k * 3, 5), (23 + k * 3, 5)], C("ink"))
    elif kind == "laugh":
        closed_eye(px, cx - 7, y0)
        closed_eye(px, cx + 3, y0)
        my = y0 + 6
        for y in range(my, my + 6):  # 张大的嘴
            half = [5, 5, 4, 4, 3, 2][y - my]
            for x in range(cx - half + 1, cx + half + 1):
                px[x, y] = C("mouth")
        for x in range(cx - 3, cx + 3):
            px[x, my + 4] = C("tongue")
            px[x, my + 5] = C("tongue") if abs(x - cx + 0.5) < 2 else px[x, my + 5]
        put(px, [(x, my) for x in range(cx - 4, cx + 6)], C("white"))
        put(px, [(cx - 5, my), (cx + 6, my)] + [(cx - 5 + k // 2, my + k) for k in range(1, 6)]
            + [(cx + 6 - k // 2, my + k) for k in range(1, 6)] + [(x, my + 6) for x in range(cx - 2, cx + 4)], C("ink"))
        tear = [(3, y0 + 1 - i), (28, y0 + 1 - i)] if i % 2 == 0 else [(2, y0 - 1), (29, y0 - 1)]
        for x, y in tear:
            put(px, [(x, y), (x, y + 1)], C("tear"))
    elif kind == "sweat":
        look = [(-1, 0), (-1, 0), (1, 0), (1, 0)][i]
        big_eye(px, cx - 7, y0, look)
        big_eye(px, cx + 3, y0, look)
        for k, x in enumerate(range(cx - 4, cx + 5)):  # 波浪嘴
            put(px, [(x, y0 + 9 + (k % 2))], C("ink"))
        sy = 5 + i * 2  # 汗珠往下滑
        put(px, [(25, sy), (24, sy + 1), (25, sy + 1), (26, sy + 1), (24, sy + 2), (25, sy + 2), (26, sy + 2)], C("tear"))
        put(px, [(25, sy - 1), (23, sy + 1), (27, sy + 1), (23, sy + 2), (27, sy + 2), (24, sy + 3), (25, sy + 3), (26, sy + 3)], rgba("#2a6a8a"))
        put(px, [(25, sy + 1)], C("white"))
    elif kind == "shock":
        big_eye(px, cx - 8, y0 - 1, (0, 0), 5)
        big_eye(px, cx + 3, y0 - 1, (0, 0), 5)
        put(px, [(cx - 8, y0 - 4), (cx - 7, y0 - 5), (cx - 6, y0 - 5), (cx + 5, y0 - 5), (cx + 6, y0 - 5), (cx + 7, y0 - 4)], C("ink"))
        my = y0 + 7
        for y in range(my, my + 4):
            for x in range(cx - 1, cx + 3):
                px[x, y] = C("mouth")
        put(px, [(x, my - 1) for x in range(cx - 1, cx + 3)] + [(x, my + 4) for x in range(cx - 1, cx + 3)]
            + [(cx - 2, y) for y in range(my, my + 4)] + [(cx + 3, y) for y in range(my, my + 4)], C("ink"))
    return lay


def emote(kind: str) -> Image.Image:
    frames = []
    for i in range(4):
        fr = new(32, 32)
        if kind == "rose":
            lay = new(32, 32)
            sway = [0, 1, 0, -1][i]
            # 花茎 + 叶子 + 花（花头随帧左右摇）
            stem = new(32, 32)
            for y in range(15, 30):
                x = 15 + (sway if y < 20 else 0)
                stem.putpixel((x, y), C("leaf1"))
                stem.putpixel((x + 1, y), C("leaf0"))
            stamp(stem, ["..GGG", ".GGHG", "GGGG.", "GG..."], 9, 20, {"G": C("leaf1"), "H": C("leaf2")})
            stamp(stem, ["GGG..", "GHGG.", ".GGGG", "...GG"], 18, 23, {"G": C("leaf1"), "H": C("leaf2")})
            stem = outline(stem)
            lay.alpha_composite(stem)
            stamp(lay, ROSE_BIG, 8 + sway, 3, rose_cmap())
            if i == 2:  # 掉一片花瓣
                stamp(lay, [".oo.", "oLRo", ".oo."], 22, 20, {"o": C("ink"), "L": C("rose2"), "R": C("rose1")})
            if i == 3:
                stamp(lay, [".oo.", "oLRo", ".oo."], 23, 25, {"o": C("ink"), "L": C("rose2"), "R": C("rose1")})
            fr.alpha_composite(lay)
        elif kind == "skull":
            jaw = [0, 2, 0, 2][i]
            fr.alpha_composite(skull_layer(32, 32, 16, 3 + (1 if i % 2 else 0), 1.55, jaw=jaw, blink=(i == 3)))
        else:
            fr.alpha_composite(emote_face(kind, i))
        frames.append(fr)
    return strip(frames)


# ---------------------------------------------------------------- 特效
PETAL = [".oo.", "oLRo", "oRDo", ".oo."]
PETAL_CM = None


def petal_cm():
    return {"o": C("ink"), "L": C("rose2"), "R": C("rose1"), "D": C("rose0")}


def sparkle_px(px, x: int, y: int, size: int, w: int, h: int, col: Px | None = None) -> None:
    col = col or C("brass3")
    pts = [(x, y)]
    for k in range(1, size + 1):
        pts += [(x + k, y), (x - k, y), (x, y + k), (x, y - k)]
    for a, b in pts:
        if 0 <= a < w and 0 <= b < h:
            px[a, b] = col
    if 0 <= x < w and 0 <= y < h:
        px[x, y] = C("white")


def fx_skull_hit() -> Image.Image:
    frames = []
    rnd = random.Random("hit")
    shards = [(rnd.uniform(0, 2 * math.pi), rnd.uniform(0.6, 1.0)) for _ in range(9)]
    puffs = [(rnd.uniform(0, 2 * math.pi), rnd.uniform(0.55, 0.9)) for _ in range(7)]
    for i in range(8):
        fr = new(64, 64)
        if i == 7:
            frames.append(fr)
            continue
        c = 31.5
        t = (i + 1) / 7
        d = ImageDraw.Draw(fr)
        # 烟团（暗紫灰，往外散，越来越淡）
        smoke = new(64, 64)
        for ang, sp in puffs:
            rr = 18 + 10 * t * sp
            x, y = c + rr * math.cos(ang), c + rr * math.sin(ang) - 3 * t
            r = 2 + 3 * t
            if i >= 1:
                blob(smoke, x, y, r, r, C("smoke"), C("smoke_lt"), shade(C("smoke"), 0.75))
        smoke = outline(smoke)
        a = [0, 230, 220, 200, 160, 120, 80][i]
        smoke.putalpha(smoke.getchannel("A").point(lambda v: min(v, a)))
        fr.alpha_composite(smoke)
        # 冲击环
        if i <= 4:
            r = 16 + 13 * (i / 4)
            wdt = [4, 3, 2, 2, 1][i]
            d.ellipse([c - r, c - r, c + r, c + r], outline=C("ink"), width=wdt + 2)
            d.ellipse([c - r + 1, c - r + 1, c + r - 1, c + r - 1], outline=C("bone2"), width=wdt)
        # 冲击线（直的，从垫子边往外射）
        if 1 <= i <= 4:
            for k in range(8):
                ang = k * math.pi / 4 + math.pi / 8
                r0 = 17 + 5 * i
                r1 = r0 + [7, 6, 4, 3][i - 1]
                a0 = (round(c + r0 * math.cos(ang)), round(c + r0 * math.sin(ang)))
                a1 = (round(c + r1 * math.cos(ang)), round(c + r1 * math.sin(ang)))
                d.line([a0, a1], fill=C("ink"), width=3)
                d.line([a0, a1], fill=C("bone2"), width=1)
        # 骨白碎片
        for ang, sp in shards:
            rr = 16 + 15 * t * sp
            x, y = round(c + rr * math.cos(ang)), round(c + rr * math.sin(ang) + 6 * t * t)
            d.rectangle([x - 1, y - 1, x + 1, y], fill=C("ink"))
            d.rectangle([x, y - 1, x, y - 1], fill=C("bone2"))
        if i == 0:  # 第一帧白色闪光星
            px = fr.load()
            for k in range(1, 12):
                for (dx, dy) in ((k, 0), (-k, 0), (0, k), (0, -k)):
                    px[int(c + dx), int(c + dy)] = C("bone2") if k > 3 else C("white")
            blob(fr, c, c, 5, 5, C("white"))
        frames.append(fr)
    return strip(frames)


def fx_petal_burst(size: int, n: int, count: int, seed: str, sparks: int, ring: bool) -> Image.Image:
    rnd = random.Random(seed)
    parts = [(rnd.uniform(0, 2 * math.pi), rnd.uniform(0.55, 1.0), rnd.randrange(2)) for _ in range(count)]
    sp = [(rnd.uniform(0, 2 * math.pi), rnd.uniform(0.4, 0.95)) for _ in range(sparks)]
    frames = []
    c = size / 2 - 0.5
    for i in range(n):
        fr = new(size, size)
        if i == n - 1:
            frames.append(fr)
            continue
        t = (i + 1) / (n - 1)
        if ring and i < n // 2:
            r = size * 0.18 + size * 0.28 * (i / (n // 2))
            d = ImageDraw.Draw(fr)
            d.ellipse([c - r, c - r, c + r, c + r], outline=C("brass1"), width=3)
            d.ellipse([c - r + 1, c - r + 1, c + r - 1, c + r - 1], outline=C("brass3"), width=1)
        for ang, spd, small in parts:
            rr = (size / 2 - 4) * spd * math.sin(t * math.pi / 2)
            x = round(c + rr * math.cos(ang)) - 2
            y = round(c + rr * math.sin(ang) + (size / 10) * t * t) - 2
            pet = PETAL if not small else [".o.", "oRo", ".o."]
            stamp(fr, pet, x, y, petal_cm())
        px = fr.load()
        for k, (ang, spd) in enumerate(sp):
            if (i + k) % 3 == 2:
                continue  # 闪烁
            rr = (size / 2 - 3) * spd * t
            sparkle_px(px, round(c + rr * math.cos(ang)), round(c + rr * math.sin(ang)), 1 + (k + i) % 2, size, size)
        frames.append(fr)
    return strip(frames)


def fx_mat_win() -> Image.Image:
    frames = []
    # 沿垫板金线一圈的点（从四个角同时往两边亮过去）
    border = []
    for x in range(8, MAT_W - 8):
        border.append((x, 8))
    for y in range(8, MAT_H - 8):
        border.append((MAT_W - 9, y))
    for x in range(MAT_W - 9, 7, -1):
        border.append((x, MAT_H - 9))
    for y in range(MAT_H - 9, 7, -1):
        border.append((8, y))
    L = len(border)
    corners = [0, (MAT_W - 16), (MAT_W - 16) + (MAT_H - 16), 2 * (MAT_W - 16) + (MAT_H - 16)]
    for i in range(8):
        fr = new(MAT_W, MAT_H)
        if i < 7:
            px = fr.load()
            reach = round((i + 1) / 7 * (L / 8 + 2))
            for cidx in corners:
                for k in range(-reach, reach + 1):
                    x, y = border[(cidx + k) % L]
                    px[x, y] = C("white") if abs(abs(k) - reach) <= 1 else C("brass3")
                    if abs(abs(k) - reach) <= 1:
                        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                            if 0 <= x + dx < MAT_W and 0 <= y + dy < MAT_H:
                                px[x + dx, y + dy] = C("flame")
            for k, (x, y) in enumerate(((10, 10), (MAT_W - 11, 10), (10, MAT_H - 11), (MAT_W - 11, MAT_H - 11), (28, 32))):
                if (i + k) % 2 == 0 and i >= 1:
                    sparkle_px(px, x, y, 1 + (i % 3 == 0), MAT_W, MAT_H)
        frames.append(fr)
    return strip(frames)


def fx_lose_disc(back: Image.Image) -> Image.Image:
    frames = []
    left = back.crop((0, 0, 16, DISC_H))
    right = back.crop((16, 0, 32, DISC_H))
    for i in range(8):
        fr = new(DISC_W, FLIP_H)
        if i == 0:
            fr.alpha_composite(back, (0, 4))
        elif i == 1:  # 裂开
            fr.alpha_composite(back, (0, 4))
            d = ImageDraw.Draw(fr)
            d.line([(16, 5), (14, 12), (17, 18), (15, 25), (16, 32)], fill=C("ink"), width=2)
        elif i < 7:  # 两半分开、往下掉、变淡，冒烟
            t = (i - 1) / 5
            a = int(255 * (1 - t * 0.9))
            lh, rh = left.copy(), right.copy()
            for part in (lh, rh):
                part.putalpha(part.getchannel("A").point(lambda v: min(v, a)))
            off = round(2 + 5 * t)
            fr.alpha_composite(lh, (max(0, 0 - off), 4 + round(4 * t)))
            fr.alpha_composite(rh, (min(16, 16 + off), 4 + round(4 * t)))
            smoke = new(DISC_W, FLIP_H)
            for k in range(4):
                x = 8 + k * 5
                y = 26 - 20 * t - (k % 2) * 3
                r = 1.5 + 3 * t
                blob(smoke, x, y, r, r, C("smoke"), C("smoke_lt"))
            sa = int(220 * (1 - t * 0.6))
            smoke.putalpha(smoke.getchannel("A").point(lambda v: min(v, sa)))
            fr.alpha_composite(smoke)
        frames.append(fr)
    return strip(frames)


def fx_snuff() -> Image.Image:
    frames = []
    plan = [(9, 0), (10, 1), (8, -1), (9, 1), (5, 0), (2, 0), (0, 0)]
    for i, (fh, sway) in enumerate(plan):
        fr = new(32, 48)
        c = candle_sprite(fh, sway, lit=fh > 0, w=32, h=32, wax_h=16)
        fr.alpha_composite(c, (0, 16))
        if fh == 0:  # 刚熄灭：一团烟
            sm = new(32, 48)
            blob(sm, 15, 15, 3, 3, C("smoke_lt"))
            blob(sm, 16, 10, 4, 3.5, C("smoke"))
            sm = outline(sm)
            sm.putalpha(sm.getchannel("A").point(lambda v: min(v, 200)))
            fr.alpha_composite(sm)
        frames.append(fr)
    last = new(32, 48)
    last.alpha_composite(out_candle(32), (0, 16))
    frames.append(last)
    return strip(frames)


def fx_candle() -> Image.Image:
    frames = []
    for fh, sway in ((8, 0), (9, 1), (7, 0), (9, -1)):
        frames.append(candle_sprite(fh, sway))
    return strip(frames)


def fx_petals() -> Image.Image:
    rnd = random.Random("petals")
    ps = [(rnd.randrange(4, 56), rnd.randrange(0, 64), rnd.randrange(2), rnd.uniform(0, 6.28)) for _ in range(10)]
    frames = []
    for i in range(8):
        fr = new(64, 64)
        for x0, y0, small, ph in ps:
            y = (y0 + i * 8) % 64  # 8 帧下落 64px，正好接上
            x = x0 + round(2 * math.sin(ph + i * math.pi / 4))
            pet = PETAL if not small else [".oo", "oRo", ".o."]
            for wrap in (0, -64):
                stamp(fr, pet, x, y + wrap, petal_cm())
        frames.append(fr)
    return strip(frames)


def fx_sparkle() -> Image.Image:
    frames = []
    for size in (0, 1, 3, 5, 3, 1):
        fr = new(16, 16)
        px = fr.load()
        if size:
            sparkle_px(px, 7, 7, size, 16, 16)
            if size >= 3:
                for dx, dy in ((1, 1), (-1, -1), (1, -1), (-1, 1)):
                    px[7 + dx, 7 + dy] = C("flame")
        else:
            px[7, 7] = C("brass3")
        frames.append(fr)
    return strip(frames)


# ---------------------------------------------------------------- 清单（和 spec.md 第 9 节一致）
EMOTES = ["rose", "skull", "taunt", "shrug", "think", "laugh", "sweat", "shock"]


def build() -> dict[str, Image.Image]:
    files: dict[str, Image.Image] = {}
    back, rose, skull = disc_back(), disc_rose(), disc_skull()
    lc_down, lc_up = disc_lc(False), disc_lc(True)
    files["discs/back.png"] = back
    files["discs/rose.png"] = rose
    files["discs/skull.png"] = skull
    files["discs/lc-down.png"] = lc_down
    files["discs/lc-up.png"] = lc_up
    for s in range(6):
        files[f"mats/mat-{s}-blank.png"] = mat(s, False)
        files[f"mats/mat-{s}-flower.png"] = mat(s, True)
    files["scene/night-0.png"] = scene(False, 0)
    files["scene/night-1.png"] = scene(False, 1)
    files["scene/day-0.png"] = scene(True, 0)
    files["scene/day-1.png"] = scene(True, 1)
    files["scene/hero.png"] = scene(False, 2, hero=True)
    files["ui/disc.png"] = ui_disc()
    files["ui/stack.png"] = ui_stack()
    files["ui/bell.png"] = ui_bell()
    files["ui/pass.png"] = ui_pass()
    files["ui/key.png"] = ui_key()
    files["ui/rose.png"] = ui_rose()
    files["ui/eye.png"] = ui_eye()
    files["ui/ready.png"] = ui_ready()
    files["ui/lc.png"] = ui_lc()
    files["ui/thinking.png"] = ui_thinking()
    files["ui/lantern.png"] = ui_lantern()
    files["ui/out.png"] = out_candle(32)
    files["ui/trophy.png"] = ui_trophy()
    files["ui/ribbon.png"] = ui_ribbon()
    files["ui/bubble.png"] = ui_bubble()
    files["ui/frame.png"] = ui_frame()
    for s in range(6):
        files[f"avatars/avatar-{s}.png"] = avatar(s)
    for e in EMOTES:
        files[f"emotes/{e}.png"] = emote(e)
    files["fx/flip-rose.png"] = flip(back, rose)
    files["fx/flip-skull.png"] = flip(back, skull)
    files["fx/flip-lc.png"] = flip(lc_down, lc_up)
    files["fx/skull-hit.png"] = fx_skull_hit()
    files["fx/rose-pop.png"] = fx_petal_burst(48, 6, 10, "pop", 6, ring=False)
    files["fx/success.png"] = fx_petal_burst(96, 8, 16, "win", 10, ring=True)
    files["fx/mat-win.png"] = fx_mat_win()
    files["fx/lose-disc.png"] = fx_lose_disc(back)
    files["fx/snuff.png"] = fx_snuff()
    files["fx/candle.png"] = fx_candle()
    files["fx/petals.png"] = fx_petals()
    files["fx/sparkle.png"] = fx_sparkle()
    return files


def sha(path: pathlib.Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def generate() -> dict[str, Image.Image]:
    files = build()
    manifest = {}
    for rel, img in files.items():
        path = OUT / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, optimize=True)
        manifest[rel] = {"size": list(img.size), "sha256": sha(path)}
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n")
    print(f"共 {len(files)} 个文件 → {OUT}；哈希表 {MANIFEST}")
    return files


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
    for title, items in (("还是简洁版", still), ("缺文件", missing), ("尺寸和 spec 不一样", wrong)):
        print(f"{title}：{len(items)}")
        for item in items:
            print("  ", item)
    return 1 if missing or wrong else 0


# ---------------------------------------------------------------- 预览（真实显示尺寸的牌桌模拟）
def up(img: Image.Image, k: int) -> Image.Image:
    return img.resize((img.width * k, img.height * k), Image.NEAREST)


def cover(img: Image.Image, w: int, h: int) -> Image.Image:
    s = max(w / img.width, h / img.height)
    big = img.resize((math.ceil(img.width * s), math.ceil(img.height * s)), Image.NEAREST)
    x, y = (big.width - w) // 2, (big.height - h) // 2
    return big.crop((x, y, x + w, y + h))


def frame_of(sheet: Image.Image, i: int, fw: int) -> Image.Image:
    return sheet.crop((i * fw, 0, (i + 1) * fw, sheet.height))


def seat_block(files, seat: int, k: int, stack: list[str], flower: bool, flip_frame: Image.Image | None = None) -> Image.Image:
    m = up(files[f"mats/mat-{seat}-{'flower' if flower else 'blank'}.png"], k)
    for i, face in enumerate(stack):
        m.alpha_composite(up(files[f"discs/{face}.png"], k), (12 * k, (22 - 4 * i) * k))
    if flip_frame is not None:
        i = len(stack)
        m.alpha_composite(up(flip_frame, k), (12 * k, (22 - 4 * i - 4) * k))
    return m


def plate(files, seat: int, k: int, w: int, h: int, icons: list[str], dim: bool = False) -> Image.Image:
    img = new(w, h, rgba("#1b0f0b", 235))
    d = ImageDraw.Draw(img)
    d.rectangle([0, 0, w - 1, h - 1], outline=rgba(SEATS[seat][1]), width=max(2, k))
    av = up(files[f"avatars/avatar-{seat}.png"], max(1, k - 1) if k > 1 else 1)
    img.alpha_composite(av, (4, (h - av.height) // 2))
    x = av.width + 10
    d.rectangle([x, 8, x + w // 3, 8 + 12 * max(1, k // 2) - 1], fill=rgba("#fff4dc", 180))  # 名字占位条（代替 HTML 字）
    for j, ic in enumerate(icons):
        im = up(files[f"ui/{ic}.png"], max(1, k - 1))
        img.alpha_composite(im, (x + j * (im.width + 4), h - im.height - 6))
    if dim:
        img.alpha_composite(new(w, h, (0, 0, 0, 120)))
    return img


def preview(files: dict[str, Image.Image]) -> list[pathlib.Path]:
    outs = []
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    flip_sk = files["fx/flip-skull.png"]
    # ---- 1440×790 桌面，3×，夜间
    for theme in ("night", "day"):
        W, H, k = 1440, 790, 3
        can = cover(files[f"scene/{theme}-0.png"], W, H)
        d = ImageDraw.Draw(can)
        d.rectangle([0, 0, W - 1, 43], fill=rgba("#140a08") if theme == "night" else rgba("#f3e6cc"))
        d.rectangle([W - 300, 44, W - 1, H - 1], fill=rgba("#140a08", 220) if theme == "night" else rgba("#f3e6cc", 230))
        seats = [
            (1, ["back", "back", "back"], False, ["stack", "disc"], False),
            (2, ["back", "back"], True, ["stack", "rose"], False),
            (3, ["back"], False, ["pass"], True),
            (4, ["back", "back", "rose"], False, ["stack"], False),
            (5, ["back", "back", "back", "back", "lc-down"], False, ["lc"], False),
        ]
        pos = [(24, 92), (384, 92), (744, 92), (24, 296), (744, 296)]
        for (seat, stack, flower, icons, dim), (x, y) in zip(seats, pos):
            fl = frame_of(flip_sk, 1, 32) if seat == 2 else None
            blk = seat_block(files, seat, k, stack, flower, fl)
            if dim:
                blk.alpha_composite(new(blk.width, blk.height, (0, 0, 0, 110)))
            can.alpha_composite(blk, (x, y))
            can.alpha_composite(plate(files, seat, k, 160, 72, icons, dim), (x + 176, y + 60))
        # 中间：场上总数 + 当前叫价（HTML 字的位置用色块代替）
        can.alpha_composite(up(files["ui/stack.png"], 3), (420, 380))
        can.alpha_composite(up(files["ui/bell.png"], 3), (560, 380))
        # 自己：垫板 + 名牌 + 手牌 2× + 表情气泡
        can.alpha_composite(seat_block(files, 0, k, ["rose", "rose"], False), (24, 520))
        can.alpha_composite(plate(files, 0, k, 160, 72, ["disc", "key"]), (200, 580))
        for j, face in enumerate(["rose", "skull"]):
            can.alpha_composite(up(files[f"discs/{face}.png"], 2), (380 + j * 72, 600))
        bub = up(files["ui/bubble.png"], 2)
        bub.alpha_composite(up(frame_of(files["emotes/laugh.png"], 0, 32), 2), (8, 8))
        can.alpha_composite(bub, (520, 186))
        bub2 = up(files["ui/bubble.png"], 2)
        bub2.alpha_composite(up(frame_of(files["emotes/taunt.png"], 1, 32), 2), (8, 8))
        can.alpha_composite(bub2, (860, 380))
        can.alpha_composite(up(files["ui/lantern.png"], 2), (330, 520))
        can.alpha_composite(up(frame_of(files["fx/candle.png"], 1, 16), 3), (W - 360, 700))
        p = PREVIEW_DIR / f"simple-preview-1440-{theme}.png"
        can.convert("RGB").save(p)
        outs.append(p)
    # ---- 390×664 手机：对手 1×，手牌 2×
    W, H = 390, 664
    can = cover(files["scene/night-1.png"], W, H)
    d = ImageDraw.Draw(can)
    d.rectangle([0, 0, W - 1, 39], fill=rgba("#140a08"))
    stacks = [["back", "back"], ["back", "back", "back", "back"], ["back"], ["back", "rose", "back"], ["lc-down", "back"]]
    for n, seat in enumerate(range(1, 6)):
        col, row = n % 3, n // 3
        x, y = 8 + col * 126, 80 + row * 116
        flower = seat == 2
        fl = frame_of(files["fx/flip-rose.png"], 5, 32) if seat == 4 else None
        can.alpha_composite(seat_block(files, seat, 1, stacks[n], flower, fl), (x, y))
        can.alpha_composite(plate(files, seat, 1, 120, 40, ["stack", "disc"]), (x - 2, y + 66))
    # 揭牌聚光：中间 3× 演翻面
    can.alpha_composite(up(frame_of(files["fx/flip-skull.png"], 7, 32), 3), (147, 316))
    can.alpha_composite(up(frame_of(files["fx/skull-hit.png"], 2, 64), 3).crop((24, 24, 168, 168)), (123, 304))
    can.alpha_composite(seat_block(files, 0, 1, ["rose"], False), (8, 480))
    can.alpha_composite(plate(files, 0, 1, 120, 40, ["disc", "key"]), (6, 548))
    for j, face in enumerate(["rose", "rose", "skull"]):
        can.alpha_composite(up(files[f"discs/{face}.png"], 2), (140 + j * 70, 488))
    bub = up(files["ui/bubble.png"], 2)
    bub.alpha_composite(up(frame_of(files["emotes/sweat.png"], 2, 32), 2), (8, 8))
    can.alpha_composite(bub, (280, 40))
    p = PREVIEW_DIR / "simple-preview-390.png"
    can.convert("RGB").save(p)
    outs.append(p)
    # ---- 总览：每个文件 3×（场景 1×），深底和浅底各一半
    pad, x, y, row_h, width = 10, 10, 10, 0, 1800
    placed = []
    for rel, img in files.items():
        big = up(img, 3) if img.width <= 128 else (up(img, 2) if img.width <= 300 else img)
        if rel.startswith("fx/") and img.width > 300:
            big = up(img, 2) if img.width * 2 <= width - 20 else img
        if x + big.width > width:
            x, y, row_h = 10, y + row_h + pad, 0
        placed.append((big, x, y))
        x += big.width + pad
        row_h = max(row_h, big.height)
    sheet = new(width, y + row_h + 10, rgba("#2a1a14"))
    half = new(width // 2, sheet.height, rgba("#f3e6cc"))
    sheet.alpha_composite(half, (width // 2, 0))
    for big, px_, py in placed:
        sheet.alpha_composite(big, (px_, py))
    p = PREVIEW_DIR / "simple-sheet.png"
    sheet.convert("RGB").save(p)
    outs.append(p)
    for o in outs:
        print(o)
    return outs


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(check())
    files = generate()
    if "--preview" in sys.argv:
        preview(files)
