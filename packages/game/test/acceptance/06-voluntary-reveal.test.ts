/**
 * 开工拍板（他额外要的）：挑战失败后其他人可以自愿「亮出我的垫子」。
 * 依据：补充 3.3 #3（官方 p.8 旁注），README 默认规则表「只在失败那次的结算画面，全部亮，不能挑」。
 * 要点：只在失败的结算画面；挑战者不能亮；全亮；亮了才公开；不泄露挑战者失的是什么；超时 / 自动不替人亮。
 */
import { describe, expect, it } from "vitest";
import { act, buildGame, canRevealStack, redactGameForViewer, timeoutTurn, type GameState } from "../../src/index.js";
import { autoAll, flip, open, pass, raise, readyAll, reject, run, runAll } from "./_helpers.js";

const reveal = { type: "revealStack" } as const;

/** 4 人：A [花] 开叫 2，B [骷]，C [骷, 花]，D [花, 花]；B、C、D pass；A 翻 B 的骷 → 失败，随机失掉一朵花。 */
function failed(): GameState {
  let g = buildGame({
    players: [{ stack: ["rose"] }, { stack: ["skull"] }, { stack: ["skull", "rose"] }, { stack: ["rose", "rose"] }],
    turn: "p1",
  });
  g = runAll(g, [["p1", open(2)], ["p2", pass], ["p3", pass], ["p4", pass]]);
  g = autoAll(g);
  return act(g, "p1", flip("p2"), "rose");
}

describe("失败后自愿亮牌（拍板）", () => {
  it("失败结算：挑战者不能亮；板上已全部翻开的人没东西可亮；其他人可以亮", () => {
    const g = failed();
    expect(g.phase).toBe("roundEnd");
    expect(g.roundLog.result).toBe("fail");
    expect(canRevealStack(g, "p1")).toBe(false);
    reject(g, "p1", reveal);
    expect(canRevealStack(g, "p2")).toBe(false); // B 唯一的一张已被翻开
    reject(g, "p2", reveal);
    expect(canRevealStack(g, "p3")).toBe(true);
    expect(canRevealStack(g, "p4")).toBe(true);
  });

  it("C 亮牌：板上没翻开的全部公开（从底往上的深度和牌面），所有视角都看得到，但没有 id；不能再亮一次", () => {
    let g = run(failed(), "p3", reveal);
    expect(g.phase).toBe("roundEnd");
    const ev = g.events.find((e) => e.type === "StackRevealed");
    expect(ev).toEqual({
      type: "StackRevealed",
      player: "p3",
      discs: [
        { depth: 0, face: "skull" },
        { depth: 1, face: "rose" },
      ],
    });
    expect(g.roundLog.reveals).toEqual([{ player: "p3", discs: [{ depth: 0, face: "skull" }, { depth: 1, face: "rose" }] }]);
    for (const viewer of ["p1", "p2", "p4", ""]) {
      const st = redactGameForViewer(g, viewer).players[2]!.stack;
      expect(st.map((d) => [d.revealed, d.face])).toEqual([
        [true, "skull"],
        [true, "rose"],
      ]);
      expect(st.every((d) => d.id === undefined)).toBe(true);
    }
    reject(g, "p3", reveal);
    // 没亮的 D 仍然看不到
    const d = redactGameForViewer(g, "p1").players[3]!.stack;
    expect(d.every((x) => x.face === undefined && !x.revealed)).toBe(true);
  });

  it("亮牌不泄露挑战者失掉的是什么", () => {
    let g = run(failed(), "p3", reveal);
    g = run(g, "p4", reveal);
    for (const viewer of ["p2", "p3", "p4", ""]) {
      const v = redactGameForViewer(g, viewer);
      expect(v.players[0]!.lost).toBeUndefined();
      expect(JSON.stringify(v.roundLog.loss)).not.toMatch(/rose|skull/);
      for (const e of v.events) if (e.type === "DiscLost") expect(e.face).toBeUndefined();
    }
  });

  it("成功的结算画面不能亮牌", () => {
    let g = buildGame({ players: [{ stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["skull"] }], turn: "p1" });
    g = runAll(g, [["p1", open(2)], ["p2", pass], ["p3", pass]]);
    g = autoAll(g);
    expect(g.roundLog.result).toBe("success");
    expect(canRevealStack(g, "p3")).toBe(false);
    reject(g, "p3", reveal);
  });

  it("结算画面以外的阶段不能亮牌（加注中、揭牌中）", () => {
    let g = buildGame({ players: [{ stack: ["rose"] }, { stack: ["skull"] }, { stack: ["rose", "rose"] }], turn: "p1" });
    g = run(g, "p1", open(1));
    reject(g, "p3", reveal);
    g = runAll(g, [["p2", pass], ["p3", raise(3)]]);
    expect(g.phase).toBe("bidding");
    reject(g, "p2", reveal);
  });

  it("结算画面到点自动开下一轮，不替任何人亮牌；收牌后亮过的牌面也不再可见", () => {
    let g = run(failed(), "p3", reveal);
    g = timeoutTurn(g);
    expect(g.phase).toBe("placeInitial");
    expect(g.history.at(-1)!.reveals.map((r) => r.player)).toEqual(["p3"]);
    const v = redactGameForViewer(g, "p1");
    expect(v.players[2]!.hand.every((d) => d.face === undefined && d.id === undefined)).toBe(true);
  });

  it("自淘汰指定先手之后的失败结算画面，其他人也可以亮", () => {
    let g = buildGame({
      players: [{ hand: [], stack: ["skull"] }, { stack: ["rose"] }, { stack: ["rose"] }],
      turn: "p1",
    });
    g = runAll(g, [["p1", open(1)], ["p2", pass], ["p3", pass]]);
    g = autoAll(g);
    expect(g.phase).toBe("chooseFirst");
    g = run(g, "p1", { type: "chooseFirstPlayer", player: "p2" });
    expect(g.phase).toBe("roundEnd");
    expect(canRevealStack(g, "p2")).toBe(true);
    g = run(g, "p2", reveal);
    expect(redactGameForViewer(g, "p3").players[1]!.stack[0]).toMatchObject({ revealed: true, face: "rose" });
    g = readyAll(g);
    expect(g.round).toBe(2);
  });
});
