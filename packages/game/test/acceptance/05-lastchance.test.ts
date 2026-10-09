/**
 * 规则书 §7 Last Chance 碟（开房选项，拍板：默认关）；补充 3.2 #3 #4、3.3 #2、3.4（超时不选碟子）。
 * 用例：TC17、TC26、TC27、TC28、TC29。
 *
 * 局面链：第 1 轮 A 一共 2 张（板上 1 花、手里 1 张），开叫 2 翻到 B 顶上的骷髅失败，随机失 1 张 → 剩 1 张。
 */
import { describe, expect, it } from "vitest";
import {
  act,
  buildGame,
  holdsLastChance,
  legalActions,
  redactGameForViewer,
  timeoutCommand,
  timeoutTurn,
  totalDiscsInPlay,
  type Face,
  type GameState,
} from "../../src/index.js";
import {
  autoAll,
  countFaces,
  flip,
  handId,
  open,
  P,
  pass,
  placeFirst,
  raise,
  readyAll,
  rng,
  run,
  runAll,
  total,
} from "./_helpers.js";

/** 第 1 轮：A [花] + 手里 handFace，B [骷]，C [花]；A 开叫 2，B、C pass；翻 B → 随机失掉 lossFace。停在结算画面。 */
function round1Fail(lastChance: boolean, handFace: Face, lossFace: Face): GameState {
  let g = buildGame({
    players: [{ hand: [handFace], stack: ["rose"] }, { stack: ["skull"] }, { stack: ["rose"] }],
    options: { lastChance },
    turn: "p1",
  });
  g = runAll(g, [["p1", open(2)], ["p2", pass], ["p3", pass]]);
  g = autoAll(g);
  return act(g, "p1", flip("p2"), lossFace);
}

const lcIn = (g: GameState, id: string) => [...P(g, id).hand, ...P(g, id).stack].filter((d) => d.lastChance);

describe("§7 Last Chance 碟：拿碟（TC17、TC26）", () => {
  it("TC17/TC26 变体关：失败后只剩 1 张 → 没有碟子，下一轮手里 1 张", () => {
    let g = round1Fail(false, "skull", "skull");
    expect(total(g, "p1")).toBe(1);
    expect(g.roundLog.lastChanceEarned).toBeNull();
    expect(g.events.some((e) => e.type === "LastChanceEarned")).toBe(false);
    g = readyAll(g);
    expect(P(g, "p1").hand).toHaveLength(1);
    expect(lcIn(g, "p1")).toHaveLength(0);
    expect(holdsLastChance(g, P(g, "p1"))).toBe(false);
  });

  it("TC17/TC26 变体开：失败后剩 1 张 → 拿碟；下一轮手里 2 张（自己 1 + 碟），所有视角都看得到碟子是玫瑰", () => {
    let g = round1Fail(true, "skull", "skull");
    expect(total(g, "p1")).toBe(1);
    expect(g.roundLog.lastChanceEarned).toBe("p1");
    expect(g.events.some((e) => e.type === "LastChanceEarned" && e.player === "p1")).toBe(true);
    g = readyAll(g);
    expect(g.round).toBe(2);
    expect(P(g, "p1").hand).toHaveLength(2);
    expect(countFaces(P(g, "p1").hand)).toEqual({ rose: 1, skull: 0, lastChance: 1 });
    expect(P(g, "p1").lastChanceRound).toBe(2);
    expect(holdsLastChance(g, P(g, "p1"))).toBe(true);
    expect(total(g, "p1")).toBe(1); // 碟子不算自己的垫子
    for (const viewer of ["p1", "p2", "p3", ""]) {
      const hand = redactGameForViewer(g, viewer).players[0]!.hand;
      const lc = hand.filter((d) => d.lastChance);
      expect(lc).toHaveLength(1);
      expect(lc[0]!.face).toBe("rose");
    }
  });

  it("翻到自己的骷髅、自选失牌后剩 1 张，同样拿碟（补充 3.3 #2：任何失败后剩 1 张）", () => {
    let g = buildGame({
      players: [{ hand: ["rose"], stack: ["skull"] }, { stack: ["rose"] }, { stack: ["rose"] }],
      options: { lastChance: true },
      turn: "p1",
    });
    g = runAll(g, [["p1", open(1)], ["p2", pass], ["p3", pass]]);
    g = autoAll(g);
    expect(g.phase).toBe("loseChoosing");
    g = run(g, "p1", { type: "loseDisc", discId: P(g, "p1").hand.find((d) => d.face === "skull")!.id! });
    expect(total(g, "p1")).toBe(1);
    expect(g.roundLog.lastChanceEarned).toBe("p1");
  });

  it("失败后还剩 2 张以上不拿碟", () => {
    let g = buildGame({
      players: [{ stack: ["rose"] }, { stack: ["skull"] }, { stack: ["rose"] }], // A 一共 4 张
      options: { lastChance: true },
      turn: "p1",
    });
    g = runAll(g, [["p1", open(2)], ["p2", pass], ["p3", pass]]);
    g = autoAll(g);
    g = act(g, "p1", flip("p2"), "rose");
    expect(total(g, "p1")).toBe(3);
    expect(g.roundLog.lastChanceEarned).toBeNull();
  });
});

describe("§7 Last Chance 碟：用碟（TC27、TC28、TC29）", () => {
  /** 第 2 轮准备阶段：A 手里 [自己的 ownFace, 碟]，A 先手（上一轮挑战者没淘汰）。 */
  function round2(ownFace: Face): GameState {
    const lossFace: Face = ownFace === "rose" ? "skull" : "rose";
    const g = readyAll(round1Fail(true, "skull", lossFace));
    expect(g.firstPlayer).toBe("p1");
    expect(countFaces(P(g, "p1").hand)).toEqual({ rose: ownFace === "rose" ? 1 : 0, skull: ownFace === "skull" ? 1 : 0, lastChance: 1 });
    return g;
  }

  it("TC27 碟子盖上去算进场上总数、能被翻、翻到算玫瑰；本轮结束收回，A 剩 1 张、之后不会再拿到碟子", () => {
    let g = round2("rose");
    g = placeFirst(g, "p1", "rose");
    g = placeFirst(g, "p2", "rose");
    g = placeFirst(g, "p3", "rose");
    // 决策回合 A 盖碟子（碟子在顶）
    g = run(g, "p1", { type: "placeDisc", discId: lcIn(g, "p1")[0]!.id! });
    expect(totalDiscsInPlay(g)).toBe(4);
    expect(P(g, "p1").stack.at(-1)!.lastChance).toBe(true);
    g = runAll(g, [["p2", open(2)], ["p3", pass], ["p1", pass]]);
    expect(g.challenger).toBe("p2");
    g = autoAll(g); // B 自己 1 张花
    g = run(g, "p2", flip("p1"));
    const last = g.roundLog.flips.at(-1)!;
    expect(last).toMatchObject({ owner: "p1", face: "rose", lastChance: true });
    expect(g.roundLog.result).toBe("success");
    expect(P(g, "p2").flowerUp).toBe(true);
    g = readyAll(g);
    expect(g.round).toBe(3);
    expect(P(g, "p1").hand).toHaveLength(1);
    expect(lcIn(g, "p1")).toHaveLength(0);
    expect(holdsLastChance(g, P(g, "p1"))).toBe(false);
    // 「整局最多一次」是推论：A 只剩 1 张，再失败就是 0 张淘汰，不会再拿碟
    g = placeFirst(g, "p1", "rose");
    g = placeFirst(g, "p2", "skull");
    g = placeFirst(g, "p3", "rose");
    // 第 3 轮先手是上一轮挑战者 B
    expect(g.turn).toBe("p2");
    g = runAll(g, [["p2", open(1)], ["p3", pass], ["p1", raise(2)], ["p2", pass]]);
    g = autoAll(g);
    g = run(g, "p1", flip("p2"));
    expect(P(g, "p1").eliminated).toBe(true);
    expect(g.roundLog.lastChanceEarned).toBeNull();
  });

  it("TC28 持碟那一轮当挑战者失败 → 碟子和最后 1 张一起失去，直接淘汰（不抽不挑），下一轮先手 = 骷髅主人", () => {
    // 原文「A 盖花、再盖碟子，总数 4；A openBid(3)，B pass、C pass」走不到：A 盖碟子用掉了自己的回合，
    // 轮到 B 时 B 只能盖（总数变 5）或开叫。改成最接近的合法顺序：A 盖碟子 → B 开叫 1 → C pass → A 加到 3 → B pass。
    let g = round2("rose");
    g = placeFirst(g, "p1", "rose");
    g = placeFirst(g, "p2", "skull");
    g = placeFirst(g, "p3", "rose");
    g = run(g, "p1", { type: "placeDisc", discId: lcIn(g, "p1")[0]!.id! });
    expect(totalDiscsInPlay(g)).toBe(4);
    g = runAll(g, [["p2", open(1)], ["p3", pass], ["p1", raise(3)], ["p2", pass]]);
    expect(g.challenger).toBe("p1");
    g = autoAll(g); // 先翻顶上的碟子，再翻自己的花
    expect(g.roundLog.flips.map((f) => [f.owner, f.face, !!f.lastChance])).toEqual([
      ["p1", "rose", true],
      ["p1", "rose", false],
    ]);
    expect(g.flipsToDo).toBe(1);
    g = run(g, "p1", flip("p2"));
    expect(g.roundLog.result).toBe("fail");
    expect(P(g, "p1").eliminated).toBe(true);
    expect(total(g, "p1")).toBe(0);
    expect(lcIn(g, "p1")).toHaveLength(0);
    expect(g.roundLog.loss).toMatchObject({ player: "p1", method: "lastChance", eliminated: true });
    expect(g.phase).toBe("roundEnd");
    expect(g.nextFirst).toBe("p2");
  });

  it("持碟那一轮翻到自己的骷髅 → 同样直接淘汰，由他指定下一轮先手", () => {
    let g = round2("skull");
    g = placeFirst(g, "p1", "skull");
    g = placeFirst(g, "p2", "rose");
    g = placeFirst(g, "p3", "rose");
    g = run(g, "p1", { type: "placeDisc", discId: lcIn(g, "p1")[0]!.id! });
    g = runAll(g, [["p2", open(1)], ["p3", pass], ["p1", raise(2)], ["p2", pass]]);
    g = autoAll(g); // 碟子（花）→ 自己的骷髅
    expect(g.roundLog.result).toBe("fail");
    expect(g.selfSkull).toBe(true);
    expect(P(g, "p1").eliminated).toBe(true);
    expect(g.roundLog.loss).toMatchObject({ method: "lastChance", eliminated: true });
    expect(g.phase).toBe("chooseFirst");
  });

  it("持碟但这一轮没当挑战者：结束时碟子收走，人留 1 张", () => {
    let g = round2("rose");
    g = placeFirst(g, "p1", "rose");
    g = placeFirst(g, "p2", "rose");
    g = placeFirst(g, "p3", "rose");
    g = runAll(g, [["p1", open(1)], ["p2", raise(2)], ["p3", pass], ["p1", pass]]);
    g = autoAll(g);
    g = run(g, "p2", flip("p3"));
    expect(g.roundLog.result).toBe("success");
    g = readyAll(g);
    expect(lcIn(g, "p1")).toHaveLength(0);
    expect(P(g, "p1").hand).toHaveLength(1);
  });

  it("TC29 手里还有碟子就不算没垫子：可以盖碟子也可以开叫；超时不选碟子 → 开叫 1", () => {
    let g = round2("rose");
    // 准备阶段超时：随机盖的那张一定是自己的，不是碟子
    for (let seed = 1; seed <= 20; seed++) {
      const c = timeoutCommand(g, "p1", rng(seed));
      expect(c?.type).toBe("placeFirst");
      expect(c && "discId" in c ? c.discId : "").toBe(handId(g, "p1", "rose"));
    }
    g = placeFirst(g, "p1", "rose");
    g = placeFirst(g, "p2", "rose");
    g = placeFirst(g, "p3", "rose");
    expect(g.turn).toBe("p1");
    const lcId = lcIn(g, "p1")[0]!.id!;
    const acts = legalActions(g, "p1");
    expect(acts).toContainEqual({ type: "placeDisc", discId: lcId });
    expect(acts).toContainEqual(open(1));
    for (let seed = 1; seed <= 20; seed++) expect(timeoutCommand(g, "p1", rng(seed))).toEqual(open(1));
    const t = timeoutTurn(g);
    expect(t.phase).toBe("bidding");
    expect(t.bid).toBe(1);
    expect(P(t, "p1").hand.some((d) => d.lastChance)).toBe(true);
  });
});

describe("Last Chance 碟默认关时的同一局面（TC17 对照）", () => {
  it("变体关时，单张玩家第 2 轮准备完手就空了，只能开叫", () => {
    let g = readyAll(round1Fail(false, "skull", "skull"));
    g = placeFirst(g, "p1", "rose");
    g = placeFirst(g, "p2", "rose");
    g = placeFirst(g, "p3", "rose");
    expect(g.turn).toBe("p1");
    expect(legalActions(g, "p1").every((c) => c.type === "openBid")).toBe(true);
  });
});
