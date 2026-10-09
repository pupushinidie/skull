"""把一批 v2 候选拼成编号拼图：python art/sheet.py <批次名> [放大倍数] [底色]"""
import sys
import pathlib
from PIL import Image
from pix import OUT, contact, on_bg

name = sys.argv[1]
k = int(sys.argv[2]) if len(sys.argv) > 2 else 4
bg = sys.argv[3] if len(sys.argv) > 3 else "#3b1c12"
folder = OUT / "r1" / name
files = sorted(folder.glob(f"{name}*.png"), key=lambda p: int(p.stem.rsplit("-", 1)[1]) if p.stem.rsplit("-", 1)[1].isdigit() else 0)
items = []
for f in files:
    if f.name.endswith(".sheet.png"):
        continue
    idx = f.stem.rsplit("-", 1)[1] if f.stem.rsplit("-", 1)[1].isdigit() else "0"
    items.append((idx, on_bg(Image.open(f).convert("RGBA"), bg)))
contact(items, scale=k, cols=16, bg=bg, label_h=12, pad=3).save(folder.parent / f"{name}.sheet.png")
print(len(items), folder.parent / f"{name}.sheet.png")
