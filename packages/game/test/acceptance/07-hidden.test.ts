/**
 * 规则书 §8.3 隐藏信息；补充 3.3 #6（垫子 id 不能泄露牌面）、3.3 #9（失牌结果只给挑战者，骷髅主人也不知道）、TC30。
 * 每个视角都拿不到：别人手里和板上没翻开的牌面和 id、别人失掉的是什么、种子和随机数状态。
 */
import { describe, expect, it } from "vitest";
import { buildGame, createGame, previewPlayers, redactGameForViewer, type GameState } from "../../src/index.js";
import { otherIds, placeFirst, randomGame, viewProblems } from "./_helpers.js";

describe("§8.3 每个视角的裁剪（TC30）", () => {
  it("TC30 开局和准备阶段：B 的视角里没有 A、C 任何一张垫子的牌面和 id；观战谁的都看不到", () => {
    let g = createGame(previewPlayers(3), 31);
    expect(viewProblems(g, "p2")).toEqual([]);
    g = placeFirst(g, "p1", "skull");
    g = placeFirst(g, "p3", "rose");
    for (const viewer of ["p1", "p2", "p3", ""]) expect(viewProblems(g, viewer)).toEqual([]);
    const b = redactGameForViewer(g, "p2");
    const json = JSON.stringify(b.players.filter((p) => p.id !== "p2"));
    expect(json).not.toMatch(/"face"/);
    expect(json).not.toMatch(/"id":"d/);
    // DiscPlaced 事件不带牌面和 id
    for (const e of b.events) expect(JSON.stringify(e)).not.toMatch(/face|discId/);
    expect(b.seed).toBeUndefined();
    expect(b.rngState).toBeUndefined();
    expect(b.log).toBeUndefined();
  });

  it("同一个公开局面、对手的暗牌不同 → 我的视角里对手部分完全一样（看不出差别）", () => {
    const mk = (p2stack: ("rose" | "skull")[]): GameState =>
      buildGame({ players: [{ stack: ["rose"] }, { stack: p2stack }, { stack: ["rose"] }], seed: 5, turn: "p1" });
    const views = [mk(["rose", "skull"]), mk(["skull", "rose"]), mk(["rose", "rose"])].map((g) => redactGameForViewer(g, "p1"));
    const strip = (v: GameState) => JSON.stringify({ others: v.players.slice(1), roundLog: v.roundLog, events: v.events, history: v.history });
    expect(strip(views[1]!)).toBe(strip(views[0]!));
    expect(strip(views[2]!)).toBe(strip(views[0]!));
  });

  it("观战看底牌（seeAll）：看得到每个人的牌面，看不到任何 id 和种子", () => {
    let g = createGame(previewPlayers(4), 8);
    g = placeFirst(g, "p1", "skull");
    g = placeFirst(g, "p2", "rose");
    const v = redactGameForViewer(g, "", { seeAll: true });
    for (const p of v.players) for (const d of [...p.hand, ...p.stack]) expect(d.face).toBeDefined();
    const json = JSON.stringify(v);
    for (const id of otherIds(g, "")) expect(json).not.toContain(`"${id}"`);
    expect(v.seed).toBeUndefined();
    expect(v.rngState).toBeUndefined();
  });
});

describe("检查器自检", () => {
  it("把没裁剪的完整状态当成 B 的视角，检查器必须报出 id、牌面、种子泄露", () => {
    let g = createGame(previewPlayers(3), 31);
    g = placeFirst(g, "p1", "skull");
    const problems = viewProblems(g, "p2", g);
    expect(problems.some((m) => m.includes("seed"))).toBe(true);
    expect(problems.some((m) => m.includes("带 id"))).toBe(true);
    expect(problems.some((m) => m.includes("没翻开却带牌面"))).toBe(true);
    expect(problems.some((m) => m.includes("手牌") && m.includes("带牌面"))).toBe(true);
  });
});

describe("随机整局逐步查泄露（3–6 人 × 每个视角 × 每一步）", () => {
  for (const n of [3, 4, 5, 6]) {
    for (const lastChance of [false, true]) {
      const games = n <= 4 ? 40 : 25;
      it(`${n} 人${lastChance ? "（Last Chance 开）" : ""}：${games} 局，每一步每个玩家视角和观战视角都没有泄露`, { timeout: 60_000 }, () => {
        const problems: string[] = [];
        for (let k = 0; k < games; k++) {
          const seed = 1000 * n + k + (lastChance ? 500 : 0);
          randomGame(n, seed, { lastChance, timeoutRate: 0.05 }, (g) => {
            if (problems.length > 20) return;
            for (const viewer of [...g.players.map((p) => p.id), ""]) {
              for (const msg of viewProblems(g, viewer)) problems.push(`种子 ${seed} 第 ${g.round} 轮 ${g.phase}：${msg}`);
            }
          });
        }
        expect(problems).toEqual([]);
      });
    }
  }
});
