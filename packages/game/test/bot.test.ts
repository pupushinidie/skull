/**
 * 人机决策单测：只吃裁剪后的视角、每个阶段都会走、补充 1.12 的九条蠢错、关键决策。
 * 局面都用 buildGame 造（完整状态），交给人机前一律 redactGameForViewer。
 */
import { describe, expect, it } from "vitest";
import { BOT_PARAMS, botCommand, botDecision, botHint } from "../src/bot.js";
import { boardRisks, bestAllocation } from "../src/bot-knowledge.js";
import { newRoundLog, redactGameForViewer } from "../src/engine.js";
import { createRng } from "../src/rng.js";
import { buildGame, type GameSpec } from "../src/scenes.js";
import type { GameState, RoundLog } from "../src/types.js";

const fixed = (value: number) => () => value;
/** random 一直返回 0.99：所有「小概率换个打法」都不触发。 */
const steady = fixed(0.99);

function view(game: GameState, me = "p1"): GameState {
  return redactGameForViewer(game, me);
}
function decide(spec: GameSpec, me = "p1", random: () => number = steady) {
  const game = buildGame(spec);
  const decision = botDecision(view(game, me), me, random);
  if (!decision) throw new Error("人机没给决定");
  return { game, ...decision };
}

describe("人机只看裁剪后的视角", () => {
  const spec: GameSpec = { players: [{ stack: ["rose"] }, { stack: ["skull"] }, { stack: ["rose"] }] };

  it("拿到完整状态（看得见别人牌面、种子）直接报错；裁剪后的视角正常给出决定", () => {
    const game = buildGame(spec);
    expect(() => botCommand(game, "p1")).toThrow(/裁剪/);
    expect(botCommand(view(game), "p1")).not.toBeNull();
  });

  it("观战看底牌的视角（看得见别人牌面）也不收", () => {
    const game = buildGame(spec);
    const seeAll = redactGameForViewer(game, "", { seeAll: true });
    expect(() => botCommand(seeAll, "p1")).toThrow(/裁剪/);
  });

  it("蠢错 8：公开局面一样、对手没翻开的牌面不同，人机的决定完全一样（每个阶段 × 40 个随机数种子）", () => {
    const pairs: [GameSpec, GameSpec][] = [
      // 盖牌或开叫
      [
        { players: [{ stack: ["rose", "rose"] }, { stack: ["rose", "skull"], hand: ["rose", "rose"] }, { stack: ["rose"], hand: ["rose", "rose", "skull"] }] },
        { players: [{ stack: ["rose", "rose"] }, { stack: ["skull", "rose"], hand: ["rose", "rose"] }, { stack: ["skull"], hand: ["rose", "rose", "rose"] }] },
      ],
      // 加注
      [
        {
          players: [{ stack: ["rose"] }, { stack: ["rose", "rose"], hand: ["rose", "skull"] }, { stack: ["skull"], hand: ["rose", "rose", "rose"] }],
          phase: "bidding",
          bids: [{ type: "open", player: "p2", count: 2 }],
          turn: "p1",
        },
        {
          players: [{ stack: ["rose"] }, { stack: ["skull", "rose"], hand: ["rose", "rose"] }, { stack: ["rose"], hand: ["rose", "rose", "skull"] }],
          phase: "bidding",
          bids: [{ type: "open", player: "p2", count: 2 }],
          turn: "p1",
        },
      ],
      // 选板
      [
        {
          players: [{ stack: [{ face: "rose", revealed: true }] }, { stack: ["rose", "skull"], hand: ["rose", "rose"] }, { stack: ["rose", "rose"], hand: ["rose", "skull"] }],
          phase: "resolving",
          bids: [{ type: "open", player: "p1", count: 3 }, { type: "pass", player: "p2" }, { type: "pass", player: "p3" }],
        },
        {
          players: [{ stack: [{ face: "rose", revealed: true }] }, { stack: ["rose", "rose"], hand: ["rose", "skull"] }, { stack: ["skull", "rose"], hand: ["rose", "rose"] }],
          phase: "resolving",
          bids: [{ type: "open", player: "p1", count: 3 }, { type: "pass", player: "p2" }, { type: "pass", player: "p3" }],
        },
      ],
    ];
    for (const [left, right] of pairs) {
      const a = view(buildGame(left));
      const b = view(buildGame(right));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
      for (let seed = 1; seed <= 40; seed += 1) {
        const ra = createRng(seed);
        const rb = createRng(seed);
        expect(botCommand(a, "p1", () => ra.next())).toEqual(botCommand(b, "p1", () => rb.next()));
      }
    }
  });
});

describe("每个阶段都会走", () => {
  it("准备阶段：手里有骷髅也有玫瑰时经过随机数决定盖哪张（蠢错 7）", () => {
    const spec: GameSpec = { players: 3 };
    expect(decide(spec, "p1", fixed(0.99)).command).toMatchObject({ type: "placeFirst" });
    const rose = decide(spec, "p1", fixed(0.99));
    const skull = decide(spec, "p1", fixed(0.0));
    const faceOf = (game: GameState, id: string) => game.players[0]!.hand.find((disc) => disc.id === id)!.face;
    expect(faceOf(rose.game, (rose.command as { discId: string }).discId)).toBe("rose");
    expect(faceOf(skull.game, (skull.command as { discId: string }).discId)).toBe("skull");
    expect(skull.reason).toMatch(/骷髅/);
  });

  it("准备阶段盖骷髅的比例：平时约 20%，有对手花面时更高，都不是 0 也不是 100%（蠢错 7）", () => {
    const rate = (spec: GameSpec) => {
      const game = buildGame(spec);
      const v = view(game);
      const rng = createRng(5);
      let skulls = 0;
      for (let index = 0; index < 2000; index += 1) {
        const command = botCommand(v, "p1", () => rng.next()) as { discId: string };
        if (game.players[0]!.hand.find((disc) => disc.id === command.discId)!.face === "skull") skulls += 1;
      }
      return skulls / 2000;
    };
    const normal = rate({ players: 3 });
    const pressured = rate({ players: [{}, { flowerUp: true }, {}] });
    expect(normal).toBeGreaterThan(0.12);
    expect(normal).toBeLessThan(0.3);
    expect(pressured).toBeGreaterThan(normal + 0.1);
    expect(pressured).toBeLessThan(0.55);
  });

  it("板上全是玫瑰：开叫至少叫自己的张数（稳开叫 2）", () => {
    const { command, reason } = decide({ players: [{ stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }] });
    expect(command).toEqual({ type: "openBid", count: 2 });
    expect(reason).toMatch(/2 张都是玫瑰/);
  });

  it("板上 1 张玫瑰、场上不多：再盖一张玫瑰，不盖骷髅", () => {
    const { game, command } = decide({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }] });
    expect(command.type).toBe("placeDisc");
    expect(game.players[0]!.hand.find((disc) => disc.id === (command as { discId: string }).discId)!.face).toBe("rose");
  });

  it("诱饵：底下骷髅、上面 1 张玫瑰 → 开叫 1", () => {
    const { command, reason } = decide({ players: [{ stack: ["skull", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }] });
    expect(command).toEqual({ type: "openBid", count: 1 });
    expect(reason).toMatch(/骷髅/);
  });

  it("手里没垫子必须开叫：板上全是玫瑰就叫自己的张数", () => {
    const { command } = decide({ players: [{ stack: ["rose", "rose", "rose"], hand: [], lost: ["skull"] }, { stack: ["rose", "rose"] }, { stack: ["rose"] }] });
    expect(command).toEqual({ type: "openBid", count: 3 });
  });

  it("手里只剩骷髅、板上全是玫瑰：开叫，不把骷髅叠到自己玫瑰上（蠢错 4）", () => {
    const { command } = decide({ players: [{ stack: ["rose", "rose", "rose"], hand: ["skull"] }, { stack: ["rose"] }, { stack: ["rose"] }] });
    expect(command).toEqual({ type: "openBid", count: 3 });
  });

  it("蠢错 2：一共只剩一张骷髅、被迫开叫时只叫 1，绝不叫到场上总数", () => {
    const { command, reason } = decide({ players: [{ stack: ["skull"], hand: [], lost: ["rose", "rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }] });
    expect(command).toEqual({ type: "openBid", count: 1 });
    expect(reason).toMatch(/最小的 1/);
  });

  it("加注：能叫得更高就加；多数时候直接加到能叫的最高数（不超过场上总数），偶尔只加 1", () => {
    const spec: GameSpec = {
      players: [{ stack: ["rose", "rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }],
      phase: "bidding",
      bids: [{ type: "open", player: "p2", count: 1 }],
      turn: "p1",
    };
    const jump = decide(spec, "p1", fixed(0)).command as { type: string; count: number };
    expect(jump.type).toBe("raise");
    expect(jump.count).toBeGreaterThanOrEqual(3);
    expect(jump.count).toBeLessThanOrEqual(5);
    expect(decide(spec, "p1", fixed(0.99)).command).toEqual({ type: "raise", count: 2 });
  });

  it("蠢错 1：自己板上骷髅在从顶往下第 2 张、现价 1 → 不加到 2，pass", () => {
    const { command, reason } = decide({
      players: [{ stack: ["skull", "rose"] }, { stack: ["rose", "rose"] }, { stack: ["rose", "rose"] }],
      phase: "bidding",
      bids: [{ type: "open", player: "p2", count: 1 }],
      turn: "p1",
    });
    expect(command).toEqual({ type: "pass" });
    expect(reason).toMatch(/自己的骷髅/);
  });

  it("蠢错 1：板上有骷髅时，无论现价多少，开叫 / 加注的数永远 ≤ 骷髅深度 − 1", () => {
    for (const stack of [["skull", "rose", "rose"], ["rose", "skull", "rose"], ["skull", "rose"]] as const) {
      const depth = [...stack].reverse().indexOf("skull") + 1;
      for (let bid = 0; bid <= 3; bid += 1) {
        const spec: GameSpec = bid === 0
          ? { players: [{ stack: [...stack] }, { stack: ["rose", "rose"] }, { stack: ["rose", "rose"] }, { stack: ["rose"] }] }
          : {
              players: [{ stack: [...stack] }, { stack: ["rose", "rose"] }, { stack: ["rose", "rose"] }, { stack: ["rose"] }],
              phase: "bidding",
              bids: [{ type: "open", player: "p2", count: bid }],
              turn: "p1",
            };
        for (let seed = 1; seed <= 20; seed += 1) {
          const rng = createRng(seed);
          const { command } = decide(spec, "p1", () => rng.next());
          if (command.type === "openBid" || command.type === "raise") expect(command.count).toBeLessThanOrEqual(depth - 1);
        }
      }
    }
  });

  it("选板：翻刚叫过价的人（他顶上多半是玫瑰），不翻一直没表态的", () => {
    const { command, reason } = decide({
      players: [{ stack: [{ face: "rose", revealed: true }] }, { stack: ["rose", "rose"] }, { stack: ["rose", "rose"] }],
      phase: "resolving",
      bids: [{ type: "open", player: "p2", count: 2 }, { type: "raise", player: "p1", count: 3 }, { type: "pass", player: "p3" }, { type: "pass", player: "p2" }],
    });
    expect(command).toEqual({ type: "flipMat", player: "p2" });
    expect(reason).toMatch(/叫到过 2/);
  });

  it("蠢错 5：不往一块板底下挖（准备阶段那张），别的板顶上还有低风险的", () => {
    const { command } = decide({
      players: [
        { stack: [{ face: "rose", revealed: true }] },
        { stack: ["rose", { face: "rose", revealed: true }] },
        { stack: ["rose"] },
        { stack: ["rose"] },
      ],
      phase: "resolving",
      bid: 3,
      bids: [{ type: "open", player: "p3", count: 1 }, { type: "raise", player: "p1", count: 3 }, { type: "pass", player: "p4" }, { type: "pass", player: "p2" }, { type: "pass", player: "p3" }],
    });
    expect(command).toEqual({ type: "flipMat", player: "p3" });
  });

  it("选板：以前老被翻出骷髅的人少翻（历史习惯），翻从来没翻出过骷髅的人", () => {
    const history: RoundLog[] = [];
    for (let round = 1; round <= 3; round += 1) {
      const log = newRoundLog(round, "p1");
      log.challenger = "p1";
      log.bid = 2;
      log.result = round < 3 ? "fail" : "success";
      log.flips = round < 3
        ? [{ owner: "p3", depth: 1, face: "rose", auto: false }, { owner: "p2", depth: 0, face: "skull", auto: false }]
        : [{ owner: "p3", depth: 0, face: "rose", auto: false }, { owner: "p2", depth: 0, face: "rose", auto: false }];
      log.skullOwner = round < 3 ? "p2" : null;
      log.nextFirst = "p1";
      history.push(log);
    }
    const { command } = decide({
      round: 4,
      history,
      players: [{ stack: [{ face: "rose", revealed: true }], lost: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }],
      phase: "resolving",
      bid: 2,
      bids: [{ type: "open", player: "p1", count: 2 }, { type: "pass", player: "p2" }, { type: "pass", player: "p3" }],
    });
    expect(command).toEqual({ type: "flipMat", player: "p3" });
  });

  it("蠢错 9：Last Chance 碟是明牌玫瑰，当挑战者时先翻它", () => {
    const { command, reason } = decide({
      options: { lastChance: true },
      players: [{ stack: [{ face: "rose", revealed: true }] }, { stack: ["rose"], hand: ["rose", "rose", "skull"] }, { stack: ["rose", "lastChance"], lost: ["rose", "rose", "skull"] }],
      phase: "resolving",
      bid: 2,
      bids: [{ type: "open", player: "p1", count: 2 }, { type: "pass", player: "p2" }, { type: "pass", player: "p3" }],
    });
    expect(command).toEqual({ type: "flipMat", player: "p3" });
    expect(reason).toMatch(/碟/);
  });

  it("Last Chance：准备阶段先盖自己的，不盖碟子；决策回合再把碟子盖上", () => {
    const options = { lastChance: true };
    const first = decide({ options, players: [{ hand: ["rose", "lastChance"], lost: ["rose", "rose", "skull"] }, {}, {}] });
    expect(first.command.type).toBe("placeFirst");
    expect((first.command as { discId: string }).discId).not.toBe("lastchance");
    const second = decide({ options, players: [{ stack: ["rose"], hand: ["lastChance"], lost: ["rose", "rose", "skull"] }, { stack: ["rose"] }, { stack: ["rose"] }] });
    expect(second.command).toEqual({ type: "placeDisc", discId: "lastchance" });
  });

  it("自选失牌（补充 1.8）：4→3 丢玫瑰；3→2 没花面丢玫瑰、花面丢骷髅；2→1 丢骷髅（蠢错 3）", () => {
    const lose = (hand: ("rose" | "skull")[], flowerUp: boolean) => {
      const lost = (["rose", "rose", "rose", "skull"] as const).slice(0, 4 - hand.length).map(() => "rose" as const);
      const { game, command } = decide({
        players: [{ hand, lost, flowerUp }, { stack: ["skull"] }, { stack: ["rose"] }],
        phase: "loseChoosing",
        challenger: "p1",
        selfSkull: true,
        bid: 1,
      });
      expect(command.type).toBe("loseDisc");
      return game.players[0]!.hand.find((disc) => disc.id === (command as { discId: string }).discId)!.face;
    };
    expect(lose(["rose", "rose", "rose", "skull"], false)).toBe("rose");
    expect(lose(["rose", "rose", "skull"], false)).toBe("rose");
    expect(lose(["rose", "rose", "skull"], true)).toBe("skull");
    expect(lose(["rose", "skull"], false)).toBe("skull");
    expect(lose(["rose", "skull"], true)).toBe("skull");
  });

  it("自己把自己淘汰：先手给离赢最远的人（没花面、垫子最少）", () => {
    const { command, reason } = decide({
      players: [
        { eliminated: true },
        { flowerUp: true, stack: ["rose"] },
        { stack: ["rose"], hand: ["rose"], lost: ["rose", "skull"] },
        { stack: ["rose"], hand: ["rose", "skull"], lost: ["rose"] },
      ],
      phase: "chooseFirst",
      challenger: "p1",
      selfSkull: true,
      bid: 1,
    });
    expect(command).toEqual({ type: "chooseFirstPlayer", player: "p3" });
    expect(reason).toMatch(/先手/);
  });

  it("结算画面：只点继续，能亮牌也从不亮", () => {
    const game = buildGame({
      players: [{ stack: ["rose", "skull"] }, { stack: [{ face: "skull", revealed: true }] }, { hand: ["rose", "rose", "skull"], lost: ["rose"] }],
      phase: "roundEnd",
      challenger: "p3",
      bid: 1,
      nextFirst: "p3",
      roundLog: { result: "fail", skullOwner: "p2" },
    });
    for (let seed = 1; seed <= 20; seed += 1) {
      const rng = createRng(seed);
      expect(botCommand(view(game), "p1", () => rng.next())).toEqual({ type: "nextRound" });
    }
  });

  it("不轮到它时返回 null", () => {
    const game = buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p2" });
    expect(botCommand(view(game), "p1")).toBeNull();
  });
});

describe("拦截领先者", () => {
  it("蠢错 6：花面的单张对手被迫开叫 1，我板上 2 张玫瑰 → 一定加注，不白送他整局", () => {
    const { command } = decide({
      players: [{ stack: ["rose", "rose"] }, { stack: ["rose"], hand: [], lost: ["rose", "rose", "skull"], flowerUp: true }, { stack: ["rose"] }],
      phase: "bidding",
      firstPlayer: "p2",
      bids: [{ type: "open", player: "p2", count: 1 }, { type: "pass", player: "p3" }],
      turn: "p1",
    });
    expect(command.type).toBe("raise");
  });

  it("花面的人叫到自己板上的全部（他多半翻得过）：平时不够门槛也要加注拦他", () => {
    const spec: GameSpec = {
      players: [
        { stack: ["rose"], hand: [], lost: ["rose", "rose", "skull"] },
        { stack: ["rose", "rose", "rose", "skull"], flowerUp: true },
        { stack: ["rose"] },
      ],
      phase: "bidding",
      firstPlayer: "p2",
      bids: [{ type: "open", player: "p2", count: 4 }, { type: "pass", player: "p3" }],
      turn: "p1",
    };
    const { command, reason } = decide(spec);
    expect(command).toEqual({ type: "raise", count: 5 });
    expect(reason).toMatch(/拦住/);
    // 同样的局面但他没花面：门槛 0.8 不够，pass
    const calm = decide({ ...spec, players: [spec.players[0]!, { stack: ["rose", "rose", "rose", "skull"] }, spec.players[2]!] } as GameSpec);
    expect(calm.command).toEqual({ type: "pass" });
  });

  it("花面的人非得翻我这块有骷髅的板才够：不拦，pass 让他踩", () => {
    const { command, reason } = decide({
      players: [{ stack: ["rose", "skull"] }, { stack: ["rose", "rose"], flowerUp: true }, { eliminated: true }],
      phase: "bidding",
      firstPlayer: "p2",
      bids: [{ type: "open", player: "p2", count: 3 }],
      turn: "p1",
    });
    expect(command).toEqual({ type: "pass" });
    expect(reason).toMatch(/踩/);
  });
});

describe("读牌", () => {
  it("补充 1.4 算例：叫 4 / 5 / 6 / 7 的最好成功率 0.865 / 0.709 / 0.497 / 0.333（同一块板风险相加、要枚举分法）", () => {
    const risk = BOT_PARAMS.risk;
    const b = boardRisks([{ revealed: false }, { revealed: false }], 4, 1, 1, 1, 3, false, risk).risks;
    const c = boardRisks([{ revealed: false }, { revealed: false }], 4, 1, 1, 1, 0, false, risk).risks;
    const d = boardRisks([{ revealed: false }], 4, 1, 1, 1, 0, false, risk).risks;
    expect(b[0]).toBeCloseTo(0.054, 3);
    expect(b[1]).toBeCloseTo(0.081, 3);
    expect(c).toEqual([expect.closeTo(0.18, 3), expect.closeTo(0.27, 3)]);
    expect(d[0]).toBeCloseTo(0.3, 3);
    const boards = [b, c, d];
    expect(bestAllocation(boards, 2).p).toBeCloseTo(0.865, 3);
    expect(bestAllocation(boards, 3).p).toBeCloseTo(0.709, 3);
    expect(bestAllocation(boards, 4).p).toBeCloseTo(0.497, 3);
    expect(bestAllocation(boards, 4).take).toEqual([2, 1, 1]);
    expect(bestAllocation(boards, 5).p).toBeCloseTo(0.333, 3);
  });

  it("翻开的玫瑰让同一块板剩下几张的风险按条件概率变大", () => {
    const risk = BOT_PARAMS.risk;
    const before = boardRisks([{ revealed: false }, { revealed: false }], 4, 1, 1, 1, 0, false, risk).risks;
    const after = boardRisks([{ revealed: false }, { revealed: true, face: "rose" }], 4, 1, 1, 1, 0, false, risk).risks;
    expect(after).toHaveLength(1);
    expect(after[0]).toBeCloseTo(before[1]! / (1 - before[0]!), 6);
  });

  it("每个决定都带一句中文理由；botHint 和 botDecision 一样", () => {
    const game = buildGame({ players: [{ stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }] });
    const hint = botHint(view(game), "p1", steady);
    expect(hint).toEqual(botDecision(view(game), "p1", steady));
    expect(hint!.reason).toMatch(/[一-龥]/);
  });
});
