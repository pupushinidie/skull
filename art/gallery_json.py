"""把 final.py 的各组候选写成不阻塞的拍板 JSON（~/projects/pipeline/games/skull/assets/gallery-decision.json），由制作人发布。
推荐项 = selection.json 里挑定的那个（已经导出到 art/out/final）。
用法：python art/gallery_json.py
"""
from __future__ import annotations

import json
import pathlib

import final

OUT = pathlib.Path.home() / "projects/pipeline/games/skull/assets/gallery-decision.json"
G = final.GAL


def main() -> None:
    choice = final.selection()
    qs = []
    for g, (title, opts, desc) in final.GROUPS.items():
        options = []
        for k in opts:
            imgs = [str(G / f"{g}-{k}.png")]
            if (G / f"{g}-{k}.gif").exists():
                imgs.append(str(G / f"{g}-{k}.gif"))
            o = {"value": k, "label": "简洁版" if k == "simple" else k, "images": imgs, "description": desc.get(k, "")}
            if k == choice[g]:
                o["recommended"] = True
            options.append(o)
        qs.append({"id": g, "type": "choice", "question": title, "options": options, "required": False})
    covers = final.OUT / "covers"
    qs.append({
        "id": "cover", "type": "choice", "question": "大厅封面（384×192，上线时制作人把选中的复制到 game-center）", "required": False,
        "options": [
            {"value": "cover-a", "label": "A 近景", "images": [str(covers / "cover-a.png")], "recommended": True,
             "description": "推荐：烛光下皮垫板上一枚玫瑰垫子、一摞黄铜垫子、一枚大眼骷髅垫子，酒瓶和蜡烛；没有字、没有人，缩小也认得出玫瑰和骷髅"},
            {"value": "cover-b", "label": "B 首页大图裁切", "images": [str(covers / "cover-b.png")],
             "description": "从首页大图裁出来的近景，垫子刻纹最清楚；玫瑰顶上被裁掉一点"},
            {"value": "cover-c", "label": "C 三摞垫子", "images": [str(covers / "cover-c.png")],
             "description": "构图最干净，但骷髅是立体的小头骨、玫瑰很小，缩小后不如 A 好认"},
        ],
    })
    intro = (
        "骷髅牌正式美术（烛光地下酒馆）的候选，每样一题。标「推荐」的是美术自查后挑定、已经导出到 `~/projects/skull/art/out/final/` 的那一套，"
        "不选就按推荐上线；想换哪张随时来换，都不满意选「其他」写备注，美术重画。每题最后一个「简洁版」是现在线上的代码画版本。\n\n"
        "预览图：左边深色底放大，右边白天底放大 + 1 倍实际像素；表情和动画另附 GIF。\n\n"
        "牌桌模拟（1440 宽、6 人、3 倍垫板，推荐那一套）："
    )
    data = {
        "id": "art-gallery",
        "title": "骷髅牌：正式美术画廊",
        "stage": "art",
        "blocking": False,
        "intro": intro,
        "images": [str(G / f"mock-{t}-{i}.png") for t in ("night", "day") for i in (0, 1)],
        "questions": qs,
    }
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=2), "utf-8")
    print(OUT, len(qs), "题")


if __name__ == "__main__":
    main()
