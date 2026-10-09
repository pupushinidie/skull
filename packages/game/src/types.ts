/**
 * 骷髅牌（Skull）的状态、命令和事件。
 *
 * 记号：座位顺序（players 数组的顺序）就是顺时针顺序。垫子（disc）有两种牌面：玫瑰 rose、骷髅 skull。
 * 板上的垫子 stack 从底到顶排：stack[0] 是准备阶段盖的那张（最底），最后一个是最上面那张（最先被翻）。
 *
 * 隐藏信息：引擎里每张垫子都带 id 和 face；发给某个视角之前一律经过 redactGameForViewer：
 * - 别人手里、板上没翻开的垫子只剩一个空对象（只能数张数），没有 id，也没有 face；
 * - 别人翻开的垫子只有 face（没有 id，免得跨轮追踪同一张）；
 * - Last Chance 碟（变体）牌面公开，任何视角都带 lastChance 和 face；
 * - 失掉的是什么只写在失牌人自己的 lost 和自己那份 DiscLost 事件里；
 * - 种子、随机数状态、动作序列只在服务器。
 */

export type Face = "rose" | "skull";

export type Phase =
  /** 准备：所有存活玩家同时扣着盖第 1 张。 */
  | "placeInitial"
  /** 轮流：轮到的人盖一张或开叫。 */
  | "placeOrBid"
  /** 加注：轮到的人加注或 pass。 */
  | "bidding"
  /** 揭牌：挑战者自己的板由系统自动逐张翻（awaitingMatChoice=false）；翻完还要翻时等挑战者选板（awaitingMatChoice=true）。 */
  | "resolving"
  /** 挑战者翻到自己的骷髅：自己挑一张丢掉。 */
  | "loseChoosing"
  /** 挑战者被自己的骷髅淘汰：由他指定下一轮先手。 */
  | "chooseFirst"
  /** 一轮结算画面：成功 / 失败的结果；失败时其他人可以亮出自己的垫子。所有存活玩家点「继续」或到时自动开下一轮。 */
  | "roundEnd"
  | "gameOver";

/** 有人要做决定、到时会自动处理的阶段（roundEnd 到时自动开下一轮，不算超时）。 */
export type TimedPhase = "placeInitial" | "placeOrBid" | "bidding" | "resolving" | "loseChoosing" | "chooseFirst";

/** 开房选项。 */
export interface GameOptions {
  /** Last Chance 碟变体：挑战失败后只剩 1 张垫子的人，下一轮多拿一张大家都知道是玫瑰的碟子。默认关。 */
  readonly lastChance: boolean;
}

export const DEFAULT_GAME_OPTIONS: GameOptions = { lastChance: false };

export interface Config extends GameOptions {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  /** 每人开局几张玫瑰、几张骷髅（3 和 1）。 */
  readonly roses: number;
  readonly skulls: number;
  /** 各步骤限时（秒），超时自动处理，见 timeoutCommand。 */
  readonly timeouts: Readonly<Record<TimedPhase, number>>;
  /** 结算画面停留多久自动开下一轮（毫秒）：成功 / 失败（失败留久一点，给人点「亮出我的垫子」）。 */
  readonly roundEndMs: number;
  readonly roundEndFailMs: number;
  /** 系统自动翻挑战者自己的垫子时，每翻一张前停多久（毫秒，服务器用）。 */
  readonly flipPauseMs: number;
}

/**
 * 一张垫子。引擎内部 id、face 都有；别人视角里没翻开的是空对象 {}（只用来数张数）。
 * id 是开局用种子随机生成的短串，不带牌面信息。
 */
export interface Disc {
  readonly id?: string;
  readonly face?: Face;
  /** Last Chance 碟（变体）：牌面一定是玫瑰，所有人都知道；只在持碟那一轮存在。 */
  readonly lastChance?: true;
}

/** 板上的一张。 */
export interface StackDisc extends Disc {
  /** 本轮挑战（或失败后自愿亮牌）时已经翻开：翻开的牌面所有人都看得到。 */
  readonly revealed: boolean;
}

export interface Player {
  readonly id: string;
  readonly name: string;
  /** 座位色 0–5，按入座顺序；也是顺时针顺序。 */
  readonly color: number;
  /** 手里没盖出去的垫子（含 Last Chance 碟）。 */
  hand: Disc[];
  /** 本轮盖在板上的垫子，从底到顶。 */
  stack: StackDisc[];
  /** 垫板已经翻到花面（成功过 1 次）。 */
  flowerUp: boolean;
  eliminated: boolean;
  /** 被淘汰的那一轮（没淘汰为 null）。 */
  eliminatedRound: number | null;
  /** 本轮加注阶段已 pass（pass 后这一轮不能再做任何事，垫子留在板上）。 */
  passed: boolean;
  /** 本轮准备阶段已盖第 1 张（公开的只是「盖没盖」）。 */
  placedInitial: boolean;
  /** 结算画面已点「继续」。 */
  ready: boolean;
  /** 持有 Last Chance 碟的那一轮（变体）。在那一轮开头碟子进手里，那一轮结束收走；没拿过为 null。公开。 */
  lastChanceRound: number | null;
  /** 一共失掉过几张自己的垫子（公开，不含 Last Chance 碟）。 */
  lostCount: number;
  /** 失掉过的牌面，按先后（只有自己看得到；别人视角里没有这个字段）。 */
  lost?: Face[];
}

/** 本轮叫价记录里的一条。 */
export type BidAction =
  | { readonly type: "open"; readonly player: string; readonly count: number }
  | { readonly type: "raise"; readonly player: string; readonly count: number }
  | { readonly type: "pass"; readonly player: string };

/** 本轮盖牌记录里的一条（谁、是不是准备阶段那张、是不是 Last Chance 碟；不含牌面）。 */
export interface PlacementRecord {
  readonly player: string;
  /** 准备阶段同时盖的第 1 张。 */
  readonly initial: boolean;
  readonly lastChance?: true;
}

/** 挑战时翻开的一张。 */
export interface FlipRecord {
  /** 翻的是谁的板。 */
  readonly owner: string;
  /** 从底往上第几张（0 = 准备阶段盖的那张）。 */
  readonly depth: number;
  readonly face: Face;
  readonly lastChance?: true;
  /** true：挑战者自己的板，系统自动翻；false：挑战者选的别人的板。 */
  readonly auto: boolean;
}

/**
 * 失牌方式（公开；失的是什么不公开）：
 * - chosen：翻到自己的骷髅，自己挑一张丢（超时则随机）；
 * - forced：翻到自己的骷髅但一共只剩 1 张，没得挑，直接丢掉并淘汰；
 * - random：翻到别人的骷髅，系统随机丢一张（相当于骷髅主人盲抽）；
 * - lastChance：持 Last Chance 碟的那一轮当挑战者失败，碟子和最后一张一起失去，直接淘汰。
 */
export type LossMethod = "chosen" | "forced" | "random" | "lastChance";

export interface LossRecord {
  readonly player: string;
  readonly method: LossMethod;
  /** 丢了几张自己的垫子（不含碟子，总是 1）。 */
  readonly count: number;
  readonly eliminated: boolean;
}

/** 失败后某人自愿亮出的垫子（板上当时没翻开的全部，从底往上的深度）。 */
export interface VoluntaryReveal {
  readonly player: string;
  readonly discs: { readonly depth: number; readonly face: Face; readonly lastChance?: true }[];
}

/** 一轮的公开记录（人机、回放、界面的历史面板用）。当前这一轮在 GameState.roundLog，打完的在 history。 */
export interface RoundLog {
  readonly round: number;
  readonly firstPlayer: string;
  /** 盖牌顺序。 */
  placements: PlacementRecord[];
  /** 叫价序列：开叫、加注、pass。 */
  bids: BidAction[];
  /** 开始挑战那一刻各家板上的张数（玩家 id → 张数）；还没开始挑战为空对象。 */
  stackSizes: Record<string, number>;
  challenger: string | null;
  /** 挑战者要翻的张数（最终叫价）。 */
  bid: number;
  /** 挑战时翻开的垫子，按翻的先后。 */
  flips: FlipRecord[];
  result: "success" | "fail" | null;
  /** 翻出来的骷髅是谁的（失败时）。 */
  skullOwner: string | null;
  loss: LossRecord | null;
  /** 这一轮失败后拿到 Last Chance 碟（下一轮用）的人。 */
  lastChanceEarned: string | null;
  /** 失败后自愿亮牌的人。 */
  reveals: VoluntaryReveal[];
  /** 下一轮先手。 */
  nextFirst: string | null;
  /** 下一轮先手是谁指定的（自淘汰的挑战者；其余情况为 null）；nextFirstAuto 表示超时 / 代打自动选的。 */
  nextFirstChosenBy: string | null;
  nextFirstAuto: boolean;
}

export type GameCommand =
  /** placeInitial：盖第 1 张。 */
  | { readonly type: "placeFirst"; readonly discId: string }
  /** placeOrBid：再盖一张（手里有垫子、还没人开叫）。 */
  | { readonly type: "placeDisc"; readonly discId: string }
  /** placeOrBid：开叫，1 ≤ count ≤ 场上总数。叫到总数直接开始挑战。 */
  | { readonly type: "openBid"; readonly count: number }
  /** bidding：加注，当前叫价 < count ≤ 场上总数。叫到总数直接开始挑战。 */
  | { readonly type: "raise"; readonly count: number }
  /** bidding：pass，这一轮不能再加注。 */
  | { readonly type: "pass" }
  /** resolving：挑战者翻 player 板上最上面一张没翻开的。 */
  | { readonly type: "flipMat"; readonly player: string }
  /** loseChoosing：挑战者丢掉自己的一张（手里或板上的，不能是 Last Chance 碟）。 */
  | { readonly type: "loseDisc"; readonly discId: string }
  /** chooseFirst：刚被自己骷髅淘汰的挑战者指定下一轮先手（必须是存活玩家）。 */
  | { readonly type: "chooseFirstPlayer"; readonly player: string }
  /** roundEnd：点「继续」。所有存活玩家都点了就开下一轮。 */
  | { readonly type: "nextRound" }
  /** roundEnd（只在挑战失败时）：挑战者以外的存活玩家把自己板上没翻开的垫子全部公开。 */
  | { readonly type: "revealStack" };

export type GameEvent =
  | { readonly type: "RoundStarted"; readonly round: number; readonly firstPlayer: string }
  /** 本轮开头 Last Chance 碟进了这个人的手里。 */
  | { readonly type: "LastChanceGiven"; readonly player: string }
  /** 有人盖了一张（不含牌面）；stackSize 是盖完后板上张数。 */
  | { readonly type: "DiscPlaced"; readonly player: string; readonly initial: boolean; readonly stackSize: number; readonly lastChance?: true }
  /** 准备阶段大家都盖好了，进入轮流。 */
  | { readonly type: "PlacementDone"; readonly firstPlayer: string }
  | { readonly type: "BidOpened"; readonly player: string; readonly count: number }
  | { readonly type: "BidRaised"; readonly player: string; readonly count: number }
  | { readonly type: "Passed"; readonly player: string }
  | { readonly type: "ChallengeStarted"; readonly challenger: string; readonly bid: number }
  /** 挑战者翻开一张。flipsLeft 是翻完这张后还差几张。 */
  | {
      readonly type: "DiscRevealed";
      readonly challenger: string;
      readonly owner: string;
      readonly depth: number;
      readonly face: Face;
      readonly auto: boolean;
      readonly flipsLeft: number;
      readonly lastChance?: true;
    }
  /** 挑战成功；won 为 true 表示这是第 2 次成功，赢下整局。 */
  | { readonly type: "ChallengeSucceeded"; readonly challenger: string; readonly won: boolean }
  | { readonly type: "ChallengeFailed"; readonly challenger: string; readonly skullOwner: string; readonly selfSkull: boolean }
  /** 挑战者失牌。face 只出现在失牌人自己的视角里；remaining 是失牌后自己还剩几张（不含碟子）。 */
  | { readonly type: "DiscLost"; readonly player: string; readonly method: LossMethod; readonly remaining: number; readonly face?: Face }
  | { readonly type: "PlayerEliminated"; readonly player: string }
  /** 失败后只剩 1 张：下一轮拿 Last Chance 碟（变体开时）。 */
  | { readonly type: "LastChanceEarned"; readonly player: string }
  | { readonly type: "FirstPlayerChosen"; readonly by: string; readonly player: string; readonly auto: boolean }
  /** 本轮结算完，进入结算画面。 */
  | { readonly type: "RoundEnded"; readonly round: number; readonly result: "success" | "fail"; readonly nextFirst: string }
  /** 失败后有人自愿亮出板上没翻开的垫子（从底往上的深度和牌面）。 */
  | { readonly type: "StackRevealed"; readonly player: string; readonly discs: { readonly depth: number; readonly face: Face; readonly lastChance?: true }[] }
  | { readonly type: "PlayerReady"; readonly player: string }
  | { readonly type: "GameEnded"; readonly winner: string; readonly reason: "twoWins" | "lastStanding" }
  /** 这一步超时，系统替他做了 timeoutCommand。 */
  | { readonly type: "TimedOut"; readonly player: string; readonly phase: Phase };

export interface FinalResult {
  readonly winner: string;
  /** twoWins：第 2 次挑战成功；lastStanding：别人都淘汰了。 */
  readonly reason: "twoWins" | "lastStanding";
}

/** 服务器日志里的一条动作（复盘用；不下发）。AUTO 是系统自动翻挑战者自己的垫子，TIMEOUT 是整步超时。 */
export interface LogEntry {
  readonly player: string;
  readonly command: GameCommand | { readonly type: "TIMEOUT" } | { readonly type: "AUTO" };
}

export interface GameState {
  readonly config: Config;
  phase: Phase;
  /** 座位顺序 = 顺时针。 */
  players: Player[];
  /** 第几轮，从 1 开始。 */
  round: number;
  /** 本轮先手。 */
  firstPlayer: string;
  /**
   * 现在轮到谁做单人决定：placeOrBid / bidding 是轮到的人；resolving / loseChoosing / chooseFirst 是挑战者；
   * placeInitial、roundEnd、gameOver 为 null（谁该动看 waitingFor）。
   */
  turn: string | null;
  /** 当前最高叫价（0 = 还没人开叫）和叫的人。 */
  bid: number;
  bidder: string | null;
  challenger: string | null;
  /** 揭牌时还差几张要翻。 */
  flipsToDo: number;
  /** resolving 里：挑战者自己的已翻完，等他选下一块板。false 时由系统自动翻他自己的。 */
  awaitingMatChoice: boolean;
  /** 翻出的骷髅是挑战者自己的（失败时）。 */
  selfSkull: boolean;
  /** 下一轮先手（结算时定下；chooseFirst 阶段还没定为 null）。 */
  nextFirst: string | null;
  /** 当前这一轮的公开记录。 */
  roundLog: RoundLog;
  /** 打完的各轮公开记录（旧的在前）。 */
  history: RoundLog[];
  /** 获胜者（终局后 1 个人；不会并列）。 */
  winners: string[];
  result: FinalResult | null;
  /** 最近一步产生的事件（已按视角裁剪）。 */
  events: GameEvent[];
  /** 每个动作 +1；网页据此判断有没有新变化（触发动画）。 */
  version: number;
  /** 计时用：换人、换步骤、系统每翻一张时 +1；别人的轮外操作（准备阶段盖牌、结算时点继续 / 亮牌）不变。服务器的计时 key 见 stepKey。 */
  step: number;
  /** 以下只在服务器：种子、随机数状态、动作序列。 */
  seed?: number;
  rngState?: number;
  log?: LogEntry[];
}
