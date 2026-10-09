/**
 * 人机的「读牌」：只从 redactGameForViewer 之后的视角里推出每个对手的情况（补充文件 1.2、1.3）。
 *
 * - h：这个对手手里或板上还有骷髅的概率（从历史推：失牌、骷髅被翻出来、玫瑰全被翻开过）；
 * - 习惯系数：以前翻开过他多少张、里面几张是骷髅（老放骷髅的人风险高，从来不放的人风险低）；
 * - 本轮板上每张没翻开的垫子是骷髅的风险 r（从顶往下）：板上张数、最底那张（准备阶段盖的）权重大、
 *   他叫过价就把他声称翻得过的那几张风险压低、开叫后第一次轮到就 pass 稍微调高、Last Chance 碟风险 0；
 *   本轮已经翻开的玫瑰按条件概率把剩下几张的风险调高。
 * 同一块板上的风险相加（一个人最多一张骷髅），不同板之间相互独立。
 */
import { discCount, holdsLastChance } from "./engine.js";
import type { Face, GameState, Player, RoundLog, StackDisc } from "./types.js";

/** 风险模型的参数（BOT_PARAMS.risk）。 */
export interface RiskParams {
  /** 骷髅在板上的概率 m：板上 n 张时 min(mCap, mBase + mStep × (n − 1))；全盖出来了就是 1。 */
  readonly mBase: number;
  readonly mStep: number;
  readonly mCap: number;
  /** 最底那张（准备阶段盖的）的权重，其余每张 1。 */
  readonly bottomWeight: number;
  /** 他本轮叫到过 b：他最上面 min(b, n) 张的风险乘这个数。 */
  readonly claimFactor: number;
  /** 开叫后第一次轮到就 pass、板上 ≥ 2 张：每张乘这个数。 */
  readonly quickPassFactor: number;
  /** 每张风险的上限。 */
  readonly cap: number;
  /** 不为 null 时不用模型：每张没翻开的固定这个风险（基线 B2 用）。 */
  readonly fixed: number | null;
}

/** 历史推断的参数（BOT_PARAMS.history）。 */
export interface HistoryParams {
  readonly enabled: boolean;
  /** 他翻到自己的骷髅后自己挑一张丢：之后还剩 ≥ 2 张 / 只剩 1 张时，h 变成多少（多数人剩 2 张以上留骷髅、只剩 1 张留玫瑰）。 */
  readonly keepSkullMany: number;
  readonly keepSkullOne: number;
  /** 习惯系数 = (骷髅次数 + prior) / (翻开张数 × rate + prior)，夹在 [min, max]。 */
  readonly habitPrior: number;
  readonly habitRate: number;
  readonly habitMin: number;
  readonly habitMax: number;
  /** 叫价可信度 = (成功 + credPrior) / (成功 + credPrior + credSelf × 翻到自己骷髅的失败 + credOther × 其他失败)。 */
  readonly credPrior: number;
  readonly credSelf: number;
  readonly credOther: number;
}

export interface OpponentInfo {
  readonly id: string;
  readonly name: string;
  readonly player: Player;
  /** 一共几张自己的垫子（手里 + 板上，不含碟子）。 */
  readonly discs: number;
  /** 他还有骷髅的概率。 */
  readonly h: number;
  /** 习惯系数（1 = 一般）。 */
  readonly habit: number;
  /** 叫价可信度（1 = 完全相信他叫的那几张是玫瑰；老叫到自己骷髅上的人会掉下来）。 */
  readonly cred: number;
  /** 本轮叫到过的最高数（没叫过为 0）。 */
  readonly claim: number;
  /** 开叫后第一次轮到就 pass。 */
  readonly quickPass: boolean;
  /** 板上没翻开的垫子从顶往下的风险（下标 0 是下一张会被翻的）。 */
  readonly risks: number[];
  /** 板上没翻开的垫子从顶往下是不是 Last Chance 碟。 */
  readonly isLastChance: boolean[];
}

export interface Knowledge {
  readonly me: Player;
  readonly opponents: OpponentInfo[];
  /** 场上总数。 */
  readonly total: number;
  readonly alive: number;
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/** 开局每人几张。 */
function startDiscs(view: GameState): number {
  return view.config.roses + view.config.skulls;
}

/** 一轮里某人被翻开（挑战 + 自愿亮牌）的牌面，不含碟子。 */
function revealedFaces(log: RoundLog, playerId: string): Face[] {
  const flips = log.flips.filter((flip) => flip.owner === playerId && !flip.lastChance).map((flip) => flip.face);
  const reveals = log.reveals
    .filter((reveal) => reveal.player === playerId)
    .flatMap((reveal) => reveal.discs.filter((disc) => !disc.lastChance).map((disc) => disc.face));
  return [...flips, ...reveals];
}

/** 从打完的各轮推 h 和习惯（补充 1.2；加上「他的玫瑰全被翻开过 → 没骷髅了」这类条件概率）。 */
export function historyEstimate(view: GameState, playerId: string, params: HistoryParams): { h: number; habit: number; cred: number } {
  if (!params.enabled) return { h: 1, habit: 1, cred: 1 };
  let h = 1;
  let discs = startDiscs(view);
  let seen = 0;
  let skulls = 0;
  let good = 0;
  let selfFail = 0;
  let otherFail = 0;
  for (const log of view.history) {
    if (log.challenger === playerId && log.result) {
      if (log.result === "success") good += 1;
      else if (log.skullOwner === playerId) selfFail += 1;
      else otherFail += 1;
    }
    const faces = revealedFaces(log, playerId);
    seen += faces.length;
    const skullShown = faces.includes("skull");
    if (skullShown) {
      skulls += 1;
      h = 1;
    } else if (faces.length > 0 && discs > 0) {
      // 翻开的 k 张都是玫瑰：骷髅在剩下 discs − k 张里的概率按张数比例（k = discs 时就是没骷髅了）
      const k = Math.min(faces.length, discs);
      const keep = h * (discs - k) / discs;
      const norm = 1 - h * k / discs;
      h = norm > 1e-9 ? keep / norm : 0;
    }
    const loss = log.loss;
    if (loss && loss.player === playerId) {
      if (loss.method === "random") h *= (discs - 1) / discs;
      else if (loss.method === "chosen") h = discs - 1 >= 2 ? params.keepSkullMany : params.keepSkullOne;
      discs -= loss.count;
    }
  }
  const habit = clamp((skulls + params.habitPrior) / (seen * params.habitRate + params.habitPrior), params.habitMin, params.habitMax);
  const cred = (good + params.credPrior) / (good + params.credPrior + params.credSelf * selfFail + params.credOther * otherFail);
  return { h: clamp(h, 0, 1), habit, cred };
}

/** 本轮某人叫到过的最高数、是不是「开叫后第一次轮到就 pass」。 */
export function bidBehaviour(log: RoundLog, playerId: string): { claim: number; quickPass: boolean } {
  let claim = 0;
  const mine = log.bids.filter((bid) => bid.player === playerId);
  for (const bid of mine) if (bid.type !== "pass") claim = Math.max(claim, bid.count);
  const quickPass = mine.length === 1 && mine[0]!.type === "pass";
  return { claim, quickPass };
}

/**
 * 一块对手板上每张没翻开的垫子的风险（从顶往下）。
 * stack 是视角里他的板（从底到顶，翻开的带牌面）；discs 是他一共几张自己的垫子。
 */
export function boardRisks(
  stack: readonly StackDisc[],
  discs: number,
  h: number,
  habit: number,
  cred: number,
  claim: number,
  quickPass: boolean,
  params: RiskParams,
): { risks: number[]; isLastChance: boolean[] } {
  const positions = stack.map((disc, depth) => ({ disc, depth }));
  const unrevealedTopDown = positions.filter((entry) => !entry.disc.revealed).reverse();
  if (params.fixed !== null) {
    return {
      risks: unrevealedTopDown.map((entry) => (entry.disc.lastChance ? 0 : params.fixed!)),
      isLastChance: unrevealedTopDown.map((entry) => entry.disc.lastChance === true),
    };
  }
  const own = positions.filter((entry) => !entry.disc.lastChance);
  const n = own.length;
  const base = new Map<number, number>();
  if (n > 0) {
    const m = n >= discs ? 1 : Math.min(params.mCap, params.mBase + params.mStep * (n - 1));
    const weightOf = (depth: number) => (depth === 0 ? params.bottomWeight : 1);
    const weightSum = own.reduce((sum, entry) => sum + weightOf(entry.depth), 0);
    const claimed = Math.min(claim, stack.length);
    for (const entry of own) {
      let risk = h * habit * m * weightOf(entry.depth) / weightSum;
      if (stack.length - entry.depth <= claimed) risk *= 1 - cred * (1 - params.claimFactor);
      if (quickPass && n >= 2) risk *= params.quickPassFactor;
      base.set(entry.depth, Math.min(params.cap, risk));
    }
  }
  // 本轮已经翻开的都是玫瑰（翻到骷髅这一轮就结束了）：剩下的按条件概率放大
  let revealedRisk = 0;
  for (const entry of own) if (entry.disc.revealed) revealedRisk += base.get(entry.depth) ?? 0;
  const scale = revealedRisk > 0 ? 1 / Math.max(0.05, 1 - revealedRisk) : 1;
  let risks = unrevealedTopDown.map((entry) => (entry.disc.lastChance ? 0 : Math.min(params.cap, (base.get(entry.depth) ?? 0) * scale)));
  const sum = risks.reduce((total, risk) => total + risk, 0);
  if (sum > 0.97) risks = risks.map((risk) => risk * 0.97 / sum);
  return { risks, isLastChance: unrevealedTopDown.map((entry) => entry.disc.lastChance === true) };
}

export function buildKnowledge(view: GameState, me: string, risk: RiskParams, history: HistoryParams): Knowledge {
  const self = view.players.find((player) => player.id === me);
  if (!self) throw new Error("人机不在这局里。");
  const opponents: OpponentInfo[] = [];
  for (const player of view.players) {
    if (player.id === me || player.eliminated) continue;
    const discs = discCount(player);
    const { h, habit, cred } = historyEstimate(view, player.id, history);
    const { claim, quickPass } = bidBehaviour(view.roundLog, player.id);
    const board = boardRisks(player.stack, discs, h, habit, cred, claim, quickPass, risk);
    opponents.push({ id: player.id, name: player.name, player, discs, h, habit, cred, claim, quickPass, ...board });
  }
  return {
    me: self,
    opponents,
    total: view.players.reduce((sum, player) => sum + player.stack.length, 0),
    alive: view.players.filter((player) => !player.eliminated).length,
  };
}

/** 一块板翻最上面 k 张都安全的概率（同一块板风险相加）。 */
export function safeTop(risks: readonly number[], k: number): number {
  let sum = 0;
  for (let index = 0; index < k; index += 1) sum += risks[index] ?? 1;
  return Math.max(0, 1 - sum);
}

/**
 * 从几块板上一共翻 x 张都安全的最大概率，和对应的每块板各翻几张（补充 1.4 第 2 条的枚举，用动态规划做，结果一样）。
 * boards 里每项是一块板从顶往下的风险。
 */
export function bestAllocation(boards: readonly (readonly number[])[], x: number): { p: number; take: number[] } {
  if (x <= 0) return { p: 1, take: boards.map(() => 0) };
  // best[i][t]：前 i 块板一共翻 t 张的最大安全概率
  const best: number[][] = [Array.from({ length: x + 1 }, (_, t) => (t === 0 ? 1 : 0))];
  const choice: number[][] = [];
  boards.forEach((risks, index) => {
    const prev = best[index]!;
    const row = Array.from({ length: x + 1 }, () => 0);
    const pick = Array.from({ length: x + 1 }, () => 0);
    for (let t = 0; t <= x; t += 1) {
      for (let k = 0; k <= Math.min(risks.length, t); k += 1) {
        const value = prev[t - k]! * safeTop(risks, k);
        if (value > row[t]!) {
          row[t] = value;
          pick[t] = k;
        }
      }
    }
    best.push(row);
    choice.push(pick);
  });
  const p = best[boards.length]![x]!;
  const take = boards.map(() => 0);
  let t = x;
  for (let index = boards.length - 1; index >= 0; index -= 1) {
    take[index] = choice[index]![t]!;
    t -= take[index]!;
  }
  return { p, take };
}

/** 我自己板上：从顶往下第几张是骷髅（1 起；没有骷髅为 0）。只看没翻开的。 */
export function ownSkullDepth(me: Player): number {
  const topDown = [...me.stack].filter((disc) => !disc.revealed).reverse();
  const index = topDown.findIndex((disc) => disc.face === "skull");
  return index < 0 ? 0 : index + 1;
}

/** 我这一轮拿着 Last Chance 碟。 */
export function meHoldsLastChance(view: GameState, me: Player): boolean {
  return holdsLastChance(view, me);
}
