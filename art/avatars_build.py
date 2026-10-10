"""头像：6 只动物（狐狸、乌鸦、蛤蟆、浣熊、黑猫、獾）各挑围巾是绿色的候选，围巾按座位亮色换色（蒙版只限下半张脸以下的绿色像素）。

用法：python art/avatars_build.py scan            列出每种动物绿围巾最多的候选
      python art/avatars_build.py                 按 PICKS 出 out/avatars/<座位>-<候选>.png 和总览
"""
from __future__ import annotations
import colorsys, sys
from PIL import Image
from pix import OUT, SEATS, rgba, mix, CLEAR

R1 = OUT / "r1"
ANIMALS = ["fox", "crow", "toad", "raccoon", "cat", "badger"]
BATCH = {"fox": "avatar-fox", "crow": "avatar-crow", "toad": "avatar-toad-g", "raccoon": "avatar-raccoon-g", "cat": "avatar-cat-g", "badger": "avatar-badger-g"}

def hsv(c):
    h, s, v = colorsys.rgb_to_hsv(c[0]/255, c[1]/255, c[2]/255); return h*360, s, v

def scarf_px(im):
    px = im.load(); out = []
    for y in range(17, 32):
        for x in range(32):
            c = px[x, y]
            if c[3] < 128: continue
            h, s, v = hsv(c)
            if 65 < h < 185 and s > 0.22 and v > 0.18:
                out.append((x, y))
    return out

def cand(batch, i):
    p = R1 / batch / (f"{batch}-{i}.png" if i else f"{batch}.png")
    return Image.open(p).convert("RGBA")

def recolor(im, seat):
    _, hexc, _ = SEATS[seat]
    base = rgba(hexc)
    dark = mix(base, rgba("ink"), 0.5); light = mix(base, rgba("#ffffff"), 0.35)
    out = im.copy(); px = out.load()
    pts = scarf_px(im)
    vs = sorted(hsv(px[p])[2] for p in pts)
    if not vs: return out
    lo, hi = vs[len(vs)//4], vs[len(vs)*3//4]
    for p in pts:
        v = hsv(px[p])[2]
        px[p] = dark if v < lo else (base if v <= hi else light)
    return out

# 座位 → 候选号们（批次见 BATCH）；第一个是推荐
PICKS = {0: [9, 35, 30], 1: [15, 8, 29], 2: [16, 12, 8], 3: [13, 26, 12], 4: [10, 26, 16], 5: [10, 34, 19]}


def build() -> dict[int, list[Image.Image]]:
    res = {}
    for seat, ids in PICKS.items():
        b = BATCH[ANIMALS[seat]]
        res[seat] = [recolor(harden(cand(b, i)), seat) for i in ids]
    return res


def harden(im):
    im = im.copy(); px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= 128 else CLEAR
    return im

if __name__ == "__main__":
    if sys.argv[1:2] == ["scan"]:
        for b in sorted(set(BATCH.values())):
            scores = []
            for i in range(64):
                n = len(scarf_px(cand(b, i)))
                scores.append((n, i))
            scores.sort(reverse=True)
            print(b, [i for n, i in scores[:24]])
        sys.exit(0)
    from PIL import ImageDraw
    res = build()
    folder = OUT / "avatars"; folder.mkdir(exist_ok=True)
    k = 4
    cw = 32 * k + 8
    sheet = Image.new("RGBA", (cw * 3 + 3 * 80, (32 * k + 16) * 6), rgba("#2b140d"))
    d = ImageDraw.Draw(sheet)
    for seat, ims in res.items():
        y = seat * (32 * k + 16)
        for j, im in enumerate(ims):
            im.save(folder / f"{seat}-{PICKS[seat][j]}.png")
            sheet.alpha_composite(im.resize((32 * k, 32 * k), Image.NEAREST), (j * cw, y))
            d.text((j * cw, y + 32 * k + 2), f"{seat} {ANIMALS[seat]} {PICKS[seat][j]}", fill=(240, 220, 180, 255))
            x0 = cw * 3 + j * 80
            d.rectangle((x0, y, x0 + 76, y + 36), fill=(243, 231, 207, 255))
            sheet.alpha_composite(im, (x0 + 2, y + 2)); sheet.alpha_composite(im.resize((64, 64), Image.NEAREST), (x0 + 6, y + 40))
            sheet.alpha_composite(im, (x0 + 40, y + 2))
    sheet.save(OUT / "review" / "avatars-picks.png")
    print("ok")
