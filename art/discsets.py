"""第一轮垫子整套候选：五种面同一外形、同一描边、同一厚度。

- 背面：disc-back 候选 → from_candidate(brass)
- 玫瑰：disc-rose 候选 → from_candidate(copper)
- 骷髅：**和玫瑰用同一个外圈**——把玫瑰候选的花抹成内底，再贴上 disc-skull 候选抠出来的骷髅
- LC：disc-lc 候选 → 外圈调成冷银色、玫瑰调亮到调色板的玫瑰红；lc-down 玫瑰压暗一档（扣着），lc-up 全彩 + 闪光
用法：python art/discsets.py → out/discs/set-*.png 和展示图
"""
from __future__ import annotations

import colorsys
import math
import pathlib

from PIL import Image, ImageChops

import discs
from pix import CLEAR, OUT, contact, harden, mix, on_bg, outline, rgba, showcase, up

R1 = OUT / "r1"


def cand(batch: str, i: int) -> Image.Image:
    p = R1 / batch / (f"{batch}-{i}.png" if i else f"{batch}.png")
    im = Image.open(p).convert("RGBA")
    if batch in ("disc-skull", "disc-skull3"):
        im = ImageChops.offset(im, 16, 0)   # 这一批左右错了半张，卷回来
    return im


def hsv(c):
    return colorsys.rgb_to_hsv(c[0] / 255, c[1] / 255, c[2] / 255)


def is_rose_px(c) -> bool:
    h, s, v = hsv(c)
    hue = h * 360
    return c[3] and s > 0.45 and (hue < 20 or hue > 335 or 70 < hue < 170) and v > 0.2


def field_color(disc: Image.Image) -> tuple:
    """内底最常见的颜色（环形 5–10px 里不是花的像素）。"""
    from collections import Counter
    px = disc.load()
    cnt = Counter()
    for y in range(32):
        for x in range(32):
            c = px[x, y]
            d = math.hypot(x + 0.5 - 16, y + 0.5 - 16)
            if c[3] and 5 < d < 9.5 and not is_rose_px(c) and 70 < sum(c[:3]) < 300:
                cnt[c] += 1
    return cnt.most_common(1)[0][0] if cnt else rgba("#3f1f12")


def clear_motif(disc: Image.Image) -> Image.Image:
    """把内底里的图案抹掉（花、叶和贴着它们的深色描边），换成内底色。"""
    out = disc.copy()
    px = out.load()
    fc = field_color(disc)
    motif = {(x, y) for y in range(32) for x in range(32) if is_rose_px(px[x, y]) and math.hypot(x + 0.5 - 16, y + 0.5 - 16) < 11}
    grown = set(motif)
    for (x, y) in motif:
        for a in (-1, 0, 1):
            for b in (-1, 0, 1):
                q = (x + a, y + b)
                if math.hypot(q[0] + 0.5 - 16, q[1] + 0.5 - 16) < 10.5 and sum(px[q][:3]) < sum(fc[:3]) + 10:
                    grown.add(q)
    for q in grown:
        px[q] = fc
    return out


def skull_motif(i: int, batch: str = "disc-skull", rmax: float = 10) -> Image.Image:
    """从 disc-skull / disc-skull3 候选里抠出骷髅（骨白色的块 + 里面的眼睛、鼻子、牙缝），外面加 1px 描边。"""
    im = cand(batch, i)
    px = im.load()
    W, H = im.size
    bone = set()
    for y in range(H):
        for x in range(W):
            c = px[x, y]
            h, s, v = hsv(c)
            if c[3] and v > 0.62 and s < 0.38 and math.hypot(x + 0.5 - 16, y + 0.5 - 16) < rmax:
                bone.add((x, y))
    # 骷髅的包围区域：从外面洪水填充非骨像素，填不到的就是骷髅里面（眼睛、鼻子）
    xs = [p[0] for p in bone]
    ys = [p[1] for p in bone]
    x0, x1, y0, y1 = min(xs) - 1, max(xs) + 1, min(ys) - 1, max(ys) + 1
    outside = set()
    stack = [(x0, y0)]
    while stack:
        x, y = stack.pop()
        if (x, y) in outside or (x, y) in bone or not (x0 <= x <= x1 and y0 <= y <= y1):
            continue
        outside.add((x, y))
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    motif = Image.new("RGBA", (x1 - x0 + 1, y1 - y0 + 1), CLEAR)
    mp = motif.load()
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if (x, y) not in outside:
                c = px[x, y]
                if (x, y) not in bone:
                    c = rgba("#2b140d")  # 眼窝、鼻孔一律用眼睛色
                mp[x - x0, y - y0] = c
    return outline(motif)


def recolor_lc(disc: Image.Image, bright: bool) -> Image.Image:
    """LC 碟：米色的外圈换成冷银色；玫瑰按亮度排名映射到调色板的玫瑰红（扣着的那面换成暗一档、灰一点的红）。"""
    out = disc.copy()
    px = out.load()
    silver = [rgba(c) for c in ("#5c606b", "#8a8f9b", "#a9aeb8", "#dde2ea", "#f6f8fb")]
    roses = [rgba(c) for c in (("#7a1a18", "#a82a24", "#c8352b", "#e85a48", "#f59a7c") if bright
                                else ("#5e2422", "#7e3631", "#9a4a43", "#b4625a", "#c98078"))]
    rose_px = []
    for y in range(36):
        for x in range(32):
            c = px[x, y]
            if not c[3] or c[:3] == rgba("ink")[:3]:
                continue
            h, s, v = hsv(c)
            hue = h * 360
            d = math.hypot(x + 0.5 - 16, y + 0.5 - 16)
            if y < 32 and d > 10.5 and s < 0.45:        # 外圈
                t = min(4, int(v * 5.2))
                px[x, y] = silver[max(0, min(4, t - 1))]
            elif (hue < 25 or hue > 330) and s > 0.35:   # 玫瑰
                rose_px.append(((x, y), v))
    for (x, y), v in rose_px:
        # 保留原来的明暗（花瓣的卷纹），只把色相、饱和度换成调色板的玫瑰红
        if bright:
            r, g, b = colorsys.hsv_to_rgb(2 / 360, 0.78, min(1.0, v * 1.35 + 0.05))
        else:
            r, g, b = colorsys.hsv_to_rgb(4 / 360, 0.45, min(1.0, v * 1.1 + 0.05))
        px[x, y] = (round(r * 255), round(g * 255), round(b * 255), 255)
    return out


def sparkle(disc: Image.Image) -> Image.Image:
    out = disc.copy()
    px = out.load()
    for (x, y), c in {(24, 5): "#ffffff", (24, 4): "#f6f8fb", (23, 5): "#f6f8fb", (25, 5): "#f6f8fb", (24, 6): "#f6f8fb",
                      (8, 25): "#ffffff"}.items():
        if px[x, y][3]:
            px[x, y] = rgba(c)
    return out


def build(back: int, rose: int, skull: int, lc: int, skull_dy: int = 0, skull_batch: str = "disc-skull",
          skull_r: float = 10) -> dict[str, Image.Image]:
    rose_disc = discs.from_candidate(cand("disc-rose", rose), "copper")
    skull_disc = clear_motif(rose_disc)
    m = skull_motif(skull, skull_batch, skull_r)
    skull_disc.alpha_composite(m, (16 - m.width // 2, 16 - m.height // 2 + skull_dy))
    lc_disc = discs.from_candidate(cand("disc-lc", lc), "silver")
    return {
        "back": discs.from_candidate(cand("disc-back", back), "brass"),
        "rose": rose_disc,
        "skull": skull_disc,
        "lc-down": recolor_lc(lc_disc, bright=False),
        "lc-up": sparkle(recolor_lc(lc_disc, bright=True)),
    }


SETS = {
    "A": dict(back=4, rose=0, skull=13, lc=9),
    "B": dict(back=20, rose=5, skull=5, lc=2),
    "C": dict(back=36, rose=41, skull=51, lc=33),
    # 2026-10-10：骷髅换成 disc-skull3 的大骷髅（占满内圈）
    "E": dict(back=4, rose=0, skull=56, lc=9, skull_batch="disc-skull3", skull_r=11.5),
    "F": dict(back=4, rose=0, skull=58, lc=9, skull_batch="disc-skull3", skull_r=11.5),
    "G": dict(back=36, rose=41, skull=57, lc=33, skull_batch="disc-skull3", skull_r=11.5),
}

ORDER = ["back", "rose", "skull", "lc-down", "lc-up"]


def stack_preview(faces: dict[str, Image.Image], mat: Image.Image | None = None) -> Image.Image:
    """垫板上叠 5 张（4 背面 + 1 LC 碟扣着）、翻开一张玫瑰、一张骷髅的样子，1× 实际尺寸。"""
    W, H = 56 * 3 + 16, 64
    im = Image.new("RGBA", (W, H), CLEAR)
    for k, x0 in enumerate((0, 64, 128)):
        if mat is not None:
            im.alpha_composite(mat, (x0, 0))
        n = [5, 3, 1][k]
        for i in range(n):
            face = "back" if i < 4 else "lc-down"
            if k == 1 and i == n - 1:
                face = "rose"
            if k == 2:
                face = "skull"
            im.alpha_composite(faces[face], (x0 + 12, 22 - 4 * i))
    return im


def sheet(name: str, faces: dict[str, Image.Image], mat: Image.Image | None = None) -> pathlib.Path:
    """一套垫子的展示图：6× 大图 + 3× + 1×（实际像素），夜间、白天两种底；下面一行是垫板上的样子（1× 和 3×）。"""
    row = Image.new("RGBA", (5 * 36, 36), CLEAR)
    for i, k in enumerate(ORDER):
        row.alpha_composite(faces[k], (i * 36, 0))
    top = showcase(row, 6, (3, 1))
    st = stack_preview(faces, mat)
    bottom = showcase(st, 3, (1,))
    out = Image.new("RGBA", (max(top.width, bottom.width), top.height + bottom.height), rgba("#2b140d"))
    out.alpha_composite(top, (0, 0))
    out.alpha_composite(bottom, (0, top.height))
    path = OUT / "discs" / f"set-{name}.png"
    out.save(path)
    return path


if __name__ == "__main__":
    (OUT / "discs").mkdir(parents=True, exist_ok=True)
    mat_path = pathlib.Path(__file__).resolve().parent.parent / "apps/web/public/art/mats/mat-0-blank.png"
    mat = Image.open(mat_path).convert("RGBA") if mat_path.exists() else None
    for name, kw in SETS.items():
        faces = build(**kw)
        for k, v in faces.items():
            v.save(OUT / "discs" / f"set-{name}-{k}.png")
        print(sheet(name, faces, mat))
    code = discs.code_set()
    for k, v in code.items():
        v.save(OUT / "discs" / f"set-D-{k}.png")
    print(sheet("D", code, mat))
