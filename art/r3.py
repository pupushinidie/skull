"""骷髅牌出图续跑（2026-10-10 接手）：把 r1 剩下的任务、r2 的补充任务，加上这次新加的几项，放进**一个进程**的线程池里并发跑。

PixelLab 会员（2026-10-10 起）同一进程里线程池并发不超过 10 个没有 429；pxqueue 按进程占位，所以照样只占一个位置。
已经出过的自动跳过（r1/r2 的函数自己会查），中断后重跑接着做。
用法：python art/r3.py [任务名 ...]   不写就全跑。  --workers N（默认 6）
"""
from __future__ import annotations

import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

import pixellab
import r1
import r2

EXTRA_SCENES = {
    # hero 多一个种子，凑够 3 个候选
    "hero-c": (r1.HERO, (4245,)),
}
r1.SCENES.update(EXTRA_SCENES)

R1_LEFT = [n for n in r1.ORDER if n not in ("disc-back", "disc-rose", "disc-skull", "disc-lc",
                                              "mat-blank", "mat-flower", "mat2-blank", "mat2-flower")]
TASKS: dict[str, callable] = {}
for n in R1_LEFT + list(EXTRA_SCENES):
    TASKS[n] = (lambda n=n: r1.run(n))
for n, fn in r2.TASKS.items():
    TASKS[n] = fn


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    workers = 6
    if "--workers" in sys.argv:
        workers = int(sys.argv[sys.argv.index("--workers") + 1])
        args = [a for a in args if a != str(workers)]
    if "--list" in sys.argv:
        print(" ".join(TASKS))
        return
    names = args or list(TASKS)
    started = time.time()

    def one(name: str) -> str:
        t = time.time()
        TASKS[name]()
        return f"{time.strftime('%H:%M:%S')} {name} done {time.time() - t:.0f}s"

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(one, n): n for n in names}
        for f in as_completed(futures):
            try:
                print(f.result(), f"; spent ${pixellab.spent_usd():.3f}", flush=True)
            except Exception as error:  # 一项失败不影响别的
                print(futures[f], "失败：", error, flush=True)
    print(f"全部结束 {time.time() - started:.0f}s; spent ${pixellab.spent_usd():.3f}", flush=True)


if __name__ == "__main__":
    main()
