/**
 * 规则书 §5.2 成功、§5.3 失败（失牌）、§5.4 淘汰、§6 结束和下一轮先手、§4.4 收牌开新一轮。
 * 补充 3.2 #5（chooseFirst 阶段）、3.3 #4（只剩 1 张直接丢）、3.3 #7（指定先手超时）、3.3 #9（骷髅主人也不知道）。
 * 用例：TC10–TC14、TC16、TC18（失牌部分）、TC22、TC23、TC25。
 */
import { describe, expect, it } from "vitest";
import {
  act,
  apply,
  buildGame,
  createRng,
  legalActions,
  redactGameForViewer,
  timeoutTurn,
  waitingFor,
  type GameState,
} from "../../src/index.js";
import {
  autoAll,
  countFaces,
  flip,
  open,
  P,
  pass,
  raise,
  readyAll,
  ready,
  reject,
  run,
  runAll,
  total,
} from "./_helpers.js";

/** A [花, 花] 开叫 2，B、C pass → A 挑战（全是自己的花，必成功）。 */
function successRound(aFlowerUp: boolean, bFlowerUp = false): GameState {
  let g = buildGame({
    players: [{ stack: ["rose", "rose"], flowerUp: aFlowerUp }, { stack: ["rose"], flowerUp: bFlowerUp }, { stack: ["skull"] }],
    turn: "p1",
  });
  g = runAll(g, [["p1", open(2)], ["p2", pass], ["p3", pass]]);
  return autoAll(g);
}

/** TC8 的局面：A 板 [花, 骷, 花]、手里 1 朵花，叫 2 翻到自己骷髅 → loseChoosing。 */
function selfSkull(): GameState {
  let g = buildGame({ players: [{ stack: ["rose", "skull", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
  g = runAll(g, [["p1", open(2)], ["p2", pass], ["p3", pass]]);
  return autoAll(g);
}

/** TC9 的局面：A [花] 开叫 3，翻 B [花]，下一翻是 C [骷]（还没翻）。 */
function beforeOtherSkull(): GameState {
  let g = buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["skull"] }], turn: "p1" });
  g = autoAll(run(g, "p1", open(3)));
  return run(g, "p1", flip("p2"));
}

describe("§5.2 成功（TC10、TC11）", () => {
  it("TC10 第一次成功：垫板翻到花面，游戏没结束，进结算画面，下一轮挑战者先手", () => {
    const g = successRound(false);
    expect(g.roundLog.result).toBe("success");
    expect(P(g, "p1").flowerUp).toBe(true);
    expect(g.phase).toBe("roundEnd");
    expect(g.winners).toEqual([]);
    expect(g.result).toBeNull();
    expect(g.nextFirst).toBe("p1");
    expect(g.events.some((e) => e.type === "ChallengeSucceeded" && e.challenger === "p1" && !e.won)).toBe(true);
  });

  it("TC11 已是花面再成功 → 立即赢下整局（twoWins）", () => {
    const g = successRound(true);
    expect(g.phase).toBe("gameOver");
    expect(g.winners).toEqual(["p1"]);
    expect(g.result).toEqual({ winner: "p1", reason: "twoWins" });
    expect(g.events.some((e) => e.type === "ChallengeSucceeded" && e.won)).toBe(true);
    for (const p of g.players) expect(legalActions(g, p.id)).toEqual([]);
  });

  it("别人是花面不影响：A 第一次成功只翻花面，不算赢", () => {
    const g = successRound(false, true);
    expect(g.phase).toBe("roundEnd");
    expect(g.winners).toEqual([]);
  });
});

describe("§5.3 翻到自己的骷髅：自己挑一张丢（TC12、TC18）", () => {
  it("TC12 自选丢骷髅：垫子移除、总数 4→3；自己知道丢的是骷髅，别人只见张数 -1", () => {
    let g = selfSkull();
    // §5.3：垫子已全部收回手里
    expect(P(g, "p1").stack).toHaveLength(0);
    const skullId = P(g, "p1").hand.find((d) => d.face === "skull")!.id!;
    g = run(g, "p1", { type: "loseDisc", discId: skullId });
    expect(total(g, "p1")).toBe(3);
    expect(P(g, "p1").lostCount).toBe(1);
    expect(P(g, "p1").lost).toEqual(["skull"]);
    expect(g.phase).toBe("roundEnd");
    expect(g.nextFirst).toBe("p1"); // 挑战者没淘汰 → 自己先手
    expect(g.roundLog.loss).toEqual({ player: "p1", method: "chosen", count: 1, eliminated: false });
    // 自己视角有 face
    const own = redactGameForViewer(g, "p1");
    expect(own.events.find((e) => e.type === "DiscLost")).toMatchObject({ player: "p1", face: "skull", remaining: 3 });
    // 别人、观战只见张数
    for (const viewer of ["p2", "p3", ""]) {
      const v = redactGameForViewer(g, viewer);
      expect(v.players[0]!.lost).toBeUndefined();
      expect(v.players[0]!.lostCount).toBe(1);
      expect(v.players[0]!.hand.length + v.players[0]!.stack.length).toBe(3);
      const ev = v.events.find((e) => e.type === "DiscLost");
      expect(ev).toBeDefined();
      expect(ev && "face" in ev ? ev.face : undefined).toBeUndefined();
      expect(JSON.stringify(v.roundLog.loss)).not.toMatch(/skull|rose/);
    }
    // 下一轮：翻开过的花都收回手里，只有丢掉的骷髅没了
    g = readyAll(g);
    expect(g.round).toBe(2);
    expect(countFaces(P(g, "p1").hand)).toEqual({ rose: 3, skull: 0, lastChance: 0 });
  });

  it("TC12 也可以丢手里没盖出去的那张", () => {
    let g = selfSkull();
    const handRose = P(g, "p1").hand.find((d) => d.face === "rose")!.id!;
    g = run(g, "p1", { type: "loseDisc", discId: handRose });
    expect(P(g, "p1").lost).toEqual(["rose"]);
    g = readyAll(g);
    expect(countFaces(P(g, "p1").hand)).toEqual({ rose: 2, skull: 1, lastChance: 0 });
  });

  it("TC18 loseDisc：别人的垫子 id、不存在的 id 拒绝；非挑战者拒绝", () => {
    const g = selfSkull();
    reject(g, "p1", { type: "loseDisc", discId: P(g, "p2").stack[0]!.id! });
    reject(g, "p1", { type: "loseDisc", discId: "不存在" });
    reject(g, "p2", { type: "loseDisc", discId: P(g, "p2").hand[0]!.id! });
    reject(g, "p2", { type: "loseDisc", discId: P(g, "p1").hand[0]!.id! });
    expect(legalActions(g, "p1").filter((c) => c.type === "loseDisc")).toHaveLength(4);
    expect(legalActions(g, "p2")).toEqual([]);
  });

  it("翻到自己骷髅失败但没淘汰 → 下一轮挑战者先手", () => {
    let g = selfSkull();
    g = run(g, "p1", { type: "loseDisc", discId: P(g, "p1").hand[0]!.id! });
    g = readyAll(g);
    expect(g.firstPlayer).toBe("p1");
  });
});

describe("§5.3 翻到别人的骷髅：随机丢一张（TC13、TC25）", () => {
  it("TC13 结果只发挑战者；骷髅主人不失牌、也不知道丢的是什么", () => {
    const g = act(beforeOtherSkull(), "p1", flip("p3"), "skull");
    expect(g.roundLog.loss).toEqual({ player: "p1", method: "random", count: 1, eliminated: false });
    expect(P(g, "p1").lost).toEqual(["skull"]);
    expect(total(g, "p3")).toBe(4);
    expect(P(g, "p3").lostCount).toBe(0);
    expect(redactGameForViewer(g, "p1").events.find((e) => e.type === "DiscLost")).toMatchObject({ face: "skull" });
    for (const viewer of ["p3", "p2", ""]) {
      const v = redactGameForViewer(g, viewer);
      expect(v.players[0]!.lost).toBeUndefined();
      const ev = v.events.find((e) => e.type === "DiscLost");
      expect(ev).toBeDefined();
      expect(ev && "face" in ev ? ev.face : undefined).toBeUndefined();
    }
    expect(g.nextFirst).toBe("p1"); // 没淘汰 → 挑战者先手
  });

  it("TC25 随机失牌均匀：4000 个种子里丢掉骷髅的比例在 25% ± 3%", () => {
    // A 一共 4 张（板上 1 花，手里 2 花 1 骷），翻到 C 的骷髅
    const base = beforeOtherSkull();
    expect(total(base, "p1")).toBe(4);
    let skulls = 0;
    const N = 4000;
    for (let seed = 1; seed <= N; seed++) {
      const s = apply(base, "p1", flip("p3"), createRng(seed * 7919)).state;
      const lost = P(s, "p1").lost!;
      expect(lost).toHaveLength(1);
      if (lost[0] === "skull") skulls++;
    }
    expect(skulls / N).toBeGreaterThan(0.22);
    expect(skulls / N).toBeLessThan(0.28);
  });
});

describe("§5.4 淘汰、§6 结束（TC14、TC22、TC23）", () => {
  it("TC23 被别人骷髅淘汰：A 只剩 1 张花，B 开叫 1、C pass、A 加到 2、B pass → A 翻 B 顶的骷 → 淘汰，下一轮先手 = 骷髅主人 B", () => {
    let g = buildGame({
      players: [{ hand: [], stack: ["rose"] }, { stack: ["skull"] }, { stack: ["rose"] }],
      firstPlayer: "p2",
      turn: "p2",
    });
    g = runAll(g, [["p2", open(1)], ["p3", pass], ["p1", raise(2)], ["p2", pass]]);
    expect(g.challenger).toBe("p1");
    g = autoAll(g);
    g = run(g, "p1", flip("p2"));
    expect(g.roundLog.result).toBe("fail");
    expect(P(g, "p1").eliminated).toBe(true);
    expect(total(g, "p1")).toBe(0);
    expect(g.roundLog.loss).toMatchObject({ player: "p1", method: "random", eliminated: true });
    expect(g.events.some((e) => e.type === "PlayerEliminated" && e.player === "p1")).toBe(true);
    expect(g.nextFirst).toBe("p2");
    expect(g.phase).toBe("roundEnd");
    g = readyAll(g);
    expect(g.round).toBe(2);
    expect(g.firstPlayer).toBe("p2");
    expect(new Set(waitingFor(g))).toEqual(new Set(["p2", "p3"]));
    reject(g, "p1", { type: "placeFirst", discId: "任何" });
  });

  it("TC14 场上只剩 1 人 → 他立即获胜（哪怕 0 次成功），lastStanding", () => {
    let g = buildGame({
      players: [{ hand: [], stack: ["rose"] }, { stack: ["skull"] }, { eliminated: true }],
      turn: "p1",
    });
    g = run(g, "p1", open(2));
    g = autoAll(g);
    g = run(g, "p1", flip("p2"));
    expect(P(g, "p1").eliminated).toBe(true);
    expect(g.phase).toBe("gameOver");
    expect(g.winners).toEqual(["p2"]);
    expect(g.result).toEqual({ winner: "p2", reason: "lastStanding" });
    expect(P(g, "p2").flowerUp).toBe(false);
  });

  /** TC22：A 一共只剩 1 张骷髅、先手；被迫开叫 1，B、C pass → 翻自己的骷 → 直接淘汰。 */
  function tc22(players: 3 | 4 = 3, eliminatedP2 = false): GameState {
    const specs = [
      { hand: [], stack: ["skull" as const] },
      eliminatedP2 ? { eliminated: true } : { stack: ["rose" as const] },
      { stack: ["rose" as const] },
      ...(players === 4 ? [{ stack: ["rose" as const] }] : []),
    ];
    let g = buildGame({ players: specs, turn: "p1" });
    reject(g, "p1", { type: "placeDisc", discId: "任何" });
    expect(legalActions(g, "p1").every((c) => c.type === "openBid")).toBe(true);
    g = run(g, "p1", open(1));
    while (g.phase === "bidding") g = run(g, g.turn!, pass);
    return autoAll(g);
  }

  it("TC22 自己骷髅、只剩 1 张：不进自选失牌，直接丢掉淘汰，进入 chooseFirst", () => {
    const g = tc22();
    expect(g.phase).toBe("chooseFirst");
    expect(g.turn).toBe("p1");
    expect(P(g, "p1").eliminated).toBe(true);
    expect(g.roundLog.loss).toMatchObject({ player: "p1", method: "forced", eliminated: true });
    expect(g.nextFirst).toBeNull();
  });

  it("TC22 指定先手：别人发拒绝、指定自己（已淘汰）拒绝、指定 C → 下一轮 C 先手", () => {
    let g = tc22();
    reject(g, "p2", { type: "chooseFirstPlayer", player: "p3" });
    reject(g, "p1", { type: "chooseFirstPlayer", player: "p1" });
    reject(g, "p1", { type: "chooseFirstPlayer", player: "p9" });
    g = run(g, "p1", { type: "chooseFirstPlayer", player: "p3" });
    expect(g.phase).toBe("roundEnd");
    expect(g.nextFirst).toBe("p3");
    expect(g.roundLog.nextFirstChosenBy).toBe("p1");
    g = readyAll(g);
    expect(g.round).toBe(2);
    expect(g.firstPlayer).toBe("p3");
  });

  it("TC22 指定先手超时（补充 3.3 #7）→ 挑战者顺时针下一位存活玩家 B", () => {
    const g = timeoutTurn(tc22());
    expect(g.nextFirst).toBe("p2");
    expect(g.roundLog.nextFirstAuto).toBe(true);
  });

  it("TC22 指定先手超时跳过已淘汰的人：B 早已淘汰 → C", () => {
    const g = timeoutTurn(tc22(4, true));
    expect(g.nextFirst).toBe("p3");
  });

  it("TC22 变体：只剩 A、B 两人时 A 自淘汰 → 直接 gameOver，B 获胜，不进 chooseFirst", () => {
    let g = buildGame({ players: [{ hand: [], stack: ["skull"] }, { stack: ["rose"] }, { eliminated: true }], turn: "p1" });
    g = runAll(g, [["p1", open(1)], ["p2", pass]]);
    g = autoAll(g);
    expect(g.phase).toBe("gameOver");
    expect(g.winners).toEqual(["p2"]);
    expect(g.result?.reason).toBe("lastStanding");
  });
});

describe("§4.4 收牌开新一轮（TC16）", () => {
  it("TC16 结算后：所有板收回手里、pass 清空、叫价清零；翻开过的花照样收回；轮数 +1；历史记下上一轮", () => {
    let g = act(beforeOtherSkull(), "p1", flip("p3"), "rose");
    expect(g.phase).toBe("roundEnd");
    // 结算画面：一个人点继续还不开新轮
    g = run(g, "p2", ready);
    expect(g.phase).toBe("roundEnd");
    reject(g, "p2", ready);
    g = readyAll(g);
    expect(g.phase).toBe("placeInitial");
    expect(g.round).toBe(2);
    expect(g.firstPlayer).toBe("p1");
    expect(g.bid).toBe(0);
    expect(g.bidder).toBeNull();
    expect(g.challenger).toBeNull();
    for (const p of g.players) {
      expect(p.stack).toEqual([]);
      expect(p.passed).toBe(false);
      expect(p.placedInitial).toBe(false);
    }
    expect(P(g, "p1").hand).toHaveLength(3);
    expect(P(g, "p2").hand).toHaveLength(4); // B 被翻开过的花回到手里
    expect(countFaces(P(g, "p3").hand)).toEqual({ rose: 3, skull: 1, lastChance: 0 }); // 骷髅主人的骷髅也回来
    expect(g.history).toHaveLength(1);
    expect(g.history[0]!.result).toBe("fail");
    expect(g.history[0]!.challenger).toBe("p1");
  });

  it("TC16 结算画面到点 → 自动开下一轮（不算超时）", () => {
    const g = timeoutTurn(successRound(false));
    expect(g.phase).toBe("placeInitial");
    expect(g.round).toBe(2);
    expect(g.firstPlayer).toBe("p1");
    expect(g.events.some((e) => e.type === "TimedOut")).toBe(false);
  });
});
