"""骷髅牌正式美术定稿：按 art/selection.json 的选择，把 spec 第 9 节的 64 个文件导出到 art/out/final/（目录结构和 public/art/ 一样），
同时给画廊出每个选项的预览图（art/out/gallery/*.png）和牌桌模拟图。

每一组素材（GROUPS）有几个选项，每个选项是一个函数，返回 {spec 路径: 图}。selection.json 记每组选了哪个。
用法：
  python art/final.py              按 selection.json 导出 final + 画廊图 + 模拟图
  python art/final.py --check      只比对 final 和 spec 第 9 节（文件齐不齐、尺寸对不对）
"""
from __future__ import annotations

import json
import pathlib
import sys

from PIL import Image, ImageDraw

import candles
import emotes_build
import fx
import mats_build  # noqa: F401（pair 目录由它生成）
import uicode
from pix import CLEAR, OUT, PUBLIC, frames_of, rgba, strip, up

ART = pathlib.Path(__file__).resolve().parent
FINAL = OUT / "final"
GAL = OUT / "gallery"
SEL = ART / "selection.json"
R1 = OUT / "r1"
SIMPLE = ART / "simple"   # 简洁版原图备查（从 public/art 复制，simple.py 也能重新生成）

# spec 第 9 节：路径 → (宽, 高)
SPEC: dict[str, tuple[int, int]] = {}
for k in ("back", "rose", "skull", "lc-down", "lc-up"):
    SPEC[f"discs/{k}.png"] = (32, 36)
for s in range(6):
    for kind in ("blank", "flower"):
        SPEC[f"mats/mat-{s}-{kind}.png"] = (56, 64)
for k in ("night-0", "night-1", "day-0", "day-1", "hero"):
    SPEC[f"scene/{k}.png"] = (512, 288)
for k in ("disc", "stack", "bell", "pass", "key", "rose", "eye", "ready", "lc"):
    SPEC[f"ui/{k}.png"] = (16, 16)
SPEC.update({"ui/thinking.png": (64, 16), "ui/lantern.png": (32, 32), "ui/out.png": (32, 32), "ui/trophy.png": (48, 48),
             "ui/ribbon.png": (96, 24), "ui/bubble.png": (40, 44), "ui/frame.png": (24, 24)})
for s in range(6):
    SPEC[f"avatars/avatar-{s}.png"] = (32, 32)
for e in emotes_build.IDS:
    SPEC[f"emotes/{e}.png"] = (128, 32)
SPEC.update({"fx/flip-rose.png": (256, 40), "fx/flip-skull.png": (256, 40), "fx/flip-lc.png": (256, 40),
             "fx/skull-hit.png": (512, 64), "fx/rose-pop.png": (288, 48), "fx/success.png": (768, 96),
             "fx/mat-win.png": (448, 64), "fx/lose-disc.png": (256, 40), "fx/snuff.png": (256, 48),
             "fx/candle.png": (64, 32), "fx/petals.png": (512, 64), "fx/sparkle.png": (96, 16)})


def load(p) -> Image.Image:
    return Image.open(p).convert("RGBA")


def hard(im: Image.Image) -> Image.Image:
    """去掉半透明羽化边：alpha ≥128 变不透明，其余全透明。"""
    im = im.convert("RGBA").copy()
    px = im.load()
    for y in range(im.height):
        for x in range(im.width):
            r, g, b, a = px[x, y]
            px[x, y] = (r, g, b, 255) if a >= 128 else CLEAR
    return im


def center(im: Image.Image, size: tuple[int, int], bottom: bool = False) -> Image.Image:
    """裁掉四周空白后放回 size 画布正中（bottom=True 时贴底）。"""
    im = hard(im)
    bb = im.getbbox()
    if not bb:
        return Image.new("RGBA", size, CLEAR)
    c = im.crop(bb)
    out = Image.new("RGBA", size, CLEAR)
    x = (size[0] - c.width) // 2
    y = size[1] - c.height if bottom else (size[1] - c.height) // 2
    out.alpha_composite(c, (x, y))
    return out


def simple(rel: str) -> Image.Image:
    p = SIMPLE / rel
    return load(p if p.exists() else PUBLIC / rel)


def cand(batch: str, i: int) -> Image.Image:
    return load(R1 / batch / (f"{batch}-{i}.png" if i else f"{batch}.png"))


# ---------------------------------------------------------------- 各组选项
def discs_set(name: str) -> dict[str, Image.Image]:
    if name == "simple":
        faces = {k: simple(f"discs/{k}.png") for k in ("back", "rose", "skull", "lc-down", "lc-up")}
    else:
        faces = {k: load(OUT / "discs" / f"set-{name}-{k}.png") for k in ("back", "rose", "skull", "lc-down", "lc-up")}
    out = {f"discs/{k}.png": v for k, v in faces.items()}
    # 跟着垫子走的动画：翻面 ×3、失去垫子（首末帧都用定稿静态图，保证接得上）
    out["fx/flip-rose.png"] = fx.flip(faces["back"], faces["rose"])
    out["fx/flip-skull.png"] = fx.flip(faces["back"], faces["skull"])
    out["fx/flip-lc.png"] = fx.flip(faces["lc-down"], faces["lc-up"], ("#dde2ea", "#8a8f9b"))
    out["fx/lose-disc.png"] = fx.lose(faces["back"])
    return out


def mats_set(name: str) -> dict[str, Image.Image]:
    res = {}
    for s in range(6):
        for kind in ("blank", "flower"):
            rel = f"mats/mat-{s}-{kind}.png"
            res[rel] = simple(rel) if name == "simple" else load(OUT / "mats" / f"pair-{name}" / f"mat-{s}-{kind}.png")
    res["fx/mat-win.png"] = fx.mat_win(res["mats/mat-0-flower.png"])
    return res


SCENES = {
    "night": {"N1": ("night-b-s4311", "night-c-s4601"), "N2": ("night-b-s4312", "night-a-s4301"), "N3": ("night-c-s4602", "night-a-s4302")},
    "day": {"D1": ("day-c-s4501", "day-c-s4503"), "D2": ("day-a-s4401", "day-c-s4502"), "D3": ("day-b-s4411", "day-a-s4402")},
}


def scene_set(theme: str, name: str) -> dict[str, Image.Image]:
    if name == "simple":
        return {f"scene/{theme}-{i}.png": simple(f"scene/{theme}-{i}.png") for i in (0, 1)}
    a, b = SCENES[theme][name]
    return {f"scene/{theme}-0.png": load(R1 / "scene" / f"{a}.png"), f"scene/{theme}-1.png": load(R1 / "scene" / f"{b}.png")}


def hero_set(name: str) -> dict[str, Image.Image]:
    if name == "simple":
        return {"scene/hero.png": simple("scene/hero.png")}
    return {"scene/hero.png": load(R1 / "scene" / f"{name}.png")}


ICONS = {  # 16px 图标：选项 → {ui 名: (批次, 候选号)}；没写的用代码版（ready / lc / thinking）
    "A": {"disc": ("icon-d", 38), "stack": ("icon-d", 10), "bell": ("icon-a", 14), "pass": ("icon-b", 45),
          "key": ("icon-a", 25), "rose": ("icon-c", 10), "eye": ("icon-b", 33)},
    "B": {"disc": ("icon-d", 29), "stack": ("icon-d", 58), "bell": ("icon-a", 30), "pass": ("icon-b", 44),
          "key": ("icon-a", 15), "rose": ("icon-c", 39), "eye": ("icon-b", 49)},
}


def icons_set(name: str) -> dict[str, Image.Image]:
    keys = ("disc", "stack", "bell", "pass", "key", "rose", "eye", "ready", "lc", "thinking")
    if name == "simple":
        return {f"ui/{k}.png": simple(f"ui/{k}.png") for k in keys}
    code = uicode.build()
    res = {}
    for k in keys:
        if k in ICONS[name]:
            res[f"ui/{k}.png"] = center(cand(*ICONS[name][k]), (16, 16))
        else:
            res[f"ui/{k}.png"] = code[k]
    return res


def lantern_set(name: str) -> dict[str, Image.Image]:
    return {"ui/lantern.png": simple("ui/lantern.png") if name == "simple" else center(cand("lantern", int(name)), (32, 32))}


def candle_set(name: str) -> dict[str, Image.Image]:
    if name == "simple":
        return {k: simple(k) for k in ("fx/candle.png", "ui/out.png", "fx/snuff.png")}
    r = candles.build(int(name))
    return {"fx/candle.png": r["candle"], "ui/out.png": r["out"], "fx/snuff.png": r["snuff"]}


def fix_trophy(im: Image.Image) -> Image.Image:
    """s603 杯身上的高光拼成了一个像字母 P 的形状：抹成杯身金色，换成一道竖直高光 + 一个亮点。"""
    im = im.copy()
    px = im.load()
    for y in range(23, 29):
        for x in range(19, 26):
            r, g, b, a = px[x, y]
            if a and r > 230 and g > 180 and (b > 120 or (r, g, b) == (0xeb, 0xc0, 0x44)):
                px[x, y] = rgba("#f6c739")
    for y in range(24, 28):
        px[21, y] = rgba("#faf2c1")
    px[22, 24] = rgba("#f8ea9c")
    return im


def trophy_set(name: str) -> dict[str, Image.Image]:
    if name == "simple":
        return {"ui/trophy.png": simple("ui/trophy.png")}
    im = load(R1 / "pixflux" / f"trophy-{name}.png")
    if name == "s603":
        im = fix_trophy(im)
    return {"ui/trophy.png": center(im, (48, 48), bottom=True)}


def chrome_set(name: str) -> dict[str, Image.Image]:
    keys = ("ribbon", "bubble", "frame")
    if name == "simple":
        return {f"ui/{k}.png": simple(f"ui/{k}.png") for k in keys}
    code = uicode.build()
    return {f"ui/{k}.png": code[k] for k in keys}


AVATARS = {"A": 0, "B": 1, "C": 2}


def avatars_set(name: str) -> dict[str, Image.Image]:
    if name == "simple":
        return {f"avatars/avatar-{s}.png": simple(f"avatars/avatar-{s}.png") for s in range(6)}
    import avatars_build as ab
    res = ab.build()
    return {f"avatars/avatar-{s}.png": center(res[s][AVATARS[name]], (32, 32), bottom=True) for s in range(6)}


def emote_set(e: str, name: str) -> dict[str, Image.Image]:
    if name == "simple":
        return {f"emotes/{e}.png": simple(f"emotes/{e}.png")}
    return {f"emotes/{e}.png": load(emotes_build.CAND / e / f"{name}.png")}


def fx_set(name: str) -> dict[str, Image.Image]:
    keys = ("skull-hit", "rose-pop", "success", "petals", "sparkle")
    if name == "simple":
        return {f"fx/{k}.png": simple(f"fx/{k}.png") for k in keys}
    return {"fx/skull-hit.png": fx.skull_hit(), "fx/rose-pop.png": fx.rose_pop(), "fx/success.png": fx.success(),
            "fx/petals.png": fx.petals(), "fx/sparkle.png": fx.sparkle()}


# 组 → (题目, 选项 → 构造函数, 选项说明)
GROUPS: dict[str, tuple[str, dict, dict]] = {
    "discs": ("垫子五种面（背面、玫瑰、骷髅、Last Chance 扣着 / 翻开），翻面和失去垫子的动画跟着这一套",
              {k: (lambda k=k: discs_set(k)) for k in ("E", "A", "G", "simple")},
              {"E": "推荐：同一个外圈和描边，骷髅是大号卡通骷髅、占满内圈（disc-skull3 #56），1× 也是「暗底上一团白」；玫瑰最亮最圆",
               "A": "同一套外圈，骷髅小一号（disc-skull #13），1× 时和玫瑰差别没那么大",
               "G": "背面漩涡更细、玫瑰带茎、骷髅大（#57）；玫瑰在 1× 只剩一个小红点",
               "simple": "现在线上的代码简洁版"}),
    "mats": ("垫板（6 个座位 × 空白面 / 花面），左侧金线小角标区分座位",
             {k: (lambda k=k: mats_set(k)) for k in ("s522", "s521", "s523", "simple")},
             {"s522": "推荐：皮革纹路干净，花面金线框 + 四角和左右小玫瑰，中间暗纹玫瑰；6 色只换皮革和缝线",
              "s521": "皮革上有一道斜光，花面的中间是漩涡；个别座位四角玫瑰旁边留了一点红皮革",
              "s523": "花面中间的玫瑰有亮红的点，换色后在蓝绿座位上很跳",
              "simple": "现在线上的代码简洁版"}),
    "scene-night": ("夜间牌桌背景（两张，按房间码选一张）",
                    {k: (lambda k=k: scene_set("night", k)) for k in ("N1", "N2", "N3", "simple")},
                    {"N1": "推荐：四角蜡烛、桌面铺满中间、只在边角放玫瑰和杯子，没有字",
                     "N2": "N2 一张右边和下面有两张带涂画的纸（像字，没用）；另一张中间有几团光斑",
                     "N3": "桌子偏小，两边露地板和椅子多",
                     "simple": "现在线上的代码简洁版"}),
    "scene-day": ("白天牌桌背景（两张）",
                  {k: (lambda k=k: scene_set("day", k)) for k in ("D1", "D2", "D3", "simple")},
                  {"D1": "推荐：蜂蜜色桌面铺满整幅，左上窗光斜照，玫瑰花瓣在右下角，右上一张空白纸",
                   "D2": "上面露窗户和椅子，桌子只占中间一部分",
                   "D3": "桌子偏右、偏小",
                   "simple": "现在线上的代码简洁版"}),
    "hero": ("首页大图",
             {k: (lambda k=k: hero_set(k)) for k in ("hero-c-s4245", "hero-s4243", "hero-s4244", "simple")},
             {"hero-c-s4245": "推荐：斜俯视的酒馆桌，皮垫板上一摞刻漩涡的黄铜垫子、一枚玫瑰、一枚大眼骷髅，蜡烛照着",
              "hero-s4243": "构图类似但垫子摞得太高、像一摞硬币",
              "hero-s4244": "垫子正面朝上，背面花纹像字母",
              "simple": "现在线上的代码简洁版"}),
    "icons": ("16px 图标（手里、板上、叫价铃、过、先手钥匙、赢过、亮牌、已盖好、LC 碟、思考沙漏）",
              {k: (lambda k=k: icons_set(k)) for k in ("A", "B", "simple")},
              {"A": "推荐：PixelLab 小图（铃、钥匙、手掌、玫瑰、眼睛、垫子、一摞垫子）+ 代码画的已盖好 / LC 碟 / 沙漏",
               "B": "同一批里的第二选择",
               "simple": "现在线上的代码简洁版"}),
    "lantern": ("挑战者提灯",
                {k: (lambda k=k: lantern_set(k)) for k in ("18", "28", "10", "simple")},
                {"18": "推荐：有提环、火苗清楚", "28": "灯罩太亮、轮廓糊", "10": "没有提环", "simple": "简洁版"}),
    "candle": ("牌桌蜡烛（循环）、淘汰的熄灭蜡烛和熄灭动画",
               {k: (lambda k=k: candle_set(k)) for k in ("17", "16", "33", "simple")},
               {"17": "推荐：PixelLab 蜡烛 + 代码逐帧画火苗和青烟（手册：16px 火苗用 animate 会画成十字）",
                "16": "蜡身更宽，烛台小", "33": "蜡身歪", "simple": "简洁版"}),
    "trophy": ("结算奖杯",
               {k: (lambda k=k: trophy_set(k)) for k in ("s603", "s602", "s604", "simple")},
               {"s603": "推荐：金杯插一朵带叶子的红玫瑰，深色描边清楚", "s602": "玫瑰像一团花球", "s604": "杯子太大、玫瑰看不清", "simple": "简洁版"}),
    "chrome": ("缎带、表情气泡、九宫格边框",
               {k: (lambda k=k: chrome_set(k)) for k in ("code", "simple")},
               {"code": "推荐：代码画的新版（缎带燕尾带折痕、气泡带光影、深木边框黄铜包角）。PixelLab 出的缎带没有描边、是渐变色，没用",
                "simple": "简洁版"}),
    "avatars": ("头像（6 个座位：狐狸、乌鸦、蛤蟆、浣熊、黑猫、獾，围巾是座位色）",
                {k: (lambda k=k: avatars_set(k)) for k in ("A", "B", "C", "simple")},
                {"A": "推荐：同一种画法（正面、圆脸、大眼），狐狸穿围裙，没有帽子道具",
                 "B": "第二选择：蛤蟆张嘴笑、乌鸦戴帽子",
                 "C": "第三选择",
                 "simple": "简洁版"}),
    "fx": ("其他特效：骷髅冲击、玫瑰弹出、挑战成功、结算花瓣、闪光",
           {k: (lambda k=k: fx_set(k)) for k in ("code", "simple")},
           {"code": "推荐：代码画（冲击环、花瓣、火花代码画最稳），按定稿配色", "simple": "简洁版"}),
}
EMO_OPTS = {
    "rose": {"code": "推荐：花头左右轻晃，掉一片花瓣", "px1": "PixelLab 动画：几乎不动，有一颗白色杂点", "px2": "PixelLab 动画：多了几颗白色杂点", "simple": "简洁版"},
    "skull": {"code": "推荐：下巴咔哒开合、头往上弹一下", "px1": "PixelLab 动画：头顶冒出一个红点（坏帧）", "px2": "PixelLab 动画：头顶长出粉色小块", "simple": "简洁版"},
    "taunt": {"px1": "推荐：PixelLab 动画，眉毛一挑一挑、嘴角歪笑", "px2": "PixelLab 动画：眯眼挤眼", "code": "代码：只是上下弹", "simple": "简洁版"},
    "shrug": {"code": "推荐：两只小手一耸一耸", "px1": "PixelLab 动画：第 2 帧脸被拉长", "px2": "PixelLab 动画：第 2 帧脸压扁、露牙", "simple": "简洁版"},
    "think": {"px2dots": "推荐：PixelLab 托下巴动作 + 代码画的三个点依次出现", "px2": "只有托下巴，没有点", "code": "代码：只有三个点", "simple": "简洁版"},
    "laugh": {"code": "推荐：整张脸上下抖，眼泪跟着弹", "px2": "PixelLab 动画：眼泪拉成细长线", "px1": "PixelLab 动画：第 1 帧脸变形", "simple": "简洁版"},
    "sweat": {"px2": "推荐：PixelLab 动画，眼睛乱瞟、汗珠上下动", "code": "代码：只有汗珠往下滑 3 像素", "px1": "PixelLab 动画：第 2 帧脸变形", "simple": "简洁版"},
    "shock": {"code": "推荐：瞪眼 O 嘴，整个往上一跳再落下", "px1": "PixelLab 动画：嘴形乱变", "px2": "PixelLab 动画：嘴形乱变", "simple": "简洁版"},
}
EMO_NAMES = {"rose": "玫瑰", "skull": "骷髅", "taunt": "挑衅", "shrug": "摊手", "think": "思考", "laugh": "大笑", "sweat": "紧张", "shock": "吃惊"}
for e, opts in EMO_OPTS.items():
    GROUPS[f"emote-{e}"] = (f"快捷表情：{EMO_NAMES[e]}（{e}，4 帧循环）", {k: (lambda k=k, e=e: emote_set(e, k)) for k in opts}, opts)


def selection() -> dict[str, str]:
    if SEL.exists():
        return json.loads(SEL.read_text("utf-8"))["choice"]
    return {g: next(iter(opts)) for g, (_, opts, _) in GROUPS.items()}


def write_selection(choice: dict[str, str]) -> None:
    data = {
        "note": "骷髅牌正式美术的选择。每组的选项和构造方法见 art/final.py 的 GROUPS；改了这里跑 python art/final.py 重新导出 art/out/final。",
        "choice": choice,
        "options": {g: {k: desc[k] for k in opts} for g, (_, opts, desc) in GROUPS.items()},
        "sources": {
            "discs": "out/discs/set-<选项>-*.png（discsets.py 拼，候选在 out/r1/disc-*）",
            "mats": "out/mats/pair-<选项>/（mats_build.py，候选 out/r1/pixflux/mat-*-i-*）",
            "scene-night": SCENES["night"], "scene-day": SCENES["day"],
            "icons": ICONS, "avatars": "avatars_build.py PICKS（A/B/C = 每只动物第 1/2/3 个候选）",
            "emotes": "out/emotes/cand/<id>/<选项>.png（emotes_build.py；首帧见 r5.EMO）",
            "candle": "candles.py（out/r1/candle/candle-<选项>.png + 代码火苗）",
        },
    }
    SEL.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")


def export(choice: dict[str, str]) -> dict[str, Image.Image]:
    files: dict[str, Image.Image] = {}
    for g, (_, opts, _) in GROUPS.items():
        files.update(opts[choice[g]]())
    for rel, im in files.items():
        p = FINAL / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        im.save(p)
    return files


def check() -> int:
    bad = 0
    for rel, size in SPEC.items():
        p = FINAL / rel
        if not p.exists():
            print("缺", rel)
            bad += 1
            continue
        s = Image.open(p).size
        if s != size:
            print("尺寸不符", rel, s, "≠", size)
            bad += 1
    extra = [str(p.relative_to(FINAL)) for p in FINAL.rglob("*.png") if str(p.relative_to(FINAL)) not in SPEC]
    print(f"spec {len(SPEC)} 项：缺或尺寸不符 {bad}；多余文件 {extra}")
    return bad


# ---------------------------------------------------------------- 画廊预览图
NIGHT, DAY = rgba("#2b140d"), rgba("#f3ead8")


def preview(files: dict[str, Image.Image]) -> Image.Image:
    """一个选项的预览：每张图左边夜间底 k 倍、右边白天底 k 倍 + 1 倍；大场景直接 1 倍。"""
    tiles = []
    for rel, im in files.items():
        if rel.startswith("fx/") and len(files) > 6 and not any(r.startswith("fx/") is False for r in [rel]):
            pass
        w, h = im.size
        if w >= 256 and h >= 200:
            tiles.append(im)
            continue
        k = 6 if max(w, h) <= 16 else 4 if max(w, h) <= 48 else 3 if max(w, h) <= 96 else 2 if h <= 64 else 1
        big = up(im, k)
        t = Image.new("RGBA", (big.width * 2 + w + 24, big.height + 8), NIGHT)
        t.alpha_composite(big, (4, 4))
        d = Image.new("RGBA", (big.width + w + 16, big.height + 8), DAY)
        d.alpha_composite(big, (4, 4))
        d.alpha_composite(im, (big.width + 10, 4))
        t.alpha_composite(d, (big.width + 8, 0))
        tiles.append(t)
    maxw = 1500
    rows, row, rw = [], [], 0
    for t in tiles:
        if row and rw + t.width + 6 > maxw:
            rows.append(row)
            row, rw = [], 0
        row.append(t)
        rw += t.width + 6
    if row:
        rows.append(row)
    W = max(sum(t.width + 6 for t in r) for r in rows)
    H = sum(max(t.height for t in r) + 6 for r in rows)
    out = Image.new("RGBA", (W, H), rgba("#140a08"))
    y = 0
    for r in rows:
        x = 0
        for t in r:
            out.alpha_composite(t, (x, y))
            x += t.width + 6
        y += max(t.height for t in r) + 6
    return out


def table_mock(files: dict[str, Image.Image], theme: str, idx: int = 0) -> Image.Image:
    """1440×790 下的牌桌模拟：舞台 1140×742（右边 300 是侧栏），背景 cover，6 块垫板 3×，垫子叠放。"""
    W, H = 1140, 742
    sc = files[f"scene/{theme}-{idx}.png"]
    k = max(W / sc.width, H / sc.height)
    bg = sc.resize((round(sc.width * k), round(sc.height * k)), Image.NEAREST)
    bg = bg.crop(((bg.width - W) // 2, (bg.height - H) // 2, (bg.width - W) // 2 + W, (bg.height - H) // 2 + H))
    stage = Image.new("RGBA", (W, H))
    stage.alpha_composite(bg)
    # 暗角（界面会压一层）
    d = ImageDraw.Draw(stage)
    seats = [(140, 70), (486, 70), (832, 70), (40, 300), (932, 300), (486, 530)]
    stacks = [3, 4, 2, 5, 1, 4]
    for s, (x, y) in enumerate(seats):
        mat = files[f"mats/mat-{s}-{'flower' if s in (1, 4) else 'blank'}.png"]
        stage.alpha_composite(up(mat, 3), (x, y))
        for i in range(stacks[s]):
            face = "discs/lc-down.png" if i == 4 else "discs/back.png"
            if s == 5 and i == stacks[s] - 1:
                face = "discs/rose.png"
            if s == 3 and i == stacks[s] - 1:
                face = "discs/skull.png"
            stage.alpha_composite(up(files[face], 3), (x + 36, y + (22 - 4 * i) * 3))
        av = files[f"avatars/avatar-{s}.png"]
        plate = Image.new("RGBA", (150, 72), rgba("#2a1610" if theme == "night" else "#3a2016", 225))
        plate.alpha_composite(up(av, 2), (4, 4))
        for j, ic in enumerate(("disc", "stack")):
            plate.alpha_composite(up(files[f"ui/{ic}.png"], 2), (74 + j * 36, 8))
        stage.alpha_composite(plate, (x + 176, y + 4))
    d.text((520, 360), "", fill=(255, 255, 255))
    return stage


def build_gallery(choice: dict[str, str], files: dict[str, Image.Image]) -> dict[str, dict[str, str]]:
    GAL.mkdir(parents=True, exist_ok=True)
    paths: dict[str, dict[str, str]] = {}
    for g, (_, opts, _) in GROUPS.items():
        paths[g] = {}
        for k, fn in opts.items():
            p = GAL / f"{g}-{k}.png"
            res = fn()
            if g.startswith("emote-"):
                # 表情：4 帧 × 4 倍（夜/白）+ 气泡里的样子 + GIF
                sheet = list(res.values())[0]
                prev = preview({"x": sheet})
                gp = GAL / f"{g}-{k}.gif"
                from pix import gif
                gif(sheet, 4, gp, scale=4, ms=160)
                prev.save(p)
                paths[g][k] = str(p)
                continue
            if g == "discs":
                faces = {kk.split("/")[1][:-4]: v for kk, v in res.items() if kk.startswith("discs/")}
                import discsets
                im = Image.open(discsets.sheet(f"gal-{k}", faces, files["mats/mat-0-blank.png"]))
            elif g in ("scene-night", "scene-day", "hero"):
                ims = list(res.values())
                im = Image.new("RGBA", (sum(i.width for i in ims) + 8 * (len(ims) - 1), 288), NIGHT)
                for j, i in enumerate(ims):
                    im.alpha_composite(i, (j * (512 + 8), 0))
                im = up(im, 1)
            else:
                im = preview(res)
            im.save(p)
            paths[g][k] = str(p)
    # 牌桌模拟（推荐那一套）
    for theme in ("night", "day"):
        for i in (0, 1):
            table_mock(files, theme, i).save(GAL / f"mock-{theme}-{i}.png")
    return paths


if __name__ == "__main__":
    if "--check" in sys.argv:
        sys.exit(1 if check() else 0)
    choice = selection()
    for g, (_, opts, _) in GROUPS.items():
        if choice.get(g) not in opts:
            choice[g] = next(iter(opts))
    write_selection(choice)
    files = export(choice)
    bad = check()
    if "--no-gallery" not in sys.argv:
        build_gallery(choice, files)
    print("ok" if not bad else "有问题")
