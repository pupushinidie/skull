"""代码画的界面小图：气泡、九宫格边框、缎带、16px 小垫子图标、沙漏。

用法：python art/uicode.py → art/out/ui/code-*.png（预览拼图 out/ui/code-sheet.png）
"""
from __future__ import annotations

import math

from PIL import Image

from pix import CLEAR, OUT, ascii_img, contact, mix, on_bg, outline, rgba, strip


def rounded_rect(w, h, r, x0=0, y0=0):
    pts = set()
    for y in range(h):
        for x in range(w):
            cx = min(max(x + 0.5, r), w - r)
            cy = min(max(y + 0.5, r), h - r)
            if math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r:
                pts.add((x + x0, y + y0))
    return pts


def bubble() -> Image.Image:
    """40×44：奶白圆角气泡（0..39 × 0..39），左下一个小尾巴；表情帧贴在 (4,4)。"""
    im = Image.new("RGBA", (40, 44), CLEAR)
    px = im.load()
    body = rounded_rect(40, 40, 7.5)
    tail = set()
    for y in range(36, 44):
        # 尾巴：从气泡底边左侧往左下斜出去
        k = y - 36
        for x in range(6 - k // 2, 15 - k):
            if x >= 0:
                tail.add((x, y))
    shape = body | tail
    for (x, y) in shape:
        px[x, y] = rgba("#f6ecd6")
    # 光影：左上亮一圈，右下暗一圈
    for (x, y) in shape:
        def ins(dx, dy):
            return (x + dx, y + dy) in shape
        if not ins(-1, 0) or not ins(0, -1) or not ins(1, 0) or not ins(0, 1):
            continue
        if not ins(-2, 0) or not ins(0, -2):
            px[x, y] = rgba("#fffaf0")
        elif not ins(2, 0) or not ins(0, 2):
            px[x, y] = rgba("#d8c49e")
    out = Image.new("RGBA", im.size, CLEAR)
    o = out.load()
    for (x, y) in shape:
        edge = any((x + dx, y + dy) not in shape for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)))
        o[x, y] = rgba("ink") if edge else px[x, y]
    return out


def frame() -> Image.Image:
    """24×24 九宫格边框（border-image 切 8）：深木头边 + 黄铜包角，中间透明。边的 8px 一段可以重复。"""
    im = Image.new("RGBA", (24, 24), CLEAR)
    px = im.load()
    wood = [rgba("#3b1c12"), rgba("#5d2a16"), rgba("#7b3b19"), rgba("#995021")]
    for y in range(24):
        for x in range(24):
            d = min(x, y, 23 - x, 23 - y)
            if d >= 7:
                continue
            if d == 0 or d == 6:
                px[x, y] = rgba("ink")
                continue
            # 木纹：沿着边的方向，周期 8
            along = x if min(y, 23 - y) == d else y
            tone = {1: 3, 2: 2, 3: 2, 4: 1, 5: 0}[d]
            if (along + d * 3) % 8 == 0 and d in (2, 3, 4):
                tone = max(0, tone - 1)
            px[x, y] = wood[tone]
    # 四个黄铜包角（7×7 的 L 形片 + 铆钉）
    brass = {"o": "ink", "h": "#fbe3a0", "b": "#e8b661", "m": "#c99a42", "d": "#865923"}
    corner = [
        "ooooooo",
        "ohbbbmo",
        "obmmdo.",
        "obmhdo.",
        "obddo..",
        "omoo...",
        "oo.....",
    ]
    c = ascii_img(corner, brass)
    for flipx in (False, True):
        for flipy in (False, True):
            cc = c
            if flipx:
                cc = cc.transpose(Image.FLIP_LEFT_RIGHT)
            if flipy:
                cc = cc.transpose(Image.FLIP_TOP_BOTTOM)
            im.alpha_composite(cc, (17 if flipx else 0, 17 if flipy else 0))
    return im


def ribbon() -> Image.Image:
    """96×24 红缎带：中间一条 16px 高的带子，两头燕尾折到后面。"""
    im = Image.new("RGBA", (96, 24), CLEAR)
    px = im.load()
    red, dark, deep, hi = rgba("#c8352b"), rgba("#8f1f1c"), rgba("#5e1512"), rgba("#e85a48")
    # 两头的燕尾（在后面，低 4px）
    for side in (0, 1):
        for y in range(6, 23):
            for x in range(0, 18):
                notch = abs(y - 14.5) * 0.9
                if x < notch:
                    continue
                xx = x if side == 0 else 95 - x
                px[xx, y] = dark if y > 7 else deep
        # 折进去的三角暗面
        for y in range(18, 23):
            for x in range(12, 18 - (y - 18)):
                xx = x if side == 0 else 95 - x
                px[xx, y] = deep
    # 正面带子，稍微有弧度（中间高 1px）
    for x in range(12, 84):
        lift = 1 if 30 <= x <= 65 else 0
        for y in range(2 - lift, 18 - lift):
            c = red
            if y <= 3 - lift:
                c = hi
            elif y >= 16 - lift:
                c = dark
            px[x, y] = c
    return outline(im)


def mini_disc(kind="brass", thick=2) -> Image.Image:
    """16×16：一枚俯视的小垫子（直径 14 的圆 + 下面 2px 厚度）。"""
    tones = {
        "brass": ("#865923", "#c99a42", "#e8b661", "#fbe3a0", "#ad7f38"),
        "silver": ("#6f7480", "#a9aeb8", "#dde2ea", "#ffffff", "#efe6d6"),
    }[kind]
    im = Image.new("RGBA", (16, 16), CLEAR)
    px = im.load()
    cx, cy, r = 8, 7, 6.6
    for y in range(16):
        for x in range(16):
            d0 = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            ds = min(math.hypot(x + 0.5 - cx, y + 0.5 - cy - k) for k in range(1, thick + 1))
            if d0 <= r:
                lit = -((x + 0.5 - cx) + (y + 0.5 - cy)) / max(d0, 0.1)
                if d0 > r - 2:
                    px[x, y] = rgba(tones[2] if lit > 0.5 else tones[1] if lit > -0.6 else tones[0])
                else:
                    px[x, y] = rgba(tones[4])
            elif ds <= r:
                px[x, y] = rgba(tones[0])
    px[5, 3] = rgba(tones[3])
    if kind == "brass":
        for (x, y), c in {(7, 6): 3, (8, 6): 2, (8, 7): 2, (7, 8): 2, (6, 7): 2, (9, 8): 0, (8, 9): 0, (6, 8): 0}.items():
            px[x, y] = rgba(tones[c])
    return outline(im)


def mini_stack() -> Image.Image:
    """16×16：三枚叠起来的扁垫子（斜看）。"""
    im = Image.new("RGBA", (16, 16), CLEAR)
    px = im.load()
    tones = ("#865923", "#c99a42", "#e8b661", "#fbe3a0", "#6e4a1f")
    for i, (top, cx) in enumerate(((10, 7.5), (6, 8.5), (2, 8))):   # 从下往上画，左右错开一点
        cy, rx, ry = top + 2, 6.4, 2.6
        for y in range(16):
            for x in range(16):
                inside_face = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1
                inside_side = any(((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy - k) / ry) ** 2 <= 1 for k in (1, 2))
                if inside_face:
                    e = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2
                    px[x, y] = rgba(tones[2] if e > 0.55 and y < cy else tones[1] if e > 0.55 else tones[4])
                elif inside_side:
                    px[x, y] = rgba(tones[0])
        # 每枚之间留一条描边线（下一枚画上去前加）
        im = outline(im)
        px = im.load()
    px[5, 3] = rgba(tones[3])
    return im


def mini_ready() -> Image.Image:
    im = Image.new("RGBA", (16, 16), CLEAR)
    im.alpha_composite(mini_stack().crop((0, 0, 16, 7)), (-1, 3))
    check = ascii_img([
        "......oo",
        ".....oGo",
        "oo..oGGo",
        "oGooGGo.",
        "oGGGGo..",
        ".oGGo...",
        "..oo....",
    ], {"o": "ink", "G": "#5cc46a"})
    im.alpha_composite(check, (8, 8))
    return im


def mini_lc() -> Image.Image:
    im = mini_disc("silver")
    px = im.load()
    for (x, y), c in {(7, 6): "#e85a48", (8, 6): "#c8352b", (7, 7): "#c8352b", (8, 7): "#8f1f1c",
                      (6, 7): "#c8352b", (9, 7): "#c8352b", (7, 8): "#8f1f1c", (8, 8): "#8f1f1c",
                      (7, 5): "#c8352b", (8, 5): "#e85a48", (7, 9): "#4f8a32", (6, 9): "#4f8a32", (9, 9): "#4f8a32"}.items():
        px[x, y] = rgba(c)
    return im


HOURGLASS = {
    "o": "ink", "b": "#c99a42", "h": "#e8b661", "d": "#865923",
    "g": "#cfe3e8", "s": "#f0c27a", "S": "#c98d4a",
}


def hourglass_frames() -> list[Image.Image]:
    top_full = [
        "obhhhhhhbo",
        "oddddddddo",
        ".ogssssgo.",
        ".ogssssgo.",
        "..ogSSgo..",
        "...oSSo...",
        "...ogso...",
        "..og..go..",
        ".og....go.",
        ".og....go.",
        "obhhhhhhbo",
        "oddddddddo",
    ]
    half = [
        "obhhhhhhbo",
        "oddddddddo",
        ".og....go.",
        ".ogssssgo.",
        "..ogSSgo..",
        "...oSSo...",
        "...ogso...",
        "..og.sgo..",
        ".og.sssgo.",
        ".ogssssgo.",
        "obhhhhhhbo",
        "oddddddddo",
    ]
    bottom = [
        "obhhhhhhbo",
        "oddddddddo",
        ".og....go.",
        ".og....go.",
        "..og..go..",
        "...o..o...",
        "...og.o...",
        "..ogssgo..",
        ".ogssssgo.",
        ".ogSSSSgo.",
        "obhhhhhhbo",
        "oddddddddo",
    ]
    frames = []
    for rows in (top_full, half, bottom):
        f = Image.new("RGBA", (16, 16), CLEAR)
        f.alpha_composite(ascii_img(rows, HOURGLASS), (3, 2))
        frames.append(f)
    # 第 3 帧：翻转到一半（转 90°）
    side = ascii_img(bottom, HOURGLASS).rotate(-90, expand=True)
    f = Image.new("RGBA", (16, 16), CLEAR)
    f.alpha_composite(side, ((16 - side.width) // 2, (16 - side.height) // 2))
    frames.append(f)
    return frames


def build() -> dict[str, Image.Image]:
    return {
        "bubble": bubble(), "frame": frame(), "ribbon": ribbon(),
        "disc": mini_disc(), "stack": mini_stack(), "ready": mini_ready(), "lc": mini_lc(),
        "thinking": strip(hourglass_frames()),
    }


if __name__ == "__main__":
    folder = OUT / "ui"
    folder.mkdir(parents=True, exist_ok=True)
    items = build()
    for k, v in items.items():
        v.save(folder / f"code-{k}.png")
    contact([(k, on_bg(v)) for k, v in items.items()], scale=6, cols=4).save(folder / "code-sheet.png")
    contact([(k, on_bg(v, "#f3ead8")) for k, v in items.items()], scale=6, cols=4, bg="#f3ead8").save(folder / "code-sheet-day.png")
    print("ok")
