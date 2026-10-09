"""出图阶段共用的小工具：调色板、像素图（ASCII）、描边、裁切、放大预览、拼图、横排精灵图。"""
from __future__ import annotations

import math
import pathlib

from PIL import Image, ImageDraw

ART = pathlib.Path(__file__).resolve().parent
ROOT = ART.parent
PUBLIC = ROOT / "apps" / "web" / "public" / "art"
OUT = ART / "out"

P = {
    "ink": "#1e0d0b",
    "wood0": "#2b140d", "wood1": "#3b1c12", "wood2": "#5d2a16", "wood3": "#7b3b19", "wood4": "#995021",
    "dwood0": "#7a3e1e", "dwood1": "#a4552a", "dwood2": "#c8883f",
    "brass0": "#865923", "brass1": "#ad7f38", "brass2": "#c99a42", "brass3": "#e8b661", "brass4": "#fbe3a0",
    "copper0": "#7f3a17", "copper1": "#bb6023", "copper2": "#e6872f", "copper3": "#f6b05a",
    "inset0": "#3b1c12", "inset1": "#532714", "inset2": "#693a1d",
    "bone0": "#9c8a6a", "bone1": "#d2c2a1", "bone2": "#f2e6c8",
    "eye": "#2b140d",
    "rose0": "#8f1f1c", "rose1": "#c8352b", "rose2": "#e85a48", "rose3": "#f59a7c",
    "leaf0": "#2d5320", "leaf1": "#4f8a32", "leaf2": "#7cb84a",
    "silver0": "#6f7480", "silver1": "#a9aeb8", "silver2": "#dde2ea", "silver3": "#f6f8fb",
    "pearl0": "#c9bfae", "pearl": "#efe6d6", "pearl2": "#fffaf0",
    "wax": "#f0c27a", "wax0": "#c98d4a", "flame": "#ffcf6b", "flame0": "#f08a2a", "flame_core": "#fbf6d7",
    "face": "#f4c66a", "face_dk": "#d9963a", "face_hi": "#fde7a6", "cheek": "#ec8a62",
    "smoke": "#5a4a5a", "smoke2": "#8a7a88",
    "white": "#ffffff",
}

SEATS = [
    ("red", "#e5533f", ("#421412", "#6c2115", "#843618")),
    ("blue", "#3b82f0", ("#16233f", "#24406e", "#33588f")),
    ("green", "#44b860", ("#15301b", "#24502e", "#336b3e")),
    ("yellow", "#f0c030", ("#3d2a08", "#6b4b12", "#8c661c")),
    ("purple", "#9b6ad6", ("#2a1638", "#46265e", "#5e357c")),
    ("cyan", "#36c2c9", ("#0f3032", "#1b5154", "#266d70")),
]

CLEAR = (0, 0, 0, 0)


def rgba(h: str, a: int = 255) -> tuple[int, int, int, int]:
    h = P.get(h, h).lstrip("#")
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), a)


def mix(a, b, t: float):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3)) + (255,)


def lum(c) -> float:
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def ascii_img(rows: list[str], legend: dict[str, str | tuple]) -> Image.Image:
    """ASCII 像素图：每个字符一个像素，'.' 和空格是透明。"""
    h = len(rows)
    w = max(len(r) for r in rows)
    im = Image.new("RGBA", (w, h), CLEAR)
    px = im.load()
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in ". ":
                continue
            v = legend[ch]
            px[x, y] = rgba(v) if isinstance(v, str) else v
    return im


def outline(im: Image.Image, color="ink", diagonal: bool = False) -> Image.Image:
    """给不透明区域外面加一圈 1px 描边。"""
    c = rgba(color) if isinstance(color, str) else color
    w, h = im.size
    src = im.load()
    out = Image.new("RGBA", (w, h), CLEAR)
    out.paste(im, (0, 0))
    dst = out.load()
    nbr = [(-1, 0), (1, 0), (0, -1), (0, 1)] + ([(-1, -1), (1, -1), (-1, 1), (1, 1)] if diagonal else [])
    for y in range(h):
        for x in range(w):
            if src[x, y][3]:
                continue
            for dx, dy in nbr:
                nx, ny = x + dx, y + dy
                if 0 <= nx < w and 0 <= ny < h and src[nx, ny][3]:
                    dst[x, y] = c
                    break
    return out


def harden(im: Image.Image, cut: int = 128) -> Image.Image:
    """半透明边一律变成全透明 / 不透明（像素图不要羽化边）。"""
    im = im.convert("RGBA")
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= cut else CLEAR
    return im


def bbox(im: Image.Image):
    return im.getchannel("A").getbbox()


def trim(im: Image.Image) -> Image.Image:
    b = bbox(im)
    return im.crop(b) if b else im


def place(canvas_size, sprite: Image.Image, anchor: str = "center", dx: int = 0, dy: int = 0) -> Image.Image:
    """把 sprite 放进透明画布：center / bottom（底部居中）。"""
    cw, ch = canvas_size
    out = Image.new("RGBA", (cw, ch), CLEAR)
    x = (cw - sprite.width) // 2 + dx
    y = ((ch - sprite.height) // 2 if anchor == "center" else ch - sprite.height) + dy
    out.alpha_composite(sprite, (x, y)) if x >= 0 and y >= 0 else out.paste(sprite, (x, y), sprite)
    return out


def up(im: Image.Image, k: int) -> Image.Image:
    return im.resize((im.width * k, im.height * k), Image.NEAREST)


def strip(frames: list[Image.Image]) -> Image.Image:
    w, h = frames[0].size
    out = Image.new("RGBA", (w * len(frames), h), CLEAR)
    for i, f in enumerate(frames):
        out.alpha_composite(f.convert("RGBA"), (i * w, 0))
    return out


def frames_of(sheet: Image.Image, n: int) -> list[Image.Image]:
    w = sheet.width // n
    return [sheet.crop((i * w, 0, (i + 1) * w, sheet.height)) for i in range(n)]


def on_bg(im: Image.Image, bg="#3b1c12") -> Image.Image:
    out = Image.new("RGBA", im.size, rgba(bg) if isinstance(bg, str) else bg)
    out.alpha_composite(im.convert("RGBA"))
    return out


def contact(items: list[tuple[str, Image.Image]], scale: int = 4, cols: int = 8, bg="#2b140d", label_h: int = 14,
            pad: int = 6) -> Image.Image:
    """拼图：每格放大 scale 倍，下面写个名字（预览用，不出现在正式图里）。"""
    from PIL import ImageFont
    cw = max(im.width for _, im in items) * scale + pad * 2
    ch = max(im.height for _, im in items) * scale + pad * 2 + label_h
    rows = math.ceil(len(items) / cols)
    sheet = Image.new("RGBA", (cw * min(cols, len(items)), ch * rows), rgba(bg) if isinstance(bg, str) else bg)
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 11)
    except Exception:
        font = None
    for i, (name, im) in enumerate(items):
        x, y = (i % cols) * cw, (i // cols) * ch
        sheet.alpha_composite(up(im.convert("RGBA"), scale), (x + pad, y + pad))
        d.text((x + pad, y + ch - label_h), name[:28], fill=(240, 220, 190, 255), font=font)
    return sheet


def circle_r(x: int, y: int, cx: float, cy: float) -> float:
    return math.hypot(x - cx, y - cy)


NIGHT_BG = "#2b140d"
DAY_BG = "#f3ead8"


def showcase(im: Image.Image, scale: int = 4, extra_scales=(1,)) -> Image.Image:
    """候选展示图：夜间底、白天底各一份，大图 + 实际尺寸（给画廊和评审看）。"""
    im = im.convert("RGBA")
    big = up(im, scale)
    smalls = [up(im, s) for s in extra_scales]
    pad = 8
    col_w = big.width + pad + sum(s.width + pad for s in smalls) + pad
    h = max(big.height, *(s.height for s in smalls)) + pad * 2
    out = Image.new("RGBA", (col_w, h * 2), rgba(NIGHT_BG))
    day = Image.new("RGBA", (col_w, h), rgba(DAY_BG))
    out.paste(day, (0, h))
    for row in (0, 1):
        x = pad
        out.alpha_composite(big, (x, row * h + pad))
        x += big.width + pad
        for s in smalls:
            out.alpha_composite(s, (x, row * h + pad))
            x += s.width + pad
    return out
