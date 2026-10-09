/**
 * 预览局面工厂（对外接口）：界面的预览页、教程剧本、验收测试（包括背靠背的规则核对）都用它造局面。
 *
 * 三种用法：
 * 1. createScene(name, { players, viewer }) —— 按名字造常见局面（SCENE_NAMES 里列着，每个都带中文说明）；
 * 2. startGame({ players, first, options }) + runScript(state, steps) —— 从开局起按「谁盖什么牌面、叫几、翻谁」一步步走真实规则；
 * 3. buildGame(spec) —— 按参数直接造任意一个精确局面（每人手里 / 板上的牌面、谁淘汰、谁花面、阶段、叫价……），造完会检查自洽。
 * 造出来的都是完整状态（含牌面和 id）；给界面看之前用 redactGameForViewer(game, viewer)，或者用 previewRoom 包成房间快照。
 */
import {
  advanceWith,
  apply,
  createGame,
  defaultConfig,
  findPlayer,
  LAST_CHANCE_ID,
  newRoundLog,
  optionsToConfig,
  redactGameForViewer,
  timeoutTurn,
  totalDiscsInPlay,
  unrevealedCount,
} from "./engine.js";
import { checkInvariants } from "./invariants.js";
import { createRng, type Rng } from "./rng.js";
import { DEFAULT_ROOM_ACCESS, type Capacity, type LobbyMember, type LobbyRoomSnapshot } from "./roomTypes.js";
import type {
  BidAction,
  Config,
  Disc,
  Face,
  FinalResult,
  FlipRecord,
  GameCommand,
  GameEvent,
  GameOptions,
  GameState,
  Phase,
  Player,
  RoundLog,
  StackDisc,
} from "./types.js";

/** 预览和测试用的昵称（座位 p1–p6）。 */
export const PREVIEW_NAMES = ["阿玫", "老K", "烛影摇红", "铜壶", "麦酒先生", "灰猫"] as const;

export function previewPlayers(count: number): { id: string; name: string }[] {
  return Array.from({ length: count }, (_, index) => ({ id: `p${index + 1}`, name: PREVIEW_NAMES[index] ?? `玩家${index + 1}` }));
}

// ---------------------------------------------------------------- 1. 从开局一步步走

export interface StartOptions {
  /** 人数 3–6，座位 id 是 p1…pN。默认 4。 */
  readonly players?: number;
  /** 第 1 轮先手，默认 p1。 */
  readonly first?: string;
  readonly options?: Partial<GameOptions>;
  readonly config?: Partial<Config>;
  readonly seed?: number;
}

/** 新开一局（第 1 轮准备阶段，谁都没盖），先手指定。 */
export function startGame(options: StartOptions = {}): GameState {
  const count = options.players ?? 4;
  const game = createGame(previewPlayers(count), options.seed ?? 7, { ...optionsToConfig(options.options), ...options.config });
  const first = options.first ?? "p1";
  if (!findPlayer(game, first)) throw new Error(`没有座位 ${first}`);
  game.firstPlayer = first;
  game.roundLog = newRoundLog(1, first);
  game.events = game.events.map((event) => (event.type === "RoundStarted" ? { ...event, firstPlayer: first } : event));
  return game;
}

/** 某人手里（或板上）一张指定牌面的垫子 id；"lastChance" 是 Last Chance 碟。找不到抛错。 */
export function discOf(state: GameState, playerId: string, face: Face | "lastChance", where: "hand" | "stack" | "any" = "hand"): string {
  const player = findPlayer(state, playerId);
  if (!player) throw new Error(`没有座位 ${playerId}`);
  const pool = where === "hand" ? player.hand : where === "stack" ? player.stack : [...player.hand, ...player.stack];
  const disc = pool.find((candidate) => (face === "lastChance" ? candidate.lastChance : !candidate.lastChance && candidate.face === face));
  if (!disc?.id) throw new Error(`${playerId} 的${where === "hand" ? "手里" : where === "stack" ? "板上" : ""}没有${face === "lastChance" ? " Last Chance 碟" : face === "rose" ? "玫瑰" : "骷髅"}`);
  return disc.id;
}

/**
 * 剧本的一步：
 * - [p, "place", 牌面]：盖一张（准备阶段是 placeFirst，轮流时是 placeDisc）；牌面 "rose" | "skull" | "lastChance"
 * - [p, "bid", n]：开叫（还没人叫）或加注
 * - [p, "pass"]
 * - [p, "flip", 目标, 失牌牌面?]：挑战者翻目标的板；如果这一翻翻到别人的骷髅，可以指定随机失掉的是什么牌面
 * - [p, "lose", 牌面]：自选失牌
 * - [p, "first", 目标]：指定下一轮先手
 * - [p, "ready"]：结算画面点继续；[p, "reveal"]：失败后亮出自己的垫子
 * - ["auto"]：系统自动翻一张挑战者自己的；["autoAll"]：一直翻到要挑战者选板或结算
 * - ["readyAll"]：所有存活玩家点继续（开下一轮）
 * - ["timeout"]：这一步到点（timeoutTurn）
 * - [p, 命令对象]：直接发 GameCommand
 */
export type ScriptStep =
  | readonly [player: string, action: "place", face: Face | "lastChance"]
  | readonly [player: string, action: "bid", count: number]
  | readonly [player: string, action: "pass"]
  | readonly [player: string, action: "flip", target: string, lossFace?: Face]
  | readonly [player: string, action: "lose", face: Face]
  | readonly [player: string, action: "first", target: string]
  | readonly [player: string, action: "ready"]
  | readonly [player: string, action: "reveal"]
  | readonly ["auto"]
  | readonly ["autoAll"]
  | readonly ["readyAll"]
  | readonly ["timeout"]
  | readonly [player: string, command: GameCommand];

/** 一个按顺序出 int 的 rng（失牌指定牌面时用），其余随机数用状态里的。 */
function fixedIntRng(state: GameState, value: number): Rng {
  const base = createRng(state.rngState ?? state.seed ?? 0);
  return { ...base, int: () => value, get state() { return base.state; } };
}

function stepCommand(state: GameState, step: ScriptStep): { player: string; command: GameCommand } {
  const [player, action, arg] = step as readonly [string, unknown, unknown];
  if (typeof action === "object" && action !== null) return { player, command: action as GameCommand };
  switch (action) {
    case "place": {
      const discId = discOf(state, player, arg as Face | "lastChance");
      return { player, command: state.phase === "placeInitial" ? { type: "placeFirst", discId } : { type: "placeDisc", discId } };
    }
    case "bid":
      return { player, command: state.phase === "bidding" ? { type: "raise", count: arg as number } : { type: "openBid", count: arg as number } };
    case "pass":
      return { player, command: { type: "pass" } };
    case "flip":
      return { player, command: { type: "flipMat", player: arg as string } };
    case "lose":
      return { player, command: { type: "loseDisc", discId: discOf(state, player, arg as Face) } };
    case "first":
      return { player, command: { type: "chooseFirstPlayer", player: arg as string } };
    case "ready":
      return { player, command: { type: "nextRound" } };
    case "reveal":
      return { player, command: { type: "revealStack" } };
    default:
      throw new Error(`看不懂的剧本步骤：${JSON.stringify(step)}`);
  }
}

/** 执行一条命令（用状态里的随机数状态），返回新状态。lossFace：这一步要是随机失牌，指定失掉的牌面。 */
export function act(state: GameState, playerId: string, command: GameCommand, lossFace?: Face): GameState {
  if (lossFace) {
    for (let index = 0; index < 5; index += 1) {
      let result: { state: GameState };
      try {
        result = apply(state, playerId, command, fixedIntRng(state, index));
      } catch (error) {
        if (index === 0) throw error;
        break;
      }
      const loser = findPlayer(result.state, playerId);
      const lost = loser?.lost?.[loser.lost.length - 1];
      if (result.state.roundLog.loss?.method === "random" && lost === lossFace) return withLog(state, result.state, playerId, command);
      if (result.state.roundLog.loss?.method !== "random") return withLog(state, result.state, playerId, command);
    }
    throw new Error(`${playerId} 手里没有${lossFace === "rose" ? "玫瑰" : "骷髅"}可以失`);
  }
  const rng = createRng(state.rngState ?? state.seed ?? 0);
  const result = apply(state, playerId, command, rng);
  result.state.rngState = rng.state;
  return withLog(state, result.state, playerId, command);
}

function withLog(before: GameState, after: GameState, playerId: string, command: GameCommand): GameState {
  after.log = [...(before.log ?? []), { player: playerId, command }];
  return after;
}

/** 系统自动翻一张挑战者自己的垫子。 */
export function autoFlip(state: GameState): GameState {
  const rng = createRng(state.rngState ?? state.seed ?? 0);
  const result = advanceWith(state, rng);
  result.state.rngState = rng.state;
  return result.state;
}

/** 按剧本一步步走（每步都是真实规则，不合法会抛出「第几步：原因」）。 */
export function runScript(state: GameState, steps: readonly ScriptStep[]): GameState {
  let current = state;
  steps.forEach((step, index) => {
    try {
      if (step[0] === "auto") current = autoFlip(current);
      else if (step[0] === "autoAll") {
        while (current.phase === "resolving" && !current.awaitingMatChoice) current = autoFlip(current);
      } else if (step[0] === "readyAll") {
        for (const player of current.players) {
          if (current.phase !== "roundEnd") break;
          if (!player.eliminated && !player.ready) current = act(current, player.id, { type: "nextRound" });
        }
      } else if (step[0] === "timeout") current = timeoutTurn(current);
      else {
        const { player, command } = stepCommand(current, step);
        const lossFace = step[1] === "flip" ? (step[3] as Face | undefined) : undefined;
        current = act(current, player, command, lossFace);
      }
    } catch (error) {
      throw new Error(`剧本第 ${index + 1} 步 ${JSON.stringify(step)}：${error instanceof Error ? error.message : String(error)}`);
    }
  });
  return current;
}

// ---------------------------------------------------------------- 2. 按参数造精确局面

export type DiscSpec = Face | "lastChance";
export interface StackSpec {
  readonly face: DiscSpec;
  readonly revealed?: boolean;
}

export interface PlayerSpec {
  readonly name?: string;
  /** 手里的牌面。不给就是「3 玫瑰 1 骷髅」减去板上和 lost 的。 */
  readonly hand?: readonly DiscSpec[];
  /** 板上从底到顶；写成 { face, revealed: true } 表示已翻开。 */
  readonly stack?: readonly (DiscSpec | StackSpec)[];
  /** 失掉过的牌面。不给时：给了 hand 就是剩下的那几张，没给 hand 就是没失过。 */
  readonly lost?: readonly Face[];
  readonly flowerUp?: boolean;
  /** 已淘汰（手里板上都空，4 张都算失掉）。 */
  readonly eliminated?: boolean;
  readonly eliminatedRound?: number;
  readonly passed?: boolean;
  /** 准备阶段盖没盖第 1 张；默认板上有牌就算盖了。 */
  readonly placedInitial?: boolean;
  readonly ready?: boolean;
  /** 持 Last Chance 碟的那一轮；hand / stack 里写了 "lastChance" 时默认就是当前轮。 */
  readonly lastChanceRound?: number | null;
}

export interface GameSpec {
  /** 人数（每人都是开局的样子）或者每个座位的设定；座位 id 是 p1…pN。 */
  readonly players: number | readonly PlayerSpec[];
  readonly options?: Partial<GameOptions>;
  readonly config?: Partial<Config>;
  readonly seed?: number;
  /** 默认 1。 */
  readonly round?: number;
  /** 默认：所有板都空是 placeInitial，否则 placeOrBid。 */
  readonly phase?: Phase;
  /** 默认 p1。 */
  readonly firstPlayer?: string;
  /** 默认：placeOrBid 是先手；resolving / loseChoosing / chooseFirst 是挑战者；其余 null。 */
  readonly turn?: string | null;
  readonly bid?: number;
  /** 默认：叫价序列里最后一个开叫 / 加注的人。 */
  readonly bidder?: string | null;
  /** 本轮叫价序列（开叫、加注、pass）。bid、bidder、passed 不给时由它推出来。 */
  readonly bids?: readonly BidAction[];
  /** 默认：resolving 以后是 bidder。 */
  readonly challenger?: string | null;
  /** 默认：resolving 时 = 叫价 − 已翻开张数。 */
  readonly flipsToDo?: number;
  readonly awaitingMatChoice?: boolean;
  readonly selfSkull?: boolean;
  readonly nextFirst?: string | null;
  readonly winners?: readonly string[];
  readonly result?: FinalResult | null;
  /** 覆盖本轮公开记录的某几项（比如 roundEnd 的 result、loss、flips）。 */
  readonly roundLog?: Partial<RoundLog>;
  readonly history?: readonly RoundLog[];
  readonly events?: readonly GameEvent[];
  readonly version?: number;
}

const ALL_FACES = (config: Config): Face[] => [...Array<Face>(config.roses).fill("rose"), ...Array<Face>(config.skulls).fill("skull")];

function removeFaces(pool: Face[], faces: readonly Face[], who: string): Face[] {
  const rest = [...pool];
  for (const face of faces) {
    const index = rest.indexOf(face);
    if (index < 0) throw new Error(`${who} 的牌面超出了 3 玫瑰 1 骷髅`);
    rest.splice(index, 1);
  }
  return rest;
}

/**
 * 按参数造一个精确局面（完整状态）。造完跑 checkInvariants，不自洽就抛错（错误里列出哪里不对）。
 * 例：buildGame({ players: [{ stack: ["rose", "skull"] }, { stack: ["rose"] }, { stack: ["skull"], flowerUp: true }], turn: "p2" })
 */
export function buildGame(spec: GameSpec): GameState {
  const specs: readonly PlayerSpec[] = typeof spec.players === "number" ? Array.from({ length: spec.players }, () => ({})) : spec.players;
  const config = defaultConfig({ ...optionsToConfig(spec.options), ...spec.config });
  if (specs.length < config.minPlayers || specs.length > config.maxPlayers) throw new Error(`需要 ${config.minPlayers}–${config.maxPlayers} 位玩家`);
  const round = spec.round ?? 1;
  const rng = createRng(spec.seed ?? 11);
  const used = new Set<string>();
  const newId = () => {
    for (;;) {
      const id = `d${rng.int(36 ** 5).toString(36).padStart(5, "0")}`;
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
  };
  const makeDisc = (face: DiscSpec): Disc => (face === "lastChance" ? { id: LAST_CHANCE_ID, face: "rose", lastChance: true } : { id: newId(), face });

  const bids = spec.bids ?? [];
  const passedBy = new Set(bids.filter((entry) => entry.type === "pass").map((entry) => entry.player));
  const players: Player[] = specs.map((playerSpec, index) => {
    const id = `p${index + 1}`;
    const who = `座位 ${id}`;
    const stackSpecs = (playerSpec.stack ?? []).map((entry) => (typeof entry === "string" ? { face: entry, revealed: false } : entry));
    const stackFaces = stackSpecs.map((entry) => entry.face).filter((face): face is Face => face !== "lastChance");
    let hand: DiscSpec[];
    let lost: Face[];
    if (playerSpec.eliminated) {
      if (playerSpec.hand?.length || stackSpecs.length) throw new Error(`${who} 淘汰了不能还有垫子`);
      hand = [];
      lost = playerSpec.lost ? [...playerSpec.lost] : ALL_FACES(config);
    } else if (playerSpec.hand) {
      hand = [...playerSpec.hand];
      const handFaces = hand.filter((face): face is Face => face !== "lastChance");
      const rest = removeFaces(ALL_FACES(config), [...handFaces, ...stackFaces], who);
      lost = playerSpec.lost ? [...playerSpec.lost] : rest;
      removeFaces(rest, lost, who);
    } else {
      lost = [...(playerSpec.lost ?? [])];
      hand = removeFaces(ALL_FACES(config), [...stackFaces, ...lost], who);
    }
    const holdsLc = hand.includes("lastChance") || stackSpecs.some((entry) => entry.face === "lastChance");
    const stack: StackDisc[] = stackSpecs.map((entry) => ({ ...makeDisc(entry.face), revealed: entry.revealed === true }));
    const eliminated = playerSpec.eliminated === true;
    return {
      id,
      name: playerSpec.name ?? PREVIEW_NAMES[index] ?? `玩家${index + 1}`,
      seat: index,
      hand: hand.map(makeDisc),
      stack,
      flowerUp: playerSpec.flowerUp === true,
      eliminated,
      eliminatedRound: eliminated ? (playerSpec.eliminatedRound ?? Math.max(1, round - 1)) : null,
      passed: playerSpec.passed ?? passedBy.has(id),
      placedInitial: playerSpec.placedInitial ?? stack.length > 0,
      ready: playerSpec.ready === true,
      lastChanceRound: playerSpec.lastChanceRound !== undefined ? playerSpec.lastChanceRound : holdsLc ? round : null,
      lostCount: lost.length,
      lost,
    };
  });

  const allEmpty = players.every((player) => player.stack.length === 0);
  const phase: Phase = spec.phase ?? (allEmpty ? "placeInitial" : "placeOrBid");
  const firstPlayer = spec.firstPlayer ?? "p1";
  const lastBid = [...bids].reverse().find((entry): entry is Extract<BidAction, { count: number }> => entry.type !== "pass");
  const bid = spec.bid ?? lastBid?.count ?? 0;
  const bidder = spec.bidder !== undefined ? spec.bidder : (lastBid?.player ?? null);
  const challenger = spec.challenger !== undefined
    ? spec.challenger
    : ["resolving", "loseChoosing", "chooseFirst", "roundEnd"].includes(phase) ? bidder : null;
  const revealedCount = players.reduce((sum, player) => sum + player.stack.filter((disc) => disc.revealed).length, 0);
  const challengerPlayer = players.find((player) => player.id === challenger);
  const awaitingMatChoice = spec.awaitingMatChoice
    ?? (phase === "resolving" && challengerPlayer !== undefined && unrevealedCount(challengerPlayer) === 0);
  const turn = spec.turn !== undefined
    ? spec.turn
    : phase === "placeOrBid" ? firstPlayer
      : ["resolving", "loseChoosing", "chooseFirst"].includes(phase) ? challenger : null;

  // 本轮公开记录：盖牌顺序按「准备阶段每人一张，然后从先手起轮流」近似；翻牌按「挑战者自己从顶往下，再按座位」近似。
  const roundLog = newRoundLog(round, firstPlayer);
  const order = [...players.slice(players.findIndex((player) => player.id === firstPlayer)), ...players.slice(0, players.findIndex((player) => player.id === firstPlayer))];
  for (const player of order) {
    if (player.stack[0]) roundLog.placements.push({ player: player.id, initial: true, ...(player.stack[0].lastChance ? { lastChance: true as const } : {}) });
  }
  const depthMax = Math.max(0, ...players.map((player) => player.stack.length));
  for (let depth = 1; depth < depthMax; depth += 1) {
    for (const player of order) {
      const disc = player.stack[depth];
      if (disc) roundLog.placements.push({ player: player.id, initial: false, ...(disc.lastChance ? { lastChance: true as const } : {}) });
    }
  }
  roundLog.bids = [...bids];
  if (["resolving", "loseChoosing", "chooseFirst", "roundEnd", "gameOver"].includes(phase) && challenger) {
    roundLog.challenger = challenger;
    roundLog.bid = bid;
    roundLog.stackSizes = Object.fromEntries(players.filter((player) => !player.eliminated).map((player) => [player.id, player.stack.length]));
    const flips: FlipRecord[] = [];
    const flipOrder = [...(challengerPlayer ? [challengerPlayer] : []), ...players.filter((player) => player.id !== challenger)];
    for (const player of flipOrder) {
      for (let depth = player.stack.length - 1; depth >= 0; depth -= 1) {
        const disc = player.stack[depth]!;
        if (!disc.revealed) continue;
        flips.push({ owner: player.id, depth, face: disc.face!, auto: player.id === challenger, ...(disc.lastChance ? { lastChance: true as const } : {}) });
      }
    }
    roundLog.flips = flips;
  }
  Object.assign(roundLog, spec.roundLog ?? {});
  const nextFirst = spec.nextFirst !== undefined ? spec.nextFirst : phase === "roundEnd" ? (roundLog.nextFirst ?? challenger) : null;
  roundLog.nextFirst = spec.roundLog?.nextFirst ?? nextFirst;

  const state: GameState = {
    config,
    phase,
    players,
    round,
    firstPlayer,
    turn,
    bid,
    bidder,
    challenger,
    flipsToDo: spec.flipsToDo ?? (phase === "resolving" ? bid - revealedCount : 0),
    awaitingMatChoice,
    selfSkull: spec.selfSkull ?? (phase === "loseChoosing" || phase === "chooseFirst"),
    nextFirst,
    roundLog,
    history: [...(spec.history ?? [])],
    winners: [...(spec.winners ?? (spec.result ? [spec.result.winner] : []))],
    result: spec.result ?? (spec.winners?.[0] ? { winner: spec.winners[0], reason: "lastStanding" } : null),
    events: [...(spec.events ?? [])],
    version: spec.version ?? 1,
    step: 1,
    seed: spec.seed ?? 11,
    rngState: rng.state,
    log: [],
  };
  const problems = checkInvariants(state);
  if (problems.length > 0) throw new Error(`造出来的局面不自洽：\n- ${problems.join("\n- ")}`);
  return state;
}

// ---------------------------------------------------------------- 3. 命名局面

export interface RoomFlags {
  /** 掉线的座位。 */
  readonly offline?: readonly string[];
  /** 托管中的座位。 */
  readonly auto?: readonly string[];
  /** 人机座位。 */
  readonly bots?: readonly string[];
  /** 当前这一步剩余毫秒（倒计时）。 */
  readonly turnRemainingMs?: number;
}

export interface Scene {
  readonly name: SceneName;
  /** 一句话说明这个局面是什么、该看什么。 */
  readonly title: string;
  /** 完整状态（含牌面和 id）；给界面看要先 redactGameForViewer(game, viewer)。 */
  readonly game: GameState;
  /** 从谁的座位看（「我」）。 */
  readonly viewer: string;
  /** 房间层面的情况（掉线、托管、人机、倒计时），previewRoom 会用到。 */
  readonly room: RoomFlags;
}

export const SCENE_NAMES = [
  "opening",
  "placing",
  "placedWaiting",
  "myTurn",
  "otherTurn",
  "forcedBid",
  "bidding",
  "biddingOther",
  "bidMax",
  "revealOwn",
  "chooseMat",
  "chooseMatOther",
  "skullOther",
  "skullOtherSeen",
  "loseChoosing",
  "chooseFirst",
  "roundEndSuccess",
  "revealAfterFail",
  "lastChance",
  "lastChanceOther",
  "sixPlayers",
  "gameOverTwoWins",
  "gameOverLastStanding",
  "opponentOffline",
  "timeout",
  "autoPlay",
  "eliminatedViewer",
  "laterRound",
] as const;
export type SceneName = (typeof SCENE_NAMES)[number];

export const SCENE_TITLES: Readonly<Record<SceneName, string>> = {
  opening: "开局：第 1 轮准备阶段，谁都还没盖，我（p1）先手",
  placing: "准备阶段：p2、p3 已经盖好，我还没盖（同时盖）",
  placedWaiting: "准备阶段：我盖好了，等其他人",
  myTurn: "轮流：轮到我，可以再盖一张或开叫（板上 2 朵玫瑰）",
  otherTurn: "轮流：轮到 p2，我在等",
  forcedBid: "轮流：我手里没垫子了，必须开叫",
  bidding: "加注：p2 开叫 2、p3 加到 3、p4 pass，轮到我加注或 pass",
  biddingOther: "加注：我叫了 3，轮到 p3",
  bidMax: "叫到上限：我加到场上总数，直接开始揭牌（还没翻）",
  revealOwn: "揭牌：我是挑战者，系统正在翻我自己的（翻了 1 张）",
  chooseMat: "揭牌：我自己的翻完了，还差 2 张，等我选翻谁的板",
  chooseMatOther: "揭牌：p2 是挑战者，在选翻谁的板（我的板顶是骷髅）",
  skullOther: "失败：我翻到 p3 的骷髅，随机失了 1 张玫瑰（只有我看得到失了什么）",
  skullOtherSeen: "失败：p2 翻到我的骷髅，随机失了 1 张（我只看到他少 1 张）",
  loseChoosing: "失败：我翻到自己的骷髅，自己挑一张丢",
  chooseFirst: "我只剩 1 张骷髅、被自己的骷髅淘汰，指定下一轮先手",
  roundEndSuccess: "成功：我翻满 3 张都是玫瑰，垫板翻到花面",
  revealAfterFail: "失败结算：p2 翻到 p3 的骷髅；p4 亮出了自己的垫子，我也可以亮",
  lastChance: "Last Chance 碟：我只剩 1 张，这一轮手里多一张公开的玫瑰碟，轮到我",
  lastChanceOther: "Last Chance 碟：p3 把碟子盖在板顶（大家都知道是玫瑰），轮到我",
  sixPlayers: "6 人满桌：加注中，有人花面、有人 pass",
  gameOverTwoWins: "终局：我第 2 次挑战成功，赢下整局",
  gameOverLastStanding: "终局：别人都淘汰了，p2 活到最后获胜（我已淘汰）",
  opponentOffline: "轮流：轮到 p2，他掉线了（3 秒后人机代打）",
  timeout: "轮流：我的上家刚超时，系统替他盖了一张；轮到我，只剩 4 秒",
  autoPlay: "我连续超时被托管（人机代打），轮到我",
  eliminatedViewer: "我已被淘汰，看别人继续打（加注中）",
  laterRound: "第 4 轮准备阶段：有之前 3 轮的历史记录（叫价、翻牌、失牌）",
};

export interface SceneOptions {
  /** 人数（3–6），不是每个局面都用得上；默认 4（sixPlayers 固定 6，revealAfterFail 至少 4）。 */
  readonly players?: number;
}

/** 补满座位：第 4 个起每人板上 1 朵玫瑰或「骷髅 + 玫瑰」交替。 */
function extras(count: number, specs: PlayerSpec[]): PlayerSpec[] {
  const result = specs.slice(0, count);
  for (let index = result.length; index < count; index += 1) result.push({ stack: index % 2 === 0 ? ["rose"] : ["skull", "rose"] });
  return result;
}

/** 加注阶段：轮到的人都 pass，直到有人当上挑战者。 */
export function passAround(state: GameState): GameState {
  let current = state;
  while (current.phase === "bidding") current = act(current, current.turn!, { type: "pass" });
  return current;
}

/** 按名字造一个常见局面。viewer 是「我」的座位，默认 p1。 */
export function createScene(name: SceneName, options: SceneOptions = {}): Scene {
  const count = Math.min(6, Math.max(3, options.players ?? 4));
  const scene = (game: GameState, viewer = "p1", room: RoomFlags = {}): Scene => ({ name, title: SCENE_TITLES[name], game, viewer, room });
  const others = Array.from({ length: count - 1 }, (_, index) => `p${index + 2}`);
  const allPlaceRose = (state: GameState): GameState => runScript(state, state.players.filter((player) => !player.eliminated).map((player): ScriptStep => [player.id, "place", "rose"]));

  switch (name) {
    case "opening":
      return scene(startGame({ players: count }));
    case "placing":
      return scene(runScript(startGame({ players: count }), [["p2", "place", "rose"], ["p3", "place", "skull"]]));
    case "placedWaiting":
      return scene(runScript(startGame({ players: count }), [["p1", "place", "rose"], ["p2", "place", "rose"]]));
    case "myTurn": {
      const steps: ScriptStep[] = [["p1", "place", "rose"], ...others.map((id, index): ScriptStep => [id, "place", index % 2 ? "skull" : "rose"])];
      steps.push(["p1", "place", "rose"], ...others.map((id): ScriptStep => [id, "place", "rose"]));
      return scene(runScript(startGame({ players: count }), steps));
    }
    case "otherTurn": {
      const game = allPlaceRose(startGame({ players: count }));
      return scene(runScript(game, [["p1", "place", "skull"]]));
    }
    case "forcedBid":
      return scene(buildGame({
        players: extras(count, [{ stack: ["rose", "rose", "skull", "rose"] }, { stack: ["rose", "rose"] }, { stack: ["skull"] }]),
        turn: "p1",
      }));
    case "bidding": {
      const game = buildGame({
        players: extras(count, [{ stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["skull", "rose"] }, { stack: ["rose"] }]),
        phase: "bidding",
        bids: [{ type: "open", player: "p2", count: 2 }, { type: "raise", player: "p3", count: 3 }, ...(count >= 4 ? [{ type: "pass" as const, player: "p4" }] : [])],
        turn: count > 4 ? "p5" : "p1",
      });
      return scene(runScript(game, others.slice(3).map((id): ScriptStep => [id, "pass"])));
    }
    case "biddingOther":
      return scene(buildGame({
        players: extras(count, [{ stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["skull", "rose"] }]),
        phase: "bidding",
        bids: [{ type: "open", player: "p1", count: 3 }, { type: "pass", player: "p2" }],
        turn: "p3",
      }));
    case "bidMax": {
      const game = buildGame({
        players: extras(count, [{ stack: ["rose", "rose"] }, { stack: ["rose"] }, { stack: ["skull", "rose"] }]),
        phase: "bidding",
        bids: [{ type: "open", player: "p3", count: 2 }],
        turn: count === 3 ? "p1" : "p4",
      });
      return scene(runScript(game, [...others.slice(2).map((id): ScriptStep => [id, "pass"]), ["p1", "bid", totalDiscsInPlay(game)]]));
    }
    case "revealOwn":
      return scene(buildGame({
        players: extras(count, [{ stack: ["rose", { face: "rose", revealed: true }] }, { stack: ["rose"] }, { stack: ["rose", "rose"] }]),
        phase: "resolving",
        bids: [{ type: "open", player: "p1", count: 3 }, ...others.map((id) => ({ type: "pass" as const, player: id }))],
      }));
    case "chooseMat":
      return scene(buildGame({
        players: extras(count, [
          { stack: [{ face: "rose", revealed: true }, { face: "rose", revealed: true }] },
          { stack: ["skull", "rose"] },
          { stack: ["rose"] },
        ]),
        phase: "resolving",
        bids: [{ type: "open", player: "p1", count: 4 }, ...others.map((id) => ({ type: "pass" as const, player: id }))],
      }));
    case "chooseMatOther":
      return scene(buildGame({
        players: extras(count, [
          { stack: ["rose", "skull"] },
          { stack: [{ face: "rose", revealed: true }] },
          { stack: ["rose", { face: "rose", revealed: true }] },
        ]),
        phase: "resolving",
        firstPlayer: "p2",
        bids: [{ type: "open", player: "p2", count: 3 }, ...[...others.slice(1), "p1"].map((id) => ({ type: "pass" as const, player: id }))],
      }));
    case "skullOther": {
      const game = buildGame({
        players: extras(count, [{ stack: ["rose"] }, { stack: ["rose", "rose"] }, { stack: ["skull"] }]),
        turn: "p1",
      });
      const bid = passAround(runScript(game, [["p1", "bid", 4]]));
      return scene(runScript(bid, [["autoAll"], ["p1", "flip", "p2"], ["p1", "flip", "p2"], ["p1", "flip", "p3", "rose"]]));
    }
    case "skullOtherSeen": {
      const game = buildGame({
        players: extras(count, [{ stack: ["skull"] }, { stack: ["rose"] }, { stack: ["rose", "rose"] }]),
        firstPlayer: "p2",
        turn: "p2",
      });
      const bid = passAround(runScript(game, [["p2", "bid", 2]]));
      return scene(runScript(bid, [["autoAll"], ["p2", "flip", "p1"]]));
    }
    case "loseChoosing": {
      const game = buildGame({ players: extras(count, [{ stack: ["skull", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }]), turn: "p1" });
      return scene(runScript(passAround(runScript(game, [["p1", "bid", 2]])), [["autoAll"]]));
    }
    case "chooseFirst": {
      const game = buildGame({
        round: 3,
        players: extras(count, [{ stack: ["skull"], lost: ["rose", "rose", "rose"] }, { stack: ["rose"], flowerUp: true }, { stack: ["rose", "rose"] }]),
        turn: "p1",
      });
      return scene(runScript(passAround(runScript(game, [["p1", "bid", 1]])), [["autoAll"]]));
    }
    case "roundEndSuccess": {
      const game = buildGame({ players: extras(count, [{ stack: ["rose", "rose"] }, { stack: ["skull", "rose"] }, { stack: ["rose"] }]), turn: "p1" });
      return scene(runScript(passAround(runScript(game, [["p1", "bid", 3]])), [["autoAll"], ["p1", "flip", "p2"]]));
    }
    case "revealAfterFail": {
      const seats = Math.max(4, count);
      const game = buildGame({
        players: extras(seats, [{ stack: ["skull", "rose"] }, { stack: ["rose", "rose"] }, { stack: ["skull"] }, { stack: ["rose", "skull", "rose"] }]),
        firstPlayer: "p2",
        turn: "p2",
      });
      const bid = passAround(runScript(game, [["p2", "bid", 3]]));
      return scene(runScript(bid, [["autoAll"], ["p2", "flip", "p3"], ["p4", "reveal"]]));
    }
    case "lastChance":
      return scene(buildGame({
        options: { lastChance: true },
        round: 4,
        players: extras(count, [
          { hand: ["lastChance"], stack: ["rose"], lost: ["rose", "rose", "skull"] },
          { stack: ["rose"], flowerUp: true },
          { stack: ["skull", "rose"] },
        ]),
        turn: "p1",
      }));
    case "lastChanceOther":
      return scene(buildGame({
        options: { lastChance: true },
        round: 4,
        players: extras(count, [{ stack: ["rose"] }, { stack: ["rose", "rose"] }, { hand: [], stack: ["rose", "lastChance"], lost: ["rose", "rose", "skull"] }]),
        firstPlayer: "p3",
        turn: "p1",
      }));
    case "sixPlayers":
      return scene(buildGame({
        players: [
          { stack: ["rose", "rose"] },
          { stack: ["skull", "rose", "rose"], flowerUp: true },
          { stack: ["rose"], lost: ["skull"] },
          { stack: ["rose", "skull"] },
          { stack: ["rose", "rose", "rose", "skull"] },
          { stack: ["skull"], lost: ["rose", "rose"], flowerUp: true },
        ],
        phase: "bidding",
        round: 5,
        firstPlayer: "p2",
        bids: [{ type: "open", player: "p2", count: 4 }, { type: "pass", player: "p3" }, { type: "raise", player: "p4", count: 6 }, { type: "pass", player: "p5" }, { type: "pass", player: "p6" }],
        turn: "p1",
      }));
    case "gameOverTwoWins": {
      const game = buildGame({
        round: 6,
        players: extras(count, [{ stack: ["rose", "rose"], flowerUp: true }, { stack: ["skull", "rose"], flowerUp: true }, { stack: ["rose"], lost: ["rose"] }]),
        turn: "p1",
      });
      return scene(runScript(passAround(runScript(game, [["p1", "bid", 2]])), [["autoAll"]]));
    }
    case "gameOverLastStanding": {
      const specs: PlayerSpec[] = [{ eliminated: true, eliminatedRound: 5 }, { stack: ["rose", "skull"], flowerUp: true }, { stack: ["rose"], lost: ["rose", "rose", "skull"] }];
      for (let index = 3; index < count; index += 1) specs.push({ eliminated: true, eliminatedRound: index + 3 });
      const game = buildGame({ round: 9, players: specs, firstPlayer: "p3", turn: "p3" });
      return scene(runScript(passAround(runScript(game, [["p3", "bid", 2]])), [["autoAll"], ["p3", "flip", "p2"]]));
    }
    case "opponentOffline": {
      const game = allPlaceRose(startGame({ players: count }));
      return scene(runScript(game, [["p1", "place", "rose"]]), "p1", { offline: ["p2"] });
    }
    case "timeout": {
      // 先手是 p1 前面隔一位的人；轮到 p1 前一位时他超时，系统替他盖了一张
      let game = allPlaceRose(startGame({ players: count, first: `p${count - 1}` }));
      game = runScript(game, [[`p${count - 1}`, "place", "rose"], ["timeout"]]);
      return scene(game, "p1", { turnRemainingMs: 4_000 });
    }
    case "autoPlay":
      return scene(runScript(startGame({ players: count }), [["timeout"]]), "p1", { auto: ["p1"] });
    case "eliminatedViewer":
      return scene(buildGame({
        round: 7,
        players: extras(count, [{ eliminated: true, eliminatedRound: 5 }, { stack: ["rose", "rose"] }, { stack: ["skull"], flowerUp: true }]),
        phase: "bidding",
        firstPlayer: "p2",
        bids: [{ type: "open", player: "p2", count: 2 }],
        turn: "p3",
      }));
    case "laterRound":
      return scene(laterRound(count));
  }
}

/** 用超时一路推进（大家随机盖，没垫子的人开叫 1，其余 pass），找一个打到第 4 轮还没结束的种子：有 3 轮历史记录。 */
function laterRound(count: number): GameState {
  for (let seed = 1; seed < 500; seed += 1) {
    let game = startGame({ players: count, seed });
    let guard = 0;
    while (game.round < 4 && game.phase !== "gameOver" && guard < 400) {
      game = timeoutTurn(game);
      guard += 1;
    }
    if (game.phase === "placeInitial" && game.round === 4) {
      // 第 4 轮再让一半人盖好
      const half = game.players.filter((player) => !player.eliminated).slice(0, 2);
      return runScript(game, half.map((player): ScriptStep => [player.id, { type: "placeFirst", discId: player.hand.find((disc) => !disc.lastChance)!.id! }]));
    }
  }
  throw new Error("找不到能打到第 4 轮的种子");
}

// ---------------------------------------------------------------- 4. 包成房间快照

export interface PreviewRoomOptions extends RoomFlags {
  /** 「我」的座位；不给用 scene.viewer。观战用 spectator: true。 */
  readonly viewer?: string;
  readonly spectator?: boolean;
  /** 观战看全部（房主打开「观战看底牌」）。 */
  readonly spectatorsSeeAll?: boolean;
  readonly rematch?: { readonly remainingMs: number; readonly acceptedIds: string[] };
}

/** 把局面包成服务器发给 viewer 的那种 LobbyRoomSnapshot（游戏已按视角裁剪）。成员的连接 id 是 "sock-<座位>"。 */
export function previewRoom(source: Scene | GameState, options: PreviewRoomOptions = {}): LobbyRoomSnapshot {
  const game = "game" in source && "viewer" in source ? source.game : (source as GameState);
  const flags: RoomFlags = { ...("room" in source ? source.room : {}), ...options };
  const viewer = options.viewer ?? ("viewer" in source ? source.viewer : "p1");
  const members: LobbyMember[] = game.players.map((player, index) => ({
    id: `sock-${player.id}`,
    playerId: player.id,
    name: player.name,
    isHost: index === 0,
    connected: !(flags.offline ?? []).includes(player.id),
    ...((flags.bots ?? []).includes(player.id) ? { bot: true } : {}),
    ...((flags.auto ?? []).includes(player.id) ? { auto: true } : {}),
  }));
  const seeAll = options.spectatorsSeeAll === true;
  return {
    code: options.spectator ? "" : "SKULL7",
    spectators: options.spectator ? [{ id: "sock-watcher", name: "看客" }] : [],
    access: { ...DEFAULT_ROOM_ACCESS, spectatorsSeeAll: seeAll },
    options: { lastChance: game.config.lastChance },
    capacity: Math.min(6, Math.max(3, game.players.length)) as Capacity,
    status: "playing",
    members,
    chat: [],
    voice: [],
    ...(flags.turnRemainingMs !== undefined ? { turnRemainingMs: flags.turnRemainingMs } : {}),
    ...(options.rematch ? { rematch: options.rematch } : {}),
    game: options.spectator ? redactGameForViewer(game, "", { seeAll }) : redactGameForViewer(game, viewer),
  };
}
