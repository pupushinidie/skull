/**
 * 规则书 §8.2 命令校验 + TC18 权限校验的补全：每个阶段只接受属于它的命令；非法输入（非整数叫价、不存在的玩家）拒绝；
 * 已淘汰的人、终局之后都不能再操作。
 */
import { describe, expect, it } from "vitest";
import { buildGame, legalActions, waitingFor, type GameCommand, type GameState } from "../../src/index.js";
import { autoAll, flip, open, pass, raise, ready, reject, run, runAll } from "./_helpers.js";

function phases(): Record<string, { state: GameState; actor: string }> {
  const base = () => buildGame({ players: [{ stack: ["rose", "skull", "rose"] }, { stack: ["rose"] }, { stack: ["skull"] }], turn: "p1" });
  const placeInitial = buildGame({ players: 3 });
  const placeOrBid = base();
  const bidding = run(base(), "p1", open(1));
  // resolving 等选板：A [花] 开叫 3
  const res = autoAll(run(buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["skull"] }], turn: "p1" }), "p1", open(3)));
  const loseChoosing = autoAll(runAll(base(), [["p1", open(2)], ["p2", pass], ["p3", pass]]));
  const chooseFirst = autoAll(
    runAll(buildGame({ players: [{ hand: [], stack: ["skull"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" }), [
      ["p1", open(1)],
      ["p2", pass],
      ["p3", pass],
    ]),
  );
  const roundEnd = autoAll(runAll(buildGame({ players: [{ stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" }), [
    ["p1", open(2)],
    ["p2", pass],
    ["p3", pass],
  ]));
  const gameOver = autoAll(
    runAll(buildGame({ players: [{ stack: ["rose", "rose"], flowerUp: true }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" }), [
      ["p1", open(2)],
      ["p2", pass],
      ["p3", pass],
    ]),
  );
  return {
    placeInitial: { state: placeInitial, actor: "p1" },
    placeOrBid: { state: placeOrBid, actor: "p1" },
    bidding: { state: bidding, actor: "p2" },
    resolving: { state: res, actor: "p1" },
    loseChoosing: { state: loseChoosing, actor: "p1" },
    chooseFirst: { state: chooseFirst, actor: "p1" },
    roundEnd: { state: roundEnd, actor: "p2" },
    gameOver: { state: gameOver, actor: "p2" },
  };
}

/** 每种命令属于哪个阶段（§8.2 + chooseFirst + revealStack）。 */
const OWN_PHASE: Record<GameCommand["type"], string[]> = {
  placeFirst: ["placeInitial"],
  placeDisc: ["placeOrBid"],
  openBid: ["placeOrBid"],
  raise: ["bidding"],
  pass: ["bidding"],
  flipMat: ["resolving"],
  loseDisc: ["loseChoosing"],
  chooseFirstPlayer: ["chooseFirst"],
  nextRound: ["roundEnd"],
  revealStack: ["roundEnd"],
};

function sample(state: GameState, actor: string, type: GameCommand["type"]): GameCommand {
  const me = state.players.find((p) => p.id === actor)!;
  const anyId = me.hand[0]?.id ?? me.stack[0]?.id ?? "x";
  switch (type) {
    case "placeFirst":
    case "placeDisc":
    case "loseDisc":
      return { type, discId: anyId };
    case "openBid":
    case "raise":
      return { type, count: Math.max(1, state.bid + 1) };
    case "flipMat":
      return { type, player: "p2" };
    case "chooseFirstPlayer":
      return { type, player: "p2" };
    default:
      return { type } as GameCommand;
  }
}

describe("§8.2 每个阶段只接受属于它的命令", () => {
  const all = phases();
  for (const [phase, { state, actor }] of Object.entries(all)) {
    it(`${phase}：其他阶段的命令一律拒绝（由该阶段该行动的人发）`, () => {
      expect(state.phase).toBe(phase);
      for (const type of Object.keys(OWN_PHASE) as GameCommand["type"][]) {
        if (OWN_PHASE[type].includes(phase)) continue;
        reject(state, actor, sample(state, actor, type));
      }
    });
  }

  it("终局后所有人都没有合法行动，任何命令都拒绝", () => {
    const { state } = all.gameOver!;
    for (const p of state.players) {
      expect(legalActions(state, p.id)).toEqual([]);
      reject(state, p.id, ready);
      reject(state, p.id, open(1));
    }
    expect(waitingFor(state)).toEqual([]);
  });
});

describe("非法输入", () => {
  const g = () => buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });

  it("叫价不是整数（1.5、NaN、字符串）拒绝", () => {
    reject(g(), "p1", open(1.5));
    reject(g(), "p1", open(Number.NaN));
    reject(g(), "p1", { type: "openBid", count: "2" as unknown as number });
    const b = run(g(), "p1", open(1));
    reject(b, "p2", raise(2.5));
    reject(b, "p2", raise(Number.POSITIVE_INFINITY));
  });

  it("不存在的玩家发命令拒绝", () => {
    reject(g(), "p9", open(1));
    reject(g(), "", open(1));
  });

  it("未知命令类型拒绝", () => {
    reject(g(), "p1", { type: "skipTurn" } as unknown as GameCommand);
  });

  it("已淘汰的人不能操作，结算画面也不用等他点继续", () => {
    let s = buildGame({
      players: [{ hand: [], stack: ["rose"] }, { stack: ["skull"] }, { stack: ["rose"] }],
      firstPlayer: "p2",
      turn: "p2",
    });
    s = runAll(s, [["p2", open(1)], ["p3", pass], ["p1", raise(2)], ["p2", pass]]);
    s = autoAll(s);
    s = run(s, "p1", flip("p2"));
    expect(s.phase).toBe("roundEnd");
    expect(waitingFor(s)).not.toContain("p1");
    reject(s, "p1", ready);
    expect(legalActions(s, "p1")).toEqual([]);
  });
});

describe("Last Chance 碟当第 1 张盖（规则书没说死）", () => {
  it("持碟人准备阶段的合法行动里，自己的垫子一定能盖（碟子能不能当第 1 张见报告）", () => {
    const s = buildGame({ players: [{ hand: ["rose", "lastChance"] }, {}, {}], options: { lastChance: true } });
    expect(s.phase).toBe("placeInitial");
    const acts = legalActions(s, "p1").filter((c) => c.type === "placeFirst");
    const own = s.players[0]!.hand.find((d) => !d.lastChance)!.id!;
    expect(acts).toContainEqual({ type: "placeFirst", discId: own });
  });
});
