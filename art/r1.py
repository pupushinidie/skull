"""骷髅牌出图第一轮：所有 PixelLab 调用都在这一个进程里按顺序跑（全站排队，占到位置时一口气多用）。

结果在 art/out/r1/（不进仓库）。已经出过的跳过，所以中断后重跑会接着做。
用法：python art/r1.py [任务名 ...]   不写就全跑。看任务名：python art/r1.py --list
"""
from __future__ import annotations

import pathlib
import sys
import time

import pixellab

OUT = pixellab.ART / "out" / "r1"
REF = pixellab.ART / "out" / "ref"

NO_TEXT = "no text, no letters, no numbers"
OUTLINE = "1px dark brown outline, lit from the top left, warm candlelight palette"


# ---------- /generate-image-v2：小图一次 64 个 ----------
# (描述, 宽, 高, 透明, 风格参考图或 None)
V2: dict[str, tuple[str, int, int, bool, str | None]] = {
    # 垫子正面：一律正上方俯视的圆，厚度和外圈之后用代码统一
    "disc-back": (
        "pixel art game token, a round antique polished brass coin seen from directly above, flat top-down view, "
        f"a raised engraved rim border, a three-armed swirl triskelion engraving in the center, bright gold brass, {OUTLINE}, {NO_TEXT}",
        32, 32, True, "kick-back.png"),
    "disc-rose": (
        "pixel art game token, a round copper coin seen from directly above, flat top-down view, orange red copper rim, "
        f"dark walnut brown inner field, a bright red rose blossom with two green leaves in the center, {OUTLINE}, {NO_TEXT}",
        32, 32, True, "kick-rose.png"),
    "disc-skull": (
        "pixel art game token, a round copper coin seen from directly above, flat top-down view, orange red copper rim, "
        "dark walnut brown inner field, a cute cartoon skull in the center, cream white, two big round black eyes, small "
        f"triangle nose, a row of little teeth, friendly not scary, {OUTLINE}, {NO_TEXT}",
        32, 32, True, "kick-skull.png"),
    "disc-lc": (
        "pixel art game token, a round silver pewter coin seen from directly above, flat top-down view, shiny silver rim, "
        f"pearl white inner field, a red rose blossom with two green leaves in the center, {OUTLINE}, {NO_TEXT}",
        32, 32, True, "kick-rose.png"),
    # 头像：一批三种动物，同一套模板，之后按座位换围巾色
    "avatar-a": (
        "pixel art character portrait for a game avatar, bust, front view slightly turned, big round shiny eyes, cute "
        "cozy tavern regular animal: a red fox wearing a small apron, or a black crow, or a brown warty toad, "
        f"wearing a knitted scarf, {OUTLINE}, {NO_TEXT}",
        32, 32, True, None),
    "avatar-b": (
        "pixel art character portrait for a game avatar, bust, front view slightly turned, big round shiny eyes, cute "
        "cozy tavern regular animal: a raccoon, or a black cat, or a badger with a white striped face, "
        f"wearing a knitted scarf, {OUTLINE}, {NO_TEXT}",
        32, 32, True, None),
    # 16px 小图标：每批两种东西
    "icon-a": (
        f"tiny 16x16 pixel art game icon, either a small brass service bell or a small brass key, {OUTLINE}, {NO_TEXT}",
        16, 16, True, None),
    "icon-b": (
        f"tiny 16x16 pixel art game icon, either an open eye or a raised open hand palm, {OUTLINE}, {NO_TEXT}",
        16, 16, True, None),
    "icon-c": (
        f"tiny 16x16 pixel art game icon, either a single red rose blossom or a small brass hourglass with sand, {OUTLINE}, {NO_TEXT}",
        16, 16, True, None),
    "candle": (
        "pixel art sprite, a short cream wax candle with wax drips on a small round brass dish, lit with a small warm "
        f"orange flame, side view, {OUTLINE}, {NO_TEXT}",
        16, 32, True, None),
    "lantern": (
        "pixel art game icon, a small brass oil lantern with a carrying handle and a warm glowing flame inside the glass, "
        f"side view, {OUTLINE}, {NO_TEXT}",
        32, 32, True, None),
    # 表情：小脸（之后用代码改表情）、玫瑰、骷髅
    "emote-face": (
        "pixel art emoji, a cute round warm yellow smiley face, two big round black eyes with a tiny white shine dot, "
        f"small calm smile, front view, fills the square, {OUTLINE}, {NO_TEXT}",
        32, 32, True, None),
    "emote-rose": (
        f"pixel art emoji icon, a single red rose blossom with a short green stem and two leaves, cute, {OUTLINE}, {NO_TEXT}",
        32, 32, True, None),
    "emote-skull": (
        "pixel art emoji icon, a cute cartoon skull head, cream white, two big round black eyes, small triangle nose, "
        f"a row of little square teeth, friendly not scary, front view, {OUTLINE}, {NO_TEXT}",
        32, 32, True, None),
}

# ---------- /create-image-pixflux：同步、快 ----------
MAT_BLANK = (
    "top-down pixel art of a small rectangular soft dark red leather play mat with rounded corners, a dashed light "
    "stitched seam running around the border, plain smooth leather in the middle with subtle wrinkles, lit from the top "
    f"left, 1px dark brown outline, {NO_TEXT}"
)
MAT_FLOWER = (
    "top-down pixel art of a small rectangular soft dark red leather play mat with rounded corners, an ornate gold "
    "embroidered border, a small red rose embroidered in each of the four corners, a large faint embossed rose pattern "
    f"in the middle, lit from the top left, 1px dark brown outline, {NO_TEXT}"
)
COVER_STYLE = "cozy 16-bit pixel art game cover illustration, rich warm colors, soft lighting, crisp clean pixels, no text, no letters, no logo, no people, no hands"
COVERS = {
    "cover-a": "close-up of a dark wooden table in an underground tavern lit by candles, a stack of antique brass coasters on a worn red leather mat, beside it one copper coaster face up showing a red rose and one showing a cute cartoon skull with big round eyes",
    "cover-b": "a round dark wooden tavern table seen from above lit by four candles, six small leather play mats in red, blue, green, yellow, purple and teal arranged in a circle around the table, a small stack of brass coasters on each mat",
    "cover-c": "a single copper coaster with a cute cartoon skull with big round eyes flipping in the air above a candlelit tavern table, red rose petals floating around it, a stack of brass coasters below, warm glow",
}
# (描述, 宽, 高, 透明, 种子们)
PIXFLUX: dict[str, tuple[str, int, int, bool, tuple[int, ...]]] = {
    "mat-blank": (MAT_BLANK, 56, 64, True, (501, 502, 503)),
    "mat-flower": (MAT_FLOWER, 56, 64, True, (501, 502, 503)),
    "mat2-blank": (MAT_BLANK, 112, 128, True, (511, 512, 513)),
    "mat2-flower": (MAT_FLOWER, 112, 128, True, (511, 512, 513)),
    "trophy": ("pixel art game icon, a golden goblet trophy cup with a single red rose standing in it, front view, "
               f"lit from the top left, 1px dark brown outline, {NO_TEXT}", 48, 48, True, (601, 602, 603, 604)),
    "ribbon": ("pixel art banner, a blank horizontal red satin ribbon banner with forked swallowtail ends folded behind, "
               f"empty middle, front view, 1px dark brown outline, {NO_TEXT}", 96, 24, True, (611, 612, 613)),
    "cover-a": (f"{COVERS['cover-a']}, {COVER_STYLE}", 384, 192, False, (811, 812)),
    "cover-b": (f"{COVERS['cover-b']}, {COVER_STYLE}", 384, 192, False, (811, 812)),
    "cover-c": (f"{COVERS['cover-c']}, {COVER_STYLE}", 384, 192, False, (811, 812)),
}

# ---------- /create-image-pixen：512×288 场景 ----------
NIGHT = (
    "Top-down view straight down onto a dark polished wooden table in a cozy underground candlelit tavern at night. "
    "The large center of the table is empty bare wood with visible grain and soft warm pools of light, nothing in the "
    "middle. Four short lit candles on small brass dishes, one in each corner of the picture, warm amber glow, deep brown "
    "shadows, darker vignette toward the edges and the top. {extra} Warm palette of amber, brown, brass gold and deep red. "
    "No text, no letters, no numbers, no people, no hands, no coins, no mats, no cards."
)
DAY = (
    "Top-down view straight down onto a honey colored wooden tavern table in the daytime. Bright warm sunlight streams "
    "diagonally from the upper left through a window, soft light shafts across the wood. The large center of the table "
    "is empty bare wood with visible grain, nothing in the middle. One unlit candle on a brass dish in a corner. {extra} "
    "Cozy warm palette of honey, amber, brown and a little deep red. No text, no letters, no numbers, no people, no "
    "hands, no coins, no mats, no cards."
)
HERO = (
    "Cozy underground candlelit tavern at night. Dark polished wooden table with grain, warm amber candle light from two "
    "short candles at the edges, soft glow and deep brown shadows. The coasters are antique brass and copper metal discs "
    "with engraved rims; the backs have an engraved swirl pattern. The play mat is worn dark red leather. Warm palette of "
    "amber, brown, brass gold and deep red. Top-down view of a tabletop game scene. In the center a play mat; on it a small "
    "stack of four round coasters, all face down showing the same back design. Beside the stack, two coasters lie face "
    "up: one shows a single red rose, the other shows a cute cartoon skull with big round friendly eyes, not scary. "
    "Exactly one rose and exactly one skull in the whole picture. No text, no letters, no numbers, no people, no hands."
)
SCENES: dict[str, tuple[str, tuple[int, ...]]] = {
    "night-a": (NIGHT.format(extra="A pewter tankard and a few scattered red rose petals near the bottom edge only."), (4301, 4302)),
    "night-b": (NIGHT.format(extra="A dried red rose and a small pewter cup near the top corners only."), (4311, 4312)),
    "day-a": (DAY.format(extra="A ceramic jug and a few red rose petals near the edges only."), (4401, 4402)),
    "day-b": (DAY.format(extra="A small vase with a red rose and a folded cloth near the top edge only."), (4411, 4412)),
    "hero": (HERO, (4243, 4244)),
}


def v2(name: str) -> None:
    desc, width, height, transparent, style = V2[name]
    folder = OUT / name
    if folder.exists() and any(folder.glob("*.png")):
        print(name, "已有，跳过", flush=True)
        return
    body: dict = {
        "description": desc,
        "image_size": {"width": width, "height": height},
        "no_background": transparent,
        "seed": 1801,
    }
    if style:
        from PIL import Image
        ref = REF / style
        with Image.open(ref) as im:
            size = {"width": im.width, "height": im.height}
        body["style_image"] = {"image": pixellab.b64_image(ref), "size": size}
        body["style_options"] = {"color_palette": False, "outline": True, "detail": True, "shading": True}
    pixellab.generate_async(name, body, folder, endpoint="/generate-image-v2")


def pixflux(name: str) -> None:
    desc, width, height, transparent, seeds = PIXFLUX[name]
    for seed in seeds:
        target = f"{name}-s{seed}"
        if (OUT / "pixflux" / f"{target}.png").exists():
            continue
        pixellab.generate_image(target, {
            "description": desc,
            "image_size": {"width": width, "height": height},
            "no_background": transparent,
            "seed": seed,
        }, OUT / "pixflux")


def scene(name: str) -> None:
    prompt, seeds = SCENES[name]
    for seed in seeds:
        target = f"{name}-s{seed}"
        if (OUT / "scene" / f"{target}.png").exists():
            continue
        pixellab.generate_image(target, {
            "description": prompt,
            "image_size": {"width": 512, "height": 288},
            "detail": "highly detailed",
            "seed": seed,
        }, OUT / "scene", endpoint="/create-image-pixen")


# 先出最关键的垫子，再出快的（pixflux），再出场景和其余小图
ORDER = [
    "disc-back", "disc-rose", "disc-skull", "disc-lc",
    "mat-blank", "mat-flower", "mat2-blank", "mat2-flower",
    "night-a", "day-a", "emote-face", "avatar-a", "avatar-b",
    "night-b", "day-b", "hero",
    "emote-rose", "emote-skull", "icon-a", "icon-b", "icon-c", "candle", "lantern",
    "trophy", "ribbon", "cover-a", "cover-b", "cover-c",
]


def run(name: str) -> None:
    if name in V2:
        v2(name)
    elif name in PIXFLUX:
        pixflux(name)
    else:
        scene(name)


if __name__ == "__main__":
    if "--list" in sys.argv:
        print(" ".join(ORDER))
        sys.exit(0)
    names = sys.argv[1:] or ORDER
    for name in names:
        started = time.time()
        try:
            run(name)
        except Exception as error:  # 一项失败不影响后面的
            print(name, "失败：", error, flush=True)
            continue
        print(time.strftime("%H:%M:%S"), name, f"done {time.time() - started:.0f}s; spent ${pixellab.spent_usd():.3f}", flush=True)
