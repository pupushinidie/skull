/**
 * 人机自对弈：3–6 人各 300 局（一半开 Last Chance），每一步都合法、不死循环、决策够快；
 * 每个决定都顺手查补充 1.12 的蠢错（叫到自己骷髅那一层、把骷髅叠到自己玫瑰上、2→1 留骷髅）和理由文案；
 * 再对随机和固定概率贪心各打一组，确认明显强于平均。完整强度数字用 ~/projects/qa-reports/tools/bots/sim-skull.ts 跑。
 */
import { describe, expect, it } from "vitest";
import { botDecision } from "../src/bot.js";
import { ownSkullDepth } from "../src/bot-knowledge.js";
import type { GameState } from "../src/types.js";
import { MAX_STEPS, POLICIES, match, playGame, timing, type Policy } from "./bot-harness.js";

/** 带检查的人机：每个决定都查一遍，有问题记进 problems（不打断对局）。 */
function checkedBot(problems: string[]): Policy {
  return (view: GameState, me: string, random: () => number) => {
    const decision = botDecision(view, me, random);
    if (!decision) return null;
    const { command, reason } = decision;
    const self = view.players.find((player) => player.id === me)!;
    if (!reason || /undefined|NaN/.test(reason)) problems.push(`理由不对：${reason}`);
    const depth = ownSkullDepth(self);
    const total = view.players.reduce((sum, player) => sum + player.stack.length, 0);
    const discs = [...self.hand, ...self.stack].filter((disc) => !disc.lastChance).length;
    if ((command.type === "openBid" || command.type === "raise") && depth > 0 && command.count >= depth) {
      const forced = command.type === "openBid" && self.hand.length === 0 && depth === 1 && command.count === 1;
      const bluff = /冒险唬人/.test(reason) && discs >= 3 && command.count < total;
      if (!forced && !bluff) problems.push(`蠢错 1：骷髅在第 ${depth} 张还叫 ${command.count}（${reason}）`);
    }
    if ((command.type === "openBid" || command.type === "raise") && command.count === total && depth > 0) problems.push("蠢错 2：板上有骷髅还叫到场上总数");
    if (command.type === "placeDisc" && self.stack.length > 0) {
      const disc = self.hand.find((candidate) => candidate.id === command.discId);
      const rosesLeft = self.hand.filter((candidate) => candidate.face === "rose" && candidate.id !== command.discId && !candidate.lastChance).length;
      if (disc?.face === "skull" && !disc.lastChance && (rosesLeft === 0 || !/盖在中间/.test(reason))) problems.push("蠢错 4：把骷髅叠到自己玫瑰上又没法盖住");
    }
    if (depth === 1 && self.hand.some((disc) => disc.face === "rose") && command.type === "openBid") problems.push("蠢错 4：骷髅在顶上、手里还有玫瑰却去开叫");
    // 给真人的提示（random=0.99）从不唬人、不装弱
    const hint = botDecision(view, me, () => 0.99);
    if (hint && /冒险唬人|装弱|盖在中间/.test(hint.reason)) problems.push(`提示教人冒险：${hint.reason}`);
    if (command.type === "loseDisc" && self.hand.filter((disc) => !disc.lastChance).length === 2) {
      const disc = self.hand.find((candidate) => candidate.id === command.discId);
      if (disc?.face !== "skull") problems.push("蠢错 3：2→1 失牌留了骷髅");
    }
    return command;
  };
}

describe("人机自对弈", () => {
  for (const seats of [3, 4, 5, 6]) {
    it(`${seats} 人 300 局（一半开 Last Chance）：每步合法、不超过 ${MAX_STEPS} 步、没有蠢错、平均 < 50ms 最慢 < 300ms`, () => {
      const problems: string[] = [];
      const bot = checkedBot(problems);
      const ms: number[] = [];
      let maxSteps = 0;
      let finished = 0;
      for (let index = 0; index < 300; index += 1) {
        const result = playGame(Array.from({ length: seats }, () => bot), 70_000 + seats * 1000 + index, { lastChance: index % 2 === 1, timeBot: bot });
        problems.push(...result.problems);
        ms.push(...result.botMs);
        maxSteps = Math.max(maxSteps, result.steps);
        if (result.winner >= 0) finished += 1;
      }
      const t = timing(ms);
      expect(problems).toEqual([]);
      expect(finished).toBe(300);
      expect(maxSteps).toBeLessThan(MAX_STEPS);
      expect(t.avg).toBeLessThan(50);
      expect(t.max).toBeLessThan(300);
    }, 60_000);
  }
});

describe("人机强度（简版，完整数字见 sim-skull.ts）", () => {
  it("3 人局 1 个人机对 2 个随机：胜率明显高于 1/3", () => {
    const result = match(POLICIES.bot, POLICIES.random, 300, 3, 9100);
    expect(result.problems).toEqual([]);
    expect(result.winRate).toBeGreaterThan(0.48);
  }, 60_000);

  it("3 人局 1 个人机对 2 个老实人、2 个固定概率贪心：胜率都 > 60%", () => {
    for (const base of ["honest", "greedy"] as const) {
      const result = match(POLICIES.bot, POLICIES[base], 300, 3, 9200);
      expect(result.problems).toEqual([]);
      expect(result.winRate).toBeGreaterThan(0.6);
    }
  }, 60_000);

  it("5 人局 1 个人机对 4 个随机：胜率明显高于 1/5", () => {
    const result = match(POLICIES.bot, POLICIES.random, 300, 5, 9300);
    expect(result.problems).toEqual([]);
    expect(result.winRate).toBeGreaterThan(0.3);
  }, 60_000);
});
