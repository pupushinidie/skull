/**
 * 测人机强度用的三个基线策略（补充文件 1.11）。只拿 redactGameForViewer 的视角，不从 index 导出。
 * - B0 随机：所有合法行动里随机（盖/开叫各一半、加注/pass 各一半，数字均匀）；
 * - B1 老实人：有玫瑰就盖玫瑰、从不主动盖骷髅；板上玫瑰 ≥ 2 或手里没玫瑰了就开叫自己板上的玫瑰数；只加注到自己板上的玫瑰数；翻板随机；失牌先丢骷髅；
 * - B2 固定概率贪心：每张对手垫子固定风险 0.25（同一块板相加）、门槛固定 0.5、准备阶段 25% 盖骷髅，其余照人机的打法。
 */
import { BOT_PARAMS, botCommand, botDecision, type BotParams } from "./bot.js";
import { legalActions } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";

type Random = () => number;

const pickOne = <T>(items: readonly T[], random: Random): T => items[Math.min(items.length - 1, Math.floor(random() * items.length))]!;

/** B0 随机。 */
export function randomPolicy(view: GameState, me: string, random: Random = Math.random): GameCommand | null {
  const actions = legalActions(view, me).filter((action) => action.type !== "revealStack");
  if (actions.length === 0) return null;
  if (view.phase === "roundEnd") return { type: "nextRound" };
  if (view.phase === "placeOrBid") {
    const places = actions.filter((action) => action.type === "placeDisc");
    const bids = actions.filter((action) => action.type === "openBid");
    if (places.length > 0 && (bids.length === 0 || random() < 0.5)) return pickOne(places, random);
    return pickOne(bids, random);
  }
  if (view.phase === "bidding") {
    const raises = actions.filter((action) => action.type === "raise");
    if (raises.length > 0 && random() < 0.5) return pickOne(raises, random);
    return { type: "pass" };
  }
  return pickOne(actions, random);
}

/** B1 老实人。 */
export function honestPolicy(view: GameState, me: string, random: Random = Math.random): GameCommand | null {
  const actions = legalActions(view, me);
  if (actions.length === 0) return null;
  const self = view.players.find((player) => player.id === me)!;
  const own = self.hand.filter((disc) => !disc.lastChance);
  const handRose = own.find((disc) => disc.face === "rose") ?? self.hand.find((disc) => disc.lastChance);
  const stackRoses = self.stack.filter((disc) => disc.face === "rose").length;
  switch (view.phase) {
    case "placeInitial":
      return { type: "placeFirst", discId: (handRose ?? own[0] ?? self.hand[0])!.id! };
    case "placeOrBid": {
      if (stackRoses >= 2 || !handRose) {
        const total = view.players.reduce((sum, player) => sum + player.stack.length, 0);
        return { type: "openBid", count: Math.max(1, Math.min(total, stackRoses)) };
      }
      return { type: "placeDisc", discId: handRose.id! };
    }
    case "bidding":
      return stackRoses > view.bid ? { type: "raise", count: view.bid + 1 } : { type: "pass" };
    case "loseChoosing": {
      const skull = self.hand.find((disc) => disc.face === "skull");
      return { type: "loseDisc", discId: (skull ?? own[0])!.id! };
    }
    case "roundEnd":
      return { type: "nextRound" };
    default:
      return pickOne(actions, random);
  }
}

/** B2 用的参数：固定风险、固定门槛、不看历史、准备阶段固定 25% 盖骷髅。 */
export const GREEDY_PARAMS: BotParams = {
  ...BOT_PARAMS,
  thresholds: { 4: 0.5, 3: 0.5, 2: 0.5, 1: 0.5 },
  flowerUpBonus: 0,
  lastChanceTheta: 0.5,
  skullFirst: { base: 0.25, oppFlower: 0, selfFlower: 0, twoLeft: 0 },
  // 补充 1.6 的原样打法：一格一格加，有人花面时 20% 跳；拦截门槛只降一点点，自己至少 2 张才拦
  jumpProb: 0,
  jumpFlower: 0.2,
  interceptK: 0.2,
  interceptMinDiscs: 2,
  risk: { ...BOT_PARAMS.risk, fixed: 0.25 },
  history: { ...BOT_PARAMS.history, enabled: false },
};

/** B2 固定概率贪心。 */
export function greedyPolicy(view: GameState, me: string, random: Random = Math.random): GameCommand | null {
  return botDecision(view, me, random, GREEDY_PARAMS)?.command ?? null;
}

/** 人机本身（对局驱动统一用这个签名）。 */
export function botPolicy(view: GameState, me: string, random: Random = Math.random): GameCommand | null {
  return botCommand(view, me, random);
}
