/**
 * 规则书 §4.2 轮流盖牌或开叫、§4.3 加注；补充 3.2 #2（叫到总数立刻开翻）、3.3 #1（第一次轮到就能开叫）。
 * 用例：TC3、TC4、TC5、TC6、TC7、TC18（叫价部分）、TC19、TC20、TC21。
 */
import { describe, expect, it } from "vitest";
import { buildGame, legalActions, totalDiscsInPlay, type GameState } from "../../src/index.js";
import { autoAll, flip, handId, open, P, pass, placeDisc, raise, reject, run, runAll } from "./_helpers.js";

/** 4 人，每人板上 1 朵玫瑰，轮到 first（placeOrBid）。 */
function fourOnes(first = "p1"): GameState {
  return buildGame({
    players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }],
    firstPlayer: first,
    turn: first,
  });
}

describe("§4.2 开叫的范围（TC3，按补充 3.2 #2 修正）", () => {
  it("TC3 总数 4：开叫 0、5 拒；开叫 1 → 加注阶段，轮到下家", () => {
    const g = fourOnes();
    expect(totalDiscsInPlay(g)).toBe(4);
    reject(g, "p1", open(0));
    reject(g, "p1", open(5));
    reject(g, "p1", open(-1));
    const s = run(g, "p1", open(1));
    expect(s.phase).toBe("bidding");
    expect(s.bid).toBe(1);
    expect(s.bidder).toBe("p1");
    expect(s.turn).toBe("p2");
    // 开叫后谁都不能再盖牌
    reject(s, "p2", { type: "placeDisc", discId: handId(s, "p2", "rose") });
    reject(s, "p3", { type: "placeDisc", discId: handId(s, "p3", "rose") });
    expect(legalActions(s, "p2").some((c) => c.type === "placeDisc")).toBe(false);
  });

  it("TC3（勘误）总数 4 时开叫 4 合法，但叫到上限直接进揭牌，挑战者 = 开叫的人", () => {
    const s = run(fourOnes(), "p1", open(4));
    expect(s.phase).toBe("resolving");
    expect(s.challenger).toBe("p1");
    expect(s.bid).toBe(4);
    for (const id of ["p2", "p3", "p4"]) expect(P(s, id).passed).toBe(false);
  });

  it("TC19 先手第一次轮到就可以直接开叫（不用先盖第 2 张）", () => {
    const g = fourOnes("p1");
    const s = run(g, "p1", open(1));
    expect(s.phase).toBe("bidding");
    expect(s.turn).toBe("p2");
    expect(P(s, "p1").stack).toHaveLength(1);
  });

  it("TC20 3 人各 1 张，先手开叫 3 → 直接揭牌，B、C 不再轮到；A 翻完自己 1 张还要翻 2 张", () => {
    let g = buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    g = run(g, "p1", open(3));
    expect(g.phase).toBe("resolving");
    expect(g.challenger).toBe("p1");
    expect(P(g, "p2").passed).toBe(false);
    expect(P(g, "p3").passed).toBe(false);
    reject(g, "p2", pass);
    reject(g, "p2", raise(3));
    g = autoAll(g);
    expect(g.flipsToDo).toBe(2);
    expect(g.awaitingMatChoice).toBe(true);
    g = run(g, "p1", flip("p2"));
    g = run(g, "p1", flip("p3"));
    expect(g.roundLog.result).toBe("success");
  });
});

describe("§4.2 盖牌（TC4）", () => {
  it("TC4 轮到 A 盖一张 → A 板上 2 张、总数 5，轮到顺时针下家", () => {
    const s = placeDisc(fourOnes(), "p1", "rose");
    expect(P(s, "p1").stack).toHaveLength(2);
    expect(P(s, "p1").hand).toHaveLength(2);
    expect(totalDiscsInPlay(s)).toBe(5);
    expect(s.phase).toBe("placeOrBid");
    expect(s.turn).toBe("p2");
  });

  it("TC4 A 4 张全盖在板上后，轮到 A 只能开叫（不能盖、不能跳过）", () => {
    const g = buildGame({
      players: [{ hand: [], stack: ["rose", "rose", "skull", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }],
      turn: "p1",
    });
    reject(g, "p1", { type: "placeDisc", discId: handId(g, "p2", "rose") });
    reject(g, "p1", pass);
    const acts = legalActions(g, "p1");
    expect(acts.length).toBeGreaterThan(0);
    expect(acts.every((c) => c.type === "openBid")).toBe(true);
    expect(acts.map((c) => (c as { count: number }).count).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(run(g, "p1", open(1)).phase).toBe("bidding");
  });

  it("placeOrBid 里不能 pass（没开叫就不能跳过）", () => {
    reject(fourOnes(), "p1", pass);
  });

  it("盖牌顺时针轮转，跨过末座回到 p1；已淘汰的人被跳过", () => {
    let g = fourOnes("p3");
    g = placeDisc(g, "p3", "rose");
    expect(g.turn).toBe("p4");
    g = placeDisc(g, "p4", "rose");
    expect(g.turn).toBe("p1");

    let h = buildGame({
      players: [{ stack: ["rose"] }, { eliminated: true }, { stack: ["rose"] }, { stack: ["rose"] }],
      turn: "p1",
    });
    h = placeDisc(h, "p1", "rose");
    expect(h.turn).toBe("p3");
    reject(h, "p2", open(1));
  });

  it("TC18 不是自己的回合：开叫、盖牌都拒绝；不能盖别人的垫子", () => {
    const g = fourOnes("p1");
    reject(g, "p2", open(1));
    reject(g, "p3", { type: "placeDisc", discId: handId(g, "p3", "rose") });
    reject(g, "p1", { type: "placeDisc", discId: handId(g, "p2", "rose") });
  });
});

describe("§4.3 加注（TC5、TC6、TC7、TC21）", () => {
  /** A 板 2、B 板 2、C 板 1、D 板 1，总数 6；A 开叫 2，轮到 B。 */
  function six(): GameState {
    const g = buildGame({
      players: [{ stack: ["rose", "rose"] }, { stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }],
      turn: "p1",
    });
    return run(g, "p1", open(2));
  }

  it("TC5 bid=2、总数 6：加 2 拒、加 1 拒、加 7 拒、加 3 允", () => {
    const g = six();
    expect(totalDiscsInPlay(g)).toBe(6);
    expect(g.turn).toBe("p2");
    reject(g, "p2", raise(2));
    reject(g, "p2", raise(1));
    reject(g, "p2", raise(7));
    const s = run(g, "p2", raise(3));
    expect(s.bid).toBe(3);
    expect(s.bidder).toBe("p2");
    expect(s.turn).toBe("p3");
    expect(s.phase).toBe("bidding");
    // 跳着加多少都行
    expect(run(s, "p3", raise(5)).bid).toBe(5);
  });

  it("TC5/TC21 加注到总数 6 → 立刻揭牌，挑战者 B；C、D、A 都不再行动；B 翻完自己 2 张还差 4 张", () => {
    let g = run(six(), "p2", raise(6));
    expect(g.phase).toBe("resolving");
    expect(g.challenger).toBe("p2");
    expect(g.bid).toBe(6);
    for (const id of ["p1", "p3", "p4"]) {
      expect(P(g, id).passed).toBe(false);
      reject(g, id, pass);
    }
    g = autoAll(g);
    expect(g.flipsToDo).toBe(4);
    expect(g.awaitingMatChoice).toBe(true);
  });

  it("TC6 pass 不可回：B pass 后再加注拒绝，轮转跳过 B；B 的垫子留在板上，挑战者可以翻", () => {
    let g = six(); // A 开叫 2，轮到 B
    g = run(g, "p2", pass);
    expect(P(g, "p2").passed).toBe(true);
    expect(g.turn).toBe("p3");
    reject(g, "p2", raise(4));
    reject(g, "p2", pass);
    g = run(g, "p3", raise(3));
    g = run(g, "p4", pass);
    expect(g.turn).toBe("p1"); // D 之后跳回 A
    g = run(g, "p1", raise(4));
    expect(g.turn).toBe("p3"); // 跳过已 pass 的 B
    reject(g, "p2", raise(5));
    expect(legalActions(g, "p2")).toEqual([]);
    g = run(g, "p3", pass);
    // 只剩 A 没 pass → A 当挑战者
    expect(g.phase).toBe("resolving");
    expect(g.challenger).toBe("p1");
    expect(P(g, "p2").stack).toHaveLength(2);
    g = autoAll(g); // A 自己 2 张玫瑰
    expect(g.flipsToDo).toBe(2);
    g = run(g, "p1", flip("p2")); // 翻已经 pass 的 B
    expect(g.roundLog.flips.at(-1)!.owner).toBe("p2");
  });

  it("TC7 A 开叫 3 → B 加 4 → C pass → D pass → A pass：最后没 pass 的 B 当挑战者", () => {
    // 原文没给张数；总数要 ≥ 5，否则 B 加到 4 就直接开翻了。这里 A 板 2 张，其余各 1 张，总数 5
    let g = buildGame({
      players: [{ stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }],
      turn: "p1",
    });
    g = runAll(g, [["p1", open(3)], ["p2", raise(4)], ["p3", pass], ["p4", pass]]);
    expect(g.phase).toBe("bidding");
    expect(g.turn).toBe("p1");
    g = run(g, "p1", pass);
    expect(g.phase).toBe("resolving");
    expect(g.challenger).toBe("p2");
    expect(g.bid).toBe(4);
    expect(g.roundLog.bids).toEqual([
      { type: "open", player: "p1", count: 3 },
      { type: "raise", player: "p2", count: 4 },
      { type: "pass", player: "p3" },
      { type: "pass", player: "p4" },
      { type: "pass", player: "p1" },
    ]);
  });

  it("开叫后其余人全 pass：开叫的人直接当挑战者，不用再轮到他", () => {
    let g = buildGame({
      players: [{ stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }],
      turn: "p1",
    });
    g = runAll(g, [["p1", open(2)], ["p2", pass], ["p3", pass], ["p4", pass]]);
    expect(g.phase).toBe("resolving");
    expect(g.challenger).toBe("p1");
    expect(g.bid).toBe(2);
  });

  it("TC18 加注阶段不是自己的回合：加注、pass 都拒绝", () => {
    const g = six(); // 轮到 B
    reject(g, "p3", raise(3));
    reject(g, "p3", pass);
    reject(g, "p1", raise(3));
    reject(g, "p4", open(3));
  });

  it("加注阶段 legalActions：pass + 当前叫价+1 到总数的每个数", () => {
    const acts = legalActions(six(), "p2");
    const counts = acts.filter((c) => c.type === "raise").map((c) => (c as { count: number }).count).sort((a, b) => a - b);
    expect(counts).toEqual([3, 4, 5, 6]);
    expect(acts).toContainEqual(pass);
    expect(acts.some((c) => c.type === "placeDisc" || c.type === "openBid")).toBe(false);
  });
});
