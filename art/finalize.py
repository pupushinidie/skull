"""动画检查（照宝石商人 finalize.py 的做法，按骷髅牌的 spec 改）。

python art/finalize.py report [目录]   默认查 art/out/final（正式美术定稿；换图验收时才覆盖 public/art）
每条精灵图：
- 最大变化（和第 0 帧比，变了的像素占不透明区域的比例）：< 3% 太静，> 60% 走形（一次性特效不查这一项）
- 坏帧：某一帧突然大变又变回（相邻帧变化的峰值 ≥ 中位数 3 倍且 ≥ 25%）—— 循环动画才查
- 循环接缝：末帧 → 首帧的变化不超过相邻帧变化最大值的 1.5 倍
- 一次性特效：最后一帧全透明（停在最后一帧的翻面、熄灭除外）
- 翻面：首帧 = 背面静态图贴在 (0,4)，末帧 = 正面静态图贴在 (0,4)，逐像素一样
退出码：有问题时 1。
"""
from __future__ import annotations

import pathlib
import sys

from PIL import Image, ImageChops

from pix import OUT, frames_of

FINAL = OUT / "final"

# 文件 → (帧数, 类型)  loop 循环；once 一次性最后一帧空；hold 一次性停在最后一帧
SPEC = {
    "fx/flip-rose.png": (8, "hold"), "fx/flip-skull.png": (8, "hold"), "fx/flip-lc.png": (8, "hold"),
    "fx/skull-hit.png": (8, "once"), "fx/rose-pop.png": (6, "once"), "fx/success.png": (8, "once"),
    "fx/mat-win.png": (8, "once"), "fx/lose-disc.png": (8, "once"), "fx/snuff.png": (8, "hold"),
    "fx/candle.png": (4, "loop"), "fx/petals.png": (8, "loop"), "fx/sparkle.png": (6, "loop"),  # 闪光本身就是整个变（不查走形）
    "ui/thinking.png": (4, "loop"),
    **{f"emotes/{k}.png": (4, "loop") for k in ("rose", "skull", "taunt", "shrug", "think", "laugh", "sweat", "shock")},
}
FLIPS = {"fx/flip-rose.png": ("back", "rose"), "fx/flip-skull.png": ("back", "skull"), "fx/flip-lc.png": ("lc-down", "lc-up")}


def diff_ratio(a: Image.Image, b: Image.Image) -> float:
    a, b = a.convert("RGBA"), b.convert("RGBA")
    d = ImageChops.difference(a, b).convert("L").point(lambda v: 255 if v > 24 else 0)
    changed = sum(1 for v in d.get_flattened_data() if v)
    area = max(1, sum(1 for v in a.getchannel("A").get_flattened_data() if v) or 1, sum(1 for v in b.getchannel("A").get_flattened_data() if v))
    return changed / area


def check(root: pathlib.Path, rel: str) -> list[str]:
    n, kind = SPEC[rel]
    path = root / rel
    if not path.exists():
        return ["缺文件"]
    sheet = Image.open(path).convert("RGBA")
    problems = []
    if sheet.width % n:
        return [f"宽 {sheet.width} 不能被 {n} 整除"]
    fr = frames_of(sheet, n)
    vs0 = [diff_ratio(fr[0], f) for f in fr[1:]]
    steps = [diff_ratio(fr[i], fr[i + 1]) for i in range(n - 1)]
    empty = [f.getchannel("A").getbbox() is None for f in fr]
    if any(empty[:-1]):
        problems.append(f"中间有空帧 {[i for i, e in enumerate(empty[:-1]) if e]}")
    if kind == "loop":
        worst = max(vs0)
        if worst < 0.03:
            problems.append(f"太静（最大变化 {worst:.1%}）")
        if worst > 0.6 and rel != "fx/sparkle.png":
            problems.append(f"走形?（最大变化 {worst:.1%}）")
        seam = diff_ratio(fr[-1], fr[0])
        if seam > max(steps) * 1.5 + 0.02:
            problems.append(f"循环接缝跳（末→首 {seam:.1%}，相邻最大 {max(steps):.1%}）")
        srt = sorted(steps + [seam])
        if srt[-1] >= 0.25 and srt[-1] >= 3 * srt[len(srt) // 2]:
            problems.append(f"疑似坏帧（峰值 {srt[-1]:.1%}，中位 {srt[len(srt) // 2]:.1%}）")
    elif kind == "once":
        if not empty[-1]:
            problems.append("最后一帧不是空的")
    if rel in FLIPS:
        back, front = FLIPS[rel]
        for idx, face in ((0, back), (n - 1, front)):
            ref = Image.new("RGBA", fr[0].size, (0, 0, 0, 0))
            ref.alpha_composite(Image.open(root / "discs" / f"{face}.png").convert("RGBA"), (0, 4))
            if ImageChops.difference(ref, fr[idx]).getbbox():
                problems.append(f"第 {idx} 帧和 discs/{face} 不一样")
    info = f"帧 {n}，和首帧比最大 {max(vs0):.1%}，相邻最大 {max(steps):.1%}"
    return problems or [f"ok（{info}）"]


def report(root: pathlib.Path = FINAL) -> int:
    bad = 0
    for rel in SPEC:
        res = check(root, rel)
        ok = len(res) == 1 and res[0].startswith("ok")
        bad += 0 if ok else 1
        print(f"{'✓' if ok else '✗'} {rel}: {'；'.join(res)}")
    print(f"共 {len(SPEC)} 条，有问题 {bad} 条")
    return bad


if __name__ == "__main__":
    args = sys.argv[1:] or ["report"]
    root = pathlib.Path(args[1]) if len(args) > 1 else FINAL
    sys.exit(1 if report(root) else 0)
