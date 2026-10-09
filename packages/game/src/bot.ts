/**
 * 骷髅牌人机「普通」难度（补充文件第一节）。
 *
 * 输入只能是 redactGameForViewer(game, playerId) 裁剪后的状态：拿到看得见别人牌面的完整状态会直接报错。
 *
 * 思路（大白话）：
 * 1. 读牌（bot-knowledge.ts）：每个对手还有没有骷髅（h）、他板上每张是骷髅的风险——板上越多越可能藏着骷髅，
 *    最底那张最危险，他自己叫过价的那几张多半是玫瑰；以前老翻出他骷髅的人风险高，从来不放骷髅的人风险低。
 * 2. 叫价：算「叫 b 能翻满的概率」——自己板上全是玫瑰时先吃掉自己的，剩下的在各块对手板之间分配（同一块板风险相加，
 *    不同板相乘，取最好的分法）；自己板上有骷髅时最多叫到骷髅上面那几张，绝不叫到骷髅那一层。
 *    概率 ≥ 门槛就敢叫。门槛按自己还剩几张定（4 张 0.45 … 1 张 0.80），差一胜就赢整局时降 0.10，拿着 Last Chance 碟时 0.80。
 * 3. 盖牌：准备阶段约三成盖骷髅（有人花面时多些、自己花面或只剩两张时少些），盖了骷髅就往上叠玫瑰、开一个低价当诱饵；
 *    板上玫瑰够了就稳稳开叫自己的张数；手里只剩骷髅就开叫，不把骷髅叠到自己玫瑰上。
 * 4. 加注：能叫得更高就加 1；领先的人（花面）叫价时门槛再降 0.10 去拦他，但他非得翻我这块有骷髅的板时就放他过去踩。
 * 5. 当挑战者：每一步都选「先翻这块，之后还能凑够的成功率最高」的板，Last Chance 碟先翻，刚叫过价的人先翻，少往一块板底下挖。
 * 6. 失牌（自己的骷髅）：剩得多时丢玫瑰留骷髅；只剩两张时丢骷髅留玫瑰；差一胜时 3 → 2 也丢骷髅。
 * 7. 自己把自己淘汰时，把先手给离赢最远的人。结算画面只点继续，从不亮牌。
 * 每一步都给一句第二人称的理由（教程「提示」按钮直接用）。理由会提到自己板上 / 手里的牌面，只能给这个座位自己看。
 */
import {
  bestAllocation,
  bidBehaviour,
  boardRisks,
  buildKnowledge,
  meHoldsLastChance,
  ownSkullDepth,
  safeTop,
  type HistoryParams,
  type Knowledge,
  type OpponentInfo,
  type RiskParams,
} from "./bot-knowledge.js";
import { discCount, legalActions, nextPlayer } from "./engine.js";
import type { EmoteId } from "./roomTypes.js";
import type { Disc, GameCommand, GameState, Player } from "./types.js";

/** 可调的参数（以后「调弱一点」就改这里）。 */
export const BOT_PARAMS = {
  /** 叫价门槛：按自己一共还剩几张（手里 + 板上，不含碟子）。 */
  thresholds: { 4: 0.45, 3: 0.55, 2: 0.65, 1: 0.8 } as Record<number, number>,
  /** 自己已经花面（再赢一次就赢整局）：门槛降多少。 */
  flowerUpBonus: 0.1,
  /** 拿着 Last Chance 碟的那一轮（失败直接淘汰）的门槛。 */
  lastChanceTheta: 0.8,
  /** 拦截领先者（他花面、他叫价最高）：门槛降 interceptK × 「我 pass 后他翻得过的概率」；自己至少要有几张才拦。 */
  interceptK: 0.8,
  /** 拦截时门槛最低降到多少（再低就是白送垫子）。 */
  interceptFloor: 0.15,
  interceptMinDiscs: 1,
  /** 拦截时直接跳到能叫的最高数（1）还是只加 1（0）的概率。 */
  interceptJump: 0,
  /** 准备阶段盖骷髅的概率：基础、有对手花面、自己花面、自己只剩 2 张。 */
  skullFirst: { base: 0.2, oppFlower: 0.2, selfFlower: -0.15, twoLeft: -0.1 },
  /** 已经可以稳开叫时，改成再盖一张玫瑰的概率（别太好猜）。 */
  stableMore: 0.25,
  /** 诱饵（骷髅上面已有玫瑰）可以开叫时，改成再叠一张玫瑰的概率。 */
  baitMore: 0.3,
  /**
   * 加注时直接跳到自己能叫的最高数（而不是只加 1）的概率：有人花面时 / 平时。
   * 自对弈测过：跳到最高数让别人没法便宜地再加，比一格一格加强很多（对只加 1 的老版本 3 人局胜率 73%）。
   */
  jumpFlower: 1,
  jumpProb: 0.8,
  risk: {
    mBase: 0.3,
    mStep: 0.15,
    mCap: 0.85,
    bottomWeight: 1.5,
    claimFactor: 0.3,
    quickPassFactor: 1.2,
    cap: 0.95,
    fixed: null,
  } as RiskParams,
  history: {
    enabled: true,
    keepSkullMany: 0.85,
    keepSkullOne: 0.4,
    habitPrior: 1,
    habitRate: 0.2,
    habitMin: 0.6,
    habitMax: 1.6,
    credPrior: 2,
    credSelf: 2,
    credOther: 0.5,
  } as HistoryParams,
};

export type BotParams = typeof BOT_PARAMS;

export interface BotDecision {
  readonly command: GameCommand;
  /** 一句玩家听得懂的理由（第二人称）。会提到自己的牌面，只给这个座位自己看。 */
  readonly reason: string;
}

const pct = (p: number) => `${Math.round(p * 100)}%`;

/** 视角里能看到别人没翻开的牌面 → 不是裁剪过的状态。 */
function assertRedacted(view: GameState, me: string): void {
  if (view.seed !== undefined || view.rngState !== undefined || view.log !== undefined) {
    throw new Error("人机只能看裁剪后的状态（redactGameForViewer）。");
  }
  for (const player of view.players) {
    if (player.id === me) continue;
    const hidden = [...player.hand, ...player.stack.filter((disc) => !disc.revealed)];
    if (hidden.some((disc: Disc) => !disc.lastChance && (disc.face !== undefined || disc.id !== undefined))) {
      throw new Error("人机只能看裁剪后的状态（redactGameForViewer）。");
    }
  }
}

interface Ctx {
  readonly view: GameState;
  readonly me: Player;
  readonly know: Knowledge;
  readonly params: BotParams;
  readonly random: () => number;
  readonly myDiscs: number;
  readonly lastChance: boolean;
  /** 自己板上（没翻开的）从顶往下第几张是骷髅，0 = 没有。 */
  readonly skullDepth: number;
  readonly theta: number;
}

function makeCtx(view: GameState, me: string, params: BotParams, random: () => number): Ctx {
  const know = buildKnowledge(view, me, params.risk, params.history);
  const self = know.me;
  const myDiscs = discCount(self);
  const lastChance = meHoldsLastChance(view, self);
  const base = params.thresholds[Math.min(4, Math.max(1, myDiscs))] ?? 0.5;
  const theta = lastChance ? params.lastChanceTheta : base - (self.flowerUp ? params.flowerUpBonus : 0);
  return { view, me: self, know, params, random, myDiscs, lastChance, skullDepth: ownSkullDepth(self), theta };
}

/** 叫 b 能翻满的概率（我来当挑战者）。 */
function bidChance(ctx: Ctx, b: number): number {
  if (ctx.skullDepth > 0) return b <= ctx.skullDepth - 1 ? 1 : 0;
  const s = ctx.me.stack.length;
  if (b <= s) return 1;
  return bestAllocation(ctx.know.opponents.map((opponent) => opponent.risks), b - s).p;
}

/** 满足「成功率 ≥ theta」的最大叫价（没有为 0）。 */
function maxBid(ctx: Ctx, theta: number): number {
  let best = 0;
  for (let b = 1; b <= ctx.know.total; b += 1) {
    if (bidChance(ctx, b) >= theta) best = b;
    else break;
  }
  return best;
}

/** 叫 b 时要从谁那里翻（给理由用）：最好分法里每块对手板翻几张。 */
function bidPlan(ctx: Ctx, b: number): string {
  const s = ctx.me.stack.length;
  if (ctx.skullDepth > 0 || b <= s) return "";
  const { take } = bestAllocation(ctx.know.opponents.map((opponent) => opponent.risks), b - s);
  return ctx.know.opponents
    .map((opponent, index) => ({ opponent, k: take[index] ?? 0 }))
    .filter((entry) => entry.k > 0)
    .map((entry) => `${entry.opponent.name} ${entry.k} 张`)
    .join("、");
}

function ownHand(me: Player): Disc[] {
  return me.hand.filter((disc) => !disc.lastChance);
}

function findFace(me: Player, face: "rose" | "skull"): Disc | undefined {
  return ownHand(me).find((disc) => disc.face === face);
}

// ---------------------------------------------------------------- 各阶段

function decidePlaceInitial(ctx: Ctx): BotDecision {
  const { me, params, random } = ctx;
  const rose = findFace(me, "rose");
  const skull = findFace(me, "skull");
  if (!rose && !skull) {
    // 只剩碟子（不会发生：持碟时手里一定还有自己的一张），兜底
    return { command: { type: "placeFirst", discId: me.hand[0]!.id! }, reason: "只剩这一张，盖上。" };
  }
  if (ctx.lastChance && me.hand.some((disc) => disc.lastChance)) {
    const disc = (rose ?? skull)!;
    return {
      command: { type: "placeFirst", discId: disc.id! },
      reason: `先盖你自己的那张${disc.face === "rose" ? "玫瑰" : "骷髅"}；碟子大家都知道是玫瑰，留着待会儿再盖。`,
    };
  }
  if (!skull) return { command: { type: "placeFirst", discId: rose!.id! }, reason: "你手里只有玫瑰，盖一张玫瑰。" };
  if (!rose) return { command: { type: "placeFirst", discId: skull.id! }, reason: "你只剩一张骷髅，只能盖它。" };
  const oppFlower = ctx.know.opponents.some((opponent) => opponent.player.flowerUp);
  let p = params.skullFirst.base;
  if (oppFlower) p += params.skullFirst.oppFlower;
  if (me.flowerUp) p += params.skullFirst.selfFlower;
  if (ctx.myDiscs === 2) p += params.skullFirst.twoLeft;
  if (random() < p) {
    return {
      command: { type: "placeFirst", discId: skull.id! },
      reason: oppFlower
        ? "有人已经花面了，这轮在最底下垫一张骷髅防他：谁想翻够叫价，就可能踩到它。"
        : "这轮在最底下垫一张骷髅当陷阱：上面再叠玫瑰、叫个低价，等别人来翻。",
    };
  }
  return { command: { type: "placeFirst", discId: rose.id! }, reason: "先盖玫瑰，给自己留着赢这一轮的机会。" };
}

function openBid(count: number, reason: string): BotDecision {
  return { command: { type: "openBid", count }, reason };
}

function decidePlaceOrBid(ctx: Ctx): BotDecision {
  const { me, params, random, know } = ctx;
  const hand = ownHand(me);
  const lcInHand = me.hand.find((disc) => disc.lastChance);
  const roses = hand.filter((disc) => disc.face === "rose");
  const skull = hand.find((disc) => disc.face === "skull");
  const d = ctx.skullDepth;
  const s = me.stack.length;

  // Last Chance 碟：盖上去等于自己多一张安全的玫瑰
  if (lcInHand) {
    return {
      command: { type: "placeDisc", discId: lcInHand.id! },
      reason: d > 0
        ? "把碟子盖在你的骷髅上面：开叫 1 只翻碟子就够，谁要叫得更高就可能踩到你的骷髅。"
        : "把碟子也盖上：你板上就有 2 张稳稳的玫瑰，可以开叫 2。",
    };
  }

  // 手里没垫子：必须开叫
  if (me.hand.length === 0) {
    if (d > 0) {
      const count = Math.max(1, d - 1);
      return openBid(
        count,
        d === 1
          ? "手里没牌了必须开叫；你顶上就是骷髅，只能叫最小的 1，指望有人加注来翻。"
          : `手里没牌了必须开叫；骷髅上面有 ${d - 1} 张玫瑰，叫 ${count} 只翻到玫瑰为止，千万别叫到 ${d}。`,
      );
    }
    return openBid(s, `手里没牌了必须开叫；你板上 ${s} 张都是玫瑰，叫 ${s} 一定翻得过。`);
  }

  if (d > 0) {
    const k = d - 1;
    if (k >= 1) {
      if (roses.length > 0 && random() < params.baitMore) {
        return { command: { type: "placeDisc", discId: roses[0]!.id! }, reason: "骷髅上面再叠一张玫瑰：诱饵更像真的，你能稳叫的数也多一张。" };
      }
      return openBid(k, `你底下盖的是骷髅、上面 ${k} 张玫瑰：开叫 ${k}，被放过就赢；有人加注就可能踩到你的骷髅。千万别叫到 ${d}。`);
    }
    if (roses.length > 0) {
      return { command: { type: "placeDisc", discId: roses[0]!.id! }, reason: "在骷髅上面叠一张玫瑰，之后开叫 1 当诱饵。" };
    }
    return openBid(1, "你顶上是骷髅，只能叫最小的 1。");
  }

  // 板上全是玫瑰
  const stable = s >= 2 || (s >= 1 && know.total >= 2 * know.alive);
  if (stable) {
    if (roses.length > 0 && random() < params.stableMore) {
      return { command: { type: "placeDisc", discId: roses[0]!.id! }, reason: `再盖一张玫瑰：你板上就有 ${s + 1} 张稳的，叫价的底气更足。` };
    }
    const count = Math.max(1, Math.min(s, maxBid(ctx, ctx.theta)));
    return openBid(count, `你板上 ${s} 张都是玫瑰，叫 ${count} 一定翻得过。`);
  }
  if (roses.length > 0) {
    return { command: { type: "placeDisc", discId: roses[0]!.id! }, reason: "再盖一张玫瑰，给自己多一张翻起来一定安全的。" };
  }
  // 手里只剩骷髅：不要把骷髅叠在自己的玫瑰上（那样这一轮自己就赢不了了）
  const count = Math.max(1, s);
  return openBid(count, `手里只剩骷髅，别叠到自己的玫瑰上；你板上 ${s} 张玫瑰，开叫 ${count}。`);
}

/**
 * 我 pass 之后，叫价最高的那位（leader）当挑战者能翻满的概率（我的估计）：
 * 他自己的按我对他板上的风险估计；还要翻别人的，就按他看我的板（一般人的风险）挑最好的分法，
 * 我这块板用真实牌面算（翻到我的骷髅就失败）。
 */
function leaderSuccess(ctx: Ctx, leader: OpponentInfo): number {
  const bid = ctx.view.bid;
  const own = safeTop(leader.risks, Math.min(bid, leader.risks.length));
  const need = bid - leader.player.stack.length;
  if (need <= 0) return own;
  const others = ctx.know.opponents.filter((opponent) => opponent.id !== leader.id);
  const { claim, quickPass } = bidBehaviour(ctx.view.roundLog, ctx.me.id);
  const myPublic = ctx.me.stack.map((disc) => ({ revealed: disc.revealed, ...(disc.lastChance ? { lastChance: true as const } : {}) }));
  const mySeen = boardRisks(myPublic, discCount(ctx.me), 1, 1, 1, claim, quickPass, ctx.params.risk).risks;
  const boards = [...others.map((opponent) => opponent.risks), mySeen];
  const plan = bestAllocation(boards, need);
  if (plan.p <= 0) return 0;
  let p = own;
  others.forEach((opponent, index) => {
    p *= safeTop(opponent.risks, plan.take[index] ?? 0);
  });
  const mine = plan.take[boards.length - 1] ?? 0;
  if (ctx.skullDepth > 0 && mine >= ctx.skullDepth) p = 0;
  return p;
}

function decideBidding(ctx: Ctx): BotDecision {
  const { view, params, random, know } = ctx;
  const bid = view.bid;
  const myMax = maxBid(ctx, ctx.theta);
  const leader = know.opponents.find((opponent) => opponent.id === view.bidder);
  const anyFlower = know.opponents.some((opponent) => opponent.player.flowerUp);
  if (myMax > bid) {
    let target = bid + 1;
    if (myMax >= bid + 2 && random() < (anyFlower ? params.jumpFlower : params.jumpProb)) target = myMax;
    const p = bidChance(ctx, target);
    const plan = bidPlan(ctx, target);
    const reason = p >= 0.999
      ? `你自己板上的就够翻 ${target} 张，加到 ${target} 稳赢这一手。`
      : target > bid + 1
        ? `直接加到你能叫的最高数 ${target}，别人就没法便宜地再加（还要翻${plan}，成功率约 ${pct(p)}）。`
        : `加到 ${target}：翻完自己的还要翻${plan}，成功率约 ${pct(p)}，值得。`;
    return { command: { type: "raise", count: target }, reason };
  }
  if (leader && leader.player.flowerUp && ctx.myDiscs >= params.interceptMinDiscs) {
    const q = leaderSuccess(ctx, leader);
    const stretch = maxBid(ctx, Math.max(params.interceptFloor, ctx.theta - params.interceptK * q));
    if (stretch > bid) {
      const target = stretch >= bid + 2 && random() < params.interceptJump ? stretch : bid + 1;
      return {
        command: { type: "raise", count: target },
        reason: `${leader.name}已经花面，大家都 pass 他就可能赢整局（他翻得过的可能约 ${pct(q)}）；加到 ${target} 拦住他（你的成功率约 ${pct(bidChance(ctx, target))}）。`,
      };
    }
    if (ctx.skullDepth > 0 && q < 0.25) {
      return { command: { type: "pass" }, reason: `${leader.name}已经花面，但他要翻够 ${bid} 张多半得翻到你的骷髅，pass，让他来踩。` };
    }
  }
  const next = bid + 1;
  if (ctx.skullDepth > 0 && next >= ctx.skullDepth) {
    return { command: { type: "pass" }, reason: `再加就要翻到你自己的骷髅（从顶往下第 ${ctx.skullDepth} 张），pass。` };
  }
  const p = bidChance(ctx, next);
  let deep: OpponentInfo | undefined;
  if (ctx.skullDepth === 0 && next > ctx.me.stack.length && next <= know.total) {
    const { take } = bestAllocation(know.opponents.map((opponent) => opponent.risks), next - ctx.me.stack.length);
    deep = know.opponents.find((opponent, index) => opponent.risks.length >= 2 && take[index] === opponent.risks.length);
  }
  const reason = deep
    ? `再加到 ${next} 成功率只有约 ${pct(p)}，就得翻到${deep.name}板底那张了，风险太大，pass。`
    : `再加到 ${next} 成功率只有约 ${pct(p)}，不划算，pass。`;
  return { command: { type: "pass" }, reason };
}

function decideFlip(ctx: Ctx): BotDecision | null {
  const { view, know } = ctx;
  const x = view.flipsToDo;
  const boards = know.opponents.filter((opponent) => opponent.risks.length > 0);
  if (boards.length === 0) return null;
  let best: { opponent: OpponentInfo; value: number; top: number } | null = null;
  for (const opponent of boards) {
    const top = opponent.risks[0]!;
    const rest = opponent.risks.slice(1).map((risk) => (top < 1 ? risk / (1 - top) : 1));
    const others = boards.map((candidate) => (candidate.id === opponent.id ? rest : candidate.risks));
    const value = (1 - top) * bestAllocation(others, x - 1).p;
    if (!best || value > best.value + 1e-9 || (Math.abs(value - best.value) <= 1e-9 && top < best.top - 1e-9)) {
      best = { opponent, value, top };
    }
  }
  const { opponent, value, top } = best!;
  const allNeeded = boards.reduce((sum, candidate) => sum + candidate.risks.length, 0) === x;
  let reason: string;
  if (opponent.isLastChance[0]) reason = `${opponent.name}顶上是 Last Chance 碟，明牌玫瑰，白送一张，先翻它。`;
  else if (allNeeded) reason = `剩下的每张都得翻，先翻风险最低的：${opponent.name}顶上那张（是骷髅的可能约 ${pct(top)}）。`;
  else if (opponent.claim > opponent.player.stack.filter((disc) => disc.revealed).length) reason = `${opponent.name}叫到过 ${opponent.claim}，他顶上的多半是玫瑰，先翻他的（这样翻完的成功率约 ${pct(value)}）。`;
  else if (opponent.risks.length === 1) reason = `${opponent.name}板上只剩 1 张没翻，翻他的，不用往别人板底下挖（成功率约 ${pct(value)}）。`;
  else reason = `先翻${opponent.name}顶上那张：是骷髅的可能约 ${pct(top)}；宁可每块板翻顶上的，也别往一块板底下挖。`;
  return { command: { type: "flipMat", player: opponent.id }, reason };
}

function decideLose(ctx: Ctx): BotDecision {
  const hand = ownHand(ctx.me);
  const rose = hand.find((disc) => disc.face === "rose");
  const skull = hand.find((disc) => disc.face === "skull");
  const before = hand.length;
  const loseRose = (reason: string): BotDecision => ({ command: { type: "loseDisc", discId: rose!.id! }, reason });
  const loseSkull = (reason: string): BotDecision => ({ command: { type: "loseDisc", discId: skull!.id! }, reason });
  if (!skull) return loseRose("你手里只有玫瑰了，丢一张玫瑰。");
  if (!rose) return loseSkull("你手里只有骷髅了，只能丢它。");
  if (before <= 2) return loseSkull("只剩两张时丢骷髅、留玫瑰：只剩一张骷髅的人每轮都得开叫，被放过就翻到自己的骷髅出局，永远赢不了挑战。");
  if (before === 3 && ctx.me.flowerUp) return loseSkull("你已经花面了，差一胜：丢骷髅、留 2 张玫瑰，下一轮全力冲。");
  return loseRose(
    before === 3
      ? "丢一张玫瑰，留 1 骷髅 1 玫瑰：骷髅是防守和唬人的本钱，玫瑰还够自己翻。"
      : "丢一张玫瑰，留着骷髅：骷髅是防守和唬人的本钱，剩下 2 张玫瑰也够自己翻。",
  );
}

function decideChooseFirst(ctx: Ctx): BotDecision | null {
  const { view, me } = ctx;
  const order: Player[] = [];
  let cursor = me.id;
  for (let index = 0; index < view.players.length; index += 1) {
    const nextId = nextPlayer(view, cursor);
    if (!nextId || order.some((player) => player.id === nextId)) break;
    order.push(view.players.find((player) => player.id === nextId)!);
    cursor = nextId;
  }
  if (order.length === 0) return null;
  const score = (player: Player) => (player.flowerUp ? 10 : 0) + discCount(player);
  let pick = order[0]!;
  for (const player of order) if (score(player) < score(pick)) pick = player;
  const why = pick.flowerUp ? "大家都已经花面了，按顺序" : `${pick.name}还没赢过、垫子也最少`;
  return {
    command: { type: "chooseFirstPlayer", player: pick.id },
    reason: `先手第一个就能开叫，给领先的人等于帮他；${why}，让他先手。`,
  };
}

// ---------------------------------------------------------------- 对外

/**
 * 人机这一步怎么走、为什么。view 必须是 redactGameForViewer(game, playerId) 的结果（拿到完整状态会报错）。
 * 轮不到它（或者整局结束）时返回 null。结算画面只点继续，从不亮牌。
 */
export function botDecision(view: GameState, playerId: string, random: () => number = Math.random, params: BotParams = BOT_PARAMS): BotDecision | null {
  assertRedacted(view, playerId);
  const actions = legalActions(view, playerId);
  if (actions.length === 0) return null;
  if (view.phase === "roundEnd") return { command: { type: "nextRound" }, reason: "看完结算，点继续。" };
  const ctx = makeCtx(view, playerId, params, random);
  switch (view.phase) {
    case "placeInitial":
      return decidePlaceInitial(ctx);
    case "placeOrBid":
      return decidePlaceOrBid(ctx);
    case "bidding":
      return decideBidding(ctx);
    case "resolving":
      return decideFlip(ctx);
    case "loseChoosing":
      return decideLose(ctx);
    case "chooseFirst":
      return decideChooseFirst(ctx);
    default:
      return null;
  }
}

/** 人机这一步的命令（服务器、托管、离线代打用）。 */
export function botCommand(view: GameState, playerId: string, random: () => number = Math.random): GameCommand | null {
  return botDecision(view, playerId, random)?.command ?? null;
}

/**
 * 教程「提示」按钮：真人座位的视角里，人机会怎么走、为什么（返回 { command, reason }）。
 * 理由会提到自己板上 / 手里的牌面，只在本人浏览器里算、只给本人看。
 */
export function botHint(view: GameState, playerId: string, random: () => number = Math.random): BotDecision | null {
  return botDecision(view, playerId, random);
}

/**
 * 人机要不要发个快捷表情（提议，服务器默认没接）：只看这一步的事件，偶尔发一个，不刷屏。
 * - 自己挑战成功：35% 发「笑」或「玫瑰」；
 * - 别人翻到了自己的骷髅：40% 发「骷髅」或「挑衅」；
 * - 自己挑战失败：25% 发「流汗」或「摊手」。
 * 其余时候返回 null。只给纯人机座位用（托管、离线的真人不替他发）；服务器照常走 sendEmote 的限频。
 */
export function botEmote(view: GameState, playerId: string, random: () => number = Math.random): EmoteId | null {
  for (const event of view.events) {
    if (event.type === "ChallengeSucceeded" && event.challenger === playerId) {
      return random() < 0.35 ? (random() < 0.5 ? "laugh" : "rose") : null;
    }
    if (event.type === "ChallengeFailed") {
      if (event.skullOwner === playerId && event.challenger !== playerId) return random() < 0.4 ? (random() < 0.5 ? "skull" : "taunt") : null;
      if (event.challenger === playerId) return random() < 0.25 ? (random() < 0.5 ? "sweat" : "shrug") : null;
    }
  }
  return null;
}
