"""骷髅牌出图第二轮（2026-10-10）：看完 r3 的结果后补的批次，一个进程线程池并发。

- avatar-fox / crow / toad：r1 的 avatar-a 是侧身写实画法，和 avatar-b（正面、圆脸、大眼）不统一 → 用 avatar-b 的浣熊当风格参考重出
- emo-*：六张小脸的首帧，用 emote-face 的平静脸当风格参考，保证同一张脸
- hourglass：icon-c 一个沙漏都没出，单独出
- disc-skull3：骷髅面重出（r2 的 disc-skull2 被内容审核误拦，换参考图和措辞）
- day-c / night-c：桌面铺满整幅的构图（牌桌背景是 cover 铺满，中间要放 6 块垫板）
- cover-d：封面多两个近景候选
用法：python art/r4.py [任务名 ...]  --workers N
"""
from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pixellab
import r1
from PIL import Image

OUT = r1.OUT
NO_TEXT = r1.NO_TEXT
OUTLINE = r1.OUTLINE


def v2(name, desc, w, h, style=None, seed=2001):
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


def pixflux(name, desc, w, h, seeds, transparent=False):
    for seed in seeds:
        target = f"{name}-s{seed}"
        if (OUT / "pixflux" / f"{target}.png").exists():
            continue
        pixellab.generate_image(target, {"description": desc, "image_size": {"width": w, "height": h},
                                         "no_background": transparent, "seed": seed}, OUT / "pixflux")


def pixen(name, desc, seeds):
    for seed in seeds:
        target = f"{name}-s{seed}"
        if (OUT / "scene" / f"{target}.png").exists():
            continue
        pixellab.generate_image(target, {"description": desc, "image_size": {"width": 512, "height": 288},
                                         "detail": "highly detailed", "seed": seed}, OUT / "scene", endpoint="/create-image-pixen")


AV_REF = OUT / "avatar-b" / "avatar-b-1.png"
FACE_REF = OUT / "emote-face" / "emote-face.png"
SKULL_REF = pixellab.ART / "out" / "ref" / "kick-skull.png"

AV = ("pixel art character portrait for a game avatar, cute chubby bust, front view, big round shiny eyes, "
      "cozy tavern regular, wearing a knitted scarf, {animal}, " + f"{OUTLINE}, {NO_TEXT}")
FACE = ("pixel art emoji, the same cute round warm yellow face, two big round black eyes, {expr}, front view, "
        f"fills the square, {OUTLINE}, {NO_TEXT}")

DAY_C = ("Top-down view straight down onto a honey colored wooden tavern table top that fills the entire picture edge "
         "to edge, long planks running left to right with visible grain and knots. Bright warm daytime sunlight falls "
         "diagonally from the upper left in soft light shafts. The large center is empty bare wood, nothing in the middle. "
         "One unlit candle on a brass dish in the top left corner and a few red rose petals in the bottom right corner only. "
         "Cozy warm palette of honey, amber, light brown. No text, no letters, no numbers, no people, no hands, no chairs, "
         "no coins, no mats, no cards, no paper.")
NIGHT_C = ("Top-down view straight down onto a dark polished wooden tavern table top that fills the entire picture edge to "
           "edge, long planks running left to right with visible grain. Four short lit candles on small brass dishes, one "
           "in each corner of the picture, warm amber glow pooling around them, the large center is empty dark wood, "
           "nothing in the middle, darker vignette toward the edges. {extra} Warm palette of amber, brown, brass gold and "
           "deep red. No text, no letters, no numbers, no people, no hands, no chairs, no coins, no mats, no cards, no paper.")
COVER_D = ("close-up of a candlelit dark wooden tavern table, a worn red leather mat with a small stack of shiny brass "
           "coasters, in front of the stack two copper coasters lie face up: one with a red rose, one with a cute cartoon "
           "skull with big round friendly eyes, one lit candle behind, warm amber glow, " + r1.COVER_STYLE)

TASKS = {
    "avatar-fox": lambda: v2("avatar-fox", AV.format(animal="a red fox wearing a small cloth apron, no hat"), 32, 32, AV_REF),
    "avatar-crow": lambda: v2("avatar-crow", AV.format(animal="a black crow with a small yellow beak"), 32, 32, AV_REF),
    "avatar-toad": lambda: v2("avatar-toad", AV.format(animal="a brown warty toad, earthy brown skin, not green"), 32, 32, AV_REF),
    "emo-taunt": lambda: v2("emo-taunt", FACE.format(expr="sly smirk, one eye winking, one eyebrow raised, lopsided grin"), 32, 32, FACE_REF),
    "emo-shrug": lambda: v2("emo-shrug", FACE.format(expr="shrugging, flat straight mouth, two tiny hands raised palms up at both sides"), 32, 32, FACE_REF),
    "emo-think": lambda: v2("emo-think", FACE.format(expr="thinking, eyes looking up, one tiny hand touching the chin, small pondering mouth"), 32, 32, FACE_REF),
    "emo-laugh": lambda: v2("emo-laugh", FACE.format(expr="laughing hard, eyes closed in happy arcs, big open mouth, small tears of joy"), 32, 32, FACE_REF),
    "emo-sweat": lambda: v2("emo-sweat", FACE.format(expr="nervous, worried eyebrows, wavy mouth, a single blue sweat drop on the forehead"), 32, 32, FACE_REF),
    "emo-shock": lambda: v2("emo-shock", FACE.format(expr="shocked, eyes wide open, mouth open in a round O"), 32, 32, FACE_REF),
    "hourglass": lambda: v2("hourglass", f"tiny 16x16 pixel art game icon, a small brass hourglass with golden sand, {OUTLINE}, {NO_TEXT}", 16, 16),
    "disc-skull3": lambda: v2(
        "disc-skull3",
        "pixel art board game token, a round copper medallion seen from directly above, flat top-down view, orange copper "
        "rim, dark brown inner field, a large cute cream colored cartoon skull face filling the inner field, two big round "
        f"black eyes, small nose, little teeth, friendly and cute, {OUTLINE}, {NO_TEXT}",
        32, 32, SKULL_REF),
    "day-c": lambda: pixen("day-c", DAY_C, (4501, 4502, 4503)),
    "night-c": lambda: pixen("night-c", NIGHT_C.format(extra="A dried red rose near the top right corner and a pewter cup near the bottom left corner only."), (4601, 4602)),
    "cover-d": lambda: pixflux("cover-d", COVER_D, 384, 192, (821, 822, 823)),
}


def main() -> None:
    workers = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 6
    names = [a for a in sys.argv[1:] if a in TASKS] or list(TASKS)
    started = time.time()

    def one(name):
        t = time.time()
        TASKS[name]()
        return f"{time.strftime('%H:%M:%S')} {name} done {time.time() - t:.0f}s"

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(one, n): n for n in names}
        for f in as_completed(futures):
            try:
                print(f.result(), flush=True)
            except Exception as error:
                print(futures[f], "失败：", error, flush=True)
    print(f"全部结束 {time.time() - started:.0f}s; spent ${pixellab.spent_usd():.3f}", flush=True)


if __name__ == "__main__":
    main()
