import { describe, expect, it } from "vitest";
import { canRevealStack, discCount, legalActions, needsAdvance, waitingFor } from "../src/engine.js";
import { checkInvariants } from "../src/invariants.js";
import {
  buildGame,
  createScene,
  previewRoom,
  runScript,
  SCENE_NAMES,
  SCENE_TITLES,
  startGame,
  type SceneName,
} from "../src/scenes.js";
import type { GameState } from "../src/types.js";
import { eventsOf, P } from "./helpers.js";

const types = (state: GameState, player: string) => [...new Set(legalActions(state, player).map((action) => action.type))];

/** 每个命名局面的「说明属实」检查。 */
const EXPECT: Record<SceneName, (game: GameState, count: number) => void> = {
  opening: (game) => {
    expect(game.phase).toBe("placeInitial");
    expect(game.round).toBe(1);
    expect(game.firstPlayer).toBe("p1");
    expect(game.players.every((player) => player.stack.length === 0)).toBe(true);
  },
  placing: (game) => {
    expect(game.phase).toBe("placeInitial");
    expect(P(game, "p2").placedInitial && P(game, "p3").placedInitial).toBe(true);
    expect(waitingFor(game)).toContain("p1");
  },
  placedWaiting: (game) => {
    expect(P(game, "p1").placedInitial).toBe(true);
    expect(waitingFor(game)).not.toContain("p1");
    expect(waitingFor(game).length).toBeGreaterThan(0);
  },
  myTurn: (game) => {
    expect(game.phase).toBe("placeOrBid");
    expect(game.turn).toBe("p1");
    expect(P(game, "p1").stack.map((disc) => disc.face)).toEqual(["rose", "rose"]);
    expect(types(game, "p1")).toEqual(["placeDisc", "openBid"]);
  },
  otherTurn: (game) => {
    expect(game.phase).toBe("placeOrBid");
    expect(game.turn).toBe("p2");
  },
  forcedBid: (game) => {
    expect(P(game, "p1").hand).toEqual([]);
    expect(types(game, "p1")).toEqual(["openBid"]);
  },
  bidding: (game, count) => {
    expect(game.phase).toBe("bidding");
    expect(game.turn).toBe("p1");
    expect(game.bid).toBe(3);
    if (count >= 4) expect(P(game, "p4").passed).toBe(true);
    expect(types(game, "p1")).toEqual(["raise", "pass"]);
  },
  biddingOther: (game) => {
    expect(game.phase).toBe("bidding");
    expect(game.turn).toBe("p3");
    expect(game.bidder).toBe("p1");
  },
  bidMax: (game) => {
    expect(game.phase).toBe("resolving");
    expect(game.challenger).toBe("p1");
    expect(game.bid).toBe(game.players.reduce((total, player) => total + player.stack.length, 0));
    expect(needsAdvance(game)).toBe(true);
    expect(game.roundLog.flips).toEqual([]);
  },
  revealOwn: (game) => {
    expect(game.challenger).toBe("p1");
    expect(needsAdvance(game)).toBe(true);
    expect(game.roundLog.flips).toHaveLength(1);
  },
  chooseMat: (game) => {
    expect(game.awaitingMatChoice).toBe(true);
    expect(game.flipsToDo).toBe(2);
    expect(types(game, "p1")).toEqual(["flipMat"]);
  },
  chooseMatOther: (game) => {
    expect(game.awaitingMatChoice).toBe(true);
    expect(game.challenger).toBe("p2");
    expect(P(game, "p1").stack.at(-1)?.face).toBe("skull");
  },
  skullOther: (game) => {
    expect(game.phase).toBe("roundEnd");
    expect(game.roundLog).toMatchObject({ result: "fail", challenger: "p1", skullOwner: "p3", loss: { method: "random" } });
    expect(P(game, "p1").lost).toEqual(["rose"]);
  },
  skullOtherSeen: (game) => {
    expect(game.roundLog).toMatchObject({ result: "fail", challenger: "p2", skullOwner: "p1" });
    expect(discCount(P(game, "p2"))).toBe(3);
  },
  loseChoosing: (game) => {
    expect(game.phase).toBe("loseChoosing");
    expect(types(game, "p1")).toEqual(["loseDisc"]);
  },
  chooseFirst: (game) => {
    expect(game.phase).toBe("chooseFirst");
    expect(P(game, "p1").eliminated).toBe(true);
    expect(types(game, "p1")).toEqual(["chooseFirstPlayer"]);
  },
  roundEndSuccess: (game) => {
    expect(game.roundLog.result).toBe("success");
    expect(P(game, "p1").flowerUp).toBe(true);
    expect(game.nextFirst).toBe("p1");
  },
  revealAfterFail: (game) => {
    expect(game.roundLog.result).toBe("fail");
    expect(game.roundLog.reveals.map((reveal) => reveal.player)).toEqual(["p4"]);
    expect(canRevealStack(game, "p1")).toBe(true);
  },
  lastChance: (game) => {
    expect(game.config.lastChance).toBe(true);
    expect(P(game, "p1").hand).toEqual([{ id: "lastchance", face: "rose", lastChance: true }]);
    expect(types(game, "p1")).toEqual(["placeDisc", "openBid"]);
  },
  lastChanceOther: (game) => {
    expect(P(game, "p3").stack.at(-1)).toMatchObject({ lastChance: true, revealed: false });
    expect(game.turn).toBe("p1");
  },
  sixPlayers: (game) => {
    expect(game.players).toHaveLength(6);
    expect(game.phase).toBe("bidding");
    expect(game.players.filter((player) => player.flowerUp).length).toBeGreaterThan(0);
    expect(game.players.filter((player) => player.passed).length).toBeGreaterThan(0);
  },
  gameOverTwoWins: (game) => {
    expect(game.phase).toBe("gameOver");
    expect(game.result).toEqual({ winner: "p1", reason: "twoWins" });
  },
  gameOverLastStanding: (game) => {
    expect(game.phase).toBe("gameOver");
    expect(game.result).toEqual({ winner: "p2", reason: "lastStanding" });
    expect(P(game, "p1").eliminated).toBe(true);
  },
  opponentOffline: (game) => {
    expect(game.turn).toBe("p2");
  },
  timeout: (game) => {
    expect(game.turn).toBe("p1");
    expect(eventsOf(game.events, "TimedOut")).toHaveLength(1);
  },
  autoPlay: (game) => {
    expect(game.turn).toBe("p1");
  },
  eliminatedViewer: (game) => {
    expect(P(game, "p1").eliminated).toBe(true);
    expect(game.phase).toBe("bidding");
  },
  laterRound: (game) => {
    expect(game.round).toBe(4);
    expect(game.history).toHaveLength(3);
  },
};

describe("预览局面工厂：命名局面", () => {
  for (const name of SCENE_NAMES) {
    it(`${name}：3–6 人都造得出来、自洽、说明属实（${SCENE_TITLES[name]}）`, () => {
      for (const count of [3, 4, 5, 6]) {
        const scene = createScene(name, { players: count });
        expect(scene.name).toBe(name);
        expect(scene.title).toBe(SCENE_TITLES[name]);
        expect(checkInvariants(scene.game)).toEqual([]);
        expect(scene.game.players).toHaveLength(name === "sixPlayers" ? 6 : name === "revealAfterFail" ? Math.max(4, count) : count);
        EXPECT[name](scene.game, count);
        // 包成房间快照：游戏已经按视角裁剪
        const room = previewRoom(scene);
        expect(room.game?.seed).toBeUndefined();
        for (const player of room.game!.players) {
          if (player.id === scene.viewer) continue;
          for (const disc of player.hand) expect(disc.id).toBeUndefined();
        }
      }
    });
  }

  it("房间标记：掉线、托管、倒计时写进快照；观战快照没有房间码、看不到牌面", () => {
    const offline = previewRoom(createScene("opponentOffline"));
    expect(offline.members.find((member) => member.playerId === "p2")?.connected).toBe(false);
    expect(previewRoom(createScene("autoPlay")).members.find((member) => member.playerId === "p1")?.auto).toBe(true);
    expect(previewRoom(createScene("timeout")).turnRemainingMs).toBe(4_000);
    const watch = previewRoom(createScene("myTurn"), { spectator: true });
    expect(watch.code).toBe("");
    expect(watch.game!.players.every((player) => player.hand.every((disc) => disc.face === undefined))).toBe(true);
    const god = previewRoom(createScene("myTurn"), { spectator: true, spectatorsSeeAll: true });
    expect(god.game!.players[1]!.hand.every((disc) => disc.face !== undefined && disc.id === undefined)).toBe(true);
    expect(previewRoom(createScene("lastChance")).options).toEqual({ lastChance: true });
    expect(previewRoom(createScene("myTurn"), { bots: ["p3"] }).members.find((member) => member.playerId === "p3")?.bot).toBe(true);
  });
});

describe("预览局面工厂：buildGame / runScript", () => {
  it("手里不写就是 3 玫瑰 1 骷髅减去板上和 lost；默认阶段、轮到谁、挑战者、还差几张都推得出来", () => {
    const game = buildGame({
      players: [{ stack: ["skull", { face: "rose", revealed: true }] }, { stack: ["rose"], lost: ["skull"] }, { stack: ["rose"] }],
      phase: "resolving",
      bids: [{ type: "open", player: "p1", count: 3 }, { type: "pass", player: "p2" }, { type: "pass", player: "p3" }],
    });
    expect(P(game, "p1").hand.map((disc) => disc.face).sort()).toEqual(["rose", "rose"]);
    expect(P(game, "p2").hand.map((disc) => disc.face)).toEqual(["rose", "rose"]);
    expect(P(game, "p2").lostCount).toBe(1);
    expect(game).toMatchObject({ challenger: "p1", bid: 3, bidder: "p1", flipsToDo: 2, awaitingMatChoice: false, turn: "p1" });
    expect(P(game, "p2").passed).toBe(true);
  });

  it("不自洽的局面直接报错，并说清楚哪里不对", () => {
    expect(() => buildGame({ players: [{ stack: ["skull", "skull"] }, {}, {}] })).toThrow(/超出了 3 玫瑰 1 骷髅/);
    expect(() => buildGame({ players: [{ stack: ["rose"] }, {}, {}] })).toThrow(/板上没有垫子/);
    expect(() => buildGame({ players: 2 })).toThrow(/3–6/);
    expect(() => buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], phase: "bidding", bid: 5, bidder: "p1", turn: "p2" })).toThrow(/不自洽/);
    expect(() => buildGame({ players: [{ hand: ["lastChance", "rose"] }, {}, {}] })).toThrow(/不自洽/);
  });

  it("剧本走错一步会说是第几步、为什么", () => {
    expect(() => runScript(startGame({ players: 3 }), [["p1", "place", "rose"], ["p1", "place", "rose"]])).toThrow(/剧本第 2 步.*已经盖过/);
    expect(() => runScript(startGame({ players: 3 }), [["p1", "bid", 1]])).toThrow(/剧本第 1 步/);
  });

  it("startGame 指定先手、人数、变体；runScript 的 timeout / readyAll / 直接发命令都能用", () => {
    let game = startGame({ players: 5, first: "p4", options: { lastChance: true } });
    expect(game.firstPlayer).toBe("p4");
    expect(game.config.lastChance).toBe(true);
    game = runScript(game, [["timeout"]]);
    expect(game.phase).toBe("placeOrBid");
    expect(game.turn).toBe("p4");
    game = runScript(game, [["p4", { type: "openBid", count: 5 }]]);
    expect(game.phase).toBe("resolving");
    game = runScript(game, [["autoAll"]]);
    while (game.phase === "resolving") game = runScript(game, [["timeout"]]);
    while (game.phase === "loseChoosing" || game.phase === "chooseFirst") game = runScript(game, [["timeout"]]);
    game = runScript(game, [["readyAll"]]);
    expect(game.round).toBe(2);
  });
});

describe("补充文件 2.3 教程剧本", () => {
  it("四轮都能按剧本走完，数字和补充文件的核对一致（总数 5 / 3 / 6 / 8，失牌后剩 3 张，最后赢下整局）", async () => {
    const { TUTORIAL_SCRIPT } = await import("../src/scenes.js");
    const { totalDiscsInPlay } = await import("../src/engine.js");
    let game = startGame({ players: 3, first: "p1" });
    const totals: number[] = [];
    for (const round of TUTORIAL_SCRIPT) {
      for (const step of round.steps) {
        game = runScript(game, [step]);
        if (game.phase === "resolving" && game.roundLog.flips.length === 0) totals.push(totalDiscsInPlay(game));
      }
      expect(checkInvariants(game)).toEqual([]);
      expect(game.round).toBe(round.round);
    }
    expect(totals).toEqual([5, 3, 6, 8]);
    expect(game.history.map((log) => [log.challenger, log.result])).toEqual([["p1", "success"], ["p1", "fail"], ["p2", "fail"]]);
    expect(game.history[1]!.loss).toMatchObject({ player: "p1", method: "random" });
    expect(P(game, "p1").lost).toEqual(["rose"]);
    expect(game.history[2]!.nextFirst).toBe("p2");
    expect(game.result).toEqual({ winner: "p1", reason: "twoWins" });
  });
});
