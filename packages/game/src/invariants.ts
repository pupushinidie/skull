import { alivePlayers, discCount, holdsLastChance, totalDiscsInPlay, unrevealedCount } from "./engine.js";
import type { Face, GameState } from "./types.js";

/**
 * 检查一份完整状态（服务器上的、没裁剪的）是不是自洽，返回问题列表（空 = 没问题）。
 * 随机对局测试每一步都跑它；buildGame 造出来的局面也先过它。
 */
export function checkInvariants(state: GameState): string[] {
  const problems: string[] = [];
  const fail = (message: string) => problems.push(message);
  const { config } = state;
  const perPlayer = config.roses + config.skulls;
  const ids = new Set<string>();
  let lastChanceDiscs = 0;
  const alive = alivePlayers(state);

  for (const player of state.players) {
    const own = [...player.hand, ...player.stack].filter((disc) => !disc.lastChance);
    for (const disc of [...player.hand, ...player.stack]) {
      if (!disc.id || !disc.face) fail(`${player.id} 有张垫子缺 id 或牌面`);
      else if (ids.has(disc.id)) fail(`垫子 id 重复：${disc.id}`);
      else ids.add(disc.id);
      if (disc.lastChance) {
        lastChanceDiscs += 1;
        if (disc.face !== "rose") fail(`${player.id} 的 Last Chance 碟不是玫瑰`);
      }
    }
    // 配件守恒：手里 + 板上 + 失掉的 = 3 玫瑰 + 1 骷髅
    if (own.length + player.lostCount !== perPlayer) fail(`${player.id} 垫子总数不守恒：${own.length} + 失 ${player.lostCount} ≠ ${perPlayer}`);
    if (player.lost) {
      if (player.lost.length !== player.lostCount) fail(`${player.id} lost 和 lostCount 不一致`);
      const faces = [...own.map((disc) => disc.face), ...player.lost];
      const roses = faces.filter((face) => face === "rose").length;
      const skulls = faces.filter((face) => face === "skull").length;
      if (roses !== config.roses || skulls !== config.skulls) fail(`${player.id} 牌面不守恒：玫瑰 ${roses}、骷髅 ${skulls}`);
    }
    if (player.eliminated !== (own.length === 0)) fail(`${player.id} 淘汰标记和垫子数不一致（还有 ${own.length} 张）`);
    if (player.eliminated && (player.hand.length > 0 || player.stack.length > 0)) fail(`${player.id} 已淘汰还有垫子`);
    if (player.eliminated && player.eliminatedRound === null) fail(`${player.id} 已淘汰但没记淘汰轮`);
    const holds = [...player.hand, ...player.stack].some((disc) => disc.lastChance);
    if (holds && !holdsLastChance(state, player)) fail(`${player.id} 不该拿着 Last Chance 碟`);
    if (holds && !config.lastChance) fail(`变体关着却有 Last Chance 碟`);
    if (holdsLastChance(state, player) && !holds && !(state.phase === "gameOver")) fail(`${player.id} 这一轮该有 Last Chance 碟却没有`);
    if (holds && discCount(player) !== 1) fail(`${player.id} 拿着 Last Chance 碟但自己的垫子不是 1 张`);
    // 翻开的只能是每摞最上面连续的几张（从顶往下翻）
    let seenHidden = false;
    for (let index = player.stack.length - 1; index >= 0; index -= 1) {
      if (!player.stack[index]!.revealed) seenHidden = true;
      else if (seenHidden) fail(`${player.id} 板上翻开的不是最上面的`);
    }
    if (player.passed && !["bidding", "resolving", "loseChoosing", "chooseFirst", "roundEnd", "gameOver"].includes(state.phase)) {
      fail(`${player.id} 在 ${state.phase} 阶段是 pass 状态`);
    }
  }
  if (lastChanceDiscs > 1) fail("场上不止一张 Last Chance 碟");

  if (state.phase !== "gameOver" && alive.length < 2) fail("对局没结束但存活的不到 2 人");
  if (state.phase === "gameOver") {
    if (state.winners.length !== 1 || !state.result || state.result.winner !== state.winners[0]) fail("终局没有唯一的获胜者");
    else if (state.players.find((player) => player.id === state.winners[0])?.eliminated) fail("获胜者已被淘汰");
  } else if (state.winners.length > 0) {
    fail("没结束就有获胜者");
  }

  const total = totalDiscsInPlay(state);
  const turnPlayer = state.turn ? state.players.find((player) => player.id === state.turn) : undefined;
  if (state.turn && !turnPlayer) fail(`turn 指向不存在的玩家 ${state.turn}`);

  switch (state.phase) {
    case "placeInitial":
      for (const player of alive) {
        if (player.stack.length !== (player.placedInitial ? 1 : 0)) fail(`准备阶段 ${player.id} 板上 ${player.stack.length} 张`);
      }
      if (state.bid !== 0 || state.turn !== null) fail("准备阶段不该有叫价或 turn");
      break;
    case "placeOrBid":
    case "bidding":
      for (const player of alive) if (player.stack.length < 1) fail(`${state.phase} 阶段 ${player.id} 板上没有垫子`);
      if (!turnPlayer || turnPlayer.eliminated) fail(`${state.phase} 阶段 turn 不是存活玩家`);
      if (state.phase === "placeOrBid" && (state.bid !== 0 || state.bidder !== null)) fail("还没开叫却有叫价");
      if (state.phase === "bidding") {
        if (state.bid < 1 || state.bid >= total) fail(`加注阶段叫价 ${state.bid} 不在 1..${total - 1}`);
        if (!state.bidder || state.players.find((player) => player.id === state.bidder)?.passed) fail("叫价最高的人不对");
        if (turnPlayer?.passed) fail("轮到了已经 pass 的人");
        if (state.turn === state.bidder) fail("轮到了叫价最高的人自己");
        if (alive.filter((player) => !player.passed).length < 2) fail("加注阶段没 pass 的不到 2 人");
      }
      if (state.challenger !== null) fail("还没挑战就有挑战者");
      break;
    case "resolving": {
      const challenger = state.players.find((player) => player.id === state.challenger);
      if (!challenger || challenger.eliminated) {
        fail("揭牌阶段没有挑战者");
        break;
      }
      if (state.bid < 1 || state.bid > total) fail(`叫价 ${state.bid} 超出场上总数 ${total}`);
      const revealed = state.players.reduce((sum, player) => sum + player.stack.filter((disc) => disc.revealed).length, 0);
      if (revealed !== state.bid - state.flipsToDo) fail(`翻开 ${revealed} 张，但叫价 ${state.bid}、还差 ${state.flipsToDo}`);
      if (state.flipsToDo < 1) fail("揭牌阶段已经不差张数了");
      if (state.awaitingMatChoice !== (unrevealedCount(challenger) === 0)) fail("awaitingMatChoice 和挑战者自己的翻牌进度不一致");
      for (const player of state.players) {
        if (player.id !== challenger.id && player.stack.some((disc) => disc.revealed) && unrevealedCount(challenger) > 0) {
          fail("挑战者自己的没翻完就翻了别人的");
        }
        if (player.stack.some((disc) => disc.revealed && disc.face === "skull")) fail("翻出骷髅了还在揭牌阶段");
      }
      if (state.turn !== challenger.id) fail("揭牌阶段 turn 不是挑战者");
      break;
    }
    case "loseChoosing": {
      const challenger = state.players.find((player) => player.id === state.challenger);
      if (!challenger || !state.selfSkull) fail("自选失牌阶段没有挑战者或不是自己的骷髅");
      else {
        if (challenger.stack.length > 0) fail("自选失牌时挑战者的垫子没收回手里");
        if (discCount(challenger) < 2) fail("只剩 1 张却进了自选失牌");
      }
      break;
    }
    case "chooseFirst": {
      const challenger = state.players.find((player) => player.id === state.challenger);
      if (!challenger?.eliminated || !state.selfSkull) fail("指定先手阶段的挑战者应该刚被自己的骷髅淘汰");
      break;
    }
    case "roundEnd": {
      const next = state.players.find((player) => player.id === state.nextFirst);
      if (!next || next.eliminated) fail("结算画面的下一轮先手不是存活玩家");
      if (state.roundLog.result === null) fail("结算画面没有结果");
      break;
    }
    case "gameOver":
      break;
  }
  return problems;
}

/** 全部垫子（含失掉的）按牌面数，给测试用：3 玫瑰 + 1 骷髅 × 人数（失掉的只在完整状态的 lost 里）。 */
export function faceTotals(state: GameState): Record<Face, number> {
  const totals: Record<Face, number> = { rose: 0, skull: 0 };
  for (const player of state.players) {
    for (const disc of [...player.hand, ...player.stack]) if (!disc.lastChance && disc.face) totals[disc.face] += 1;
    for (const face of player.lost ?? []) totals[face] += 1;
  }
  return totals;
}
