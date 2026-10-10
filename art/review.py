"""审图小工具：把一组图拼成总览（带名字），按倍数放大、可选底色。用法见各调用处。"""
from __future__ import annotations
import sys, glob, pathlib
from PIL import Image, ImageDraw

def grid(paths, out, scale=1, cols=4, bg=(43, 20, 13, 255), pad=6, label=True, maxw=None):
    ims = []
    for p in paths:
        im = Image.open(p).convert("RGBA")
        if scale != 1:
            im = im.resize((im.width * scale, im.height * scale), Image.NEAREST)
        ims.append((pathlib.Path(p).stem, im))
    cw = max(i.width for _, i in ims) + pad
    ch = max(i.height for _, i in ims) + pad + (12 if label else 0)
    rows = (len(ims) + cols - 1) // cols
    o = Image.new("RGBA", (cw * cols, ch * rows), bg)
    d = ImageDraw.Draw(o)
    for k, (n, im) in enumerate(ims):
        x, y = (k % cols) * cw, (k // cols) * ch
        o.alpha_composite(im, (x, y))
        if label:
            d.text((x + 2, y + im.height + 1), n[-22:], fill=(240, 220, 180, 255))
    if maxw and o.width > maxw:
        s = maxw / o.width
        o = o.resize((maxw, int(o.height * s)), Image.LANCZOS)
    o.save(out)
    return out

if __name__ == "__main__":
    out, scale, cols, *pats = sys.argv[1:]
    paths = sorted(sum((glob.glob(p) for p in pats), []))
    print(grid(paths, out, int(scale), int(cols), maxw=1900), len(paths))
