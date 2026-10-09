import { describe, expect, it } from "vitest";
import {
  advanceWith,
  alivePlayers,
  apply,
  createGame,
  legalActions,
  needsAdvance,
  nextPlayer,
  redactGameForViewer,
  timeoutTurn,
  waitingFor,
} from "../src/engine.js";
import { checkInvariants } from "../src/invariants.js";
import { createRng, type Rng } from "../src/rng.js";
import { previewPlayers } from "../src/scenes.js";
import type { GameCommand, GameEvent, GameState, RoundLog } from "../src/types.js";

const GAMES_PER_COUNT = 300;
const MAX_STEPS = 4000;

interface Stats {
  games: number;
  steps: number;
  rounds: number;
  twoWins: number;
  lastStanding: number;
  reveals: number;
  lastChance: number;
  timeouts: number;
  selfEliminations: number;
  maxSteps: number;
}

/** 随机挑一个合法动作；加注时一半概率 pass，免得一直叫到顶。 */
function randomCommand(state: GameState, playerId: string, rng: Rng): GameCommand {
  const actions = legalActions(state, playerId);
  if (state.phase === "bidding" && rng.next() < 0.5) return { type: "pass" };
  if (state.phase === "placeOrBid" && rng.next() < 0.35) {
    const places = actions.filter((action) => action.type === "placeDisc");
    if (places.length > 0) return rng.pick(places);
  }
  if (state.phase === "roundEnd") {
    const reveal = actions.find((action) => action.type === "revealStack");
    if (reveal && rng.next() < 0.3) return reveal;
    return { type: "nextRound" };
  }
  return rng.pick(actions);
}

/** 公开信息里不该有的：别人没翻开垫子的牌面和 id、别人的 lost、种子。只做结构检查（快）。 */
function leakProblems(full: GameState, view: GameState, viewer: string): string[] {
  const problems: string[] = [];
  if (view.seed !== undefined || view.rngState !== undefined || view.log !== undefined) problems.push("种子或动作序列下发了");
  view.players.forEach((player, index) => {
    if (player.id === viewer) return;
    if (player.lost !== undefined) problems.push(`${viewer} 看得到 ${player.id} 失了什么`);
    for (const disc of player.hand) {
      if (disc.id !== undefined) problems.push(`${viewer} 看得到 ${player.id} 手里的 id`);
      if (!disc.lastChance && disc.face !== undefined) problems.push(`${viewer} 看得到 ${player.id} 手里的牌面`);
    }
    player.stack.forEach((disc, depth) => {
      if (disc.id !== undefined) problems.push(`${viewer} 看得到 ${player.id} 板上的 id`);
      if (!disc.revealed && !disc.lastChance && disc.face !== undefined) problems.push(`${viewer} 看得到 ${player.id} 没翻开的牌面`);
      if (disc.revealed && disc.face !== full.players[index]!.stack[depth]!.face) problems.push("翻开的牌面不对");
    });
    if (player.hand.length !== full.players[index]!.hand.length || player.stack.length !== full.players[index]!.stack.length) problems.push("张数不对");
  });
  for (const event of view.events) {
    if (event.type === "DiscLost" && event.player !== viewer && "face" in event) problems.push(`${viewer} 收到了别人失牌的牌面`);
  }
  return problems;
}

/** 一轮记录对不对：叫价单调上升、翻牌数 = 叫价（成功）或最后一张是骷髅（失败）。 */
function roundLogProblems(log: RoundLog): string[] {
  const problems: string[] = [];
  let last = 0;
  for (const bid of log.bids) {
    if (bid.type === "pass") continue;
    if (bid.count <= last) problems.push(`第 ${log.round} 轮叫价没有上升`);
    last = bid.count;
  }
  if (log.result === "success") {
    if (log.flips.length !== log.bid) problems.push(`第 ${log.round} 轮成功但翻了 ${log.flips.length} 张、叫 ${log.bid}`);
    if (log.flips.some((flip) => flip.face === "skull")) problems.push("成功却翻到了骷髅");
  }
  if (log.result === "fail") {
    if (log.flips.at(-1)?.face !== "skull") problems.push("失败但最后一张不是骷髅");
    if (log.flips.slice(0, -1).some((flip) => flip.face === "skull")) problems.push("翻到骷髅后还在翻");
    if (log.flips.length > log.bid) problems.push("翻的比叫价多");
    if (!log.loss || log.loss.player !== log.challenger) problems.push("失败了却没有挑战者失牌");
  }
  // 先翻自己的：挑战者自己的翻牌都在前面
  const challengerFlips = log.flips.map((flip) => flip.owner === log.challenger);
  const firstOther = challengerFlips.indexOf(false);
  if (firstOther >= 0 && challengerFlips.slice(firstOther).some(Boolean)) problems.push("翻了别人之后又翻自己的");
  if (firstOther >= 0 && log.challenger && challengerFlips.filter(Boolean).length !== log.stackSizes[log.challenger]) {
    problems.push("自己的没翻完就翻了别人的");
  }
  return problems;
}

function playRandomGame(count: number, seed: number, lastChance: boolean, stats: Stats): string[] {
  const problems: string[] = [];
  const rng = createRng(seed * 7919 + count);
  let state = createGame(previewPlayers(count), seed, { lastChance });
  const earned = new Map<string, number>();
  let steps = 0;
  const startProblems = checkInvariants(state);
  if (startProblems.length) return startProblems.map((problem) => `开局：${problem}`);

  while (state.phase !== "gameOver") {
    steps += 1;
    if (steps > MAX_STEPS) return [`${count} 人 种子 ${seed}：${MAX_STEPS} 步还没结束`];
    const before = state;
    const frozen = steps % 97 === 1 ? JSON.stringify(before) : null;
    const waiting = waitingFor(state);
    if (!needsAdvance(state) && waiting.length === 0) return [`${count} 人 种子 ${seed}：卡住了（没人要行动，也没有自动步骤）`];
    let events: GameEvent[] = [];
    let actor: string | null = null;
    let command: GameCommand | null = null;
    if (needsAdvance(state)) {
      const result = advanceWith(state, rng);
      state = result.state;
      events = result.events;
    } else if (rng.next() < 0.08) {
      state = timeoutTurn(state);
      events = state.events;
      stats.timeouts += 1;
    } else {
      actor = rng.pick(waiting);
      command = randomCommand(state, actor, rng);
      const legal = legalActions(before, actor);
      if (!legal.some((action) => JSON.stringify(action) === JSON.stringify(command))) problems.push(`挑出来的命令不在合法列表里：${JSON.stringify(command)}`);
      const result = apply(state, actor, command, rng);
      state = result.state;
      events = result.events;
    }
    if (frozen && JSON.stringify(before) !== frozen) problems.push("apply 改了输入");
    if (state.version <= before.version) problems.push("version 没前进");

    // 轮次推进
    if (state.round !== before.round) {
      if (state.round !== before.round + 1) problems.push("轮次跳了");
      if (state.history.length !== state.round - 1) problems.push("history 长度不对");
      problems.push(...roundLogProblems(state.history.at(-1)!));
      stats.rounds += 1;
      if (state.firstPlayer !== before.nextFirst) problems.push("下一轮先手不对");
    }
    // 轮流 / 加注：顺时针交给下一个
    if (actor && command && before.phase === "placeOrBid" && command.type === "placeDisc" && state.turn !== nextPlayer(before, actor)) problems.push("盖完没交给顺时针下一位");
    if (actor && command && state.phase === "bidding" && before.phase === "bidding") {
      const expected = nextPlayer(state, actor, (player) => !player.passed);
      if (state.turn !== expected) problems.push("加注阶段没交给下一个没 pass 的人");
    }
    for (const event of events) {
      if (event.type === "LastChanceEarned") {
        earned.set(event.player, (earned.get(event.player) ?? 0) + 1);
        if (earned.get(event.player)! > 1) problems.push(`${event.player} 拿了两次 Last Chance 碟`);
        stats.lastChance += 1;
      }
      if (event.type === "StackRevealed") stats.reveals += 1;
      if (event.type === "DiscLost" && (event.method === "forced" || event.method === "lastChance") && event.remaining === 0) stats.selfEliminations += 1;
    }
    problems.push(...checkInvariants(state).map((problem) => `${count} 人 种子 ${seed} 第 ${steps} 步：${problem}`));
    // 隐藏信息：随机抽一个视角查
    const viewer = state.players[steps % state.players.length]!.id;
    problems.push(...leakProblems(state, redactGameForViewer(state, viewer), viewer));
    if (steps % 5 === 0) problems.push(...leakProblems(state, redactGameForViewer(state, ""), ""));
    if (problems.length > 0) return problems.slice(0, 5);
  }

  // 终局判定
  const winner = state.players.find((player) => player.id === state.winners[0]);
  if (!winner || state.winners.length !== 1) return ["终局没有唯一的获胜者"];
  const logs = [...state.history, state.roundLog];
  problems.push(...roundLogProblems(state.roundLog));
  if (state.result?.reason === "twoWins") {
    stats.twoWins += 1;
    if (state.roundLog.challenger !== winner.id || state.roundLog.result !== "success" || !winner.flowerUp) problems.push("两次成功获胜的记录不对");
  } else {
    stats.lastStanding += 1;
    if (alivePlayers(state).length !== 1) problems.push("最后存活获胜但不止一人存活");
  }
  // 「分数」：花面 = 成功过（获胜的那次除外）
  for (const player of state.players) {
    const successes = logs.filter((log) => log.result === "success" && log.challenger === player.id).length;
    const expected = player.id === winner.id && state.result?.reason === "twoWins" ? 2 : player.flowerUp ? 1 : 0;
    if (successes !== expected) problems.push(`${player.id} 成功 ${successes} 次，但花面/获胜对不上`);
  }
  stats.games += 1;
  stats.steps += steps;
  stats.maxSteps = Math.max(stats.maxSteps, steps);
  return problems;
}

describe("随机对局：每种人数 300 局，随机走合法行动直到终局，逐步检查不变量", () => {
  for (const count of [3, 4, 5, 6]) {
    it(`${count} 人 ${GAMES_PER_COUNT} 局（一半开 Last Chance 碟）`, () => {
      const stats: Stats = { games: 0, steps: 0, rounds: 0, twoWins: 0, lastStanding: 0, reveals: 0, lastChance: 0, timeouts: 0, selfEliminations: 0, maxSteps: 0 };
      const failures: string[] = [];
      for (let seed = 1; seed <= GAMES_PER_COUNT; seed += 1) {
        const problems = playRandomGame(count, seed, seed % 2 === 0, stats);
        if (problems.length > 0) failures.push(...problems.map((problem) => `种子 ${seed}：${problem}`));
        if (failures.length > 10) break;
      }
      expect(failures).toEqual([]);
      expect(stats.games).toBe(GAMES_PER_COUNT);
      // 两种结束方式、亮牌、Last Chance 碟、超时都真的走到过
      expect(stats.twoWins).toBeGreaterThan(0);
      expect(stats.lastStanding).toBeGreaterThan(0);
      expect(stats.reveals).toBeGreaterThan(0);
      expect(stats.lastChance).toBeGreaterThan(0);
      expect(stats.timeouts).toBeGreaterThan(0);
      console.log(`${count} 人：${stats.games} 局，平均 ${(stats.steps / stats.games).toFixed(0)} 步 / ${(stats.rounds / stats.games).toFixed(1)} 轮，最长 ${stats.maxSteps} 步；两胜 ${stats.twoWins}、存活 ${stats.lastStanding}；亮牌 ${stats.reveals} 次，Last Chance ${stats.lastChance} 次，整步超时 ${stats.timeouts} 次`);
    }, 120_000);
  }

  it("全靠超时也能打完（没人操作时对局不会卡住）", () => {
    for (const count of [3, 4, 5, 6]) {
      for (let seed = 1; seed <= 40; seed += 1) {
        let state = createGame(previewPlayers(count), seed, { lastChance: seed % 2 === 0 });
        let steps = 0;
        while (state.phase !== "gameOver" && steps < MAX_STEPS) {
          const next = timeoutTurn(state);
          expect(next.version).toBeGreaterThan(state.version);
          state = next;
          steps += 1;
        }
        expect(state.phase).toBe("gameOver");
        expect(checkInvariants(state)).toEqual([]);
      }
    }
  }, 60_000);
});
