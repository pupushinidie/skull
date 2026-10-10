"""蜡烛三件套：PixelLab 静态蜡烛（去掉它自己的火苗）+ 代码逐帧画火苗和烟（手册：16px 火苗用 animate 会画成十字）。

fx/candle.png  64×32  4 帧循环（火苗一跳一跳）
ui/out.png     32×32  熄灭的蜡烛 + 一缕细烟（静态）
fx/snuff.png   256×48 8 帧一次：火苗晃两下 → 变小 → 熄灭冒烟，最后一帧下面 32×32 = ui/out
用法：python art/candles.py [候选号 ...]  → out/candle/c<候选>/{candle,out,snuff}.png + 预览
"""
from __future__ import annotations

import sys

from PIL import Image

from pix import CLEAR, OUT, rgba, strip, up, on_bg

R1 = OUT / "r1" / "candle"
FL = {"o": "#e4732e", "m": "#efa84a", "y": "#ffd44e", "c": "#fbf6d7", "r": "#b8461c"}
SMOKE = {"s": (184, 170, 178, 230), "S": (146, 130, 142, 200), "t": (214, 204, 208, 150)}

# 火苗（底部对准烛芯上方一格，x 以烛芯为 0 列的偏移在 ASCII 里找 'w' 那一列）
FLAMES = {
    "a": ["..o..", "..o..", ".omo.", ".oyo.", "omyoo", "omyco", ".oyo.", "..w.."],
    "b": ["...o.", "..oo.", ".omo.", ".oyo.", "omyo.", "omyco", ".oyo.", "..w.."],
    "c": ["..o..", ".oo..", ".omo.", ".oyo.", ".myoo", "omyco", ".oyo.", "..w.."],
    "d": [".....", "..o..", "..o..", ".omo.", ".oyo.", "omyco", ".oyo.", "..w.."],
    "small": [".....", ".....", ".....", "..o..", ".omo.", ".oyo.", "..o..", "..w.."],
    "tiny": [".....", ".....", ".....", ".....", ".....", "..o..", "..r..", "..w.."],
}
WISPS = [  # 烟：从烛芯往上飘（行 0 在最上面），'.' 透明
    [".....", ".....", ".....", ".....", ".....", ".....", "..s..", "..w.."],
    [".....", ".....", ".....", "..t..", "..S..", "...s.", "..s..", "..w.."],
    [".t...", "..t..", "..S..", "...S.", "..s..", "..s..", ".....", "..w.."],
    ["..t..", ".t...", ".tS..", "..S..", "...S.", "..s..", "..s..", "..w.."],
]


def body(cand: int) -> tuple[Image.Image, int, int]:
    """候选蜡烛：抠掉火苗（蜡顶以上全清），贴底放在 16×32 里。返回（蜡烛、烛芯 x、蜡顶 y）。"""
    im = Image.open(R1 / f"candle-{cand}.png").convert("RGBA")
    px = im.load()
    W, H = im.size
    # 蜡顶：从上往下第一行出现描边色（很暗）的行
    top = next(y for y in range(H) if any(px[x, y][3] and sum(px[x, y][:3]) < 120 for x in range(W)))
    flame_cols = [x for y in range(top) for x in range(W) if px[x, y][3]]
    wick = round(sum(flame_cols) / len(flame_cols)) if flame_cols else W // 2
    for y in range(top):
        for x in range(W):
            px[x, y] = CLEAR
    for y in range(H):
        for x in range(W):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= 128 else CLEAR
    bb = im.getbbox()
    shift = H - bb[3]
    out = Image.new("RGBA", (W, H), CLEAR)
    out.alpha_composite(im.crop((0, 0, W, bb[3])), (0, shift))
    return out, wick, top + shift


def stamp(im: Image.Image, rows: list[str], wick_x: int, wick_y: int, legend: dict) -> None:
    """把 ASCII 贴上去：'w' 那一格对准 (wick_x, wick_y)（烛芯），'w' 本身画成深色烛芯。"""
    wx = next(r.index("w") for r in rows if "w" in r)
    wy = next(i for i, r in enumerate(rows) if "w" in r)
    px = im.load()
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            if ch == ".":
                continue
            x, y = wick_x + dx - wx, wick_y + dy - wy
            if not (0 <= x < im.width and 0 <= y < im.height):
                continue
            if ch == "w":
                px[x, y] = rgba("#2b140d")
            else:
                c = legend[ch]
                px[x, y] = rgba(c) if isinstance(c, str) else c


def build(cand: int) -> dict[str, Image.Image]:
    b, wick, top = body(cand)
    wy = top - 1   # 烛芯在蜡顶上面一格
    # fx/candle：4 帧
    frames = []
    for k in ("a", "b", "d", "c"):
        f = b.copy()
        stamp(f, FLAMES[k], wick, wy, FL)
        frames.append(f)
    candle = strip(frames)
    # ui/out：32×32，蜡烛居中贴底，烛芯冒一缕烟
    out = Image.new("RGBA", (32, 32), CLEAR)
    out.alpha_composite(b, (8, 0))
    stamp(out, WISPS[3], wick + 8, wy, SMOKE)
    # fx/snuff：8 帧 32×48，下面 32 行和 ui/out 对齐
    sn = []
    seq = [("fl", "a"), ("fl", "b"), ("fl", "c"), ("fl", "small"), ("fl", "tiny"), ("sm", 0), ("sm", 1), ("sm", 2)]
    for kind, k in seq:
        f = Image.new("RGBA", (32, 48), CLEAR)
        f.alpha_composite(b, (8, 16))
        if kind == "fl":
            stamp(f, FLAMES[k], wick + 8, wy + 16, FL)
        else:
            stamp(f, WISPS[k], wick + 8, wy + 16, SMOKE)
        sn.append(f)
    last = Image.new("RGBA", (32, 48), CLEAR)
    last.alpha_composite(out, (0, 16))
    sn.append(last)
    sn = sn[:7] + [last]
    return {"candle": candle, "out": out, "snuff": strip(sn)}


if __name__ == "__main__":
    cands = [int(a) for a in sys.argv[1:]] or [17, 16, 33]
    for c in cands:
        res = build(c)
        folder = OUT / "candle" / f"c{c}"
        folder.mkdir(parents=True, exist_ok=True)
        for k, v in res.items():
            v.save(folder / f"{k}.png")
            up(on_bg(v), 6).save(folder / f"{k}-x6.png")
    print("ok")
