/**
 * 骷髅牌和教程有关的部分（共用的教练层之外，每款游戏自己写的）：游戏 id、「提示」怎么说、「第一次遇到」小贴士什么时候出。
 * 欲罢不能放在 src/tutorialGame.ts；骷髅牌的教程文件都收在 src/tutorial/ 里。
 */
import { botHint, canRevealStack, findPlayer, redactGameForViewer, type GameCommand, type GameState } from "@skull/game";

/** 本机记录（gm-tutorial-<id>、gm-tips-<id>）用的游戏 id。 */
export const GAME_ID = "skull";

export interface Hint {
  readonly say: string;
  readonly note?: string;
  /** 高亮哪里（data-tutorial）；null 不指。 */
  readonly anchor: string | null;
}

/**
 * 「提示」：让人机从你的位置算一步（它只看你看得到的信息），说它会怎么走、为什么。
 * 随机数固定传 0.99：永远不建议冒险唬人（人机交接报告），同一个局面问两次说法也一样。
 * 理由里会提到你自己盖了什么，只给你自己看。
 */
export function hintFor(game: GameState, playerId: string): Hint {
  if (game.phase === "gameOver") return { say: "这一局已经结束了。", anchor: null };
  const me = findPlayer(game, playerId);
  if (!me) return { say: "你在观战。", anchor: null };
  const decision = botHint(redactGameForViewer(game, playerId), playerId, () => 0.99);
  if (!decision) return { say: "现在不用你做什么，等别人。", anchor: null };
  return { say: describe(game, playerId, decision.command), note: decision.reason, anchor: anchorOf(game, playerId, decision.command) };
}

function describe(game: GameState, me: string, command: GameCommand): string {
  const name = (id: string) => (id === me ? "自己" : findPlayer(game, id)?.name ?? "?");
  const faceOf = (discId: string) => {
    const player = findPlayer(game, me);
    const disc = [...(player?.hand ?? []), ...(player?.stack ?? [])].find((candidate) => candidate.id === discId);
    return disc?.lastChance ? "Last Chance 碟" : disc?.face === "skull" ? "骷髅" : "一朵玫瑰";
  };
  switch (command.type) {
    case "placeFirst":
    case "placeDisc":
      return `我会盖${faceOf(command.discId)}。`;
    case "openBid":
      return `我会开叫 ${command.count}。`;
    case "raise":
      return `我会加到 ${command.count}。`;
    case "pass":
      return "我会点「过」。";
    case "flipMat":
      return `我会翻 ${name(command.player)} 的板。`;
    case "loseDisc":
      return `我会丢掉${faceOf(command.discId)}。`;
    case "chooseFirstPlayer":
      return `我会让 ${name(command.player)} 下一轮先手。`;
    case "nextRound":
      return "看完结算，点「继续」。";
    case "revealStack":
      return "我会亮出自己的垫子。";
  }
}

function anchorOf(game: GameState, me: string, command: GameCommand): string | null {
  const hand = findPlayer(game, me)?.hand ?? [];
  switch (command.type) {
    case "placeFirst":
    case "placeDisc":
    case "loseDisc": {
      const index = hand.findIndex((disc) => disc.id === command.discId);
      return index >= 0 ? `hand-disc-${index}` : "my-hand";
    }
    case "openBid":
    case "raise":
      return "bid-panel";
    case "pass":
      return "pass-button";
    case "flipMat":
      return `mat-${command.player}`;
    case "chooseFirstPlayer":
      return command.player === me ? "my-mat" : `mat-${command.player}`;
    case "nextRound":
      return "continue-button";
    case "revealStack":
      return "reveal-button";
  }
}

/** 「第一次遇到」小贴士的内容（真实对局里每条每台机器只出一次）。 */
export const TIPS = {
  "open-early": { title: "可以直接开叫", text: "第一次轮到你就能开叫，不用先盖第 2 张；叫到场上总数就直接开翻。" },
  "must-bid": { title: "手里没垫子了", text: "没垫子可盖时，轮到你必须开叫（或加注 / 过），不能跳过。" },
  "own-skull": { title: "自己板上有骷髅", text: "挑战者先翻自己的：叫到骷髅那一层，就一定会翻到自己的骷髅。叫价预览变红就是这个意思。" },
  challenger: { title: "你是挑战者", text: "先自动翻完你自己板上的，再一张张点别人的板；每块板只能翻最上面那张。" },
  "lost-mine": { title: "只有你知道", text: "你丢掉的是玫瑰还是骷髅，别人看不到，只看到你少了一张；丢掉的不会回来。" },
  "lose-choose": { title: "自己挑一张丢", text: "翻到自己的骷髅时，丢哪张由你挑；只剩 1 张时就没得挑。" },
  reveal: { title: "可以亮牌", text: "有人挑战失败时，你可以点「亮出我的垫子」给大家看；不亮也没关系。" },
  "choose-first": { title: "你来指定先手", text: "你被自己的骷髅淘汰了，下一轮谁先手由你点。" },
  "out-mine": { title: "你出局了", text: "垫子丢光就淘汰；还能看大家打、发表情，下一局再来。" },
  timeout: { title: "超时了", text: "这一步系统替你走了；连续 2 次超时会转成托管（人机代打），点「取消托管」就收回。" },
} as const;

/** 这一步该出哪些小贴士（按优先顺序；只出第一条没看过的）。 */
export function detectTips(game: GameState, selfId: string): string[] {
  const ids: string[] = [];
  const me = findPlayer(game, selfId);
  if (!me) return ids;
  for (const event of game.events) {
    if (event.type === "TimedOut" && event.player === selfId) ids.push("timeout");
    if (event.type === "PlayerEliminated" && event.player === selfId) ids.push("out-mine");
    if (event.type === "DiscLost" && event.player === selfId) ids.push("lost-mine");
    if (event.type === "ChallengeStarted" && event.challenger === selfId && me.stack.length > 0) ids.push("challenger");
  }
  const myTurn = game.turn === selfId;
  if (myTurn && game.phase === "loseChoosing") ids.push("lose-choose");
  if (myTurn && game.phase === "chooseFirst") ids.push("choose-first");
  if (myTurn && game.phase === "placeOrBid") {
    if (me.hand.length === 0) ids.push("must-bid");
    else if (me.stack.length === 1) ids.push("open-early");
  }
  if (myTurn && (game.phase === "placeOrBid" || game.phase === "bidding") && me.stack.some((disc) => disc.face === "skull")) ids.push("own-skull");
  if (canRevealStack(game, selfId)) ids.push("reveal");
  return ids;
}
