"""代码画的动画和特效（首帧、末帧都由静态图生成，保证接得上）。

flip(back, front)     → fx/flip-*.png   8 帧 32×40
lose(back)            → fx/lose-disc    8 帧 32×40，最后一帧空
skull_hit()           → fx/skull-hit    8 帧 64×64，最后一帧空
rose_pop()            → fx/rose-pop     6 帧 48×48，最后一帧空
success()             → fx/success     8 帧 96×96，最后一帧空
mat_win(mat)          → fx/mat-win     8 帧 56×64，最后一帧空
petals()              → fx/petals      8 帧 64×64，循环（每帧往下 8px，竖向可平铺）
sparkle()             → fx/sparkle     6 帧 16×16，循环
"""
from __future__ import annotations

import math
import random

from PIL import Image

from pix import CLEAR, mix, rgba, strip

FW, FH = 32, 40


def _squash(im: Image.Image, fx: float) -> Image.Image:
    w = max(1, round(im.width * fx))
    return im.resize((w, im.height), Image.NEAREST)


def _shadow(frame: Image.Image, top: int, width: int = 26, alpha: int = 110) -> None:
    """垫子拿起来时下面的影子：一块扁圆，一种透明度。"""
    px = frame.load()
    cx = FW / 2
    for y in range(top, min(FH, top + 4)):
        for x in range(FW):
            dx = (x + 0.5 - cx) / (width / 2)
            dy = (y + 0.5 - (top + 2)) / 2.2
            if dx * dx + dy * dy <= 1 and px[x, y][3] == 0:
                px[x, y] = (30, 13, 11, alpha)


def _edge(height: int, tones: tuple[str, str]) -> Image.Image:
    """立起来的垫子：一条 3px 宽的竖条（侧面）。"""
    im = Image.new("RGBA", (4, height), CLEAR)
    px = im.load()
    for y in range(height):
        for x in range(4):
            if y in (0, height - 1) or x in (0, 3):
                px[x, y] = rgba("ink")
            else:
                px[x, y] = rgba(tones[0] if x == 1 else tones[1])
    # 圆角
    for (x, y) in [(0, 0), (3, 0), (0, height - 1), (3, height - 1)]:
        px[x, y] = CLEAR
    return im


def flip(back: Image.Image, front: Image.Image, edge_tones=("#e8b661", "#ad7f38")) -> Image.Image:
    frames = []

    def put(img, y, fx=1.0, shadow=True):
        f = Image.new("RGBA", (FW, FH), CLEAR)
        if shadow:
            _shadow(f, 35, width=max(8, round(26 * max(fx, 0.35))))
        s = _squash(img, fx) if fx < 1 else img
        f.alpha_composite(s, ((FW - s.width) // 2, y))
        return f

    frames.append(put(back, 4, shadow=False))           # 0 扣着
    frames.append(put(back, 1))                          # 1 拿起来（悬念停在这帧）
    frames.append(put(back, 1, 0.7))                     # 2
    frames.append(put(back, 1, 0.35))                    # 3
    edge = Image.new("RGBA", (FW, FH), CLEAR)            # 4 立起来
    _shadow(edge, 35, width=8)
    edge.alpha_composite(_edge(34, edge_tones), (14, 2))
    frames.append(edge)
    frames.append(put(front, 1, 0.35))                   # 5
    frames.append(put(front, 2, 0.7))                    # 6
    frames.append(put(front, 4, shadow=False))           # 7 平放（= 静态正面）
    return strip(frames)


# ---------------------------------------------------------------- 粒子小工具
from pix import outline as _outline

PETAL_SHAPES = [
    ["..RR.", ".RLLR", "RLRRD", "RRRDD", ".DDD."],
    [".RR..", "RLLR.", "RLRRD", ".RRDD", "..DD."],
    ["..RRR", ".RLRD", "RLRD.", "RRD..", ".D..."],
    [".RRR.", "RLLRD", "RRRDD", ".DD.."],
    ["RR...", "RLR..", "RLRR.", ".RRDD", "..DD."],
]
PETAL_COLS = {"R": "#c8352b", "L": "#f59a7c", "D": "#8f1f1c"}


def _petal(px, size, x, y, shape_i, alpha=255):
    shape = PETAL_SHAPES[shape_i % len(PETAL_SHAPES)]
    for dy, row in enumerate(shape):
        for dx, ch in enumerate(row):
            if ch == ".":
                continue
            xx, yy = int(round(x)) + dx, int(round(y)) + dy
            if 0 <= xx < size and 0 <= yy < size:
                px[xx, yy] = rgba(PETAL_COLS[ch], alpha)


def _spark(px, size, x, y, big: bool, color="#ffcf6b", core="#fbf6d7"):
    x, y = int(round(x)), int(round(y))
    pts = [(0, 0, core)]
    arm = 3 if big else 1
    for k in range(1, arm + 1):
        for dx, dy in ((k, 0), (-k, 0), (0, k), (0, -k)):
            pts.append((dx, dy, core if k == 1 and big else color))
    if big:
        for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            pts.append((dx, dy, color))
    for dx, dy, c in pts:
        if 0 <= x + dx < size and 0 <= y + dy < size:
            px[x + dx, y + dy] = rgba(c)


def _disc_fill(px, size, cx, cy, r, color, light=None, dither=0, phase=0):
    """实心圆；light 给了就左上一块用亮色；dither=2/3 时隔点画（变淡）。"""
    for y in range(max(0, int(cy - r - 1)), min(size, int(cy + r + 2))):
        for x in range(max(0, int(cx - r - 1)), min(size, int(cx + r + 2))):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if d > r:
                continue
            if dither and (x + y + phase) % dither:
                continue
            c = color
            if light is not None and (x + 0.5 - cx) + (y + 0.5 - cy) < -r * 0.6:
                c = light
            px[x, y] = c


def _layers(size):
    solid = Image.new("RGBA", (size, size), CLEAR)
    soft = Image.new("RGBA", (size, size), CLEAR)
    return solid, soft


def _merge(solid, soft, outline_solid=True):
    out = soft.copy()
    s = _outline(solid) if outline_solid else solid
    out.alpha_composite(s)
    return out


def _ring(px, size, cx, cy, r, w, color, inner=None):
    for y in range(size):
        for x in range(size):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            if r - w / 2 <= d <= r + w / 2:
                px[x, y] = inner if (inner is not None and d < r) else color


SMOKE_HI, SMOKE_LO = "#6e4a82", "#43285a"


# ---------------------------------------------------------------- 失去一张垫子：背面裂开、两半分开、化成烟
def lose(back: Image.Image) -> Image.Image:
    rnd = random.Random(7)
    crack = [(16, 0), (15, 3), (17, 6), (15, 9), (17, 12), (15, 15), (17, 18), (16, 21), (15, 24), (17, 27), (16, 30), (16, 35)]
    # 裂缝路径上每一行的 x
    xs = {}
    for (x0, y0), (x1, y1) in zip(crack, crack[1:]):
        for y in range(y0, y1 + 1):
            t = (y - y0) / max(1, y1 - y0)
            xs[y] = round(x0 + (x1 - x0) * t)

    def halves(img):
        left = Image.new("RGBA", img.size, CLEAR)
        right = Image.new("RGBA", img.size, CLEAR)
        sp, lp, rp = img.load(), left.load(), right.load()
        for y in range(img.height):
            cx = xs.get(y, 16)
            for x in range(img.width):
                if not sp[x, y][3]:
                    continue
                if x < cx:
                    lp[x, y] = sp[x, y]
                elif x > cx:
                    rp[x, y] = sp[x, y]
        return _outline(left), _outline(right)

    def frame():
        return Image.new("RGBA", (FW, FH), CLEAR)

    frames = []
    f0 = frame(); f0.alpha_composite(back, (0, 4)); frames.append(f0)
    # 1：裂纹出现（上半截）
    f1 = f0.copy(); p = f1.load()
    for y, x in xs.items():
        if y < 20 and p[x, y + 4][3]:
            p[x, y + 4] = rgba("ink")
            if p[x - 1, y + 4][3] and y % 3 == 0:
                p[x - 1, y + 4] = rgba("#fbe3a0")
    frames.append(f1)
    L, R = halves(back)
    # 2：裂透，分开 1px，往两边歪一点
    f2 = frame(); f2.alpha_composite(L, (-1, 4)); f2.alpha_composite(R, (1, 4)); frames.append(f2)
    # 3：两半分开 3px、往下掉 1px，裂缝里冒烟
    solid, soft = Image.new("RGBA", (FW, FH), CLEAR), Image.new("RGBA", (FW, FH), CLEAR)
    sp = soft.load()
    for k in range(4):
        _disc_fill(sp, FW, 16 + rnd.uniform(-1.5, 1.5), 10 + k * 6, 2.5, rgba(SMOKE_LO, 210), rgba(SMOKE_HI, 210))
    f3 = frame(); f3.alpha_composite(L, (-3, 5)); f3.alpha_composite(R, (3, 5)); f3.alpha_composite(soft)
    frames.append(f3)

    # 4：两半被烟吃掉一半
    def eaten(img, keep):
        img = img.copy(); px = img.load()
        for y in range(img.height):
            for x in range(img.width):
                if px[x, y][3] and random.Random(x * 131 + y * 17).random() * 10 >= keep:
                    px[x, y] = CLEAR
        return img

    puffs = [(rnd.uniform(5, 27), rnd.uniform(12, 34), rnd.uniform(3.5, 5.5)) for _ in range(8)]

    def smoke(step, alpha, dither):
        s = Image.new("RGBA", (FW, FH), CLEAR); px = s.load()
        for (cx, cy, r) in puffs:
            _disc_fill(px, FW, cx + (cx - 16) * 0.15 * step, cy - step * 4, r + step * 0.7,
                       rgba(SMOKE_LO, alpha), rgba(SMOKE_HI, alpha), dither=dither, phase=step)
        return s

    f4 = frame(); f4.alpha_composite(smoke(1, 220, 0)); f4.alpha_composite(eaten(L, 5), (-5, 6)); f4.alpha_composite(eaten(R, 5), (5, 6))
    frames.append(f4)
    f5 = frame(); f5.alpha_composite(smoke(2, 200, 0)); frames.append(f5)
    f6 = frame(); f6.alpha_composite(smoke(3, 140, 2)); frames.append(f6)
    frames.append(frame())
    return strip(frames)


# ---------------------------------------------------------------- 骷髅冲击
def _jag(px, size, c, ang, r0, r1, rnd, color, hi):
    x, y = c + r0 * math.cos(ang), c + r0 * math.sin(ang)
    a = ang
    r = r0
    while r < r1:
        a = ang + rnd.uniform(-0.35, 0.35)
        nx, ny = x + 2 * math.cos(a), y + 2 * math.sin(a)
        for t in range(5):
            xx, yy = int(x + (nx - x) * t / 4), int(y + (ny - y) * t / 4)
            if 0 <= xx < size and 0 <= yy < size:
                px[xx, yy] = color
                if 0 <= xx - 1 and 0 <= yy - 1:
                    px[xx - 1, yy - 1] = hi if px[xx - 1, yy - 1][3] == 0 else px[xx - 1, yy - 1]
        x, y, r = nx, ny, r + 2


def skull_hit() -> Image.Image:
    S, c = 64, 32
    rnd = random.Random(3)
    rays = [k * 2 * math.pi / 6 + rnd.uniform(-0.3, 0.3) for k in range(6)]
    puffs = [(k * 2 * math.pi / 9 + rnd.uniform(-0.2, 0.2), rnd.uniform(0.85, 1.15), rnd.uniform(3.5, 5)) for k in range(9)]
    frames = []
    for i in range(8):
        solid, soft = _layers(S)
        sp, op = solid.load(), soft.load()
        # 暗紫烟（下层，半透明三档）
        if 1 <= i <= 6:
            alpha = [0, 230, 230, 230, 170, 120, 80][i]
            dither = 0 if i < 5 else 2
            for ang, sp_, r in puffs:
                d = (11 + i * 3.2) * sp_
                _disc_fill(op, S, c + d * math.cos(ang), c + d * math.sin(ang) - i * 0.5, r + i * 0.6,
                           rgba(SMOKE_LO, alpha), rgba(SMOKE_HI, alpha), dither=dither, phase=i)
        if i == 0:
            # 一圈锯齿状白光
            for y in range(S):
                for x in range(S):
                    dx, dy = x + 0.5 - c, y + 0.5 - c
                    d = math.hypot(dx, dy)
                    a = math.atan2(dy, dx)
                    rr = 15 + 4 * (0.5 + 0.5 * math.cos(a * 8))
                    if 13 <= d <= rr:
                        sp[x, y] = rgba("#fbf6d7") if d < rr - 1.5 else rgba("#ffcf6b")
        elif i <= 4:
            r = [0, 15, 19, 23, 27][i]
            w = [0, 4, 3, 2, 2][i]
            _ring(sp, S, c, c, r, w, rgba("#f2e6c8"), inner=rgba("#fbf6d7"))
        # 裂纹（黑色锯齿线，左上带一点亮边）
        if 1 <= i <= 4:
            rr = random.Random(41)
            reach = [0, 20, 25, 27, 27][i]
            for ang in rays:
                _jag(sp, S, c, ang, 14, reach, rr, rgba("ink"), rgba("#d2c2a1"))
        frames.append(_merge(solid, soft, outline_solid=(i <= 4 and i >= 1) or i == 0))
    frames[-1] = Image.new("RGBA", (S, S), CLEAR)
    return strip(frames)


def rose_pop() -> Image.Image:
    S, c = 48, 24
    rnd = random.Random(5)
    petals = [(-math.pi / 2 + (k - 2.5) * 0.45 + rnd.uniform(-0.1, 0.1), rnd.uniform(2.6, 3.4), k) for k in range(6)]
    sparks = [(-math.pi / 2 + (k - 1) * 0.9, rnd.uniform(3.4, 4.0)) for k in range(3)]
    frames = []
    for i in range(6):
        solid, _ = _layers(S)
        px = solid.load()
        if i < 5:
            t = i + 1
            for ang, sp, k in petals:
                x = c + math.cos(ang) * sp * t * 1.5 - 2
                y = c + 4 + math.sin(ang) * sp * t * 1.5 + 0.9 * t * t - 2
                if i < 4 or k % 2 == 0:
                    _petal(px, S, x, y, k + i)
            for ang, sp in sparks:
                if i < 4:
                    _spark(px, S, c + math.cos(ang) * sp * t * 1.7, c + math.sin(ang) * sp * t * 1.7, big=(i in (1, 2)))
        frames.append(_outline(solid))
    return strip(frames)


def success() -> Image.Image:
    S, c = 96, 48
    rnd = random.Random(9)
    petals = [(k * 2 * math.pi / 16 + rnd.uniform(-0.12, 0.12), rnd.uniform(0.85, 1.15), k) for k in range(16)]
    sparks = [(k * 2 * math.pi / 10 + 0.3, rnd.uniform(0.95, 1.25)) for k in range(10)]
    frames = []
    for i in range(8):
        solid, soft = _layers(S)
        px, op = solid.load(), soft.load()
        if i == 0:
            _spark(px, S, c, c, True, "#ffcf6b", "#ffffff")
            for k in range(8):
                a = k * math.pi / 4
                for t in range(4, 10 if k % 2 == 0 else 7):
                    px[int(c + t * math.cos(a)), int(c + t * math.sin(a))] = rgba("#ffcf6b")
        elif i < 7:
            r = 6 + i * 6.2
            fall = max(0, i - 3) ** 2 * 1.2
            for ang, sp, k in petals:
                if i >= 6 and k % 2:
                    continue
                _petal(px, S, c + math.cos(ang) * r * sp - 2, c + math.sin(ang) * r * sp - 2 + fall, k + i)
            for ang, sp in sparks:
                if i < 6:
                    rr = r * 1.2 * sp
                    _spark(px, S, c + math.cos(ang) * rr, c + math.sin(ang) * rr + fall * 0.5, big=(i + int(ang * 3)) % 2 == 0)
            if i <= 3:
                _ring(op, S, c, c, r * 0.75, 2, rgba("#ffcf6b", [0, 230, 170, 110][i]))
        frames.append(_merge(solid, soft))
    return strip(frames)


# ---------------------------------------------------------------- 垫板翻到花面：金线从四角亮过去
def mat_win(mat: Image.Image) -> Image.Image:
    W, H = mat.size
    a = mat.getchannel("A").load()
    ring = []
    for inset in (2, 3):
        for x in range(inset, W - inset):
            ring += [(x, inset), (x, H - 1 - inset)]
        for y in range(inset + 1, H - 1 - inset):
            ring += [(inset, y), (W - 1 - inset, y)]
    corners = [(3, 3), (W - 4, 3), (3, H - 4), (W - 4, H - 4)]

    def cd(p):
        return min(abs(p[0] - cx) + abs(p[1] - cy) for cx, cy in corners)

    maxd = max(cd(p) for p in ring)
    frames = []
    for i in range(8):
        solid, soft = _layers(max(W, H))
        px, op = solid.load(), soft.load()
        if i < 7:
            front = (i + 1) / 5 * (maxd + 4)
            for p in ring:
                d = cd(p)
                x, y = p
                if not a[x, y]:
                    continue
                if front - 3 <= d <= front:
                    px[x, y] = rgba("#fbf6d7")
                elif d < front - 3 and i >= 1:
                    op[x, y] = rgba("#ffcf6b", [0, 230, 230, 230, 230, 170, 100][i])
            if i in (0, 1, 5, 6):
                for (cx, cy) in corners:
                    _spark(px, max(W, H), cx, cy, big=(i in (0, 5)))
        f = _merge(solid, soft, outline_solid=False).crop((0, 0, W, H))
        frames.append(f)
    return strip(frames)

def petals() -> Image.Image:
    """循环：每个花瓣每帧往下 8px、左右轻摆，8 帧正好走完 64px，所以竖着能接上。"""
    S = 64
    rnd = random.Random(21)
    items = [(rnd.uniform(2, 58), rnd.uniform(0, 64), rnd.randint(0, 3), rnd.uniform(0, 2 * math.pi)) for _ in range(9)]
    frames = []
    for i in range(8):
        f = Image.new("RGBA", (S, S), CLEAR)
        px = f.load()
        for (x0, y0, k, ph) in items:
            y = (y0 + i * 8) % S
            x = x0 + 2.5 * math.sin(ph + i * 2 * math.pi / 8)
            shape = (k + (i // 2)) % 4
            for wrap in (0, -S):
                _petal(px, S, x, y + wrap, shape)
        frames.append(f)
    return strip(frames)


def sparkle() -> Image.Image:
    S = 16
    sizes = [0, 1, 2, 3, 2, 1]
    frames = []
    for i, s in enumerate(sizes):
        f = Image.new("RGBA", (S, S), CLEAR)
        px = f.load()
        c = 7
        if s == 0:
            px[c, c] = rgba("#ffcf6b")
        else:
            for k in range(1, s * 2 + 1):
                col = rgba("#fbf6d7") if k <= s else rgba("#ffcf6b")
                for dx, dy in ((k, 0), (-k, 0), (0, k), (0, -k)):
                    px[c + dx, c + dy] = col
            px[c, c] = rgba("#ffffff")
            if s >= 2:
                for dx, dy in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
                    px[c + dx, c + dy] = rgba("#ffcf6b")
        # 旁边一颗小星错开半拍
        s2 = sizes[(i + 3) % 6]
        if s2:
            x, y = 12, 3
            px[x, y] = rgba("#fbf6d7")
            if s2 >= 2:
                for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    px[x + dx, y + dy] = rgba("#ffcf6b")
        frames.append(f)
    return strip(frames)
