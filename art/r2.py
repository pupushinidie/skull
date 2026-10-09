"""骷髅牌出图第一轮补充（r1 跑完后接着跑，同样一个进程按顺序排队）。

- disc-skull2：骷髅面重出（r1 那批左右错位、垫子偏扁偏小），用选中的玫瑰候选当风格参考，外圈和玫瑰面一致
- mat-*-i：垫板用代码画的底图当 init_image（r1 的透明底把皮革当背景抠掉了），不透明出图，之后套圆角蒙版
- icon-d：16px 小垫子图标（「手里 N 张」「板上 N 张」）
用法：python art/r2.py [任务名 ...]
"""
from __future__ import annotations

import sys
import time

import pixellab
from PIL import Image

OUT = pixellab.ART / "out" / "r1"
ROSE_REF = OUT / "disc-rose" / "disc-rose-5.png"
NO_TEXT = "no text, no letters, no numbers"
OUTLINE = "1px dark brown outline, lit from the top left, warm candlelight palette"


def v2(name, desc, w, h, style=None, seed=1901):
    folder = OUT / name
    if folder.exists() and any(folder.glob("*.png")):
        print(name, "已有，跳过", flush=True)
        return
    body = {"description": desc, "image_size": {"width": w, "height": h}, "no_background": True, "seed": seed}
    if style:
        with Image.open(style) as im:
            size = {"width": im.width, "height": im.height}
        body["style_image"] = {"image": pixellab.b64_image(style), "size": size}
        body["style_options"] = {"color_palette": False, "outline": True, "detail": True, "shading": True}
    pixellab.generate_async(name, body, folder, endpoint="/generate-image-v2")


def pixflux_init(name, desc, w, h, init, seeds, strength=300):
    for seed in seeds:
        target = f"{name}-s{seed}"
        if (OUT / "pixflux" / f"{target}.png").exists():
            continue
        pixellab.generate_image(target, {
            "description": desc,
            "image_size": {"width": w, "height": h},
            "no_background": False,
            "init_image": pixellab.b64_image(init),
            "init_image_strength": strength,
            "seed": seed,
        }, OUT / "pixflux")


MAT_B = ("top-down pixel art of a soft worn leather play mat filling the whole image, rich red leather with subtle "
         "grain, wrinkles and scuffs, a dashed stitched seam around the border, rounded corners, lit from the top left, "
         f"{NO_TEXT}")
MAT_F = ("top-down pixel art of a soft worn red leather play mat filling the whole image, an ornate gold thread "
         "embroidered border, a small red rose embroidered in each corner and on the middle of the left and right edges, "
         f"a large faint embossed rose in the center, rounded corners, lit from the top left, {NO_TEXT}")

INIT = pixellab.ART / "out" / "mats"

TASKS = {
    "disc-skull2": lambda: v2(
        "disc-skull2",
        "pixel art game token, a round copper coin seen from directly above, flat top-down view, orange red copper rim, "
        "dark walnut brown inner field, a big cute cartoon skull filling the inner field, cream white, two big round "
        f"black eyes, small triangle nose, a row of little square teeth, friendly not scary, {OUTLINE}, {NO_TEXT}",
        32, 32, ROSE_REF),
    "mat-blank-i": lambda: pixflux_init("mat-blank-i", MAT_B, 56, 64, INIT / "code-blank-0.png", (521, 522, 523)),
    "mat-flower-i": lambda: pixflux_init("mat-flower-i", MAT_F, 56, 64, INIT / "code-flower-0.png", (521, 522, 523)),
    "mat2-blank-i": lambda: pixflux_init("mat2-blank-i", MAT_B, 112, 128, INIT / "code-blank-0-x2.png", (531, 532)),
    "mat2-flower-i": lambda: pixflux_init("mat2-flower-i", MAT_F, 112, 128, INIT / "code-flower-0-x2.png", (531, 532)),
    "icon-d": lambda: v2(
        "icon-d",
        f"tiny 16x16 pixel art game icon, either a single round brass coin or a small stack of three brass coins, {OUTLINE}, {NO_TEXT}",
        16, 16),
}

if __name__ == "__main__":
    names = sys.argv[1:] or list(TASKS)
    for name in names:
        started = time.time()
        try:
            TASKS[name]()
        except Exception as error:
            print(name, "失败：", error, flush=True)
            continue
        print(time.strftime("%H:%M:%S"), name, f"done {time.time() - started:.0f}s; spent ${pixellab.spent_usd():.3f}", flush=True)
