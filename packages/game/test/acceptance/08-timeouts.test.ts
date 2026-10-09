/**
 * 补充 3.4 超时默认值（替换规则书 §8.4）：
 * | placeInitial 20 秒 随机盖 1 张 | placeOrBid 25 秒 有垫子随机盖、没垫子开叫 1 | bidding 20 秒 pass |
 * | resolving 20 秒 顺时针第一个板上还有没翻开垫子的对手 | loseChoosing 20 秒 随机丢 1 张 | chooseFirst 15 秒 顺时针下一位存活 |
 * 另：计时 key 只在换人 / 换步骤时变（别人的轮外操作不重置倒计时）。
 */
import { describe, expect, it } from "vitest";
import {
  buildGame,
  DEFAULT_TIMEOUTS,
  startGame,
  stepKey,
  stepTimeoutMs,
  timeoutCommand,
  timeoutTurn,
  totalDiscsInPlay,
  type GameState,
} from "../../src/index.js";
import { autoAll, flip, open, P, pass, placeFirst, ready, rng, run, runAll, total } from "./_helpers.js";

describe("补充 3.4 各步限时", () => {
  it("限时表：准备 20、轮流 25、加注 20、选板 20、自选失牌 20、指定先手 15（秒）", () => {
    expect(DEFAULT_TIMEOUTS).toEqual({
      placeInitial: 20,
      placeOrBid: 25,
      bidding: 20,
      resolving: 20,
      loseChoosing: 20,
      chooseFirst: 15,
    });
    const g = startGame({ players: 3, first: "p1" });
    expect(stepTimeoutMs(g)).toBe(20_000);
    let s = placeFirst(placeFirst(placeFirst(g, "p1", "rose"), "p2", "rose"), "p3", "rose");
    expect(stepTimeoutMs(s)).toBe(25_000);
    s = run(s, "p1", open(1));
    expect(stepTimeoutMs(s)).toBe(20_000);
  });
});

describe("补充 3.4 超时动作", () => {
  it("准备阶段到点：没盖的人各随机盖 1 张，已盖的不动；进入轮流", () => {
    let g = startGame({ players: 4, first: "p2", seed: 11 });
    g = placeFirst(g, "p1", "skull");
    const before = P(g, "p1").stack[0]!.id;
    g = timeoutTurn(g);
    expect(g.phase).toBe("placeOrBid");
    for (const p of g.players) expect(p.stack).toHaveLength(1);
    expect(P(g, "p1").stack[0]!.id).toBe(before);
    const timedOut = g.events.filter((e) => e.type === "TimedOut").map((e) => (e as { player: string }).player);
    expect(new Set(timedOut)).toEqual(new Set(["p2", "p3", "p4"]));
  });

  it("准备阶段随机盖：多个种子下玫瑰、骷髅都会被选到（是随机，不是固定盖某一张）", () => {
    const g = startGame({ players: 3, first: "p1" });
    const faces = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const c = timeoutCommand(g, "p1", rng(seed));
      expect(c?.type).toBe("placeFirst");
      const id = c && "discId" in c ? c.discId : "";
      faces.add(P(g, "p1").hand.find((d) => d.id === id)!.face!);
    }
    expect(faces).toEqual(new Set(["rose", "skull"]));
  });

  it("轮流到点、手里有垫子：随机盖 1 张（不开叫）", () => {
    const g = buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    const s = timeoutTurn(g);
    expect(P(s, "p1").stack).toHaveLength(2);
    expect(s.phase).toBe("placeOrBid");
    expect(s.turn).toBe("p2");
    expect(s.bid).toBe(0);
  });

  it("轮流到点、手里没垫子：开叫 1", () => {
    const g = buildGame({ players: [{ hand: [], stack: ["rose", "skull"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    expect(timeoutCommand(g, "p1", rng())).toEqual(open(1));
    const s = timeoutTurn(g);
    expect(s.phase).toBe("bidding");
    expect(s.bid).toBe(1);
    expect(s.bidder).toBe("p1");
  });

  it("加注到点：pass", () => {
    let g = buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    g = run(g, "p1", open(1));
    expect(timeoutCommand(g, "p2", rng())).toEqual(pass);
    g = timeoutTurn(g);
    expect(P(g, "p2").passed).toBe(true);
    expect(g.bid).toBe(1);
    expect(g.turn).toBe("p3");
  });

  it("选板到点：挑战者顺时针第一个板上还有没翻开垫子的对手（跳过已翻空的）", () => {
    // A [花]，B [花]，C [花]，D [花]：A 开叫 4 = 总数
    let g = buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    g = autoAll(run(g, "p1", open(4)));
    expect(timeoutCommand(g, "p1", rng())).toEqual(flip("p2"));
    g = run(g, "p1", flip("p2")); // B 翻空
    expect(timeoutCommand(g, "p1", rng())).toEqual(flip("p3"));
    g = timeoutTurn(g);
    expect(g.roundLog.flips.at(-1)!.owner).toBe("p3");
  });

  it("选板到点：顺时针从挑战者往后绕（挑战者是 C → 先 D 再 A），跳过已淘汰的", () => {
    let g = buildGame({
      players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }, { eliminated: true }],
      firstPlayer: "p3",
      turn: "p3",
    });
    g = autoAll(run(g, "p3", open(3)));
    expect(g.challenger).toBe("p3");
    expect(timeoutCommand(g, "p3", rng())).toEqual(flip("p1"));
  });

  it("自选失牌到点：随机丢 1 张（多个种子下玫瑰、骷髅都可能），失牌方式仍记 chosen", () => {
    let g = buildGame({ players: [{ stack: ["rose", "skull", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    g = autoAll(runAll(g, [["p1", open(2)], ["p2", pass], ["p3", pass]]));
    expect(g.phase).toBe("loseChoosing");
    const s = timeoutTurn(g);
    expect(total(s, "p1")).toBe(3);
    expect(s.roundLog.loss).toMatchObject({ player: "p1", method: "chosen" });
    expect(s.events.some((e) => e.type === "TimedOut" && e.player === "p1")).toBe(true);
    const faces = new Set<string>();
    for (let seed = 1; seed <= 60; seed++) {
      const c = timeoutCommand(g, "p1", rng(seed));
      expect(c?.type).toBe("loseDisc");
      const id = c && "discId" in c ? c.discId : "";
      faces.add(P(g, "p1").hand.find((d) => d.id === id)!.face!);
    }
    expect(faces).toEqual(new Set(["rose", "skull"]));
  });

  it("不轮到的人 timeoutCommand 为 null", () => {
    const g = buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    expect(timeoutCommand(g, "p2", rng())).toBeNull();
    expect(timeoutCommand(g, "p3", rng())).toBeNull();
  });
});

describe("一个决定一个计时（stepKey）", () => {
  it("准备阶段别人盖牌不改 key；轮流换人改 key", () => {
    let g = startGame({ players: 3, first: "p1" });
    const k0 = stepKey(g);
    g = placeFirst(g, "p2", "rose");
    expect(stepKey(g)).toBe(k0);
    g = placeFirst(g, "p3", "rose");
    expect(stepKey(g)).toBe(k0);
    g = placeFirst(g, "p1", "rose");
    const k1 = stepKey(g);
    expect(k1).not.toBe(k0);
    g = run(g, "p1", open(1));
    expect(stepKey(g)).not.toBe(k1);
  });

  it("结算画面别人点继续不改 key", () => {
    let g: GameState = buildGame({ players: [{ stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" });
    g = autoAll(runAll(g, [["p1", open(2)], ["p2", pass], ["p3", pass]]));
    expect(g.phase).toBe("roundEnd");
    const k = stepKey(g);
    g = run(g, "p2", ready);
    expect(stepKey(g)).toBe(k);
    expect(totalDiscsInPlay(g)).toBe(4);
  });
});
