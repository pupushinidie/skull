/**
 * 规则书 §2 配件、§3 开局、§4.1 准备（同时盖第 1 张）。
 * 开工拍板：3–6 人、第一轮先手随机、每轮第 1 张所有人同时盖、Last Chance 碟默认关。
 */
import { describe, expect, it } from "vitest";
import {
  createGame,
  legalActions,
  previewPlayers,
  startGame,
  totalDiscsInPlay,
  waitingFor,
} from "../../src/index.js";
import { countFaces, handId, open, P, placeFirst, reject, run } from "./_helpers.js";

describe("§2/§3 开局构成（规则书 TC1）", () => {
  for (const n of [3, 4, 5, 6]) {
    it(`TC1 ${n} 人开局：每人 3 玫瑰 + 1 骷髅、垫板空白面、没淘汰、场上 0 张`, () => {
      const g = createGame(previewPlayers(n), 101 + n);
      expect(g.players).toHaveLength(n);
      expect(g.phase).toBe("placeInitial");
      expect(g.round).toBe(1);
      expect(g.bid).toBe(0);
      expect(g.challenger).toBeNull();
      expect(g.winners).toEqual([]);
      expect(totalDiscsInPlay(g)).toBe(0);
      for (const p of g.players) {
        expect(p.hand).toHaveLength(4);
        expect(countFaces(p.hand)).toEqual({ rose: 3, skull: 1, lastChance: 0 });
        expect(p.stack).toEqual([]);
        expect(p.flowerUp).toBe(false);
        expect(p.eliminated).toBe(false);
        expect(p.passed).toBe(false);
        expect(p.lostCount).toBe(0);
      }
      // 全桌垫子 id 互不相同，且 id 里看不出牌面（补充 3.3 #6）
      const ids = g.players.flatMap((p) => p.hand.map((d) => d.id!));
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).not.toMatch(/rose|skull|flower|花|骷|玫/i);
    });
  }

  it("§7 只支持 3–6 人：2 人、7 人开局都拒绝", () => {
    expect(() => createGame(previewPlayers(2), 1)).toThrow();
    expect(() => createGame([...previewPlayers(6), { id: "p7", name: "七" }], 1)).toThrow();
  });

  it("拍板：Last Chance 碟默认关，开房选项能打开", () => {
    expect(createGame(previewPlayers(3), 1).config.lastChance).toBe(false);
    expect(createGame(previewPlayers(3), 1, { lastChance: true }).config.lastChance).toBe(true);
  });

  it("拍板：第一轮先手随机（400 个种子里每个座位都当过先手，比例在 15%–35%）", () => {
    const counts: Record<string, number> = {};
    for (let seed = 1; seed <= 400; seed++) {
      const g = createGame(previewPlayers(4), seed);
      counts[g.firstPlayer] = (counts[g.firstPlayer] ?? 0) + 1;
    }
    for (const id of ["p1", "p2", "p3", "p4"]) {
      expect(counts[id] ?? 0).toBeGreaterThan(400 * 0.15);
      expect(counts[id] ?? 0).toBeLessThan(400 * 0.35);
    }
  });

  it("同一种子开出同一局（可复现）", () => {
    expect(JSON.stringify(createGame(previewPlayers(5), 77))).toBe(JSON.stringify(createGame(previewPlayers(5), 77)));
  });
});

describe("§4.1 同时盖第 1 张（规则书 TC2，拍板：同时盖）", () => {
  it("TC2 4 人任意顺序各盖 1 张 → 每人板上 1 张、总数 4、进入轮流，先手生效", () => {
    let g = startGame({ players: 4, first: "p2", seed: 3 });
    expect(new Set(waitingFor(g))).toEqual(new Set(["p1", "p2", "p3", "p4"]));
    expect(g.turn).toBeNull();
    // 不按座位顺序，也不要求先手最后盖；第 1 张可以直接盖骷髅
    g = placeFirst(g, "p3", "skull");
    g = placeFirst(g, "p2", "rose");
    expect(g.phase).toBe("placeInitial");
    expect(new Set(waitingFor(g))).toEqual(new Set(["p1", "p4"]));
    g = placeFirst(g, "p4", "rose");
    g = placeFirst(g, "p1", "rose");
    expect(g.phase).toBe("placeOrBid");
    expect(g.turn).toBe("p2");
    expect(totalDiscsInPlay(g)).toBe(4);
    for (const p of g.players) {
      expect(p.stack).toHaveLength(1);
      expect(p.hand).toHaveLength(3);
    }
    expect(P(g, "p3").stack[0]!.face).toBe("skull");
  });

  it("准备阶段：同一人不能盖第 2 张；不能开叫、不能 placeDisc；不能盖别人的垫子", () => {
    let g = startGame({ players: 3, first: "p1", seed: 4 });
    const p2Disc = handId(g, "p2", "rose");
    g = placeFirst(g, "p1", "rose");
    reject(g, "p1", { type: "placeFirst", discId: handId(g, "p1", "rose") });
    reject(g, "p2", { type: "placeDisc", discId: p2Disc });
    reject(g, "p2", open(1));
    reject(g, "p3", { type: "placeFirst", discId: p2Disc });
    reject(g, "p3", { type: "placeFirst", discId: "不存在" });
    expect(legalActions(g, "p1")).toEqual([]);
    expect(legalActions(g, "p2").every((c) => c.type === "placeFirst")).toBe(true);
    expect(legalActions(g, "p2")).toHaveLength(4);
  });

  it("补充 3.5(e)：进入轮流时每个存活玩家板上都至少 1 张，开叫 1 永远合法", () => {
    let g = startGame({ players: 5, first: "p4", seed: 9 });
    for (const p of ["p1", "p2", "p3", "p4", "p5"]) g = placeFirst(g, p, "rose");
    expect(g.phase).toBe("placeOrBid");
    for (const p of g.players) expect(p.stack.length).toBeGreaterThanOrEqual(1);
    expect(legalActions(g, "p4")).toContainEqual(open(1));
    const s = run(g, "p4", open(1));
    expect(s.phase).toBe("bidding");
  });
});
