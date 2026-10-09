import { describe, expect, it } from "vitest";
import {
  apply,
  applyCommand,
  canRevealStack,
  createGame,
  discCount,
  holdsLastChance,
  legalActions,
  needsAdvance,
  redactGameForViewer,
  stepKey,
  timeoutCommand,
  timeoutTurn,
  totalDiscsInPlay,
  waitingFor,
} from "../src/engine.js";
import { checkInvariants } from "../src/invariants.js";
import { createRng } from "../src/rng.js";
import { act, autoFlip, buildGame, discOf, passAround, previewPlayers, runScript, startGame } from "../src/scenes.js";
import type { GameState } from "../src/types.js";
import { deepFreeze, eventsOf, intRng, P, placeCmd, rejects, run } from "./helpers.js";

/** 4 人局，大家都盖好第 1 张（全是玫瑰），先手 p1，进入轮流。 */
function placedAll(players = 4, first = "p1"): GameState {
  const game = startGame({ players, first });
  return runScript(game, game.players.map((player) => [player.id, "place", "rose"] as const));
}

function noProblems(state: GameState): void {
  expect(checkInvariants(state)).toEqual([]);
}

describe("规则书 §9 测试用例", () => {
  it("规则书#TC1 开局构成：4 人，每人 4 张（3 玫瑰 1 骷髅）、空白面、没淘汰，场上总数 0", () => {
    const game = createGame(previewPlayers(4), 5);
    expect(game.players).toHaveLength(4);
    for (const player of game.players) {
      expect(player.hand).toHaveLength(4);
      expect(player.hand.filter((disc) => disc.face === "rose")).toHaveLength(3);
      expect(player.hand.filter((disc) => disc.face === "skull")).toHaveLength(1);
      expect(player.stack).toEqual([]);
      expect(player.flowerUp).toBe(false);
      expect(player.eliminated).toBe(false);
    }
    expect(totalDiscsInPlay(game)).toBe(0);
    expect(game.phase).toBe("placeInitial");
    expect(game.round).toBe(1);
    noProblems(game);
  });

  it("规则书#TC2 同时盖第 1 张：4 人各 placeFirst → 每人板上 1 张、总数 4，进入轮流，先手生效", () => {
    let game = startGame({ players: 4, first: "p3" });
    for (const id of ["p2", "p4", "p1"]) {
      game = run(game, id, placeCmd(game, id, "rose"));
      expect(game.phase).toBe("placeInitial");
      expect(game.turn).toBeNull();
    }
    game = run(game, "p3", placeCmd(game, "p3", "skull"));
    expect(game.players.map((player) => player.stack.length)).toEqual([1, 1, 1, 1]);
    expect(totalDiscsInPlay(game)).toBe(4);
    expect(game.phase).toBe("placeOrBid");
    expect(game.turn).toBe("p3");
    expect(eventsOf(game.events, "PlacementDone")).toEqual([{ type: "PlacementDone", firstPlayer: "p3" }]);
    noProblems(game);
  });

  it("规则书#TC3 开叫校验：总数 4 时 0、5 拒，1 允（进加注），4 允（叫到上限直接揭牌，勘误 3.2 #2）；开叫后谁都不能再盖", () => {
    const game = placedAll(4);
    expect(totalDiscsInPlay(game)).toBe(4);
    expect(rejects(game, "p1", { type: "openBid", count: 0 })).toMatch(/1 到场上总数 4/);
    expect(rejects(game, "p1", { type: "openBid", count: 5 })).toMatch(/1 到场上总数 4/);
    const one = run(game, "p1", { type: "openBid", count: 1 });
    expect(one.phase).toBe("bidding");
    expect(one.bid).toBe(1);
    expect(one.bidder).toBe("p1");
    const four = run(game, "p1", { type: "openBid", count: 4 });
    expect(four.phase).toBe("resolving");
    expect(four.challenger).toBe("p1");
    for (const player of one.players) {
      const disc = player.hand[0]!;
      expect(rejects(one, player.id, { type: "placeDisc", discId: disc.id! })).not.toBeNull();
    }
    expect(rejects(one, "p2", { type: "placeDisc", discId: P(one, "p2").hand[0]!.id! })).toMatch(/已经有人开叫/);
  });

  it("规则书#TC4 盖牌与总数：轮到 A 盖一张 → A 板上 2 张、总数 5；A 盖满 4 张后再盖被拒，只能开叫", () => {
    let game = placedAll(4);
    game = run(game, "p1", placeCmd(game, "p1", "rose"));
    expect(P(game, "p1").stack).toHaveLength(2);
    expect(totalDiscsInPlay(game)).toBe(5);
    expect(game.turn).toBe("p2");
    // 一直盖到 A 手里没垫子
    while (P(game, "p1").hand.length > 0) {
      const id = game.turn!;
      game = run(game, id, { type: "placeDisc", discId: P(game, id).hand[0]!.id! });
    }
    while (game.turn !== "p1") game = run(game, game.turn!, { type: "placeDisc", discId: P(game, game.turn!).hand[0]!.id! });
    expect(P(game, "p1").stack).toHaveLength(4);
    expect(rejects(game, "p1", { type: "placeDisc", discId: P(game, "p1").stack[0]!.id! })).toMatch(/不在你手里/);
    expect(legalActions(game, "p1").every((action) => action.type === "openBid")).toBe(true);
  });

  it("规则书#TC5 加注边界：叫价 2、总数 6 时 raise(2)、raise(7) 拒，raise(3) 允，raise(6) 允（= 总数直接揭牌）", () => {
    let game = placedAll(3);
    game = runScript(game, [["p1", "place", "rose"], ["p2", "place", "rose"], ["p3", "place", "rose"], ["p1", "bid", 2]]);
    expect(totalDiscsInPlay(game)).toBe(6);
    expect(game.turn).toBe("p2");
    expect(rejects(game, "p2", { type: "raise", count: 2 })).toMatch(/比现在的 2 大/);
    expect(rejects(game, "p2", { type: "raise", count: 7 })).toMatch(/场上总数 6/);
    const three = run(game, "p2", { type: "raise", count: 3 });
    expect(three.phase).toBe("bidding");
    expect(three.bid).toBe(3);
    expect(three.turn).toBe("p3");
    const six = run(game, "p2", { type: "raise", count: 6 });
    expect(six.phase).toBe("resolving");
    expect(six.challenger).toBe("p2");
  });

  it("规则书#TC6 pass 不可回：B pass 后同一轮再加注被拒；B 的垫子还在板上，能被挑战者翻", () => {
    let game = placedAll(3);
    game = runScript(game, [["p1", "bid", 2], ["p2", "pass"]]);
    expect(P(game, "p2").passed).toBe(true);
    expect(rejects(game, "p2", { type: "raise", count: 3 })).not.toBeNull();
    game = runScript(game, [["p3", "pass"]]);
    expect(game.phase).toBe("resolving");
    game = runScript(game, [["autoAll"], ["p1", "flip", "p2"]]);
    expect(game.roundLog.flips.map((flip) => flip.owner)).toEqual(["p1", "p2"]);
    expect(game.roundLog.result).toBe("success");
  });

  it("规则书#TC7 挑战者产生：A 开叫 3 → B 加 4 → C pass → D pass → A pass，没 pass 的 B 当挑战者", () => {
    let game = placedAll(4);
    game = runScript(game, [["p1", "place", "rose"], ["p2", "place", "rose"], ["p3", "place", "rose"], ["p4", "place", "rose"]]);
    game = runScript(game, [["p1", "bid", 3], ["p2", "bid", 4], ["p3", "pass"], ["p4", "pass"]]);
    expect(game.phase).toBe("bidding");
    expect(game.turn).toBe("p1");
    game = runScript(game, [["p1", "pass"]]);
    expect(game.phase).toBe("resolving");
    expect(game.challenger).toBe("p2");
    expect(game.bid).toBe(4);
    expect(game.roundLog.bids).toEqual([
      { type: "open", player: "p1", count: 3 },
      { type: "raise", player: "p2", count: 4 },
      { type: "pass", player: "p3" },
      { type: "pass", player: "p4" },
      { type: "pass", player: "p1" },
    ]);
  });

  it("规则书#TC8 从顶往下翻 + 自己的骷髅：板上 [花, 骷, 花]、叫 2 → 先翻顶上的花，再翻到骷髅 → 失败、自选失牌，没碰别人的", () => {
    let game = buildGame({ players: [{ stack: ["rose", "skull", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    game = passAround(runScript(game, [["p1", "bid", 2]]));
    expect(game.challenger).toBe("p1");
    expect(needsAdvance(game)).toBe(true);
    game = autoFlip(game);
    expect(eventsOf(game.events, "DiscRevealed")[0]).toMatchObject({ owner: "p1", depth: 2, face: "rose", auto: true, flipsLeft: 1 });
    game = autoFlip(game);
    expect(eventsOf(game.events, "DiscRevealed")[0]).toMatchObject({ owner: "p1", depth: 1, face: "skull" });
    expect(game.phase).toBe("loseChoosing");
    expect(game.selfSkull).toBe(true);
    expect(game.roundLog.flips.map((flip) => flip.owner)).toEqual(["p1", "p1"]);
    expect(P(game, "p2").stack.every((disc) => !disc.revealed)).toBe(true);
    noProblems(game);
  });

  it("规则书#TC9 先翻自己再翻别人：自己 [花]、叫 3，X [花]、Y [骷] → 自动翻自己，翻 X 的花，翻 Y 的骷 → 失败，随机失牌", () => {
    let game = buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["skull"] }], turn: "p1" });
    game = run(game, "p1", { type: "openBid", count: 3 });
    // 叫价 3 = 总数 3，开叫那一下就进揭牌（勘误 3.2 #2）
    expect(game.phase).toBe("resolving");
    expect(game.awaitingMatChoice).toBe(false);
    game = autoFlip(game);
    expect(game.flipsToDo).toBe(2);
    expect(game.awaitingMatChoice).toBe(true);
    game = run(game, "p1", { type: "flipMat", player: "p2" });
    expect(eventsOf(game.events, "DiscRevealed")[0]).toMatchObject({ owner: "p2", face: "rose", auto: false });
    game = run(game, "p1", { type: "flipMat", player: "p3" });
    expect(eventsOf(game.events, "ChallengeFailed")[0]).toEqual({ type: "ChallengeFailed", challenger: "p1", skullOwner: "p3", selfSkull: false });
    expect(game.roundLog.loss).toMatchObject({ player: "p1", method: "random" });
    expect(discCount(P(game, "p1"))).toBe(3);
    expect(game.phase).toBe("roundEnd");
  });

  it("规则书#TC10 成功记 1 次：叫 2、自己 [花, 花] → 成功，垫板翻花面，对局没结束", () => {
    let game = buildGame({ players: [{ stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["skull"] }], turn: "p1" });
    game = runScript(passAround(runScript(game, [["p1", "bid", 2]])), [["autoAll"]]);
    expect(game.roundLog.result).toBe("success");
    expect(P(game, "p1").flowerUp).toBe(true);
    expect(game.phase).toBe("roundEnd");
    expect(game.nextFirst).toBe("p1");
    expect(eventsOf(game.events, "ChallengeSucceeded")[0]).toEqual({ type: "ChallengeSucceeded", challenger: "p1", won: false });
  });

  it("规则书#TC11 成功两次获胜：已经花面的挑战者再成功 → 终局，winners = [他]", () => {
    let game = buildGame({ players: [{ stack: ["rose", "rose"], flowerUp: true }, { stack: ["rose"] }, { stack: ["skull"] }], turn: "p1" });
    game = runScript(passAround(runScript(game, [["p1", "bid", 2]])), [["autoAll"]]);
    expect(game.phase).toBe("gameOver");
    expect(game.winners).toEqual(["p1"]);
    expect(game.result).toEqual({ winner: "p1", reason: "twoWins" });
    expect(rejects(game, "p2", { type: "nextRound" })).toMatch(/已经结束/);
  });

  it("规则书#TC12 自己骷髅自选失牌：loseDisc 移除那张；别人只看到总数 -1，不知道是花是骷", () => {
    let game = buildGame({ players: [{ stack: ["skull"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    game = runScript(passAround(runScript(game, [["p1", "bid", 1]])), [["autoAll"]]);
    expect(game.phase).toBe("loseChoosing");
    // 板上的收回手里：4 张都在手里，可以挑任何一张（包括刚翻出来的骷髅）
    expect(P(game, "p1").stack).toEqual([]);
    expect(P(game, "p1").hand).toHaveLength(4);
    const skull = discOf(game, "p1", "skull");
    game = run(game, "p1", { type: "loseDisc", discId: skull });
    expect(P(game, "p1").hand.some((disc) => disc.id === skull)).toBe(false);
    expect(P(game, "p1").lost).toEqual(["skull"]);
    expect(game.roundLog.loss).toEqual({ player: "p1", method: "chosen", count: 1, eliminated: false });
    const seenByP2 = redactGameForViewer(game, "p2");
    expect(P(seenByP2, "p1").hand).toEqual([{}, {}, {}]);
    expect(P(seenByP2, "p1").lost).toBeUndefined();
    expect(P(seenByP2, "p1").lostCount).toBe(1);
    expect(eventsOf(seenByP2.events, "DiscLost")[0]).toEqual({ type: "DiscLost", player: "p1", method: "chosen", remaining: 3 });
    expect(JSON.stringify(seenByP2)).not.toContain(skull);
    const mine = redactGameForViewer(game, "p1");
    expect(eventsOf(mine.events, "DiscLost")[0]?.face).toBe("skull");
  });

  it("规则书#TC13 别人骷髅随机失牌：服务器从挑战者全部垫子里随机拿走 1 张，结果只发挑战者；骷髅主人不失牌", () => {
    let game = buildGame({ players: [{ stack: ["rose"] }, { stack: ["skull"] }, { stack: ["rose"] }], turn: "p1" });
    game = runScript(passAround(runScript(game, [["p1", "bid", 2]])), [["autoAll"]]);
    const before = structuredClone(game);
    const result = apply(game, "p1", { type: "flipMat", player: "p2" }, intRng(2));
    const after = result.state;
    // 收回后的手里是 [手里 3 张, 板上 1 张]，int(4) 取 2 → 丢第 3 张
    const collected = [...P(before, "p1").hand, ...P(before, "p1").stack];
    expect(P(after, "p1").lost).toEqual([collected[2]!.face]);
    expect(discCount(P(after, "p1"))).toBe(3);
    expect(discCount(P(after, "p2"))).toBe(4);
    expect(P(after, "p2").lostCount).toBe(0);
    for (const viewer of ["p2", "p3", ""]) {
      const view = redactGameForViewer(after, viewer);
      expect(eventsOf(view.events, "DiscLost")[0]).not.toHaveProperty("face");
      expect(P(view, "p1").lost).toBeUndefined();
    }
    expect(eventsOf(redactGameForViewer(after, "p1").events, "DiscLost")[0]).toHaveProperty("face");
  });

  it("规则书#TC14 淘汰与最后存活：只剩 1 张的挑战者失败 → 淘汰；场上只剩 1 人 → 他赢（哪怕 0 次成功）", () => {
    let game = buildGame({
      players: [{ stack: ["rose"], lost: ["rose", "rose", "skull"] }, { stack: ["rose", "skull"] }, { eliminated: true }],
      turn: "p1",
    });
    game = runScript(passAround(runScript(game, [["p1", "bid", 2]])), [["autoAll"], ["p1", "flip", "p2"]]);
    expect(P(game, "p1").eliminated).toBe(true);
    expect(P(game, "p1").hand).toEqual([]);
    expect(game.phase).toBe("gameOver");
    expect(game.winners).toEqual(["p2"]);
    expect(game.result?.reason).toBe("lastStanding");
    expect(P(game, "p2").flowerUp).toBe(false);
    noProblems(game);
  });

  it("规则书#TC15（补充替换版）3 人局 C 已淘汰：A、B 各盖 1 花，A 开叫 2 → 不轮到 B 直接揭牌；A 翻自己的，再翻 B 的 → 成功", () => {
    let game = buildGame({ players: [{}, {}, { eliminated: true }], phase: "placeInitial" });
    game = runScript(game, [["p1", "place", "rose"], ["p2", "place", "rose"]]);
    expect(game.phase).toBe("placeOrBid");
    expect(totalDiscsInPlay(game)).toBe(2);
    game = run(game, "p1", { type: "openBid", count: 2 });
    expect(game.phase).toBe("resolving");
    expect(game.challenger).toBe("p1");
    expect(P(game, "p2").passed).toBe(false);
    game = autoFlip(game);
    expect(game.flipsToDo).toBe(1);
    expect(game.awaitingMatChoice).toBe(true);
    game = run(game, "p1", { type: "flipMat", player: "p2" });
    expect(game.roundLog.result).toBe("success");
    expect(P(game, "p1").flowerUp).toBe(true);
  });

  it("规则书#TC16 新一轮：结算后板上的收回手里、pass 清空；先手 = 没淘汰的挑战者", () => {
    let game = placedAll(4);
    game = runScript(game, [["p1", "bid", 1], ["p2", "pass"], ["p3", "pass"], ["p4", "pass"], ["autoAll"]]);
    expect(game.phase).toBe("roundEnd");
    expect(P(game, "p2").passed).toBe(true);
    game = runScript(game, [["readyAll"]]);
    expect(game.phase).toBe("placeInitial");
    expect(game.round).toBe(2);
    expect(game.firstPlayer).toBe("p1");
    for (const player of game.players) {
      expect(player.stack).toEqual([]);
      expect(player.hand).toHaveLength(4);
      expect(player.passed).toBe(false);
      expect(player.hand.every((disc) => !("revealed" in disc))).toBe(true);
    }
    expect(game.history).toHaveLength(1);
    expect(game.history[0]!.result).toBe("success");
    noProblems(game);
  });

  it("规则书#TC16 新一轮：挑战者被别人骷髅淘汰 → 骷髅主人先手；被自己骷髅淘汰 → 他指定", () => {
    // 被别人骷髅淘汰（4 人，淘汰后还剩 3 人）
    let game = buildGame({
      players: [{ stack: ["rose"], lost: ["rose", "rose", "skull"] }, { stack: ["rose"] }, { stack: ["skull"] }, { stack: ["rose"] }],
      turn: "p1",
    });
    game = runScript(passAround(runScript(game, [["p1", "bid", 2]])), [["autoAll"], ["p1", "flip", "p3"]]);
    expect(P(game, "p1").eliminated).toBe(true);
    expect(game.nextFirst).toBe("p3");
    game = runScript(game, [["readyAll"]]);
    expect(game.firstPlayer).toBe("p3");
    expect(waitingFor(game)).toEqual(["p2", "p3", "p4"]);

    // 被自己骷髅淘汰 → 指定
    let own = buildGame({ players: [{ stack: ["skull"], lost: ["rose", "rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    own = runScript(passAround(runScript(own, [["p1", "bid", 1]])), [["autoAll"]]);
    expect(own.phase).toBe("chooseFirst");
    own = runScript(own, [["p1", "first", "p4"], ["readyAll"]]);
    expect(own.firstPlayer).toBe("p4");
  });

  it("规则书#TC17 Last Chance：默认关时失败后剩 1 张没有碟子；开启时下一轮手里多一张公开的玫瑰，持碟那轮当挑战者失败 → 碟子和最后一张一起失去、淘汰", () => {
    // p1 一共 2 张（板上花、手里骷），叫 3：翻自己的花、p2 的花，再翻到 p3 的骷 → 随机失掉骷髅，剩 1 朵花
    const setup = (lastChance: boolean) => {
      const game = buildGame({
        options: { lastChance },
        players: [{ stack: ["rose"], hand: ["skull"], lost: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["skull"] }],
        turn: "p1",
      });
      return runScript(passAround(runScript(game, [["p1", "bid", 3]])), [["autoAll"], ["p1", "flip", "p2"], ["p1", "flip", "p3", "skull"]]);
    };
    const off = setup(false);
    expect(discCount(P(off, "p1"))).toBe(1);
    expect(P(off, "p1").lastChanceRound).toBeNull();
    const offNext = runScript(off, [["readyAll"]]);
    expect(P(offNext, "p1").hand).toHaveLength(1);
    expect(P(offNext, "p1").hand.some((disc) => disc.lastChance)).toBe(false);

    const on = setup(true);
    expect(P(on, "p1").lastChanceRound).toBe(2);
    expect(eventsOf(on.events, "LastChanceEarned")).toEqual([{ type: "LastChanceEarned", player: "p1" }]);
    let next = runScript(on, [["readyAll"]]);
    expect(P(next, "p1").hand).toHaveLength(2);
    expect(P(next, "p1").hand.filter((disc) => disc.lastChance)).toEqual([{ id: "lastchance", face: "rose", lastChance: true }]);
    expect(holdsLastChance(next, P(next, "p1"))).toBe(true);
    // 这一轮 p1 当挑战者失败
    next = runScript(next, [["p1", "place", "rose"], ["p2", "place", "skull"], ["p3", "place", "rose"], ["p1", "place", "lastChance"], ["p2", "bid", 1], ["p3", "pass"], ["p1", "bid", 3], ["p2", "pass"]]);
    expect(next.challenger).toBe("p1");
    next = runScript(next, [["autoAll"], ["p1", "flip", "p2"]]);
    expect(P(next, "p1").eliminated).toBe(true);
    expect(next.roundLog.loss).toEqual({ player: "p1", method: "lastChance", count: 1, eliminated: true });
    expect(next.players.flatMap((player) => [...player.hand, ...player.stack]).some((disc) => disc.lastChance)).toBe(false);
    noProblems(next);
  });

  it("规则书#TC18 权限校验：非挑战者 flipMat 拒；自己的没翻完就 flipMat 拒；loseDisc 传不是自己的垫子拒；没轮到的人 raise/pass/openBid 拒", () => {
    let game = buildGame({ players: [{ stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["skull"] }], turn: "p1" });
    expect(rejects(game, "p2", { type: "openBid", count: 1 })).toMatch(/还没轮到你/);
    game = run(game, "p1", { type: "openBid", count: 3 });
    expect(rejects(game, "p3", { type: "raise", count: 4 })).toMatch(/还没轮到你/);
    expect(rejects(game, "p3", { type: "pass" })).toMatch(/还没轮到你/);
    expect(rejects(game, "p1", { type: "raise", count: 4 })).toMatch(/还没轮到你/);
    game = passAround(game);
    expect(rejects(game, "p2", { type: "flipMat", player: "p3" })).toMatch(/只有挑战者/);
    expect(rejects(game, "p1", { type: "flipMat", player: "p3" })).toMatch(/先把自己板上的翻完/);
    game = autoFlip(game);
    expect(rejects(game, "p1", { type: "flipMat", player: "p3" })).toMatch(/先把自己板上的翻完/);
    game = autoFlip(game);
    expect(game.awaitingMatChoice).toBe(true);
    expect(rejects(game, "p1", { type: "flipMat", player: "p1" })).not.toBeNull();
    expect(rejects(game, "p1", { type: "flipMat", player: "p9" })).toMatch(/找不到/);

    let lose = buildGame({ players: [{ stack: ["skull"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    lose = runScript(passAround(runScript(lose, [["p1", "bid", 1]])), [["autoAll"]]);
    expect(lose.phase).toBe("loseChoosing");
    expect(rejects(lose, "p1", { type: "loseDisc", discId: P(lose, "p2").hand[0]!.id! })).toMatch(/不是你的/);
    expect(rejects(lose, "p1", { type: "loseDisc", discId: "nope" })).toMatch(/不是你的/);
    expect(rejects(lose, "p2", { type: "loseDisc", discId: P(lose, "p2").hand[0]!.id! })).toMatch(/不用丢/);
  });
});

describe("补充文件 3.6 测试用例", () => {
  it("补充#TC19 先手直接开叫：4 人各盖 1 张，先手 A 第一个决策回合 openBid(1) 允许 → 加注阶段，轮到 B", () => {
    const game = run(placedAll(4), "p1", { type: "openBid", count: 1 });
    expect(game.phase).toBe("bidding");
    expect(game.turn).toBe("p2");
  });

  it("补充#TC20 开叫即到上限：3 人各 1 张，A openBid(3) → 直接揭牌，挑战者 A，B、C 不再表态；A 翻完自己 1 张还要翻 B、C 各 1 张", () => {
    let game = run(placedAll(3), "p1", { type: "openBid", count: 3 });
    expect(game.phase).toBe("resolving");
    expect(game.challenger).toBe("p1");
    expect(P(game, "p2").passed).toBe(false);
    expect(P(game, "p3").passed).toBe(false);
    expect(legalActions(game, "p2")).toEqual([]);
    game = autoFlip(game);
    expect(game.flipsToDo).toBe(2);
    game = runScript(game, [["p1", "flip", "p2"], ["p1", "flip", "p3"]]);
    expect(game.roundLog.flips.map((flip) => flip.owner)).toEqual(["p1", "p2", "p3"]);
    expect(game.roundLog.result).toBe("success");
  });

  it("补充#TC21 加注即到上限：A2 B2 C1 D1 总数 6，A 开叫 2、B 加到 6 → 直接揭牌，挑战者 B；B 翻完自己 2 张还差 4", () => {
    let game = buildGame({ players: [{ stack: ["rose", "rose"] }, { stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    game = runScript(game, [["p1", "bid", 2], ["p2", "bid", 6]]);
    expect(game.phase).toBe("resolving");
    expect(game.challenger).toBe("p2");
    expect(legalActions(game, "p3")).toEqual([]);
    expect(legalActions(game, "p1")).toEqual([]);
    game = runScript(game, [["autoAll"]]);
    expect(game.flipsToDo).toBe(4);
    expect(game.awaitingMatChoice).toBe(true);
  });

  it("补充#TC22 自淘汰指定先手：A 只剩 1 张骷髅，盖下后只能开叫；被自己骷髅淘汰（不进自选）→ 只有 A 能指定、只能指定存活玩家；超时 = A 顺时针下一位", () => {
    let game = buildGame({ players: [{ lost: ["rose", "rose", "rose"] }, {}, {}], phase: "placeInitial" });
    game = runScript(game, [["p1", "place", "skull"], ["p2", "place", "rose"], ["p3", "place", "rose"]]);
    expect(P(game, "p1").hand).toEqual([]);
    expect(game.turn).toBe("p1");
    expect(rejects(game, "p1", { type: "placeDisc", discId: P(game, "p1").stack[0]!.id! })).not.toBeNull();
    expect(legalActions(game, "p1").map((action) => action.type)).toEqual(["openBid", "openBid", "openBid"]);
    game = runScript(game, [["p1", "bid", 1], ["p2", "pass"], ["p3", "pass"], ["autoAll"]]);
    expect(P(game, "p1").eliminated).toBe(true);
    expect(game.roundLog.loss).toEqual({ player: "p1", method: "forced", count: 1, eliminated: true });
    expect(game.phase).toBe("chooseFirst");
    expect(waitingFor(game)).toEqual(["p1"]);
    expect(rejects(game, "p2", { type: "chooseFirstPlayer", player: "p3" })).toMatch(/不用你指定/);
    expect(rejects(game, "p1", { type: "chooseFirstPlayer", player: "p1" })).toMatch(/还在场上/);
    const chosen = runScript(game, [["p1", "first", "p3"]]);
    expect(chosen.phase).toBe("roundEnd");
    expect(chosen.nextFirst).toBe("p3");
    expect(chosen.roundLog.nextFirstChosenBy).toBe("p1");
    expect(runScript(chosen, [["readyAll"]]).firstPlayer).toBe("p3");
    const timedOut = timeoutTurn(game);
    expect(timedOut.nextFirst).toBe("p2");
    expect(timedOut.roundLog.nextFirstAuto).toBe(true);
    expect(eventsOf(timedOut.events, "FirstPlayerChosen")[0]).toEqual({ type: "FirstPlayerChosen", by: "p1", player: "p2", auto: true });
  });

  it("补充#TC22 变体：只剩 A、B 两人时 A 自淘汰 → 直接终局 B 赢，不进指定先手", () => {
    let game = buildGame({ players: [{ lost: ["rose", "rose", "rose"] }, {}, { eliminated: true }], phase: "placeInitial" });
    game = runScript(game, [["p1", "place", "skull"], ["p2", "place", "rose"], ["p1", "bid", 1], ["p2", "pass"], ["autoAll"]]);
    expect(game.phase).toBe("gameOver");
    expect(game.winners).toEqual(["p2"]);
  });

  it("补充#TC23 被别人骷髅淘汰：A 只剩 1 张花，B 开叫 1、C pass、A 加 2、B pass → A 翻自己的花再翻 B 顶上的骷 → A 淘汰，下一轮 B 先手", () => {
    let exact = buildGame({ players: [{ stack: ["rose"], hand: [], lost: ["rose", "rose", "skull"] }, { stack: ["rose", "skull"] }, { stack: ["rose"] }], firstPlayer: "p2", turn: "p2" });
    exact = runScript(exact, [["p2", "bid", 1], ["p3", "pass"], ["p1", "bid", 2], ["p2", "pass"]]);
    expect(exact.challenger).toBe("p1");
    exact = runScript(exact, [["autoAll"], ["p1", "flip", "p2"]]);
    expect(P(exact, "p1").eliminated).toBe(true);
    expect(exact.roundLog.loss).toMatchObject({ method: "random", eliminated: true });
    expect(exact.phase).toBe("roundEnd");
    expect(exact.nextFirst).toBe("p2");
  });

  it("补充#TC24 叫价小于自己张数：A 板 [骷, 花, 花] 叫 2 → 只翻顶上 2 朵花就成功；骷髅一直没翻开，别人视角和事件里都看不到", () => {
    let game = buildGame({ players: [{ stack: ["skull", "rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    game = runScript(passAround(runScript(game, [["p1", "bid", 2]])), [["autoAll"]]);
    expect(game.roundLog.result).toBe("success");
    expect(game.roundLog.flips.map((flip) => flip.depth)).toEqual([2, 1]);
    expect(P(game, "p1").stack[0]).toMatchObject({ face: "skull", revealed: false });
    const skullId = P(game, "p1").stack[0]!.id!;
    for (const viewer of ["p2", "p3", ""]) {
      const view = redactGameForViewer(game, viewer);
      expect(P(view, "p1").stack[0]).toEqual({ revealed: false });
      const text = JSON.stringify(view);
      expect(text).not.toContain(skullId);
      expect(view.roundLog.flips.every((flip) => flip.face === "rose")).toBe(true);
    }
    // 下一轮开局也看不到
    const next = runScript(game, [["readyAll"]]);
    for (const viewer of ["p2", "p3"]) expect(P(redactGameForViewer(next, viewer), "p1").hand).toEqual([{}, {}, {}, {}]);
  });

  it("补充#TC25 随机失牌均匀：A 4 张（3 花 1 骷）翻到 B 的骷，4000 个种子里失骷髅的比例在 25% ± 3%；结果只在 A 的视角", () => {
    let game = buildGame({ players: [{ stack: ["rose"] }, { stack: ["skull"] }, { stack: ["rose"] }], turn: "p1" });
    game = runScript(passAround(runScript(game, [["p1", "bid", 2]])), [["autoAll"]]);
    let skulls = 0;
    for (let seed = 1; seed <= 4000; seed += 1) {
      const after = apply(game, "p1", { type: "flipMat", player: "p2" }, createRng(seed)).state;
      if (P(after, "p1").lost![0] === "skull") skulls += 1;
      if (seed <= 20) {
        for (const viewer of ["p2", "p3"]) {
          const view = redactGameForViewer(after, viewer);
          expect(P(view, "p1").hand).toHaveLength(3);
          expect(P(view, "p1").lost).toBeUndefined();
          expect(eventsOf(view.events, "DiscLost")[0]).not.toHaveProperty("face");
        }
      }
    }
    expect(skulls / 4000).toBeGreaterThan(0.22);
    expect(skulls / 4000).toBeLessThan(0.28);
  });

  /** TC26 的局面：变体开关、A 一共 2 张（花、骷），翻到 C 的骷失败。 */
  function tc26(lastChance: boolean, lossFace: "rose" | "skull"): GameState {
    const game = buildGame({
      options: { lastChance },
      players: [{ stack: ["rose"], hand: ["skull"], lost: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["skull"] }],
      turn: "p1",
    });
    return runScript(passAround(runScript(game, [["p1", "bid", 2]])), [["autoAll"], ["p1", "flip", "p3", lossFace]]);
  }

  it("补充#TC26 Last Chance 拿碟：A 一共 2 张、失败后剩 1 张 → 下一轮 A 手里 2 张（自己的 + 碟），所有人都看得到碟子；变体关时没有", () => {
    const on = runScript(tc26(true, "skull"), [["readyAll"]]);
    expect(P(on, "p1").hand).toHaveLength(2);
    expect(eventsOf(on.events, "LastChanceGiven")).toEqual([{ type: "LastChanceGiven", player: "p1" }]);
    for (const viewer of ["p1", "p2", "p3", ""]) {
      const view = redactGameForViewer(on, viewer);
      expect(P(view, "p1").hand.filter((disc) => disc.lastChance)).toHaveLength(1);
      expect(P(view, "p1").hand.find((disc) => disc.lastChance)?.face).toBe("rose");
      expect(P(view, "p1").lastChanceRound).toBe(on.round);
    }
    const off = runScript(tc26(false, "skull"), [["readyAll"]]);
    expect(P(off, "p1").hand).toHaveLength(1);
    expect(P(off, "p1").lastChanceRound).toBeNull();
  });

  it("补充#TC27 Last Chance 计数和翻牌：A 盖花再盖碟子（在顶），B、C 各 1 张，总数 4；B 开叫 2、C、A pass → B 翻自己的花再翻到碟子算玫瑰 → 成功；这轮结束碟子收走，之后不再拿", () => {
    let game = runScript(tc26(true, "skull"), [["readyAll"]]);
    expect(game.firstPlayer).toBe("p1");
    game = runScript(game, [["p1", "place", "rose"], ["p2", "place", "rose"], ["p3", "place", "skull"], ["p1", "place", "lastChance"]]);
    expect(totalDiscsInPlay(game)).toBe(4);
    expect(P(game, "p1").stack[1]).toMatchObject({ lastChance: true, revealed: false });
    expect(redactGameForViewer(game, "p2").players[0]!.stack[1]).toEqual({ revealed: false, face: "rose", lastChance: true });
    game = runScript(game, [["p2", "bid", 2], ["p3", "pass"], ["p1", "pass"]]);
    expect(game.challenger).toBe("p2");
    game = runScript(game, [["autoAll"], ["p2", "flip", "p1"]]);
    expect(game.roundLog.flips[1]).toEqual({ owner: "p1", depth: 1, face: "rose", lastChance: true, auto: false });
    expect(game.roundLog.result).toBe("success");
    expect(P(game, "p2").flowerUp).toBe(true);
    game = runScript(game, [["readyAll"]]);
    expect(P(game, "p1").hand).toHaveLength(1);
    expect(P(game, "p1").hand.some((disc) => disc.lastChance)).toBe(false);
    expect(holdsLastChance(game, P(game, "p1"))).toBe(false);
    // 再打几轮也不会再拿到碟子
    for (let index = 0; index < 60 && game.phase !== "gameOver"; index += 1) {
      game = timeoutTurn(game);
      expect(game.players.flatMap((player) => player.hand).filter((disc) => disc.lastChance && P(game, "p1").hand.includes(disc))).toEqual([]);
      noProblems(game);
    }
  });

  it("补充#TC28 Last Chance 当挑战者失败：A 盖花再盖碟子、当挑战者，翻碟子、翻自己的花，再翻 B 的骷 → 碟子和最后一张一起失去、直接淘汰，下一轮 B 先手", () => {
    let game = runScript(tc26(true, "skull"), [["readyAll"]]);
    // 原文写「A openBid(3)」，但 A 盖完碟子后要等 B、C 表态；这里让 B 先开叫 1、C pass、A 加到 3、B pass
    game = runScript(game, [["p1", "place", "rose"], ["p2", "place", "skull"], ["p3", "place", "rose"], ["p1", "place", "lastChance"]]);
    expect(totalDiscsInPlay(game)).toBe(4);
    game = runScript(game, [["p2", "bid", 1], ["p3", "pass"], ["p1", "bid", 3], ["p2", "pass"]]);
    expect(game.challenger).toBe("p1");
    game = runScript(game, [["autoAll"]]);
    expect(game.roundLog.flips.map((flip) => [flip.face, flip.lastChance === true])).toEqual([["rose", true], ["rose", false]]);
    game = runScript(game, [["p1", "flip", "p2"]]);
    expect(P(game, "p1").eliminated).toBe(true);
    expect(game.roundLog.loss).toEqual({ player: "p1", method: "lastChance", count: 1, eliminated: true });
    expect(game.nextFirst).toBe("p2");
    expect(game.phase).toBe("roundEnd");
  });

  it("补充#TC29 拿碟人不想盖碟子：手里还有碟子就不是被迫开叫，可以盖碟子也可以开叫；超时不选碟子，只剩碟子时开叫 1", () => {
    let game = runScript(tc26(true, "skull"), [["readyAll"]]);
    const rng = createRng(4);
    for (let index = 0; index < 20; index += 1) {
      const command = timeoutCommand(game, "p1", createRng(index));
      expect(command?.type).toBe("placeFirst");
      expect(command && "discId" in command ? command.discId : "").not.toBe("lastchance");
    }
    game = runScript(game, [["p1", "place", "rose"], ["p2", "place", "rose"], ["p3", "place", "rose"]]);
    expect(game.turn).toBe("p1");
    const types = legalActions(game, "p1").map((action) => action.type);
    expect(types).toContain("placeDisc");
    expect(types).toContain("openBid");
    expect(timeoutCommand(game, "p1", rng)).toEqual({ type: "openBid", count: 1 });
    expect(run(game, "p1", { type: "placeDisc", discId: "lastchance" }).turn).toBe("p2");
  });

  it("补充#TC30 id 不泄露：开局后 B 的视角里没有 A、C 任何一张没翻开的垫子的牌面和 id；A 失牌后 B 只看到 A 的张数变化", () => {
    let game = startGame({ players: 3 });
    const idsOf = (state: GameState, id: string) => [...P(state, id).hand, ...P(state, id).stack].map((disc) => disc.id!);
    const check = (state: GameState) => {
      const view = redactGameForViewer(state, "p2");
      const text = JSON.stringify(view);
      for (const other of ["p1", "p3"]) {
        for (const id of idsOf(state, other)) expect(text).not.toContain(id);
        for (const disc of [...P(view, other).hand, ...P(view, other).stack]) {
          if (!("revealed" in disc) || !disc.revealed) expect(disc.face).toBeUndefined();
          expect(disc.id).toBeUndefined();
        }
      }
    };
    check(game);
    game = runScript(game, [["p1", "place", "rose"], ["p2", "place", "rose"], ["p3", "place", "skull"]]);
    check(game);
    game = runScript(game, [["p1", "place", "rose"], ["p2", "place", "rose"], ["p3", "place", "rose"], ["p1", "bid", 4], ["p2", "pass"], ["p3", "pass"], ["autoAll"], ["p1", "flip", "p3"], ["p1", "flip", "p3"]]);
    expect(game.roundLog.loss?.player).toBe("p1");
    check(game);
    const before = redactGameForViewer(runScript(buildGame({ players: 3 }), []), "p2");
    const after = redactGameForViewer(game, "p2");
    expect(P(after, "p1").hand).toHaveLength(3);
    expect(P(before, "p1").hand).toHaveLength(4);
    expect(P(after, "p1").lost).toBeUndefined();
  });
});

describe("勘误和补充 3.2 / 3.3", () => {
  it("勘误 3.3 #6：垫子 id 是不带牌面的随机串，骷髅在手里的位置也随机", () => {
    const positions = new Set<number>();
    for (let seed = 1; seed <= 40; seed += 1) {
      const game = createGame(previewPlayers(3), seed);
      for (const player of game.players) {
        for (const disc of player.hand) {
          expect(disc.id).toMatch(/^d[0-9a-z]{5}$/);
          expect(disc.id).not.toMatch(/rose|skull/);
        }
        positions.add(player.hand.findIndex((disc) => disc.face === "skull"));
      }
    }
    expect(positions.size).toBe(4);
  });

  it("勘误 3.5(e)：进入轮流时每个存活玩家板上至少 1 张，开叫 1 永远合法", () => {
    for (let seed = 1; seed <= 30; seed += 1) {
      let game = createGame(previewPlayers(3 + (seed % 4)), seed);
      game = timeoutTurn(game);
      expect(game.phase).toBe("placeOrBid");
      for (const player of game.players) expect(player.stack.length).toBeGreaterThanOrEqual(1);
      expect(legalActions(game, game.turn!)).toContainEqual({ type: "openBid", count: 1 });
    }
  });

  it("勘误 3.3 #8：只剩 2 人时规则照常，两种胜法都成立", () => {
    let game = buildGame({ players: [{ stack: ["rose", "rose"], flowerUp: true }, { stack: ["skull"] }, { eliminated: true }], turn: "p1" });
    game = runScript(game, [["p1", "bid", 1], ["p2", "pass"], ["autoAll"]]);
    expect(game.result).toEqual({ winner: "p1", reason: "twoWins" });
  });
});

describe("规则逐条", () => {
  it("顺时针轮流跳过已淘汰的人；加注时跳过已 pass 的人；轮不到叫价最高的人自己", () => {
    let game = buildGame({ players: [{ stack: ["rose"] }, { eliminated: true }, { stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    game = run(game, "p1", placeCmd(game, "p1", "rose"));
    expect(game.turn).toBe("p3");
    game = runScript(game, [["p3", "bid", 1], ["p4", "pass"], ["p5", "bid", 2]]);
    expect(game.turn).toBe("p1");
    game = runScript(game, [["p1", "pass"]]);
    expect(game.turn).toBe("p3");
    game = runScript(game, [["p3", "bid", 3]]);
    expect(game.turn).toBe("p5");
  });

  it("准备阶段淘汰的人不用盖，也不等他", () => {
    const game = buildGame({ players: [{}, { eliminated: true }, {}], phase: "placeInitial" });
    expect(waitingFor(game)).toEqual(["p1", "p3"]);
    expect(rejects(game, "p2", { type: "placeFirst", discId: "x" })).toMatch(/淘汰/);
  });

  it("准备阶段每人只能盖 1 张，轮流时不能用 placeFirst、准备阶段不能用 placeDisc 或开叫", () => {
    let game = startGame({ players: 3 });
    expect(rejects(game, "p1", { type: "placeDisc", discId: discOf(game, "p1", "rose") })).not.toBeNull();
    expect(rejects(game, "p1", { type: "openBid", count: 1 })).not.toBeNull();
    game = run(game, "p1", placeCmd(game, "p1", "rose"));
    expect(rejects(game, "p1", { type: "placeFirst", discId: discOf(game, "p1", "rose") })).toMatch(/已经盖过/);
    game = runScript(game, [["p2", "place", "rose"], ["p3", "place", "rose"]]);
    expect(rejects(game, "p1", { type: "placeFirst", discId: discOf(game, "p1", "rose") })).not.toBeNull();
  });

  it("挑战者翻别人时每翻一张都可以换板，每块板只能翻最上面那张（从顶往下）", () => {
    let game = buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose", "rose", "skull"] }, { stack: ["rose", "rose"] }], turn: "p1" });
    game = runScript(game, [["p1", "bid", 4], ["p2", "pass"], ["p3", "pass"], ["autoAll"]]);
    game = runScript(game, [["p1", "flip", "p3"]]);
    expect(game.roundLog.flips.at(-1)).toMatchObject({ owner: "p3", depth: 1 });
    game = runScript(game, [["p1", "flip", "p3"]]);
    expect(game.roundLog.flips.at(-1)).toMatchObject({ owner: "p3", depth: 0 });
    expect(rejects(game, "p1", { type: "flipMat", player: "p3" })).toMatch(/翻完/);
    game = runScript(game, [["p1", "flip", "p2"]]);
    // p2 最上面是骷髅
    expect(game.roundLog.result).toBe("fail");
    expect(game.roundLog.skullOwner).toBe("p2");
  });

  it("翻到骷髅马上停：后面不再翻，挑战者的垫子收回手里，别人的板保持原样", () => {
    let game = buildGame({ players: [{ stack: ["rose"] }, { stack: ["skull"] }, { stack: ["rose", "rose"] }], turn: "p1" });
    game = runScript(game, [["p1", "bid", 4], ["autoAll"], ["p1", "flip", "p2"]]);
    expect(game.roundLog.flips).toHaveLength(2);
    expect(P(game, "p1").stack).toEqual([]);
    expect(P(game, "p2").stack).toEqual([expect.objectContaining({ face: "skull", revealed: true })]);
    expect(P(game, "p3").stack.every((disc) => !disc.revealed)).toBe(true);
  });

  it("翻开过的玫瑰下一轮照样收回手里，只有失掉的那张没了", () => {
    let game = buildGame({ players: [{ stack: ["rose", "rose"] }, { stack: ["skull"] }, { stack: ["rose"] }], turn: "p1" });
    game = runScript(game, [["p1", "bid", 3], ["p2", "pass"], ["p3", "pass"], ["autoAll"], ["p1", "flip", "p2", "rose"], ["readyAll"]]);
    expect(P(game, "p1").hand).toHaveLength(3);
    expect(P(game, "p1").hand.filter((disc) => disc.face === "rose")).toHaveLength(2);
    expect(P(game, "p2").hand).toHaveLength(4);
  });

  it("结算画面：所有存活玩家点继续才开下一轮；不能点两次；淘汰的人不用点", () => {
    let game = buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }, { eliminated: true }], turn: "p1" });
    game = runScript(game, [["p1", "bid", 1], ["p2", "pass"], ["p3", "pass"], ["autoAll"]]);
    expect(game.phase).toBe("roundEnd");
    expect(waitingFor(game)).toEqual(["p1", "p2", "p3"]);
    const key = stepKey(game);
    game = run(game, "p2", { type: "nextRound" });
    expect(stepKey(game)).toBe(key);
    expect(rejects(game, "p2", { type: "nextRound" })).toMatch(/点过/);
    expect(rejects(game, "p4", { type: "nextRound" })).toMatch(/淘汰/);
    game = runScript(game, [["p1", "ready"]]);
    expect(game.phase).toBe("roundEnd");
    game = runScript(game, [["p3", "ready"]]);
    expect(game.phase).toBe("placeInitial");
    expect(eventsOf(game.events, "RoundStarted")).toHaveLength(1);
  });

  it("apply 不改输入；每一步 version +1", () => {
    const game = deepFreeze(placedAll(3));
    const next = apply(game, "p1", { type: "openBid", count: 1 }, createRng(1)).state;
    expect(next.version).toBe(game.version + 1);
    const flips = deepFreeze(runScript(next, [["p2", "pass"], ["p3", "pass"]]));
    expect(() => autoFlip(flips)).not.toThrow();
  });

  it("人数只能 3–6；玩家 id 不能重复", () => {
    expect(() => createGame(previewPlayers(2))).toThrow(/3–6/);
    expect(() => createGame(previewPlayers(7))).toThrow(/3–6/);
    expect(() => createGame([{ id: "a", name: "甲" }, { id: "a", name: "乙" }, { id: "b", name: "丙" }])).toThrow(/重复/);
    for (const count of [3, 4, 5, 6]) expect(createGame(previewPlayers(count)).players).toHaveLength(count);
  });

  it("第 1 轮先手随机（种子决定），各座位都会出现", () => {
    const firsts = new Set<string>();
    for (let seed = 1; seed <= 60; seed += 1) firsts.add(createGame(previewPlayers(4), seed).firstPlayer);
    expect([...firsts].sort()).toEqual(["p1", "p2", "p3", "p4"]);
  });

  it("不认识的命令、不在局里的人都被拒", () => {
    const game = placedAll(3);
    expect(rejects(game, "p1", { type: "dance" } as never)).toMatch(/未知/);
    expect(rejects(game, "p9", { type: "openBid", count: 1 })).toMatch(/不在这局/);
    expect(rejects(game, "p1", { type: "openBid", count: 1.5 })).not.toBeNull();
    expect(rejects(game, "p1", { type: "openBid", count: "2" as never })).not.toBeNull();
  });
});

describe("失败后自愿亮牌（他额外要的）", () => {
  function failed(): GameState {
    let game = buildGame({
      players: [{ stack: ["skull", "rose"] }, { stack: ["rose", "rose"] }, { stack: ["skull"] }, { stack: ["rose", "skull", "rose"] }],
      firstPlayer: "p2",
      turn: "p2",
    });
    game = passAround(runScript(game, [["p2", "bid", 3]]));
    return runScript(game, [["autoAll"], ["p2", "flip", "p3", "rose"]]);
  }

  it("只有失败那次结算可用：挑战者以外、板上还有没翻开垫子的存活玩家；亮出全部没翻开的，进公开事件和本轮记录", () => {
    const game = failed();
    expect(game.phase).toBe("roundEnd");
    expect(canRevealStack(game, "p2")).toBe(false); // 挑战者
    expect(canRevealStack(game, "p3")).toBe(false); // 板上那张骷髅已经翻开了
    expect(canRevealStack(game, "p1")).toBe(true);
    expect(canRevealStack(game, "p4")).toBe(true);
    expect(rejects(game, "p2", { type: "revealStack" })).toMatch(/收回手里/);
    expect(rejects(game, "p3", { type: "revealStack" })).toMatch(/没有没翻开/);
    const key = stepKey(game);
    const revealed = run(game, "p4", { type: "revealStack" });
    expect(stepKey(revealed)).toBe(key);
    expect(eventsOf(revealed.events, "StackRevealed")).toEqual([
      { type: "StackRevealed", player: "p4", discs: [{ depth: 0, face: "rose" }, { depth: 1, face: "skull" }, { depth: 2, face: "rose" }] },
    ]);
    expect(revealed.roundLog.reveals).toEqual([{ player: "p4", discs: [{ depth: 0, face: "rose" }, { depth: 1, face: "skull" }, { depth: 2, face: "rose" }] }]);
    for (const viewer of ["p1", "p2", "p3", ""]) {
      expect(P(redactGameForViewer(revealed, viewer), "p4").stack.map((disc) => disc.face)).toEqual(["rose", "skull", "rose"]);
    }
    expect(rejects(revealed, "p4", { type: "revealStack" })).toMatch(/没有没翻开/);
    // 没亮的人的牌面仍然看不到
    expect(P(redactGameForViewer(revealed, "p4"), "p1").stack).toEqual([{ revealed: false }, { revealed: false }]);
    // 下一轮开始后就不能亮了，记录进历史
    const next = runScript(revealed, [["readyAll"]]);
    expect(rejects(next, "p1", { type: "revealStack" })).not.toBeNull();
    expect(next.history.at(-1)!.reveals).toHaveLength(1);
  });

  it("亮牌不泄露挑战者失的是哪张；成功那次的结算没有亮牌", () => {
    const game = runScript(failed(), [["p1", "reveal"], ["p4", "reveal"]]);
    for (const viewer of ["p1", "p3", "p4", ""]) {
      const view = redactGameForViewer(game, viewer);
      expect(P(view, "p2").lost).toBeUndefined();
      expect(P(view, "p2").hand.every((disc) => Object.keys(disc).length === 0)).toBe(true);
    }
    let success = buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["skull"] }], turn: "p1" });
    success = runScript(success, [["p1", "bid", 1], ["p2", "pass"], ["p3", "pass"], ["autoAll"]]);
    expect(success.roundLog.result).toBe("success");
    expect(canRevealStack(success, "p3")).toBe(false);
    expect(rejects(success, "p3", { type: "revealStack" })).toMatch(/失败/);
  });

  it("超时、托管、人机都不亮：结算画面的超时动作是继续，到点直接开下一轮", () => {
    const game = failed();
    for (const player of ["p1", "p3", "p4"]) expect(timeoutCommand(game, player, createRng(1))).toEqual({ type: "nextRound" });
    const next = timeoutTurn(game);
    expect(next.phase).toBe("placeInitial");
    expect(next.history.at(-1)!.reveals).toEqual([]);
    expect(eventsOf(next.events, "TimedOut")).toEqual([]);
  });
});

describe("超时（补充 3.4）", () => {
  it("准备阶段：替没盖的人随机盖 1 张，每人记一次超时；已经盖了的不动", () => {
    let game = startGame({ players: 4 });
    game = runScript(game, [["p2", "place", "skull"]]);
    const next = timeoutTurn(game);
    expect(next.phase).toBe("placeOrBid");
    expect(eventsOf(next.events, "TimedOut").map((event) => event.player)).toEqual(["p1", "p3", "p4"]);
    expect(P(next, "p2").stack[0]!.face).toBe("skull");
    expect(next.players.every((player) => player.stack.length === 1)).toBe(true);
  });

  it("轮流：有垫子随机盖一张，没有就开叫 1；加注：pass；选板：顺时针第一块；自选失牌：随机丢；指定先手：顺时针下一位", () => {
    let game = placedAll(3);
    let next = timeoutTurn(game);
    expect(eventsOf(next.events, "DiscPlaced")[0]).toMatchObject({ player: "p1", initial: false });
    expect(next.turn).toBe("p2");

    const forced = buildGame({ players: [{ stack: ["rose", "rose", "rose", "skull"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    expect(eventsOf(timeoutTurn(forced).events, "BidOpened")[0]).toEqual({ type: "BidOpened", player: "p1", count: 1 });

    game = runScript(game, [["p1", "bid", 1]]);
    next = timeoutTurn(game);
    expect(eventsOf(next.events, "Passed")[0]).toEqual({ type: "Passed", player: "p2" });
    expect(eventsOf(next.events, "TimedOut")[0]).toEqual({ type: "TimedOut", player: "p2", phase: "bidding" });

    let mats = buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], firstPlayer: "p3", turn: "p3" });
    mats = runScript(mats, [["p3", "bid", 3], ["p4", "pass"], ["p1", "pass"], ["p2", "pass"], ["autoAll"]]);
    expect(timeoutCommand(mats, "p3", createRng(1))).toEqual({ type: "flipMat", player: "p4" });
    mats = timeoutTurn(mats);
    expect(mats.roundLog.flips.at(-1)?.owner).toBe("p4");
    expect(timeoutCommand(mats, "p3", createRng(1))).toEqual({ type: "flipMat", player: "p1" });

    let lose = buildGame({ players: [{ stack: ["skull"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    lose = runScript(lose, [["p1", "bid", 1], ["p2", "pass"], ["p3", "pass"], ["autoAll"]]);
    const lost = timeoutTurn(lose);
    expect(lost.roundLog.loss).toMatchObject({ method: "chosen" });
    expect(discCount(P(lost, "p1"))).toBe(3);
    expect(eventsOf(lost.events, "TimedOut")[0]?.phase).toBe("loseChoosing");
  });

  it("系统自动翻牌到点就翻一张（不算超时）", () => {
    let game = buildGame({ players: [{ stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    game = runScript(game, [["p1", "bid", 2], ["p2", "pass"], ["p3", "pass"]]);
    const next = timeoutTurn(game);
    expect(eventsOf(next.events, "DiscRevealed")).toHaveLength(1);
    expect(eventsOf(next.events, "TimedOut")).toEqual([]);
  });
});

describe("计时 key（一个决定一个计时）", () => {
  it("准备阶段别人盖牌不换 key；换人、换阶段、系统每翻一张都换 key", () => {
    let game = startGame({ players: 4 });
    const key = stepKey(game);
    game = runScript(game, [["p2", "place", "rose"], ["p3", "place", "rose"], ["p4", "place", "rose"]]);
    expect(stepKey(game)).toBe(key);
    game = runScript(game, [["p1", "place", "rose"]]);
    const turnKey = stepKey(game);
    expect(turnKey).not.toBe(key);
    game = runScript(game, [["p1", "place", "rose"]]);
    expect(stepKey(game)).not.toBe(turnKey);
    game = runScript(game, [["p2", "bid", 4], ["p3", "pass"], ["p4", "pass"], ["p1", "pass"]]);
    const flipKey = stepKey(game);
    game = autoFlip(game);
    expect(stepKey(game)).not.toBe(flipKey);
  });

  it("多步自动推进时 version 每步都前进（网页靠它触发动画）", () => {
    let game = buildGame({ players: [{ stack: ["rose", "rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    game = runScript(game, [["p1", "bid", 3], ["p2", "pass"], ["p3", "pass"]]);
    const versions = [game.version];
    while (game.phase === "resolving") {
      game = autoFlip(game);
      versions.push(game.version);
    }
    expect(versions).toEqual([versions[0], versions[0]! + 1, versions[0]! + 2, versions[0]! + 3]);
  });
});

describe("公开历史（补充 3.3 #5，人机要用）", () => {
  it("本轮叫价序列、盖牌顺序、每张翻开的（主人、深度、牌面）、挑战者、成败、失牌方式（不含牌面）都在公开状态里，打完进 history", () => {
    let game = startGame({ players: 3, first: "p2" });
    game = runScript(game, [["p1", "place", "rose"], ["p2", "place", "rose"], ["p3", "place", "skull"], ["p2", "place", "rose"], ["p3", "bid", 1], ["p1", "bid", 2], ["p2", "bid", 3], ["p3", "pass"], ["p1", "pass"]]);
    game = runScript(game, [["autoAll"], ["p2", "flip", "p3", "rose"]]);
    const view = redactGameForViewer(game, "p1");
    expect(view.roundLog.placements).toEqual([
      { player: "p1", initial: true },
      { player: "p2", initial: true },
      { player: "p3", initial: true },
      { player: "p2", initial: false },
    ]);
    expect(view.roundLog.bids.map((bid) => bid.type)).toEqual(["open", "raise", "raise", "pass", "pass"]);
    expect(view.roundLog.stackSizes).toEqual({ p1: 1, p2: 2, p3: 1 });
    expect(view.roundLog.flips).toEqual([
      { owner: "p2", depth: 1, face: "rose", auto: true },
      { owner: "p2", depth: 0, face: "rose", auto: true },
      { owner: "p3", depth: 0, face: "skull", auto: false },
    ]);
    expect(view.roundLog).toMatchObject({ challenger: "p2", bid: 3, result: "fail", skullOwner: "p3", loss: { player: "p2", method: "random", count: 1, eliminated: false }, nextFirst: "p2" });
    expect(JSON.stringify(view.roundLog)).not.toContain("lost");
    const next = runScript(game, [["readyAll"]]);
    expect(next.history).toHaveLength(1);
    expect(next.history[0]!.flips).toHaveLength(3);
  });
});

describe("applyCommand / 服务器用的随机数", () => {
  it("同一种子、同一串动作总能得到同一局（随机失牌由状态里的随机数状态决定）", () => {
    const play = () => {
      let game = createGame(previewPlayers(3), 99);
      for (let index = 0; index < 200 && game.phase !== "gameOver"; index += 1) game = timeoutTurn(game);
      return game;
    };
    expect(JSON.stringify(play())).toBe(JSON.stringify(play()));
    const game = applyCommand(placedAll(3), "p1", { type: "openBid", count: 1 });
    expect(game.log?.at(-1)).toEqual({ player: "p1", command: { type: "openBid", count: 1 } });
    expect(act(placedAll(3), "p1", { type: "openBid", count: 1 }).bid).toBe(1);
  });
});
