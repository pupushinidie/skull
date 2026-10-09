/**
 * 规则书 §5.1 揭牌：一张张翻、只翻每摞最上面、先翻完自己的再翻别人、翻别人时每张都可以换板、翻到骷髅立即停。
 * 用例：TC8、TC9、TC15（补充替换版）、TC18（翻牌部分）、TC24。
 */
import { describe, expect, it } from "vitest";
import { buildGame, flippableMats, needsAdvance, redactGameForViewer, type GameState } from "../../src/index.js";
import { autoAll, flip, open, P, pass, reject, run, runAll, total } from "./_helpers.js";

describe("§5.1 先翻自己、从顶往下（TC8）", () => {
  it("TC8 挑战者板 [花, 骷, 花]、叫 2：第 1 翻顶上花、第 2 翻骷髅 → 失败进自选失牌，别人的一张没翻", () => {
    let g = buildGame({
      players: [{ stack: ["rose", "skull", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }],
      turn: "p1",
    });
    g = runAll(g, [["p1", open(2)], ["p2", pass], ["p3", pass]]);
    expect(g.phase).toBe("resolving");
    expect(g.challenger).toBe("p1");
    expect(needsAdvance(g)).toBe(true);
    expect(g.awaitingMatChoice).toBe(false);
    g = autoAll(g);
    expect(g.roundLog.flips.map((f) => [f.owner, f.depth, f.face, f.auto])).toEqual([
      ["p1", 2, "rose", true],
      ["p1", 1, "skull", true],
    ]);
    expect(g.phase).toBe("loseChoosing");
    expect(g.selfSkull).toBe(true);
    expect(g.turn).toBe("p1");
    // §5.3：自己的骷髅 → 挑战者把垫子全部收回手里再挑（最底下那张没被翻过：翻牌记录只有 2 张）
    expect(P(g, "p1").hand).toHaveLength(4);
    expect(P(g, "p1").stack).toHaveLength(0);
    expect(P(g, "p2").stack[0]!.revealed).toBe(false);
    expect(P(g, "p3").stack[0]!.revealed).toBe(false);
    expect(g.roundLog.result).toBe("fail");
    expect(g.roundLog.skullOwner).toBe("p1");
  });

  it("TC24 叫价小于自己张数：板 [骷, 花, 花] 叫 2 → 只翻顶上 2 朵花就成功，骷髅始终没翻开，别人视角看不到它", () => {
    let g = buildGame({
      players: [{ stack: ["skull", "rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }],
      turn: "p1",
    });
    g = runAll(g, [["p1", open(2)], ["p2", pass], ["p3", pass]]);
    g = autoAll(g);
    expect(g.roundLog.result).toBe("success");
    expect(g.roundLog.flips.map((f) => f.depth)).toEqual([2, 1]);
    expect(P(g, "p1").flowerUp).toBe(true);
    expect(P(g, "p1").stack[0]!.revealed).toBe(false);
    for (const viewer of ["p2", "p3", ""]) {
      const v = redactGameForViewer(g, viewer);
      const bottom = v.players[0]!.stack[0]!;
      expect(bottom.face).toBeUndefined();
      expect(bottom.id).toBeUndefined();
      expect(v.roundLog.flips.every((f) => f.face === "rose")).toBe(true);
      expect(v.events.some((e) => e.type === "DiscRevealed" && e.face === "skull")).toBe(false);
    }
  });
});

describe("§5.1 翻别人（TC9、TC18）", () => {
  /** 挑战者 A 板 [花]，X=B 板 [花]，Y=C 板 [骷]；A 开叫 3（= 总数）直接揭牌。 */
  function tc9(): GameState {
    const g = buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["skull"] }], turn: "p1" });
    return run(g, "p1", open(3));
  }

  it("TC18 自己的没翻完就 flipMat 拒绝", () => {
    const g = tc9();
    expect(needsAdvance(g)).toBe(true);
    reject(g, "p1", flip("p2"));
  });

  it("TC9 自动翻自己 1 张花 → 等选板；翻 B 顶（花）→ 翻 C 顶（骷）→ 失败，别人骷髅走随机失牌", () => {
    let g = autoAll(tc9());
    expect(g.flipsToDo).toBe(2);
    expect(g.awaitingMatChoice).toBe(true);
    expect(g.phase).toBe("resolving");
    expect(new Set(flippableMats(g))).toEqual(new Set(["p2", "p3"]));
    g = run(g, "p1", flip("p2"));
    expect(g.flipsToDo).toBe(1);
    expect(g.phase).toBe("resolving");
    reject(g, "p1", flip("p2")); // B 板上没有没翻开的了
    g = run(g, "p1", flip("p3"));
    expect(g.roundLog.result).toBe("fail");
    expect(g.selfSkull).toBe(false);
    expect(g.roundLog.skullOwner).toBe("p3");
    expect(g.phase).not.toBe("loseChoosing"); // 别人的骷髅不进自选
    expect(g.roundLog.loss?.method).toBe("random");
    expect(total(g, "p1")).toBe(3);
    expect(total(g, "p3")).toBe(4); // 骷髅主人不受罚
    expect(total(g, "p2")).toBe(4);
  });

  it("TC18 非挑战者 flipMat 拒绝；挑战者翻自己（已翻空）拒绝；翻不存在的人拒绝", () => {
    const g = autoAll(tc9());
    reject(g, "p2", flip("p3"));
    reject(g, "p3", flip("p2"));
    reject(g, "p1", flip("p1"));
    reject(g, "p1", flip("p9"));
  });

  it("只能翻最上面那张：连翻同一块板依次是从顶往下，底下的骷髅不会被跳着翻到", () => {
    // A [花]，B [骷, 花, 花]（骷在最底），C [花]，总数 5；A 开叫 3，B、C pass
    let g = buildGame({
      players: [{ stack: ["rose"] }, { stack: ["skull", "rose", "rose"] }, { stack: ["rose"] }],
      turn: "p1",
    });
    g = runAll(g, [["p1", open(3)], ["p2", pass], ["p3", pass]]);
    g = autoAll(g);
    g = run(g, "p1", flip("p2"));
    g = run(g, "p1", flip("p2"));
    expect(g.roundLog.flips.filter((f) => !f.auto).map((f) => [f.owner, f.depth])).toEqual([
      ["p2", 2],
      ["p2", 1],
    ]);
    expect(g.roundLog.result).toBe("success");
    expect(P(g, "p2").stack[0]!.revealed).toBe(false);
  });

  it("翻别人时每张都可以换板：B 顶 → C 顶 → B 下一张", () => {
    let g = buildGame({
      players: [{ stack: ["rose"] }, { stack: ["rose", "rose"] }, { stack: ["rose", "rose"] }],
      turn: "p1",
    });
    g = runAll(g, [["p1", open(4)], ["p2", pass], ["p3", pass]]);
    g = autoAll(g);
    g = run(g, "p1", flip("p2"));
    g = run(g, "p1", flip("p3"));
    g = run(g, "p1", flip("p2"));
    expect(g.roundLog.flips.filter((f) => !f.auto).map((f) => [f.owner, f.depth])).toEqual([
      ["p2", 1],
      ["p3", 1],
      ["p2", 0],
    ]);
    expect(g.roundLog.result).toBe("success");
  });

  it("翻开的垫子牌面对所有人公开（没有 id）", () => {
    let g = autoAll(tc9());
    g = run(g, "p1", flip("p2"));
    for (const viewer of ["p1", "p3", ""]) {
      const v = redactGameForViewer(g, viewer);
      const d = v.players[1]!.stack[0]!;
      expect(d.revealed).toBe(true);
      expect(d.face).toBe("rose");
      expect(d.id).toBeUndefined();
    }
  });
});

describe("§5.1 叫价 = 总数必须全翻（TC15 补充替换版）", () => {
  it("TC15 3 人局 C 已淘汰，A、B 各 1 朵花，A 开叫 2 → 不轮到 B 直接揭牌；翻完自己必须翻 B，成功", () => {
    let g = buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { eliminated: true }], turn: "p1" });
    g = run(g, "p1", open(2));
    expect(g.phase).toBe("resolving");
    expect(g.challenger).toBe("p1");
    g = autoAll(g);
    expect(g.flipsToDo).toBe(1);
    expect(flippableMats(g)).toEqual(["p2"]);
    reject(g, "p1", flip("p3")); // 已淘汰，没有板
    g = run(g, "p1", flip("p2"));
    expect(g.roundLog.result).toBe("success");
    expect(P(g, "p1").flowerUp).toBe(true);
  });
});
