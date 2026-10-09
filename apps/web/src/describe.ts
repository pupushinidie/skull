/**
 * 文案：提示条、中央的结算句子、动作记录。用玩家听得懂的话，不用内部术语。
 */
import { totalDiscsInPlay, waitingFor, type GameEvent, type GameState, type Player } from "@skull/game";

export type NameOf = (playerId: string | null | undefined) => string;

/** 名字当主语：别人的名字后面空一格（「老K 开叫」），「你」不空（「你开叫」）。 */
export function subj(name: string): string {
  return name === "你" ? name : `${name} `;
}

export function makeNameOf(game: GameState, selfId: string): NameOf {
  return (playerId) => {
    if (!playerId) return "?";
    if (playerId === selfId) return "你";
    return game.players.find((player) => player.id === playerId)?.name ?? "?";
  };
}

/** 提示条的一句话（轮到谁、该做什么）。 */
export function promptText(game: GameState, selfId: string, spectating: boolean, nameOf: NameOf): { text: string; mine: boolean } {
  const me = game.players.find((player) => player.id === selfId);
  const waiting = waitingFor(game);
  const mine = !spectating && waiting.includes(selfId);
  switch (game.phase) {
    case "gameOver":
      return { text: `${nameOf(game.winners[0])}${game.winners[0] === selfId ? "赢了！" : " 获胜"}`, mine: false };
    case "placeInitial": {
      if (mine) return { text: "轮到你：挑一张垫子扣着盖上（大家同时盖）", mine };
      const left = waiting.length;
      return { text: left > 0 ? `大家同时盖第 1 张…还有 ${left} 人没盖` : "大家都盖好了", mine };
    }
    case "placeOrBid":
      if (mine) return { text: me && me.hand.length > 0 ? "轮到你：再盖一张，或者开叫" : "轮到你：手里没垫子了，只能开叫", mine };
      return { text: `轮到 ${nameOf(game.turn)}：盖一张，或者开叫`, mine };
    case "bidding":
      if (mine) return { text: `轮到你：加注（比 ${game.bid} 大），或者过`, mine };
      return { text: `轮到 ${nameOf(game.turn)}：加注，或者过`, mine };
    case "resolving":
      if (!game.awaitingMatChoice) return { text: `${subj(nameOf(game.challenger))}先翻自己板上的…还差 ${game.flipsToDo} 张`, mine: false };
      if (mine) return { text: `点一块亮起来的板，翻开最上面那张（还差 ${game.flipsToDo} 张）`, mine };
      return { text: `${subj(nameOf(game.challenger))}在挑要翻谁的板（还差 ${game.flipsToDo} 张）`, mine };
    case "loseChoosing":
      if (mine) return { text: "你翻到了自己的骷髅：挑一张丢掉（只有你知道丢的是什么）", mine };
      return { text: `${subj(nameOf(game.challenger))}翻到了自己的骷髅，正在挑一张丢掉`, mine };
    case "chooseFirst":
      if (mine) return { text: "你出局了：指定下一轮谁先手", mine };
      return { text: `${subj(nameOf(game.challenger))}出局了，正在指定下一轮谁先手`, mine };
    case "roundEnd": {
      const log = game.roundLog;
      const head = log.result === "success" ? `${subj(nameOf(log.challenger))}挑战成功！` : `${subj(nameOf(log.challenger))}挑战失败`;
      return { text: head, mine };
    }
  }
}

/** 结算画面中央的两句话：结果 + 后果。 */
export function roundResult(game: GameState, selfId: string, nameOf: NameOf): { title: string; detail: string; lostFace?: "rose" | "skull" } {
  const log = game.phase === "gameOver" ? game.roundLog : game.roundLog;
  const challenger = log.challenger;
  if (log.result === "success") {
    const player = game.players.find((candidate) => candidate.id === challenger);
    const won = game.phase === "gameOver";
    return {
      title: `${subj(nameOf(challenger))}翻满 ${log.bid} 张，全是玫瑰！`,
      detail: won ? "第二次成功，赢下整局" : player?.flowerUp ? "垫板翻到花面，再成功一次就赢" : "成功",
    };
  }
  const skull = log.skullOwner === challenger ? "自己的骷髅" : ` ${subj(nameOf(log.skullOwner))}的骷髅`;
  const loss = log.loss;
  let detail = "";
  let lostFace: "rose" | "skull" | undefined;
  if (loss) {
    const how = { chosen: "自己挑了一张丢掉", forced: "丢掉了最后一张", random: "被随机拿走一张", lastChance: "连同 Last Chance 碟一起失去" }[loss.method];
    detail = `${subj(nameOf(loss.player))}${how}${loss.eliminated ? "，出局" : ""}`;
    if (loss.player === selfId) {
      const me = game.players.find((player) => player.id === selfId);
      lostFace = me?.lost?.[me.lost.length - 1];
    }
  } else if (game.phase === "loseChoosing") {
    detail = challenger === selfId ? "挑一张丢掉，别人只看到你少了一张" : `${subj(nameOf(challenger))}正在挑一张丢掉`;
  }
  if (log.lastChanceEarned) detail += `；${subj(nameOf(log.lastChanceEarned))}只剩 1 张，下一轮多拿一张 Last Chance 碟`;
  return { title: `${subj(nameOf(challenger))}翻到${skull}！`, detail, ...(lostFace ? { lostFace } : {}) };
}

/** 中央的「还要翻」那一句。 */
export function resolvingText(game: GameState, nameOf: NameOf): string {
  return `${subj(nameOf(game.challenger))}要翻 ${game.roundLog.bid || game.bid} 张 · 还差 ${game.flipsToDo} 张`;
}

/** 叫 N 时要翻几张自己的、几张别人的；会不会翻到自己的骷髅。 */
export function bidPreview(me: Player | undefined, count: number): { text: string; danger: boolean } {
  if (!me) return { text: "", danger: false };
  const own = me.stack.length;
  // 自己的骷髅在从上往下第几张（1 = 最上面）
  let skullDepth = 0;
  for (let index = me.stack.length - 1; index >= 0; index -= 1) {
    if (me.stack[index]!.face === "skull") {
      skullDepth = me.stack.length - index;
      break;
    }
  }
  if (skullDepth > 0 && count >= skullDepth) return { text: `叫 ${count} 会翻到你自己的骷髅！最多叫 ${skullDepth - 1}`, danger: true };
  if (count <= own) return { text: `叫 ${count}：只翻你自己板上的 ${count} 张`, danger: false };
  return { text: `叫 ${count}：先翻你自己的 ${own} 张，再翻别人 ${count - own} 张`, danger: false };
}

export function totalText(game: GameState): number {
  return totalDiscsInPlay(game);
}

/** 动作记录里的一句（null = 不记）。 */
export function describeEvent(event: GameEvent, nameOf: NameOf): string | null {
  switch (event.type) {
    case "RoundStarted":
      return `第 ${event.round} 轮开始，${subj(nameOf(event.firstPlayer))}先手`;
    case "LastChanceGiven":
      return `${subj(nameOf(event.player))}拿到 Last Chance 碟（公开的玫瑰）`;
    case "DiscPlaced":
      return event.initial ? null : `${subj(nameOf(event.player))}又盖了一张${event.lastChance ? "（Last Chance 碟）" : ""}，板上 ${event.stackSize} 张`;
    case "PlacementDone":
      return "大家都盖好了第 1 张";
    case "BidOpened":
      return `${subj(nameOf(event.player))}开叫 ${event.count}`;
    case "BidRaised":
      return `${subj(nameOf(event.player))}加到 ${event.count}`;
    case "Passed":
      return `${subj(nameOf(event.player))}过`;
    case "ChallengeStarted":
      return `${subj(nameOf(event.challenger))}当挑战者，要翻 ${event.bid} 张`;
    case "DiscRevealed":
      return `翻开 ${subj(nameOf(event.owner))}的一张：${event.lastChance ? "Last Chance 碟（玫瑰）" : event.face === "rose" ? "玫瑰" : "骷髅！"}`;
    case "ChallengeSucceeded":
      return event.won ? `${subj(nameOf(event.challenger))}第二次成功，赢了！` : `${subj(nameOf(event.challenger))}挑战成功，垫板翻到花面`;
    case "ChallengeFailed":
      return `${subj(nameOf(event.challenger))}翻到${event.selfSkull ? "自己" : ` ${subj(nameOf(event.skullOwner))}`}的骷髅，失败`;
    case "DiscLost": {
      const how = { chosen: "自己挑了一张丢掉", forced: "丢掉了最后一张", random: "被随机拿走一张", lastChance: "连同 Last Chance 碟一起失去" }[event.method];
      const face = event.face ? `（${event.face === "rose" ? "玫瑰" : "骷髅"}，只有你看得到）` : "";
      return `${subj(nameOf(event.player))}${how}${face}，还剩 ${event.remaining} 张`;
    }
    case "PlayerEliminated":
      return `${subj(nameOf(event.player))}出局`;
    case "LastChanceEarned":
      return `${subj(nameOf(event.player))}只剩 1 张，下一轮拿 Last Chance 碟`;
    case "FirstPlayerChosen":
      return `${subj(nameOf(event.by))}指定 ${subj(nameOf(event.player))}下一轮先手${event.auto ? "（超时自动）" : ""}`;
    case "RoundEnded":
      return null;
    case "StackRevealed":
      return `${subj(nameOf(event.player))}亮出垫子：${event.discs.map((disc) => (disc.lastChance ? "碟" : disc.face === "rose" ? "玫瑰" : "骷髅")).join("、")}`;
    case "PlayerReady":
      return null;
    case "GameEnded":
      return `${subj(nameOf(event.winner))}获胜（${event.reason === "twoWins" ? "成功两次" : "活到最后"}）`;
    case "TimedOut":
      return `${subj(nameOf(event.player))}超时，系统替${nameOf(event.player) === "你" ? "你" : "他"}走了一步`;
  }
}

/** 本轮叫价链（侧栏）。 */
export function bidChain(game: GameState, nameOf: NameOf): string[] {
  return game.roundLog.bids.map((bid) => (bid.type === "pass" ? `${subj(nameOf(bid.player))}过` : `${subj(nameOf(bid.player))}${bid.type === "open" ? "开叫" : "加到"} ${bid.count}`));
}

/** 名牌上的最近一次叫价。 */
export function lastBidOf(game: GameState, playerId: string): string | undefined {
  for (let index = game.roundLog.bids.length - 1; index >= 0; index -= 1) {
    const bid = game.roundLog.bids[index]!;
    if (bid.player !== playerId) continue;
    return bid.type === "pass" ? "过" : `叫 ${bid.count}`;
  }
  return undefined;
}
