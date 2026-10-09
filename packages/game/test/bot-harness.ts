/**
 * 人机自对弈 / 对基线的对局驱动（测试和 ~/projects/qa-reports/tools/bots/sim-skull.ts 共用）。
 * 每个策略只拿到 redactGameForViewer 的视角；命令不合法时 applyCommand 会抛错，记成问题。
 */
import { botPolicy, greedyPolicy, honestPolicy, randomPolicy } from "../src/bot-baselines.js";
import {
  advance,
  applyCommand,
  createGame,
  discCount,
  legalActions,
  needsAdvance,
  optionsToConfig,
  redactGameForViewer,
  waitingFor,
} from "../src/engine.js";
import { createRng } from "../src/rng.js";
import type { GameCommand, GameState } from "../src/types.js";

export type Policy = (view: GameState, me: string, random: () => number) => GameCommand | null;

export const POLICIES: Record<"bot" | "random" | "honest" | "greedy", Policy> = {
  bot: botPolicy,
  random: randomPolicy,
  honest: honestPolicy,
  greedy: greedyPolicy,
};

/** 一局最多走多少步（系统翻牌也算一步）。正常一局 6 人也就两三百步。 */
export const MAX_STEPS = 3000;

export interface GameResult {
  /** 赢家的座位下标（-1 = 没打完）。 */
  winner: number;
  reason: "twoWins" | "lastStanding" | null;
  rounds: number;
  /** 每个座位挑战成功几次、当挑战者几次、失败几次。 */
  successes: number[];
  challenges: number[];
  failures: number[];
  /** 每个座位的名次（1 最好，并列取平均）：赢家第 1；其余按「还在场 > 淘汰得晚」，在场的按花面、垫子数排。 */
  ranks: number[];
  steps: number;
  problems: string[];
  /** timeBot 座位每一步的耗时（毫秒，含裁剪视角）。 */
  botMs: number[];
}

export function playGame(policies: readonly Policy[], seed: number, options: { lastChance?: boolean; timeBot?: Policy } = {}): GameResult {
  const random = createRng(seed ^ 0x5bd1e995);
  let state = createGame(
    policies.map((_, index) => ({ id: `p${index + 1}`, name: `座位${index + 1}` })),
    seed,
    optionsToConfig({ lastChance: options.lastChance === true }),
  );
  const seatOf = (id: string) => Number(id.slice(1)) - 1;
  const successes = policies.map(() => 0);
  const challenges = policies.map(() => 0);
  const failures = policies.map(() => 0);
  const problems: string[] = [];
  const botMs: number[] = [];
  let steps = 0;
  outer: while (state.phase !== "gameOver") {
    if (steps > MAX_STEPS) {
      problems.push(`超过 ${MAX_STEPS} 步还没结束`);
      break;
    }
    if (needsAdvance(state)) {
      state = advance(state);
      steps += 1;
      continue;
    }
    const waiting = waitingFor(state);
    if (waiting.length === 0) {
      problems.push(`没人要行动也不用系统翻牌：${state.phase}`);
      break;
    }
    for (const actor of waiting) {
      if (!waitingFor(state).includes(actor)) continue;
      const policy = policies[seatOf(actor)]!;
      const started = performance.now();
      let command: GameCommand | null;
      try {
        command = policy(redactGameForViewer(state, actor), actor, () => random.next());
      } catch (error) {
        problems.push(`策略报错（${state.phase}）：${(error as Error).message}`);
        break outer;
      }
      if (policy === options.timeBot) botMs.push(performance.now() - started);
      if (!command) {
        problems.push(`轮到 ${actor} 却没给命令（${state.phase}）`);
        break outer;
      }
      if (!legalActions(state, actor).some((action) => JSON.stringify(action) === JSON.stringify(command))) {
        problems.push(`不在合法行动里：${actor} ${JSON.stringify(command)}（${state.phase}）`);
        break outer;
      }
      const before = state;
      try {
        state = applyCommand(state, actor, command);
      } catch (error) {
        problems.push(`不合法：${JSON.stringify(command)} → ${(error as Error).message}`);
        break outer;
      }
      steps += 1;
      if (state.phase === "gameOver" || state.round !== before.round) break;
    }
  }
  for (const log of [...state.history, state.roundLog]) {
    if (!log.challenger || !log.result) continue;
    const seat = seatOf(log.challenger);
    challenges[seat]! += 1;
    if (log.result === "success") successes[seat]! += 1;
    else failures[seat]! += 1;
  }
  const winnerId = state.winners[0];
  const score = (index: number) => {
    const player = state.players[index]!;
    if (player.id === winnerId) return 1e9;
    if (player.eliminated) return player.eliminatedRound ?? 0;
    return 1e6 + (player.flowerUp ? 10 : 0) + discCount(player);
  };
  const scores = state.players.map((_, index) => score(index));
  const ranks = scores.map((mine) => {
    const better = scores.filter((value) => value > mine).length;
    const same = scores.filter((value) => value === mine).length;
    return better + (same + 1) / 2;
  });
  return {
    winner: winnerId ? seatOf(winnerId) : -1,
    reason: state.result?.reason ?? null,
    rounds: state.round,
    successes,
    challenges,
    failures,
    ranks,
    steps,
    problems,
    botMs,
  };
}

export interface MatchResult {
  games: number;
  winRate: number;
  fair: number;
  avgRank: number;
  /** A 当挑战者的成功率、平均每局当几次挑战者。 */
  successRate: number;
  challengesPerGame: number;
  /** A 赢的局里靠两胜 / 靠活到最后的比例。 */
  twoWinsShare: number;
  avgRounds: number;
  problems: string[];
  botMs: number[];
}

/** 1 个 a 对 seats − 1 个 b，a 轮流坐每个座位；lastChance 为 "half" 时一半局开 Last Chance。 */
export function match(a: Policy, b: Policy, games: number, seats: number, seedBase = 1000, lastChance: boolean | "half" = "half"): MatchResult {
  let wins = 0;
  let twoWins = 0;
  let rankSum = 0;
  let succ = 0;
  let chal = 0;
  let rounds = 0;
  const problems: string[] = [];
  const botMs: number[] = [];
  for (let index = 0; index < games; index += 1) {
    const seat = index % seats;
    const policies = Array.from({ length: seats }, (_, k) => (k === seat ? a : b));
    const lc = lastChance === "half" ? Math.floor(index / seats) % 2 === 1 : lastChance;
    const result = playGame(policies, seedBase + index, { lastChance: lc, timeBot: a });
    problems.push(...result.problems);
    botMs.push(...result.botMs);
    if (result.winner === seat) {
      wins += 1;
      if (result.reason === "twoWins") twoWins += 1;
    }
    rankSum += result.ranks[seat]!;
    succ += result.successes[seat]!;
    chal += result.challenges[seat]!;
    rounds += result.rounds;
  }
  return {
    games,
    winRate: wins / games,
    fair: 1 / seats,
    avgRank: rankSum / games,
    successRate: chal > 0 ? succ / chal : 0,
    challengesPerGame: chal / games,
    twoWinsShare: wins > 0 ? twoWins / wins : 0,
    avgRounds: rounds / games,
    problems,
    botMs,
  };
}

export function timing(ms: readonly number[]): { avg: number; max: number; p99: number } {
  if (ms.length === 0) return { avg: 0, max: 0, p99: 0 };
  const sorted = [...ms].sort((x, y) => x - y);
  return {
    avg: ms.reduce((sum, value) => sum + value, 0) / ms.length,
    max: sorted.at(-1)!,
    p99: sorted[Math.floor(sorted.length * 0.99)]!,
  };
}
