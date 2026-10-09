// 陪玩脚本和抓包脚本共用的简单出牌策略（不是人机，只求能把一局打完、各种行动都走到）。
// 只看自己座位能看到的状态（服务器发来的就是裁剪过的）。
import { canRevealStack, legalActions, totalDiscsInPlay } from "../packages/game/dist/index.js";

const pick = (items) => items[Math.floor(Math.random() * items.length)];

/** 自己板上从顶往下连着几朵玫瑰（叫到这个数以内一定翻得过自己的）。 */
function safeOnTop(player) {
  let count = 0;
  for (let index = player.stack.length - 1; index >= 0; index -= 1) {
    if (player.stack[index].face !== "rose") break;
    count += 1;
  }
  return count;
}

export function chooseCommand(game, seat) {
  const actions = legalActions(game, seat);
  if (actions.length === 0) return null;
  const me = game.players.find((player) => player.id === seat);
  const total = totalDiscsInPlay(game);
  const safe = safeOnTop(me);
  switch (game.phase) {
    case "placeInitial": {
      const wantSkull = Math.random() < 0.25;
      const disc = me.hand.find((candidate) => !candidate.lastChance && candidate.face === (wantSkull ? "skull" : "rose")) ?? me.hand[0];
      return { type: "placeFirst", discId: disc.id };
    }
    case "placeOrBid": {
      const roses = me.hand.filter((disc) => disc.face === "rose" || disc.lastChance);
      if (roses.length > 0 && Math.random() < 0.45) return { type: "placeDisc", discId: pick(roses).id };
      if (safe >= 1 && Math.random() < 0.6) return { type: "openBid", count: Math.min(total, safe + (Math.random() < 0.3 ? 1 : 0)) };
      const places = actions.filter((action) => action.type === "placeDisc");
      if (places.length > 0 && Math.random() < 0.5) return pick(places);
      return { type: "openBid", count: 1 };
    }
    case "bidding":
      if (game.bid < safe) return { type: "raise", count: game.bid + 1 };
      if (game.bid + 1 <= total && Math.random() < 0.15) return { type: "raise", count: game.bid + 1 };
      return { type: "pass" };
    case "loseChoosing": {
      const roses = actions.filter((action) => me.hand.find((disc) => disc.id === action.discId)?.face === "rose");
      return roses[0] ?? actions[0];
    }
    case "roundEnd":
      if (canRevealStack(game, seat) && Math.random() < 0.35) return { type: "revealStack" };
      return { type: "nextRound" };
    default:
      return pick(actions);
  }
}
