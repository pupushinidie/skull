import { createRng, type Rng } from "./rng.js";
import {
  DEFAULT_GAME_OPTIONS,
  type Config,
  type Disc,
  type Face,
  type GameCommand,
  type GameEvent,
  type GameOptions,
  type GameState,
  type LossMethod,
  type Phase,
  type Player,
  type RoundLog,
  type StackDisc,
  type TimedPhase,
} from "./types.js";

/** 各步骤限时（秒），见补充文件 3.4。 */
export const DEFAULT_TIMEOUTS: Readonly<Record<TimedPhase, number>> = {
  placeInitial: 20,
  placeOrBid: 25,
  bidding: 20,
  resolving: 20,
  loseChoosing: 20,
  chooseFirst: 15,
};

/** Last Chance 碟的 id（同一时间最多一个人拿着它）。 */
export const LAST_CHANCE_ID = "lastchance";

export function defaultConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...DEFAULT_GAME_OPTIONS,
    minPlayers: 3,
    maxPlayers: 6,
    roses: 3,
    skulls: 1,
    timeouts: DEFAULT_TIMEOUTS,
    roundEndMs: 5_000,
    roundEndFailMs: 8_000,
    flipPauseMs: 1_000,
    ...overrides,
  };
}

export interface NewPlayer {
  readonly id: string;
  readonly name: string;
}

// ---------------------------------------------------------------- 查询（都不改状态）

export function findPlayer(state: Pick<GameState, "players">, playerId: string): Player | undefined {
  return state.players.find((player) => player.id === playerId);
}

function mustPlayer(state: GameState, playerId: string): Player {
  const player = findPlayer(state, playerId);
  if (!player) throw new Error("你不在这局里。");
  return player;
}

export function alivePlayers(state: Pick<GameState, "players">): Player[] {
  return state.players.filter((player) => !player.eliminated);
}

/** 自己还有几张垫子（手里 + 板上，不含 Last Chance 碟）。公开信息。 */
export function discCount(player: Pick<Player, "hand" | "stack">): number {
  return player.hand.filter((disc) => !disc.lastChance).length + player.stack.filter((disc) => !disc.lastChance).length;
}

/** 场上盖着的总数：本轮所有板上的垫子（含 Last Chance 碟，不算手里的）。叫价上限。 */
export function totalDiscsInPlay(state: Pick<GameState, "players">): number {
  return state.players.reduce((total, player) => total + player.stack.length, 0);
}

/** 这一轮这个人手里或板上有 Last Chance 碟。 */
export function holdsLastChance(state: Pick<GameState, "round">, player: Pick<Player, "lastChanceRound" | "eliminated">): boolean {
  return !player.eliminated && player.lastChanceRound === state.round;
}

/** 板上还没翻开的张数。 */
export function unrevealedCount(player: Pick<Player, "stack">): number {
  return player.stack.filter((disc) => !disc.revealed).length;
}

/** 从 fromId 顺时针往后找第一个满足条件的存活玩家（不含 fromId 自己）；找不到返回 null。 */
export function nextPlayer(state: Pick<GameState, "players">, fromId: string, accept: (player: Player) => boolean = () => true): string | null {
  const start = state.players.findIndex((player) => player.id === fromId);
  const count = state.players.length;
  for (let offset = 1; offset < count; offset += 1) {
    const candidate = state.players[(start + offset) % count]!;
    if (!candidate.eliminated && accept(candidate)) return candidate.id;
  }
  return null;
}

/** 现在要等谁做决定（同时行动的阶段可能有几个人）。系统自动翻牌时为空。 */
export function waitingFor(state: GameState): string[] {
  switch (state.phase) {
    case "placeInitial":
      return state.players.filter((player) => !player.eliminated && !player.placedInitial).map((player) => player.id);
    case "placeOrBid":
    case "bidding":
      return state.turn ? [state.turn] : [];
    case "resolving":
      return state.awaitingMatChoice && state.challenger ? [state.challenger] : [];
    case "loseChoosing":
    case "chooseFirst":
      return state.challenger ? [state.challenger] : [];
    case "roundEnd":
      return state.players.filter((player) => !player.eliminated && !player.ready).map((player) => player.id);
    case "gameOver":
      return [];
  }
}

/** 现在有没有要系统自动做的一步（揭牌时翻挑战者自己的垫子）。服务器停 flipPauseMs 后调 advance。 */
export function needsAdvance(state: GameState): boolean {
  return state.phase === "resolving" && !state.awaitingMatChoice;
}

/**
 * 服务器计时用的 key：换人、换步骤、系统每翻一张都会变；准备阶段别人盖牌、结算时别人点继续或亮牌都不变，
 * 所以一个人的倒计时不会被别人的操作重置。
 */
export function stepKey(state: GameState): string {
  return `${state.round}:${state.phase}:${state.step}`;
}

/** 这一步多久后自动处理（毫秒）；终局为 null。系统自动翻牌是 flipPauseMs，结算画面是 roundEndMs / roundEndFailMs。 */
export function stepTimeoutMs(state: GameState): number | null {
  switch (state.phase) {
    case "gameOver":
      return null;
    case "roundEnd":
      return state.roundLog.result === "fail" ? state.config.roundEndFailMs : state.config.roundEndMs;
    case "resolving":
      return state.awaitingMatChoice ? state.config.timeouts.resolving * 1000 : state.config.flipPauseMs;
    default:
      return state.config.timeouts[state.phase] * 1000;
  }
}

/** 这一轮能不能自愿亮牌：挑战失败的结算画面，挑战者以外、板上还有没翻开垫子的存活玩家。 */
export function canRevealStack(state: GameState, playerId: string): boolean {
  if (state.phase !== "roundEnd" || state.roundLog.result !== "fail" || playerId === state.challenger) return false;
  const player = findPlayer(state, playerId);
  return Boolean(player && !player.eliminated && unrevealedCount(player) > 0);
}

/** 挑战者现在能翻的板（别人的、还有没翻开的）。 */
export function flippableMats(state: GameState): string[] {
  if (state.phase !== "resolving" || !state.awaitingMatChoice) return [];
  return state.players
    .filter((player) => player.id !== state.challenger && !player.eliminated && unrevealedCount(player) > 0)
    .map((player) => player.id);
}

/** 这个人现在所有合法的命令（叫价把每个数都列出来）。不是他的决定时为空。 */
export function legalActions(state: GameState, playerId: string): GameCommand[] {
  const player = findPlayer(state, playerId);
  if (!player || !waitingFor(state).includes(playerId)) return [];
  const total = totalDiscsInPlay(state);
  switch (state.phase) {
    case "placeInitial":
      return player.hand.map((disc) => ({ type: "placeFirst", discId: disc.id! }));
    case "placeOrBid": {
      const places: GameCommand[] = player.hand.map((disc) => ({ type: "placeDisc", discId: disc.id! }));
      const bids: GameCommand[] = range(1, total).map((count) => ({ type: "openBid", count }));
      return [...places, ...bids];
    }
    case "bidding":
      return [...range(state.bid + 1, total).map((count): GameCommand => ({ type: "raise", count })), { type: "pass" }];
    case "resolving":
      return flippableMats(state).map((id) => ({ type: "flipMat", player: id }));
    case "loseChoosing":
      return [...player.hand, ...player.stack].filter((disc) => !disc.lastChance).map((disc) => ({ type: "loseDisc", discId: disc.id! }));
    case "chooseFirst":
      return alivePlayers(state).map((candidate) => ({ type: "chooseFirstPlayer", player: candidate.id }));
    case "roundEnd":
      return canRevealStack(state, playerId) ? [{ type: "nextRound" }, { type: "revealStack" }] : [{ type: "nextRound" }];
    case "gameOver":
      return [];
  }
}

function range(from: number, to: number): number[] {
  const result: number[] = [];
  for (let value = from; value <= to; value += 1) result.push(value);
  return result;
}

// ---------------------------------------------------------------- 改状态的内部步骤（只改 clone 出来的 next）

/** 按结构复制：垫子对象本身不可变，可以共用；数组和会改的对象都换新的。 */
function cloneState(state: GameState): GameState {
  return {
    ...state,
    players: state.players.map((player) => ({
      ...player,
      hand: [...player.hand],
      stack: [...player.stack],
      ...(player.lost ? { lost: [...player.lost] } : {}),
    })),
    roundLog: cloneRoundLog(state.roundLog),
    winners: [...state.winners],
    events: [],
  };
}

function cloneRoundLog(log: RoundLog): RoundLog {
  return {
    ...log,
    placements: [...log.placements],
    bids: [...log.bids],
    stackSizes: { ...log.stackSizes },
    flips: [...log.flips],
    reveals: [...log.reveals],
  };
}

export function newRoundLog(round: number, firstPlayer: string): RoundLog {
  return {
    round,
    firstPlayer,
    placements: [],
    bids: [],
    stackSizes: {},
    challenger: null,
    bid: 0,
    flips: [],
    result: null,
    skullOwner: null,
    loss: null,
    lastChanceEarned: null,
    reveals: [],
    nextFirst: null,
    nextFirstChosenBy: null,
    nextFirstAuto: false,
  };
}

function lastChanceDisc(): Disc {
  return { id: LAST_CHANCE_ID, face: "rose", lastChance: true };
}

function stripRevealed(disc: StackDisc): Disc {
  const { revealed: _revealed, ...rest } = disc;
  return rest;
}

/** 开一轮：板上的收回手里、Last Chance 碟收走或发下、pass 清空，进入准备阶段。 */
function startRound(state: GameState, firstPlayer: string, events: GameEvent[]): void {
  if (state.round > 0) state.history = [...state.history, state.roundLog];
  state.round += 1;
  const given: GameEvent[] = [];
  for (const player of state.players) {
    const discs = [...player.hand, ...player.stack.map(stripRevealed)].filter((disc) => !disc.lastChance);
    player.stack = [];
    player.hand = player.eliminated ? [] : discs;
    if (!player.eliminated && player.lastChanceRound === state.round) {
      player.hand.push(lastChanceDisc());
      given.push({ type: "LastChanceGiven", player: player.id });
    }
    player.passed = false;
    player.placedInitial = false;
    player.ready = false;
  }
  state.phase = "placeInitial";
  state.firstPlayer = firstPlayer;
  state.turn = null;
  state.bid = 0;
  state.bidder = null;
  state.challenger = null;
  state.flipsToDo = 0;
  state.awaitingMatChoice = false;
  state.selfSkull = false;
  state.nextFirst = null;
  state.roundLog = newRoundLog(state.round, firstPlayer);
  events.push({ type: "RoundStarted", round: state.round, firstPlayer }, ...given);
}

function takeFromHand(player: Player, discId: unknown): Disc {
  const index = player.hand.findIndex((disc) => disc.id === discId);
  if (index < 0) throw new Error("这张垫子不在你手里。");
  const [disc] = player.hand.splice(index, 1);
  return disc!;
}

function placeOnStack(state: GameState, player: Player, disc: Disc, initial: boolean, events: GameEvent[]): void {
  player.stack.push({ ...disc, revealed: false });
  const lastChance = disc.lastChance ? { lastChance: true as const } : {};
  state.roundLog.placements.push({ player: player.id, initial, ...lastChance });
  events.push({ type: "DiscPlaced", player: player.id, initial, stackSize: player.stack.length, ...lastChance });
}

function validCount(count: unknown): count is number {
  return typeof count === "number" && Number.isInteger(count);
}

function startChallenge(state: GameState, challengerId: string, events: GameEvent[]): void {
  state.phase = "resolving";
  state.challenger = challengerId;
  state.turn = challengerId;
  state.flipsToDo = state.bid;
  state.awaitingMatChoice = false;
  state.roundLog.challenger = challengerId;
  state.roundLog.bid = state.bid;
  state.roundLog.stackSizes = Object.fromEntries(
    state.players.filter((player) => !player.eliminated).map((player) => [player.id, player.stack.length]),
  );
  events.push({ type: "ChallengeStarted", challenger: challengerId, bid: state.bid });
}

/** 翻开 owner 板上最上面一张没翻开的，处理成功 / 失败。 */
function flipTop(state: GameState, owner: Player, auto: boolean, rng: Rng, events: GameEvent[]): void {
  let index = -1;
  for (let position = owner.stack.length - 1; position >= 0; position -= 1) {
    if (!owner.stack[position]!.revealed) {
      index = position;
      break;
    }
  }
  if (index < 0) throw new Error("这块板上已经没有没翻开的垫子了。");
  const disc = owner.stack[index]!;
  owner.stack[index] = { ...disc, revealed: true };
  state.flipsToDo -= 1;
  const face = disc.face!;
  const lastChance = disc.lastChance ? { lastChance: true as const } : {};
  state.roundLog.flips.push({ owner: owner.id, depth: index, face, auto, ...lastChance });
  events.push({ type: "DiscRevealed", challenger: state.challenger!, owner: owner.id, depth: index, face, auto, flipsLeft: state.flipsToDo, ...lastChance });
  if (face === "skull") {
    failChallenge(state, owner.id, rng, events);
    return;
  }
  if (state.flipsToDo === 0) {
    succeedChallenge(state, events);
    return;
  }
  state.awaitingMatChoice = unrevealedCount(mustPlayer(state, state.challenger!)) === 0;
}

function succeedChallenge(state: GameState, events: GameEvent[]): void {
  const challenger = mustPlayer(state, state.challenger!);
  state.roundLog.result = "success";
  state.awaitingMatChoice = false;
  const won = challenger.flowerUp;
  events.push({ type: "ChallengeSucceeded", challenger: challenger.id, won });
  if (won) {
    finishGame(state, challenger.id, "twoWins", events);
    return;
  }
  challenger.flowerUp = true;
  endRound(state, challenger.id, events);
}

function failChallenge(state: GameState, skullOwner: string, rng: Rng, events: GameEvent[]): void {
  const challenger = mustPlayer(state, state.challenger!);
  state.selfSkull = skullOwner === challenger.id;
  state.awaitingMatChoice = false;
  state.flipsToDo = 0;
  state.roundLog.result = "fail";
  state.roundLog.skullOwner = skullOwner;
  events.push({ type: "ChallengeFailed", challenger: challenger.id, skullOwner, selfSkull: state.selfSkull });
  // 挑战者把板上的垫子全部收回手里（翻开过的也扣回去），再失一张：别人看不出失的是板上哪个位置的。
  challenger.hand = [...challenger.hand, ...challenger.stack.map(stripRevealed)];
  challenger.stack = [];
  const own = challenger.hand.filter((disc) => !disc.lastChance);
  if (holdsLastChance(state, challenger)) {
    // 持碟那一轮失败：碟子和最后一张一起失去，不抽、不挑。
    loseDisc(state, challenger, own[0]!.id!, "lastChance", events);
    return;
  }
  if (state.selfSkull) {
    if (own.length === 1) {
      loseDisc(state, challenger, own[0]!.id!, "forced", events);
      return;
    }
    state.phase = "loseChoosing";
    state.turn = challenger.id;
    return;
  }
  // 别人的骷髅：骷髅主人盲抽一张 = 系统随机丢一张。
  loseDisc(state, challenger, own[rng.int(own.length)]!.id!, "random", events);
}

/** 挑战者失掉 discId，再处理淘汰、Last Chance 碟、下一轮先手和终局。 */
function loseDisc(state: GameState, challenger: Player, discId: string, method: LossMethod, events: GameEvent[]): void {
  const disc = takeFromHand(challenger, discId);
  if (disc.lastChance) throw new Error("Last Chance 碟不能拿来丢。");
  if (method === "lastChance") challenger.hand = challenger.hand.filter((candidate) => !candidate.lastChance);
  challenger.lostCount += 1;
  challenger.lost = [...(challenger.lost ?? []), disc.face!];
  const remaining = discCount(challenger);
  const eliminated = remaining === 0;
  state.roundLog.loss = { player: challenger.id, method, count: 1, eliminated };
  events.push({ type: "DiscLost", player: challenger.id, method, remaining, face: disc.face! });
  if (eliminated) {
    challenger.eliminated = true;
    challenger.eliminatedRound = state.round;
    challenger.hand = [];
    challenger.stack = [];
    events.push({ type: "PlayerEliminated", player: challenger.id });
  } else if (remaining === 1 && state.config.lastChance) {
    // 只在「失败后只剩 1 张」时给；垫子只减不增，所以每人自然最多拿一次（这里只做断言）。
    if (challenger.lastChanceRound !== null) throw new Error("内部错误：Last Chance 碟拿了两次。");
    challenger.lastChanceRound = state.round + 1;
    state.roundLog.lastChanceEarned = challenger.id;
    events.push({ type: "LastChanceEarned", player: challenger.id });
  }
  const alive = alivePlayers(state);
  if (alive.length === 1) {
    finishGame(state, alive[0]!.id, "lastStanding", events);
    return;
  }
  if (!eliminated) {
    endRound(state, challenger.id, events);
  } else if (!state.selfSkull) {
    endRound(state, state.roundLog.skullOwner!, events);
  } else {
    state.phase = "chooseFirst";
    state.turn = challenger.id;
  }
}

function endRound(state: GameState, nextFirst: string, events: GameEvent[]): void {
  state.phase = "roundEnd";
  state.turn = null;
  state.awaitingMatChoice = false;
  state.nextFirst = nextFirst;
  state.roundLog.nextFirst = nextFirst;
  for (const player of state.players) player.ready = false;
  events.push({ type: "RoundEnded", round: state.round, result: state.roundLog.result!, nextFirst });
}

function finishGame(state: GameState, winner: string, reason: "twoWins" | "lastStanding", events: GameEvent[]): void {
  state.phase = "gameOver";
  state.turn = null;
  state.awaitingMatChoice = false;
  state.nextFirst = null;
  state.winners = [winner];
  state.result = { winner, reason };
  events.push({ type: "GameEnded", winner, reason });
}

// ---------------------------------------------------------------- 对外：apply / advance / timeout

function requireTurn(state: GameState, phase: Phase, playerId: string, message: string): void {
  if (state.phase !== phase) throw new Error(message);
  if (state.turn !== playerId) throw new Error("还没轮到你。");
}

function decisionSignature(state: GameState): string {
  return `${state.round}|${state.phase}|${state.turn}|${state.flipsToDo}|${state.awaitingMatChoice}`;
}

/**
 * 纯函数：playerId 发出 command 之后的新状态和事件。不改输入；version 加一；需要随机（别人骷髅时随机失牌）时用 rng。
 * 不合法时抛出带中文说明的 Error。
 */
export function apply(state: GameState, playerId: string, command: GameCommand, rng: Rng): { state: GameState; events: GameEvent[] } {
  if (state.phase === "gameOver") throw new Error("对局已经结束。");
  const before = decisionSignature(state);
  const next = cloneState(state);
  const player = mustPlayer(next, playerId);
  if (player.eliminated && !(next.phase === "chooseFirst" && next.challenger === playerId)) throw new Error("你已经被淘汰了。");
  const events: GameEvent[] = [];
  const total = totalDiscsInPlay(next);

  switch (command?.type) {
    case "placeFirst": {
      if (next.phase !== "placeInitial") throw new Error("现在不是盖第 1 张的时候。");
      if (player.placedInitial) throw new Error("你这一轮已经盖过第 1 张了。");
      const disc = takeFromHand(player, command.discId);
      player.placedInitial = true;
      placeOnStack(next, player, disc, true, events);
      const alive = alivePlayers(next);
      if (alive.every((candidate) => candidate.placedInitial)) {
        if (alive.some((candidate) => candidate.stack.length < 1)) throw new Error("内部错误：有人没盖第 1 张。");
        next.phase = "placeOrBid";
        next.turn = next.firstPlayer;
        events.push({ type: "PlacementDone", firstPlayer: next.firstPlayer });
      }
      break;
    }
    case "placeDisc": {
      requireTurn(next, "placeOrBid", playerId, next.phase === "bidding" ? "已经有人开叫了，不能再盖牌。" : "现在不能盖牌。");
      const disc = takeFromHand(player, command.discId);
      placeOnStack(next, player, disc, false, events);
      next.turn = nextPlayer(next, playerId);
      break;
    }
    case "openBid": {
      requireTurn(next, "placeOrBid", playerId, next.phase === "bidding" ? "已经有人开叫了，只能加注或 pass。" : "现在不能开叫。");
      if (!validCount(command.count) || command.count < 1 || command.count > total) {
        throw new Error(`开叫的数要在 1 到场上总数 ${total} 之间。`);
      }
      next.bid = command.count;
      next.bidder = playerId;
      next.roundLog.bids.push({ type: "open", player: playerId, count: command.count });
      events.push({ type: "BidOpened", player: playerId, count: command.count });
      if (command.count === total) {
        startChallenge(next, playerId, events);
      } else {
        next.phase = "bidding";
        next.turn = nextPlayer(next, playerId, (candidate) => !candidate.passed);
      }
      break;
    }
    case "raise": {
      requireTurn(next, "bidding", playerId, next.phase === "placeOrBid" ? "还没人开叫，要先开叫。" : "现在不能加注。");
      if (!validCount(command.count) || command.count <= next.bid || command.count > total) {
        throw new Error(`加注要比现在的 ${next.bid} 大，最多叫到场上总数 ${total}。`);
      }
      next.bid = command.count;
      next.bidder = playerId;
      next.roundLog.bids.push({ type: "raise", player: playerId, count: command.count });
      events.push({ type: "BidRaised", player: playerId, count: command.count });
      if (command.count === total) startChallenge(next, playerId, events);
      else next.turn = nextPlayer(next, playerId, (candidate) => !candidate.passed);
      break;
    }
    case "pass": {
      requireTurn(next, "bidding", playerId, "现在不能 pass。");
      player.passed = true;
      next.roundLog.bids.push({ type: "pass", player: playerId });
      events.push({ type: "Passed", player: playerId });
      const remaining = alivePlayers(next).filter((candidate) => !candidate.passed);
      if (remaining.length === 1) {
        if (remaining[0]!.id !== next.bidder) throw new Error("内部错误：最后没 pass 的不是叫价最高的人。");
        startChallenge(next, remaining[0]!.id, events);
      } else {
        next.turn = nextPlayer(next, playerId, (candidate) => !candidate.passed);
      }
      break;
    }
    case "flipMat": {
      if (next.phase !== "resolving" || next.challenger !== playerId) throw new Error("只有挑战者能翻牌。");
      if (!next.awaitingMatChoice) throw new Error("要先把自己板上的翻完。");
      if (command.player === playerId) throw new Error("你自己的已经翻完了，选别人的板。");
      const owner = findPlayer(next, command.player);
      if (!owner || owner.eliminated) throw new Error("找不到这块板。");
      if (unrevealedCount(owner) === 0) throw new Error("这块板上的已经翻完了。");
      flipTop(next, owner, false, rng, events);
      break;
    }
    case "loseDisc": {
      if (next.phase !== "loseChoosing" || next.challenger !== playerId) throw new Error("现在不用丢垫子。");
      const disc = player.hand.find((candidate) => candidate.id === command.discId);
      if (!disc) throw new Error("这张垫子不是你的。");
      if (disc.lastChance) throw new Error("Last Chance 碟不能拿来丢。");
      loseDisc(next, player, command.discId, "chosen", events);
      break;
    }
    case "chooseFirstPlayer": {
      if (next.phase !== "chooseFirst" || next.challenger !== playerId) throw new Error("现在不用你指定先手。");
      const target = findPlayer(next, command.player);
      if (!target || target.eliminated) throw new Error("只能指定还在场上的玩家。");
      next.roundLog.nextFirstChosenBy = playerId;
      events.push({ type: "FirstPlayerChosen", by: playerId, player: target.id, auto: false });
      endRound(next, target.id, events);
      break;
    }
    case "nextRound": {
      if (next.phase !== "roundEnd") throw new Error("现在不是结算画面。");
      if (player.ready) throw new Error("你已经点过继续了。");
      player.ready = true;
      events.push({ type: "PlayerReady", player: playerId });
      if (alivePlayers(next).every((candidate) => candidate.ready)) startRound(next, next.nextFirst!, events);
      break;
    }
    case "revealStack": {
      if (next.phase !== "roundEnd" || next.roundLog.result !== "fail") throw new Error("只有挑战失败后的结算画面才能亮牌。");
      if (playerId === next.challenger) throw new Error("挑战者的垫子已经收回手里了。");
      if (unrevealedCount(player) === 0) throw new Error("你板上没有没翻开的垫子。");
      const discs = player.stack.flatMap((disc, depth) =>
        disc.revealed ? [] : [{ depth, face: disc.face!, ...(disc.lastChance ? { lastChance: true as const } : {}) }],
      );
      player.stack = player.stack.map((disc) => (disc.revealed ? disc : { ...disc, revealed: true }));
      next.roundLog.reveals.push({ player: playerId, discs });
      events.push({ type: "StackRevealed", player: playerId, discs });
      break;
    }
    default:
      throw new Error("未知的行动。");
  }
  finishStep(next, before, events);
  return { state: next, events };
}

function finishStep(next: GameState, before: string, events: GameEvent[]): void {
  next.version += 1;
  if (decisionSignature(next) !== before) next.step += 1;
  next.events = events;
}

/** 系统自动做一步：揭牌时翻挑战者自己板上最上面一张没翻开的（needsAdvance 为真时）。纯函数，随机用 rng。 */
export function advanceWith(state: GameState, rng: Rng): { state: GameState; events: GameEvent[] } {
  if (!needsAdvance(state)) throw new Error("现在没有要自动做的步骤。");
  const before = decisionSignature(state);
  const next = cloneState(state);
  const events: GameEvent[] = [];
  flipTop(next, mustPlayer(next, next.challenger!), true, rng, events);
  finishStep(next, before, events);
  return { state: next, events };
}

function runCommand(state: GameState, playerId: string, command: GameCommand): { state: GameState; events: GameEvent[] } {
  const rng = createRng(state.rngState ?? state.seed ?? 0);
  const result = apply(state, playerId, command, rng);
  result.state.rngState = rng.state;
  result.state.log = [...(state.log ?? []), { player: playerId, command }];
  return result;
}

/** 服务器用：用状态里存的随机数状态执行命令，并记进动作序列。 */
export function applyCommand(state: GameState, playerId: string, command: GameCommand): GameState {
  return runCommand(state, playerId, command).state;
}

/** 服务器用：执行系统自动的一步（见 needsAdvance）。 */
export function advance(state: GameState): GameState {
  const rng = createRng(state.rngState ?? state.seed ?? 0);
  const result = advanceWith(state, rng);
  result.state.rngState = rng.state;
  result.state.log = [...(state.log ?? []), { player: state.challenger ?? "", command: { type: "AUTO" } }];
  return result.state;
}

/**
 * 超时时替 playerId 做的事（补充文件 3.4）：
 * - 准备阶段：随机盖 1 张（不选 Last Chance 碟）；
 * - 轮流：手里有自己的垫子就随机盖 1 张（不选碟子），没有就开叫 1；
 * - 加注：pass；
 * - 选板：挑战者顺时针第一块还有没翻开垫子的板；
 * - 自选失牌：随机丢 1 张；
 * - 指定先手：挑战者顺时针下一位存活玩家；
 * - 结算画面：点继续（不亮牌）。
 * 不轮到他时返回 null。随机用 rng。
 */
export function timeoutCommand(state: GameState, playerId: string, rng: Rng): GameCommand | null {
  if (!waitingFor(state).includes(playerId)) return null;
  const player = mustPlayer(state, playerId);
  const ownInHand = player.hand.filter((disc) => !disc.lastChance);
  switch (state.phase) {
    case "placeInitial": {
      const pool = ownInHand.length > 0 ? ownInHand : player.hand;
      return { type: "placeFirst", discId: pool[rng.int(pool.length)]!.id! };
    }
    case "placeOrBid":
      return ownInHand.length > 0 ? { type: "placeDisc", discId: ownInHand[rng.int(ownInHand.length)]!.id! } : { type: "openBid", count: 1 };
    case "bidding":
      return { type: "pass" };
    case "resolving": {
      const target = nextPlayer(state, playerId, (candidate) => unrevealedCount(candidate) > 0);
      return target ? { type: "flipMat", player: target } : null;
    }
    case "loseChoosing":
      return { type: "loseDisc", discId: ownInHand[rng.int(ownInHand.length)]!.id! };
    case "chooseFirst": {
      const target = nextPlayer(state, playerId);
      return target ? { type: "chooseFirstPlayer", player: target } : null;
    }
    case "roundEnd":
      return { type: "nextRound" };
    case "gameOver":
      return null;
  }
}

/**
 * 这一步到点：系统自动翻牌的就翻一张；其余阶段替每个还没做决定的人做 timeoutCommand（结算画面就是都点继续、开下一轮），
 * 事件前面加上每个人的 TimedOut（结算画面不算超时，不加）。
 */
export function timeoutTurn(state: GameState): GameState {
  if (state.phase === "gameOver") return state;
  if (needsAdvance(state)) return advance(state);
  const phase = state.phase;
  let current = state;
  const timedOut: GameEvent[] = [];
  const events: GameEvent[] = [];
  for (const playerId of waitingFor(state)) {
    if (current.phase !== phase || current.round !== state.round) break;
    const rng = createRng(current.rngState ?? current.seed ?? 0);
    const command = timeoutCommand(current, playerId, rng);
    if (!command) continue;
    const result = apply(current, playerId, command, rng);
    result.state.rngState = rng.state;
    result.state.log = [...(current.log ?? []), { player: playerId, command: { type: "TIMEOUT" } }, { player: playerId, command }];
    if (phase !== "roundEnd") timedOut.push({ type: "TimedOut", player: playerId, phase });
    events.push(...result.events);
    current = result.state;
  }
  if (current === state) return state;
  if (phase === "chooseFirst") {
    current.roundLog.nextFirstAuto = true;
    current.events = [...timedOut, ...events.map((event) => (event.type === "FirstPlayerChosen" ? { ...event, auto: true } : event))];
    return current;
  }
  current.events = [...timedOut, ...events];
  return current;
}

// ---------------------------------------------------------------- 隐藏信息

export interface RedactOptions {
  /** 观战的上帝视角（房主打开「观战看底牌」）：看得到每个人的牌面，但看不到 id、种子和随机数状态。 */
  readonly seeAll?: boolean;
}

function hiddenDisc(disc: Disc): Disc {
  return disc.lastChance ? { face: "rose", lastChance: true } : {};
}

function hiddenStackDisc(disc: StackDisc): StackDisc {
  if (disc.lastChance) return { revealed: disc.revealed, face: "rose", lastChance: true };
  return disc.revealed ? { revealed: true, face: disc.face! } : { revealed: false };
}

function faceOnly(disc: Disc): Disc {
  return disc.lastChance ? { face: "rose", lastChance: true } : { face: disc.face! };
}

/**
 * 给某个视角看的状态（所有下发都要经过这里）：
 * - 去掉种子、随机数状态、动作序列；
 * - 别人手里、板上没翻开的垫子换成空对象（只剩张数）；别人翻开的只留牌面、不留 id；Last Chance 碟公开；
 * - 别人的 lost（失掉的牌面）去掉，DiscLost 事件里别人的 face 去掉。
 * viewerId 不是玩家（比如观战用 ""）时，谁的牌面都看不到；seeAll 时看得到牌面但没有 id。
 */
export function redactGameForViewer(state: GameState, viewerId: string, options: RedactOptions = {}): GameState {
  const { seed: _seed, rngState: _rngState, log: _log, ...rest } = state;
  const seeAll = options.seeAll === true;
  return {
    ...rest,
    players: state.players.map((player): Player => {
      if (player.id === viewerId) return { ...player, hand: [...player.hand], stack: [...player.stack], ...(player.lost ? { lost: [...player.lost] } : {}) };
      const { lost, ...visible } = player;
      if (seeAll) {
        return {
          ...visible,
          hand: player.hand.map(faceOnly),
          stack: player.stack.map((disc) => ({ revealed: disc.revealed, ...faceOnly(disc) })),
          ...(lost ? { lost: [...lost] } : {}),
        };
      }
      return { ...visible, hand: player.hand.map(hiddenDisc), stack: player.stack.map(hiddenStackDisc) };
    }),
    events: state.events.map((event): GameEvent => {
      if (event.type !== "DiscLost" || event.player === viewerId || seeAll) return event;
      const { face: _face, ...publicPart } = event;
      return publicPart;
    }),
  };
}

// ---------------------------------------------------------------- 开局

function discId(rng: Rng, used: Set<string>): string {
  for (;;) {
    const id = `d${rng.int(36 ** 5).toString(36).padStart(5, "0")}`;
    if (!used.has(id)) {
      used.add(id);
      return id;
    }
  }
}

/** 开局：每人 3 玫瑰 + 1 骷髅（id 随机、顺序随机），先手随机，进入第 1 轮准备阶段。 */
export function createGame(
  players: readonly NewPlayer[],
  seed = Math.floor(Math.random() * 2 ** 32),
  overrides: Partial<Config> = {},
): GameState {
  const config = defaultConfig(overrides);
  if (players.length < config.minPlayers || players.length > config.maxPlayers) {
    throw new Error(`需要 ${config.minPlayers}–${config.maxPlayers} 位玩家才能开始。`);
  }
  if (new Set(players.map((player) => player.id)).size !== players.length) throw new Error("玩家 id 重复。");
  const rng = createRng(seed);
  const used = new Set<string>();
  const faces: Face[] = [...Array<Face>(config.roses).fill("rose"), ...Array<Face>(config.skulls).fill("skull")];
  const state: GameState = {
    config,
    phase: "placeInitial",
    players: players.map((player, index) => ({
      id: player.id,
      name: player.name,
      color: index,
      hand: rng.shuffle(faces).map((face) => ({ id: discId(rng, used), face })),
      stack: [],
      flowerUp: false,
      eliminated: false,
      eliminatedRound: null,
      passed: false,
      placedInitial: false,
      ready: false,
      lastChanceRound: null,
      lostCount: 0,
      lost: [],
    })),
    round: 0,
    firstPlayer: "",
    turn: null,
    bid: 0,
    bidder: null,
    challenger: null,
    flipsToDo: 0,
    awaitingMatChoice: false,
    selfSkull: false,
    nextFirst: null,
    roundLog: newRoundLog(0, ""),
    history: [],
    winners: [],
    result: null,
    events: [],
    version: 0,
    step: 0,
    seed,
  };
  const first = players[rng.int(players.length)]!.id;
  const events: GameEvent[] = [];
  startRound(state, first, events);
  state.events = events;
  state.rngState = rng.state;
  state.log = [];
  return state;
}

/** 开房选项 → 对局 config 的覆盖项（服务器建局时用）。 */
export function optionsToConfig(options: Partial<GameOptions> = {}): Partial<Config> {
  return { lastChance: options.lastChance === true };
}
