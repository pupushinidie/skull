/**
 * 补充 2.3 推荐教程剧本（3 人：你 p1 + 咕噜一号 p2 + 咕噜二号 p3，你先手，四轮）。
 * 1) 按补充原文自己写一遍剧本，用真实规则走通，核对补充给的数字（总数 5 / 3 / 6 / 8、谁当挑战者、成败、失牌、下一轮先手）。
 * 2) 核对引擎导出的 TUTORIAL_SCRIPT 走出来的结果和补充一致（教程直接用它）。
 * 剧本没写死的牌面（人机盖什么）这里自己补，只要符合原文描述（比如「翻二号 → 玫瑰」）。
 */
import { describe, expect, it } from "vitest";
import { runScript, startGame, TUTORIAL_SCRIPT, type GameState, type RoundLog } from "../../src/index.js";
import { P, total } from "./_helpers.js";

const sum = (log: RoundLog) => Object.values(log.stackSizes).reduce((a, b) => a + b, 0);

describe("补充 2.3 教程剧本按真实规则走得通", () => {
  it("自己按原文写的四轮剧本：数字和补充的「剧本数字核对」一致", () => {
    let g: GameState = startGame({ players: 3, first: "p1", seed: 23 });
    // 第 1 轮：你盖 2 朵花；一号盖 2 张；二号盖 1 张后开叫 2；总数 5；你加到 3；两人 pass；翻自己 2 朵 + 二号顶上 1 朵 → 成功
    g = runScript(g, [
      ["p1", "place", "rose"], ["p2", "place", "skull"], ["p3", "place", "rose"],
      ["p1", "place", "rose"], ["p2", "place", "rose"], ["p3", "bid", 2],
      ["p1", "bid", 3], ["p2", "pass"], ["p3", "pass"],
      ["autoAll"], ["p1", "flip", "p3"],
    ]);
    expect(sum(g.roundLog)).toBe(5);
    expect(g.roundLog.challenger).toBe("p1");
    expect(g.roundLog.result).toBe("success");
    expect(P(g, "p1").flowerUp).toBe(true);
    expect(g.nextFirst).toBe("p1");

    // 第 2 轮：各盖 1 张，总数 3；你开叫 1，一号加到 2，二号 pass，你加到 3 = 总数直接开翻；翻自己 → 一号 → 二号的骷髅；随机丢一朵玫瑰
    g = runScript(g, [
      ["readyAll"],
      ["p1", "place", "rose"], ["p2", "place", "rose"], ["p3", "place", "skull"],
      ["p1", "bid", 1], ["p2", "bid", 2], ["p3", "pass"], ["p1", "bid", 3],
    ]);
    expect(g.phase).toBe("resolving"); // 叫到总数，不再轮到一号
    g = runScript(g, [["autoAll"], ["p1", "flip", "p2"], ["p1", "flip", "p3", "rose"]]);
    expect(sum(g.roundLog)).toBe(3);
    expect(g.roundLog.result).toBe("fail");
    expect(g.roundLog.skullOwner).toBe("p3");
    expect(total(g, "p3")).toBe(4); // 二号没事
    expect(total(g, "p1")).toBe(3);
    expect(P(g, "p1").lost).toEqual(["rose"]);
    expect(g.nextFirst).toBe("p1");

    // 第 3 轮：你底下骷髅、上面玫瑰；一号、二号各 2 张，总数 6；你开叫 1，一号加到 4，二号 pass，你 pass；
    // 一号翻自己 2 张后翻你的顶（玫瑰）、再翻你的骷髅 → 一号失败
    g = runScript(g, [
      ["readyAll"],
      ["p1", "place", "skull"], ["p2", "place", "rose"], ["p3", "place", "skull"],
      ["p1", "place", "rose"], ["p2", "place", "rose"], ["p3", "place", "rose"],
      ["p1", "bid", 1], ["p2", "bid", 4], ["p3", "pass"], ["p1", "pass"],
      ["autoAll"], ["p2", "flip", "p1"], ["p2", "flip", "p1", "rose"],
    ]);
    expect(sum(g.roundLog)).toBe(6);
    expect(g.roundLog.challenger).toBe("p2");
    expect(g.roundLog.result).toBe("fail");
    expect(g.roundLog.skullOwner).toBe("p1");
    expect(total(g, "p2")).toBe(3);
    expect(total(g, "p1")).toBe(3);
    expect(g.nextFirst).toBe("p2");

    // 第 4 轮：一号先手；你盖 2 朵花、手里剩骷髅；一号 3 张全盖、二号 3 张，总数 8；你开叫 2，都 pass → 第 2 次成功
    g = runScript(g, [
      ["readyAll"],
      ["p1", "place", "rose"], ["p2", "place", "rose"], ["p3", "place", "rose"],
      ["p2", "place", "rose"], ["p3", "place", "rose"], ["p1", "place", "rose"],
      ["p2", "place", "skull"], ["p3", "place", "rose"], ["p1", "bid", 2],
      ["p2", "pass"], ["p3", "pass"], ["autoAll"],
    ]);
    expect(sum(g.roundLog)).toBe(8);
    expect(P(g, "p1").hand.map((d) => d.face)).toEqual(["skull"]);
    expect(g.phase).toBe("gameOver");
    expect(g.result).toEqual({ winner: "p1", reason: "twoWins" });
  });

  it("引擎导出的 TUTORIAL_SCRIPT 走出来和补充 2.3 一致", () => {
    expect(TUTORIAL_SCRIPT).toHaveLength(4);
    let g: GameState = startGame({ players: 3, first: "p1" });
    const logs: RoundLog[] = [];
    for (const round of TUTORIAL_SCRIPT) {
      g = runScript(g, round.steps);
      logs.push(g.roundLog);
    }
    expect(logs.map(sum)).toEqual([5, 3, 6, 8]);
    expect(logs.map((l) => l.challenger)).toEqual(["p1", "p1", "p2", "p1"]);
    expect(logs.map((l) => l.result)).toEqual(["success", "fail", "fail", "success"]);
    expect(logs.map((l) => l.bid)).toEqual([3, 3, 4, 2]);
    expect(logs[1]!.skullOwner).toBe("p3");
    expect(logs[2]!.skullOwner).toBe("p1");
    expect(P(g, "p1").lost).toEqual(["rose"]); // 第 2 轮固定丢一朵玫瑰
    expect(g.phase).toBe("gameOver");
    expect(g.result).toEqual({ winner: "p1", reason: "twoWins" });
  });
});
