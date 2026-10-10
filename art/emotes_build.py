"""快捷表情定稿候选：首帧都是挑定的 PixelLab v2 静态图（r5.EMO），动画两种做法：
- px<seed>：PixelLab animate-with-text-v3 出的 4 帧（返回 5 帧，去掉重复的末帧；第 0 帧换成静态图）
- code：代码在静态图上做小动作（上下弹、挪手、汗珠下滑、思考的点、下巴开合、花瓣掉落）
另外 simple = 现在线上的简洁版（public/art/emotes）。

用法：python art/emotes_build.py → out/emotes/cand/<id>/<做法>.png（128×32）+ 总览 out/review/emotes-cand.png + GIF
"""
from __future__ import annotations

import math

from PIL import Image, ImageChops

import r5
from finalize import diff_ratio
from pix import CLEAR, OUT, PUBLIC, frames_of, gif, rgba, strip, up

R1 = OUT / "r1"
IDS = list(r5.EMO)
CAND = OUT / "emotes" / "cand"


def static(e: str) -> Image.Image:
    im = Image.open(R1 / r5.EMO[e][0]).convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= 128 else CLEAR
    return im


def harden(im: Image.Image) -> Image.Image:
    im = im.convert("RGBA").copy()
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= 128 else CLEAR
    return im


def px_frames(e: str, seed: int) -> list[Image.Image] | None:
    folder = R1 / "anim" / e / f"s{seed}"
    paths = sorted(folder.glob(f"{e}-s{seed}-*.png"))
    if not paths:
        return None
    fr = [harden(Image.open(p)) for p in paths][:4]
    fr = [f if f.size == (32, 32) else f.resize((32, 32), Image.NEAREST) for f in fr]
    fr[0] = static(e)
    return fr


def shift(im: Image.Image, dx: int, dy: int) -> Image.Image:
    out = Image.new("RGBA", im.size, CLEAR)
    out.alpha_composite(im, (0, 0)) if (dx, dy) == (0, 0) else out.paste(im, (dx, dy), im)
    return out


def mask_move(im: Image.Image, pred, dx: int, dy: int, fill=None) -> Image.Image:
    """把满足 pred(x, y, rgba) 的像素挪 (dx, dy)；原位置用 fill（None = 下面那层头的颜色就取周围最常见色）。"""
    src = im.load()
    out = im.copy()
    px = out.load()
    moved = [(x, y, src[x, y]) for y in range(im.height) for x in range(im.width) if src[x, y][3] and pred(x, y, src[x, y])]
    for x, y, c in moved:
        px[x, y] = fill(x, y) if fill else CLEAR
    for x, y, c in moved:
        nx, ny = x + dx, y + dy
        if 0 <= nx < im.width and 0 <= ny < im.height:
            px[nx, ny] = c
    return out


def is_blue(c) -> bool:
    r, g, b, a = c
    return b > 150 and b > r + 40 and b > g + 10


def face_disc(im: Image.Image):
    bb = im.getbbox()
    return ((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2, (bb[2] - bb[0]) / 2)


def head_color(im: Image.Image):
    from collections import Counter
    cnt = Counter(c for c in im.getdata() if c[3] and c[0] > 200 and c[1] > 140 and c[2] < 120)
    return cnt.most_common(1)[0][0]


def code_frames(e: str) -> list[Image.Image]:
    s = static(e)
    W = 32
    if e == "rose":
        # 花头左右晃 1px（茎以上的行），第 2、3 帧掉一片花瓣
        bb = s.getbbox()
        cut = bb[1] + (bb[3] - bb[1]) * 5 // 9

        def sway(dx):
            top = s.crop((0, 0, W, cut))
            out = s.copy()
            out.paste(Image.new("RGBA", (W, cut), CLEAR), (0, 0))
            out.alpha_composite(shift(top, dx, 0), (0, 0))
            return out
        petal = Image.new("RGBA", (3, 2), CLEAR)
        pp = petal.load()
        pp[0, 0] = rgba("#e85a48"); pp[1, 0] = rgba("#c8352b"); pp[1, 1] = rgba("#8f1f1c"); pp[2, 1] = rgba("#c8352b")
        f1 = sway(1)
        f2 = s.copy(); f2.alpha_composite(petal, (bb[2] - 4, cut + 1))
        f3 = sway(-1); f3.alpha_composite(petal, (bb[2] - 3, cut + 5))
        return [s, f1, f2, f3]
    if e == "skull":
        # 下巴（最下面 5 行）往下开 1px，中间露出暗色缝；第 2 帧整个往上弹 1px
        bb = s.getbbox()
        jaw = bb[3] - 5
        gap = rgba("#2b140d")

        def open_jaw(im, y0):
            out = mask_move(im, lambda x, y, c: y >= y0, 0, 1)
            px = out.load()
            src = im.load()
            for x in range(W):
                if src[x, y0][3] and src[x, y0 - 1][3]:
                    px[x, y0] = gap if src[x, y0][0] > 120 else src[x, y0]
            return out
        return [s, open_jaw(s, jaw), shift(s, 0, -1), open_jaw(s, jaw)]
    if e == "shrug":
        cx, cy, r = face_disc(s)
        hands = lambda x, y, c: y > cy and abs(x + 0.5 - cx) > r - 7
        return [s, mask_move(s, hands, 0, -1), mask_move(s, hands, 0, -2), mask_move(s, hands, 0, -1)]
    if e == "sweat":
        drop = lambda x, y, c: is_blue(c) or (c[3] and sum(c[:3]) < 160 and any(is_blue(s.getpixel((x + a, y + b))) for a in (-1, 0, 1) for b in (-1, 0, 1) if 0 <= x + a < W and 0 <= y + b < W))
        hc = head_color(s)
        f = [s]
        for k in (1, 2, 3):
            f.append(mask_move(s, lambda x, y, c: is_blue(c), 0, k, fill=lambda x, y: hc if s.getpixel((x, y))[3] else CLEAR))
        return f
    if e == "laugh":
        tears = lambda x, y, c: is_blue(c)
        up1 = shift(s, 0, -1)
        return [s, mask_move(up1, tears, 0, -1, fill=None), s, mask_move(up1, tears, 0, 1, fill=None)]
    if e == "shock":
        return [s, shift(s, 0, -2), shift(s, 0, -3), shift(s, 0, -1)]
    if e == "think":
        dot = Image.new("RGBA", (5, 5), CLEAR)
        dp = dot.load()
        rows = [".ooo.", "ohhho", "ohwho", "ohhho", ".ooo."]
        for y, row in enumerate(rows):
            for x, ch in enumerate(row):
                if ch != ".":
                    dp[x, y] = rgba({"o": "#1e0d0b", "h": "#f6ecd6", "w": "#ffffff"}[ch])
        out = []
        for k in range(4):
            f = s.copy()
            for j in range(min(k, 3)):
                f.alpha_composite(dot, (15 + j * 5, 0))
            out.append(f)
        out[3] = out[3]
        return [out[0], out[1], out[2], out[3]]
    # taunt：上下弹 + 向右歪 1px
    return [s, shift(s, 0, -1), shift(s, 1, -1), shift(s, 0, -1)]


def metrics(fr: list[Image.Image]) -> str:
    vs0 = [diff_ratio(fr[0], f) for f in fr[1:]]
    steps = [diff_ratio(fr[i], fr[(i + 1) % 4]) for i in range(4)]
    return f"首帧比 {max(vs0):.0%} 相邻 {min(steps):.0%}–{max(steps):.0%}"


if __name__ == "__main__":
    from PIL import ImageDraw
    rows = []
    CAND.mkdir(parents=True, exist_ok=True)
    for e in IDS:
        opts = {"code": code_frames(e)}
        for sd in (1, 2):
            f = px_frames(e, sd)
            if f:
                opts[f"px{sd}"] = f
        if e == "think" and "px2" in opts:
            # PixelLab 的托下巴动作 + 代码的三个点依次出现
            dots = code_frames("think")
            base = static("think")
            mixed = []
            for f, d in zip(opts["px2"], dots):
                f = f.copy()
                diff = ImageChops.difference(d, base).getbbox()
                if diff:
                    f.alpha_composite(d.crop(diff), diff[:2])
                mixed.append(f)
            opts["px2dots"] = mixed
        simple = PUBLIC / "emotes" / f"{e}.png"
        if simple.exists():
            opts["simple"] = frames_of(Image.open(simple).convert("RGBA"), 4)
        folder = CAND / e
        folder.mkdir(exist_ok=True)
        for k, fr in opts.items():
            sh = strip(fr)
            sh.save(folder / f"{k}.png")
            gif(sh, 4, folder / f"{k}.gif", scale=4, ms=160)
            print(e, k, metrics(fr))
        rows.append((e, opts))
    # 总览：每行一个表情，每个做法 4 帧 × 4 倍
    k = 4
    cw = 32 * k * 4 + 24
    out = Image.new("RGBA", (cw * 4, (32 * k + 18) * len(rows)), rgba("#2b140d"))
    d = ImageDraw.Draw(out)
    for r, (e, opts) in enumerate(rows):
        y = r * (32 * k + 18)
        for j, (name, fr) in enumerate(opts.items()):
            x = j * cw
            for i, f in enumerate(fr):
                out.alpha_composite(up(f, k), (x + i * 32 * k, y))
            d.text((x, y + 32 * k + 2), f"{e} {name}", fill=(240, 220, 180, 255))
    out.save(OUT / "review" / "emotes-cand.png")
    print("ok")
