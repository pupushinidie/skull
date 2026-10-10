"""骷髅牌出图第三轮（2026-10-10）：表情动画（animate-with-text-v3）+ 头像绿围巾补批（方便按座位换围巾色）。一个进程线程池。

表情：首帧 = 挑定的 v2 静态图，last_frame = 首帧（循环），frame_count 4，返回多出来的重复末帧在 emotes_build.py 里去掉。
用法：python art/r5.py [任务名 ...] --workers N
"""
from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pixellab
import r1
import r4

OUT = r1.OUT
R = OUT

# 表情 id → (首帧文件, 动作描述)
EMO = {
    "rose": ("emote-rose/emote-rose-26.png", "the rose sways gently left and right and one small petal drops down"),
    "skull": ("emote-skull/emote-skull.png", "the little skull clacks its jaw open and closed and bobs slightly"),
    "taunt": ("emo-taunt/emo-taunt-52.png", "the face smirks and wiggles one raised eyebrow up and down"),
    "shrug": ("emo-shrug/emo-shrug-1.png", "the face shrugs, both little hands bob up and down"),
    "think": ("emo-think/emo-think-27.png", "the face ponders, eyes glance up, hand taps the chin"),
    "laugh": ("emo-laugh/emo-laugh-12.png", "the face laughs and shakes up and down, tears bounce"),
    "sweat": ("emo-sweat/emo-sweat-49.png", "the nervous face glances left and right, the sweat drop slides down"),
    "shock": ("emo-shock/emo-shock-47.png", "the shocked face jumps up and lands back down"),
}


def anim(emo: str, seed: int) -> None:
    first, action = EMO[emo]
    folder = OUT / "anim" / emo / f"s{seed}"
    if folder.exists() and any(folder.glob("*.png")):
        print(emo, seed, "已有，跳过", flush=True)
        return
    img = R / first
    pixellab.animate(f"{emo}-s{seed}", {
        "first_frame": pixellab.b64_image(img),
        "last_frame": pixellab.b64_image(img),
        "action": action,
        "frame_count": 4,
        "no_background": True,
        "seed": 5100 + seed,
    }, folder)


AV = r4.AV
TASKS = {}
for e in EMO:
    for s in (1, 2):
        TASKS[f"anim-{e}-{s}"] = (lambda e=e, s=s: anim(e, s))
TASKS.update({
    "avatar-toad-g": lambda: r4.v2("avatar-toad-g", AV.format(animal="a brown warty toad, earthy brown skin, wearing a plain bright green scarf"), 32, 32, r4.AV_REF, seed=2101),
    "avatar-badger-g": lambda: r4.v2("avatar-badger-g", AV.format(animal="a badger with a black and white striped face, wearing a plain bright green scarf"), 32, 32, r4.AV_REF, seed=2102),
    "avatar-raccoon-g": lambda: r4.v2("avatar-raccoon-g", AV.format(animal="a raccoon with a dark eye mask, wearing a plain bright green scarf"), 32, 32, r4.AV_REF, seed=2103),
    "avatar-cat-g": lambda: r4.v2("avatar-cat-g", AV.format(animal="a black cat with yellow green eyes, wearing a plain bright green scarf"), 32, 32, r4.AV_REF, seed=2104),
})


def main() -> None:
    workers = int(sys.argv[sys.argv.index("--workers") + 1]) if "--workers" in sys.argv else 8
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
    print(f"全部结束 {time.time() - started:.0f}s", flush=True)


if __name__ == "__main__":
    main()
