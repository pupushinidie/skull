import { legalActions } from "./engine.js";
import type { GameCommand, GameState } from "./types.js";

/**
 * 人机占位（引擎阶段放的）：从合法行动里随机挑一个；结算画面只点「继续」，从不亮牌。
 * 人机阶段会把这里换成正式策略（「普通」难度），接口不变：
 *   botCommand(view, playerId) —— view 必须是 redactGameForViewer(game, playerId) 之后的状态；
 *   不该它做决定时返回 null。
 */
export function botCommand(state: GameState, playerId: string, random: () => number = Math.random): GameCommand | null {
  const actions = legalActions(state, playerId).filter((action) => action.type !== "revealStack");
  if (actions.length === 0) return null;
  if (state.phase === "roundEnd") return { type: "nextRound" };
  return actions[Math.floor(random() * actions.length)]!;
}
