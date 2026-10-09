"""快捷表情（代码版）：六张小脸共用同一张脸（大小、位置、描边、眼睛画法完全一致），只换五官和小道具；
每个 4 帧 32×32，循环播放（第 3 帧能接回第 0 帧）。

face(...) 画一帧；EMOTES 里每个表情给 4 组参数。
用法：python art/emotes.py → art/out/emotes/code-*.png + 预览
"""
from __future__ import annotations

import math

from PIL import Image

from pix import CLEAR, OUT, ascii_img, contact, on_bg, outline, rgba, strip, up

S = 32
CX, CY, R = 15.5, 18.0, 12.2

LEG = {
    "E": "#2b140d", "e": "#fffaf0", "m": "#5a1a14", "T": "#e85a48", "o": "ink",
    "f": "#f4c66a", "F": "#d9963a", "h": "#fde7a6",
    "b": "#7cc8f0", "B": "#3f8fc8", "w": "#eaf8ff",
    "c": "#ec8a62",
}

EYE = [".EE.", "EeEE", "EEEE", "EEEE", ".EE."]
EYE_BIG = [".EEE.", "EeEEE", "EEEEE", "EEEEE", "EEEEE", ".EEE."]
EYE_HAPPY = [".EE.", "E..E", "E..E"]
EYE_WINK = ["....", ".EEE", "E..."]
EYE_UP = [".EE.", "EeEE", "EEEE", ".EE."]   # 往上看（整体高一格，配合 dy）
MOUTH_SMILE = ["E....E", ".EEEE."]
MOUTH_SMIRK = [".....E", "...EE.", "EEE..."]
MOUTH_FLAT = ["EEEEE"]
MOUTH_WAVY = [".E...E.", "E.E.E.E", "...E..."]
MOUTH_O = [".EEE.", "EmmmE", "EmmmE", "EmmmE", ".EEE."]
MOUTH_O_SMALL = [".EE.", "EmmE", ".EE."]
MOUTH_LAUGH = ["EEEEEEEE", "EmmmmmmE", "EmmTTmmE", ".EmTTmE.", "..EEEE.."]
MOUTH_HMM = ["EEE", "...E"]
BROW_L = ["EEE"]
BROW_TILT_L = ["E..", ".EE"]      # 皱眉（左眉往里低）
BROW_TILT_R = ["EE.", "..E"]
BROW_UP_R = [".EE", "E.."]        # 挑眉

HAND = ["..oo..", ".offo.", "offffo", "offFFo", ".oooo."]
HAND_R = [r[::-1] for r in HAND]
FIST = [".oooo.", "offffo", "offfFo", "offfFo", "offFFo", ".oooo."]
DROP = [".o.", "obo", "owbo", "obBo", ".oo."]
DROP = [".o..", "obo.", "owbo", "obBo", ".oo."]
TEAR = [".o.", "obo", "owo", ".o."]
DOT = [".oo.", "oeeo", "oeeo", ".oo."]


def _blit(px, rows, x0, y0, legend=LEG):
    for dy, row in enumerate(rows):
        for dx, ch in enumerate(row):
            if ch in ". ":
                continue
            x, y = x0 + dx, y0 + dy
            if 0 <= x < S and 0 <= y < S:
                px[x, y] = rgba(legend[ch])


def head(dy: int = 0, squash: int = 0) -> Image.Image:
    """圆脸：左上亮、右下暗，1px 描边。squash>0 时横向宽一点、纵向矮一点（落地）。"""
    im = Image.new("RGBA", (S, S), CLEAR)
    px = im.load()
    rx, ry = R + squash * 0.6, R - squash * 0.8
    cy = CY + dy + squash * 0.8
    pts = set()
    for y in range(S):
        for x in range(S):
            if ((x + 0.5 - CX) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                pts.add((x, y))
    for (x, y) in pts:
        if any((x + a, y + b) not in pts for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1))):
            px[x, y] = rgba("ink")
            continue
        nx, ny = (x + 0.5 - CX) / rx, (y + 0.5 - cy) / ry
        d = math.hypot(nx, ny)
        lit = -(nx + ny) / max(d, 1e-6)
        if d > 0.68 and lit < -0.25:
            px[x, y] = rgba("F")  if False else rgba(LEG["F"])
        elif 0.7 < d < 0.9 and lit > 0.6:
            px[x, y] = rgba(LEG["h"])
        else:
            px[x, y] = rgba(LEG["f"])
    return im


def face(eyes=("n", "n"), mouth="smile", brows=None, dy=0, eye_dx=0, squash=0, extras=()) -> Image.Image:
    im = head(dy, squash)
    px = im.load()
    oy = dy + squash
    ey = 12 + oy
    shapes = {"n": EYE, "big": EYE_BIG, "happy": EYE_HAPPY, "wink": EYE_WINK, "up": EYE_UP}
    for side, kind in zip((0, 1), eyes):
        shp = shapes[kind]
        w = len(shp[0])
        x = (10 if side == 0 else 18) + eye_dx - (w - 4) // 2
        y = ey - (1 if kind == "big" else 0) + (1 if kind in ("happy", "wink") else 0) - (1 if kind == "up" else 0)
        if kind == "wink" and side == 0:
            shp = [r[::-1] for r in shp]
        _blit(px, shp, x, y)
    # 腮红
    if mouth not in ("o", "laugh"):
        for x in (8, 9, 22, 23):
            px[x, 18 + oy] = rgba(LEG["c"])
    m = {"smile": MOUTH_SMILE, "smirk": MOUTH_SMIRK, "flat": MOUTH_FLAT, "wavy": MOUTH_WAVY,
         "o": MOUTH_O, "o-small": MOUTH_O_SMALL, "laugh": MOUTH_LAUGH, "hmm": MOUTH_HMM}[mouth]
    mw = len(m[0])
    _blit(px, m, int(CX + 0.5 - mw / 2) + (1 if mouth == "hmm" else 0), 20 + oy - (1 if mouth == "laugh" else 0))
    if brows:
        for side, (rows, bdy) in zip((0, 1), brows):
            if rows is None:
                continue
            _blit(px, rows, (9 if side == 0 else 19), 9 + oy + bdy)
    for (rows, x, y) in extras:
        _blit(px, rows, x, y + (oy if y >= 0 else 0))
    return im


def taunt() -> list[Image.Image]:
    # 眯一只眼、歪嘴坏笑，右边眉毛一挑一挑
    return [face(("wink", "n"), "smirk", brows=((BROW_L, 1), (BROW_UP_R, b)), dy=0) for b in (0, -1, -2, -1)]


def shrug() -> list[Image.Image]:
    out = []
    for k in (0, 1, 2, 1):
        out.append(face(("n", "n"), "flat", brows=((BROW_L, -k), (BROW_L, -k)), dy=0,
                        extras=((HAND, 0, 20 - k * 2), (HAND_R, 26, 20 - k * 2))))
    return out


def think() -> list[Image.Image]:
    dots = [((DOT, 18, 1),), ((DOT, 18, 1), (DOT, 23, 0)), ((DOT, 18, 1), (DOT, 23, 0), (DOT, 28, 1)),
            ((DOT, 18, 1), (DOT, 23, 0), (DOT, 28, 1))]
    out = []
    for i in range(4):
        out.append(face(("up", "up"), "hmm", brows=((BROW_L, -1), (BROW_UP_R, -1)), eye_dx=1 if i in (1, 2) else 0,
                        extras=((FIST, 18, 25),) + dots[i]))
    return out


def laugh() -> list[Image.Image]:
    out = []
    for i, d in enumerate((0, -1, 0, -1)):
        k = i % 2
        tears = ((TEAR, 3 - k, 12 + d - k), (TEAR, 26 + k, 12 + d - k))
        out.append(face(("happy", "happy"), "laugh", dy=d, extras=tears))
    return out


def sweat() -> list[Image.Image]:
    out = []
    for i, dx in enumerate((-1, 0, 1, 0)):
        out.append(face(("n", "n"), "wavy", brows=((BROW_TILT_R, 0), (BROW_TILT_L, 0)), eye_dx=dx,
                        extras=((DROP, 23, 7 + i),)))
    return out


def shock() -> list[Image.Image]:
    params = [dict(dy=0, squash=1, mouth="o-small"), dict(dy=-3, mouth="o"), dict(dy=-3, mouth="o"), dict(dy=-1, mouth="o")]
    out = []
    for p in params:
        out.append(face(("big", "big"), p["mouth"], brows=((BROW_L, -2), (BROW_L, -2)), dy=p["dy"], squash=p.get("squash", 0)))
    return out


EMOTES = {"taunt": taunt, "shrug": shrug, "think": think, "laugh": laugh, "sweat": sweat, "shock": shock}


def build() -> dict[str, Image.Image]:
    return {k: strip(f()) for k, f in EMOTES.items()}


if __name__ == "__main__":
    folder = OUT / "emotes"
    folder.mkdir(parents=True, exist_ok=True)
    res = build()
    for k, v in res.items():
        v.save(folder / f"code-{k}.png")
    items = [(k, on_bg(v)) for k, v in res.items()]
    contact(items, scale=5, cols=2).save(folder / "code-sheet.png")
    print("ok")
