/**
 * 规则核对（背靠背）用的小工具。
 * 只用 packages/game 的对外接口（index.ts 导出的函数和预览局面工厂），不读引擎实现。
 */
import { expect } from "vitest";
import {
  advanceWith,
  apply,
  createGame,
  createRng,
  legalActions,
  previewPlayers,
  timeoutTurn,
  waitingFor,
  discCount,
  findPlayer,
  needsAdvance,
  redactGameForViewer,
  type Disc,
  type Face,
  type GameCommand,
  type GameState,
  type Player,
} from "../../src/index.js";

/** 每次给一个新的固定种子随机数（只有随机失牌、超时随机盖才用得到）。 */
export const rng = (seed = 12345) => createRng(seed);

/** 执行一条命令，返回新状态。 */
export function run(state: GameState, playerId: string, command: GameCommand, seed = 12345): GameState {
  return apply(state, playerId, command, rng(seed)).state;
}

/** 依次执行几条命令。 */
export function runAll(state: GameState, steps: readonly [string, GameCommand][]): GameState {
  let s = state;
  for (const [p, c] of steps) s = run(s, p, c);
  return s;
}

/** 这条命令必须被拒绝（抛错），并且不改输入状态。 */
export function reject(state: GameState, playerId: string, command: GameCommand): void {
  const before = JSON.stringify(state);
  expect(() => apply(state, playerId, command, rng()), `${playerId} ${JSON.stringify(command)} 应该被拒绝`).toThrow();
  expect(JSON.stringify(state)).toBe(before);
}

/** 系统把挑战者自己的垫子翻到底（翻到要选板、翻到骷髅或翻满为止）。 */
export function autoAll(state: GameState): GameState {
  let s = state;
  let guard = 0;
  while (needsAdvance(s)) {
    s = advanceWith(s, rng()).state;
    if (++guard > 50) throw new Error("自动翻牌停不下来");
  }
  return s;
}

export function P(state: GameState, id: string): Player {
  const p = findPlayer(state, id);
  if (!p) throw new Error(`没有玩家 ${id}`);
  return p;
}

export const open = (count: number): GameCommand => ({ type: "openBid", count });
export const raise = (count: number): GameCommand => ({ type: "raise", count });
export const pass: GameCommand = { type: "pass" };
export const flip = (player: string): GameCommand => ({ type: "flipMat", player });
export const ready: GameCommand = { type: "nextRound" };

/** 某人手里第一张指定牌面的垫子 id（不含 Last Chance 碟）。 */
export function handId(state: GameState, playerId: string, face: Face): string {
  const d = P(state, playerId).hand.find((x) => x.face === face && !x.lastChance);
  if (!d?.id) throw new Error(`${playerId} 手里没有 ${face}`);
  return d.id;
}

export const placeFirst = (state: GameState, p: string, face: Face): GameState =>
  run(state, p, { type: "placeFirst", discId: handId(state, p, face) });
export const placeDisc = (state: GameState, p: string, face: Face): GameState =>
  run(state, p, { type: "placeDisc", discId: handId(state, p, face) });

/** 牌面计数。 */
export function countFaces(discs: readonly Disc[]): { rose: number; skull: number; lastChance: number } {
  let rose = 0;
  let skull = 0;
  let lastChance = 0;
  for (const d of discs) {
    if (d.lastChance) lastChance++;
    else if (d.face === "rose") rose++;
    else if (d.face === "skull") skull++;
  }
  return { rose, skull, lastChance };
}

/** 结算画面所有存活玩家点继续。 */
export function readyAll(state: GameState): GameState {
  let s = state;
  for (const p of s.players) {
    if (s.phase !== "roundEnd") break;
    if (!p.eliminated && !P(s, p.id).ready) s = run(s, p.id, ready);
  }
  return s;
}

/** 一个玩家一共几张（不含碟子）。 */
export const total = (state: GameState, id: string) => discCount(P(state, id));

/** 所有不是 viewer 的玩家的垫子 id（完整状态里）。 */
export function otherIds(full: GameState, viewer: string): string[] {
  const ids: string[] = [];
  for (const p of full.players) {
    if (p.id === viewer) continue;
    for (const d of [...p.hand, ...p.stack]) if (d.id && !d.lastChance) ids.push(d.id);
  }
  return ids;
}

/**
 * 检查某个视角的裁剪结果（规则书 §8.3、补充 3.3 #6 #9）：
 * - 种子、随机数状态、动作序列不下发；
 * - 别人手里的垫子：没有 id、没有牌面（Last Chance 碟除外，牌面公开）；
 * - 别人板上没翻开的：没有 id、没有牌面（碟子除外）；翻开的：牌面和真实一致，没有 id；
 * - 别人的 lost（失掉的牌面）不下发；事件里别人的 DiscLost 不带 face；
 * - 自己的垫子 id、牌面完整。
 * 返回发现的问题（空 = 没问题）。viewer 为 "" 表示观战。viewOverride 只给检查器自检用（喂一个没裁剪的状态，必须报错）。
 */
export function viewProblems(full: GameState, viewer: string, viewOverride?: GameState): string[] {
  const view = viewOverride ?? redactGameForViewer(full, viewer);
  const out: string[] = [];
  const json = JSON.stringify(view);
  if ("seed" in view && view.seed !== undefined) out.push("下发了 seed");
  if ("rngState" in view && view.rngState !== undefined) out.push("下发了 rngState");
  if ("log" in view && view.log !== undefined) out.push("下发了 log");
  for (const id of otherIds(full, viewer)) if (json.includes(`"${id}"`)) out.push(`别人的垫子 id ${id} 出现在 ${viewer || "观战"} 的视角里`);
  full.players.forEach((fp, i) => {
    const vp = view.players[i]!;
    if (vp.hand.length !== fp.hand.length) out.push(`${fp.id} 手牌张数不一致`);
    if (vp.stack.length !== fp.stack.length) out.push(`${fp.id} 板上张数不一致`);
    if (fp.id === viewer) {
      fp.hand.forEach((d, k) => {
        if (vp.hand[k]?.id !== d.id || vp.hand[k]?.face !== d.face) out.push(`自己(${viewer})手牌 ${k} 不完整`);
      });
      fp.stack.forEach((d, k) => {
        if (vp.stack[k]?.id !== d.id || vp.stack[k]?.face !== d.face) out.push(`自己(${viewer})板上 ${k} 不完整`);
      });
      return;
    }
    vp.hand.forEach((d, k) => {
      if (d.id !== undefined) out.push(`${fp.id} 手牌 ${k} 带 id`);
      if (d.lastChance) {
        if (d.face !== "rose") out.push(`${fp.id} 手里的碟子牌面不公开`);
      } else if (d.face !== undefined) out.push(`${fp.id} 手牌 ${k} 带牌面`);
    });
    vp.stack.forEach((d, k) => {
      const real = fp.stack[k]!;
      if (d.id !== undefined) out.push(`${fp.id} 板上 ${k} 带 id`);
      if (d.revealed !== real.revealed) out.push(`${fp.id} 板上 ${k} revealed 不一致`);
      if (real.revealed || real.lastChance) {
        if (d.face !== real.face) out.push(`${fp.id} 板上 ${k} 翻开的牌面不对`);
      } else if (d.face !== undefined) out.push(`${fp.id} 板上 ${k} 没翻开却带牌面`);
    });
    if (vp.lost !== undefined) out.push(`${fp.id} 的 lost 下发给了 ${viewer || "观战"}`);
  });
  for (const e of view.events) {
    if (e.type === "DiscLost" && e.player !== viewer && e.face !== undefined) out.push(`${viewer || "观战"} 看到了 ${e.player} 失掉的牌面`);
    if ("discId" in e) out.push(`事件 ${e.type} 带 discId`);
  }
  return out;
}

/**
 * 随机打一局：每一步要么系统自动翻牌，要么从 waitingFor 里随机挑一个人、从他的 legalActions 里随机挑一条命令；
 * timeoutRate 的概率改成「这一步到点」（timeoutTurn）。每一步之后调 onStep。返回终局状态和步数。
 * 只用对外接口，自己判断有没有卡住（不靠引擎的不变量检查）。
 */
export function randomGame(
  n: number,
  seed: number,
  opts: { lastChance?: boolean; timeoutRate?: number; maxSteps?: number },
  onStep: (state: GameState, prev: GameState) => void,
): { state: GameState; steps: number } {
  const r = createRng(seed);
  let g = createGame(previewPlayers(n), seed, { lastChance: opts.lastChance ?? false });
  const max = opts.maxSteps ?? 5000;
  let steps = 0;
  while (g.phase !== "gameOver") {
    if (++steps > max) throw new Error(`种子 ${seed}：${max} 步还没结束`);
    const prev = g;
    if (needsAdvance(g)) {
      g = advanceWith(g, r).state;
    } else if (r.next() < (opts.timeoutRate ?? 0)) {
      g = timeoutTurn(g);
    } else {
      const waiting = waitingFor(g);
      if (waiting.length === 0) throw new Error(`种子 ${seed}：${g.phase} 阶段没人要做决定，也不用系统自动翻（卡住）`);
      const p = r.pick(waiting);
      const acts = legalActions(g, p);
      if (acts.length === 0) throw new Error(`种子 ${seed}：等 ${p} 做决定，但他没有合法行动（卡住）`);
      g = apply(g, p, r.pick(acts), r).state;
    }
    onStep(g, prev);
  }
  return { state: g, steps };
}
