/**
 * 骷髅牌的新手教程剧本（补充文件 2.3 的四轮，引擎 TUTORIAL_SCRIPT 测过的同一套走法）。
 *
 * 教程在浏览器里直接跑规则引擎，不连服务器：3 个人（你 + 咕噜一号 + 咕噜二号），你先手；
 * 对手按剧本走，系统翻挑战者自己的垫子也是剧本里的一步（{ type: "auto" }）；
 * 两次随机失牌按剧本固定（第 2 轮你丢一朵玫瑰，第 3 轮一号丢的是骷髅，第 4 轮他手里才全是玫瑰）。
 * 剧本走完（你第 2 次成功、赢下整局）后接一局新的人机练习，对手交给人机。
 *
 * 和情书一样，do 步骤可以带 subs：盖牌要点两下（点一张选中 → 再点一下 / 点「盖上这张」），
 * 每一下高亮哪里、咕噜嘎说什么，看界面（when 条件）决定；剧本只认最后发出的那条命令。
 *
 * 垫子 id：教程局里把每张垫子的 id 换成「座位-牌面-序号」（比如 p1-rose-2），剧本就能写「盖一朵玫瑰」
 * 而不管是哪一朵（sameCommand 只比牌面）。这只在本地教程里，真实对局的 id 照旧不带牌面。
 *
 * 这份文件不碰 DOM，剧本单测（script.test.ts）直接跑。
 */
import {
  act,
  autoFlip,
  createGame,
  needsAdvance,
  redactGameForViewer,
  startGame,
  totalDiscsInPlay,
  waitingFor,
  legalActions,
  type Face,
  type GameCommand,
  type GameState,
} from "@skull/game";

/** 咕噜嘎的表情。 */
export type TutorialFace = "base" | "happy" | "surprised" | "think";

/**
 * 锚点：网页里 data-tutorial 的值。另外 `card:rose` / `card:skull` 指自己手里第一张那种牌面的垫子
 * （换算成 hand-disc-<下标>）。
 */
export type Anchor = string;

/** 界面条件（都满足才算）：present 元素在；enabled 元素在且能点；absent 元素不在。 */
export interface Cond {
  readonly present?: Anchor;
  readonly enabled?: Anchor;
  readonly absent?: Anchor;
}

/** 一步里的一下：高亮哪里、说什么。when 满足的最后一下就是现在这一下（第一下不写 when）。 */
export interface SubStep {
  readonly anchor: Anchor;
  readonly say: string;
  readonly note?: string;
  readonly noteTouch?: string;
  readonly when?: Cond;
}

/**
 * 教程里走的一步：玩家的 GameCommand；系统自动翻挑战者自己的一张（auto）；
 * 剧本里指定谁来走（as，同时行动的阶段 actor 不唯一，剧本里对手的每一步都写明是谁）。
 */
export type TutorialCommand =
  | GameCommand
  | { readonly type: "auto" }
  | { readonly type: "as"; readonly player: string; readonly command: GameCommand };

interface StepBase {
  readonly id: string;
  /** 侧栏进度里这一课叫什么；没有就不单独列。 */
  readonly lesson?: string;
  /** 主句（24px），一句话。 */
  readonly say: string;
  /** 补充（12px），最多一句（主句 + 补充最多两句，单测检查）。 */
  readonly note?: string;
  /** 触屏设备上换成这句。 */
  readonly noteTouch?: string;
  readonly anchor?: Anchor;
  readonly face?: TutorialFace;
  /** 要点好几下的步骤：每一下的高亮和说法（有它时 say / anchor 只用在单测和第一下之前）。 */
  readonly subs?: readonly SubStep[];
}

export type TutorialStep =
  /** 讲解：点「下一步」继续。finale 是最后一步。 */
  | (StepBase & { readonly kind: "info"; readonly finale?: boolean })
  /** 等玩家做这一步；做别的会被拦下。 */
  | (StepBase & { readonly kind: "do"; readonly expect: GameCommand })
  /** 对手（和系统翻牌）按剧本自动走，牌桌不压暗。 */
  | (StepBase & { readonly kind: "watch"; readonly moves: readonly TutorialCommand[] });

export const TUTORIAL_SELF = "p1";
export const RIVAL_1 = "p2";
export const RIVAL_2 = "p3";
/** 系统（自动翻挑战者自己的垫子）在 useTutorial 里当成一个「座位」。 */
export const SYSTEM = "system";
export const RIVAL_NAMES: Readonly<Record<string, string>> = { [RIVAL_1]: "咕噜一号", [RIVAL_2]: "咕噜二号" };

/** 剧本里固定的随机失牌（第几轮 → 谁失、失的是什么）。 */
const SCRIPTED_LOSS: Readonly<Record<number, { readonly player: string; readonly face: Face }>> = {
  2: { player: TUTORIAL_SELF, face: "rose" },
  3: { player: RIVAL_1, face: "skull" },
};

function renamePlayers(game: GameState, selfName: string): GameState {
  game.players = game.players.map((player) => ({
    ...player,
    name: player.id === TUTORIAL_SELF ? selfName : RIVAL_NAMES[player.id] ?? player.name,
  }));
  return game;
}

/** 垫子 id 换成「座位-牌面-序号」，剧本里「盖一朵玫瑰」就不用管是哪一朵。 */
function faceIds(game: GameState): GameState {
  game.players = game.players.map((player) => {
    const count: Record<string, number> = {};
    return {
      ...player,
      hand: player.hand.map((disc) => {
        const face = disc.face ?? "rose";
        count[face] = (count[face] ?? 0) + 1;
        return { ...disc, id: `${player.id}-${face}-${count[face]}` };
      }),
    };
  });
  return game;
}

/** 剧本开局：3 人，你先手，第 1 轮准备阶段。 */
export function createTutorialGame(selfName: string): GameState {
  return faceIds(renamePlayers(startGame({ players: 3, first: TUTORIAL_SELF, seed: 20261009 }), selfName));
}

/** 练习局：同样 3 个人，先手随机，普通的随机 id。 */
export function createPracticeGame(selfName: string, seed: number): GameState {
  return createGame(
    [
      { id: TUTORIAL_SELF, name: selfName },
      { id: RIVAL_1, name: RIVAL_NAMES[RIVAL_1]! },
      { id: RIVAL_2, name: RIVAL_NAMES[RIVAL_2]! },
    ],
    seed,
  );
}

/** id 里带的牌面（教程局的 id 是 p1-rose-2 这样）；剧本里直接写 "rose" / "skull" 也行。 */
export function faceOfId(id: string): Face | null {
  if (id === "rose" || id.includes("-rose-")) return "rose";
  if (id === "skull" || id.includes("-skull-")) return "skull";
  return null;
}

/** 剧本里写的 discId（"rose" / "skull"）换成这个人手里第一张那种牌面的真实 id。 */
function resolveDisc(state: GameState, playerId: string, command: GameCommand): GameCommand {
  if ((command.type === "placeFirst" || command.type === "placeDisc" || command.type === "loseDisc") && (command.discId === "rose" || command.discId === "skull")) {
    const player = state.players.find((candidate) => candidate.id === playerId);
    const pool = command.type === "loseDisc" ? [...(player?.hand ?? []), ...(player?.stack ?? [])] : player?.hand ?? [];
    const disc = pool.find((candidate) => !candidate.lastChance && candidate.face === command.discId);
    if (!disc?.id) throw new Error(`${playerId} 手里没有${command.discId === "rose" ? "玫瑰" : "骷髅"}`);
    return { ...command, discId: disc.id };
  }
  return command;
}

/**
 * 教程里走一步（不合法就抛错，引擎的中文错误信息）。
 * - auto：系统翻挑战者自己的一张；
 * - as：剧本里指定谁来走；
 * - 剧本进行中（script）：固定的随机失牌按 SCRIPTED_LOSS；你在结算画面点「继续」时，两个咕噜一起点。
 * 练习局里结算画面的「继续」由人机自己点（见 tutorialActor）。
 */
export function tutorialApply(state: GameState, playerId: string, command: TutorialCommand, script: boolean): GameState {
  if (command.type === "auto") return autoFlip(state);
  if (command.type === "as") return tutorialApply(state, command.player, command.command, script);
  const real = resolveDisc(state, playerId, command);
  const loss = script && real.type === "flipMat" ? SCRIPTED_LOSS[state.round] : undefined;
  let next = act(state, playerId, real, loss && loss.player === playerId ? loss.face : undefined);
  if (script && real.type === "nextRound") {
    for (const player of next.players) {
      if (next.phase !== "roundEnd") break;
      if (player.id !== playerId && !player.eliminated && !player.ready) next = act(next, player.id, { type: "nextRound" });
    }
  }
  return next;
}

/**
 * 现在等谁：系统要自动翻牌时是 SYSTEM；同时行动的阶段（准备、结算画面）先让人机走，人机都走完了才是你；
 * 终局没有人。
 */
export function tutorialActor(state: GameState): string | null {
  if (needsAdvance(state)) return SYSTEM;
  const waiting = waitingFor(state);
  return waiting.find((id) => id !== TUTORIAL_SELF) ?? waiting[0] ?? null;
}

/** 练习局里你现在能不能发命令（同时行动的阶段人机还没走完时你也能走）。 */
export function tutorialCanAct(state: GameState, playerId: string): boolean {
  return waitingFor(state).includes(playerId);
}

/** 两条命令是不是同一步。盖牌、丢牌只比牌面（剧本说「盖一朵玫瑰」，哪一朵都行）。 */
export function sameCommand(a: TutorialCommand, b: TutorialCommand): boolean {
  if (a.type !== b.type) return false;
  switch (a.type) {
    case "placeFirst":
    case "placeDisc":
    case "loseDisc":
      return faceOfId(a.discId) === faceOfId((b as typeof a).discId);
    case "openBid":
    case "raise":
      return a.count === (b as typeof a).count;
    case "flipMat":
    case "chooseFirstPlayer":
      return a.player === (b as typeof a).player;
    default:
      return true;
  }
}

/** 人机替 playerId 走一步（只给它裁剪后的局面）；系统那一步是 auto。 */
export function tutorialBot(state: GameState, playerId: string, bot: (view: GameState, id: string) => GameCommand | null): TutorialCommand | null {
  if (playerId === SYSTEM) return needsAdvance(state) ? { type: "auto" } : null;
  return bot(redactGameForViewer(state, playerId), playerId);
}

// ---------------------------------------------------------------------------
// 盖一张要点的两下

type PlaceCommand = Extract<GameCommand, { type: "placeFirst" | "placeDisc" }>;

/** 盖牌的两下：点那张垫子（选中）→ 点「盖上这张」（或者再点一下那张）。 */
export function placeSubs(command: PlaceCommand, first: readonly [string, string?], second?: readonly [string, string?]): SubStep[] {
  const card = `card:${faceOfId(command.discId) ?? "rose"}`;
  const [say2, note2] = second ?? ["点「盖上这张」（再点一下那张也行）。"];
  return [
    { anchor: card, say: first[0], ...(first[1] ? { note: first[1] } : {}) },
    { anchor: "place-button", say: say2, ...(note2 ? { note: note2 } : {}), when: { enabled: "place-button" } },
  ];
}

const placeFirst = (face: Face): PlaceCommand => ({ type: "placeFirst", discId: face });
const placeDisc = (face: Face): PlaceCommand => ({ type: "placeDisc", discId: face });
const by = (player: string, command: GameCommand): TutorialCommand => ({ type: "as", player, command });
const AUTO: TutorialCommand = { type: "auto" };

// ---------------------------------------------------------------------------
// 剧本

const R1_FIRST = placeFirst("rose");
const R1_SECOND = placeDisc("rose");
const R2_FIRST = placeFirst("rose");
const R3_FIRST = placeFirst("skull");
const R3_SECOND = placeDisc("rose");
const R4_FIRST = placeFirst("rose");
const R4_SECOND = placeDisc("rose");

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  // ---- 第 1 轮：怎么赢一轮 ----
  {
    kind: "info", id: "welcome", lesson: "目标", face: "happy",
    say: "骷髅牌：盖垫子、叫价、唬人，先成功翻牌 2 次的人赢。",
    note: "这局 3 个人：你、咕噜一号、咕噜二号，跟着我一步步来。",
  },
  {
    kind: "info", id: "discs", lesson: "垫子", anchor: "my-hand",
    say: "你手里有 3 朵玫瑰、1 个骷髅，背面一模一样。",
    note: "别人只看得到你盖了几张，看不出盖的是什么。",
  },
  {
    kind: "info", id: "goal", anchor: "my-mat",
    say: "这是你的垫板：当挑战者成功 1 次，它就翻到花面。",
    note: "带着花面再成功一次就赢；别人全被淘汰、只剩你，也算赢。",
  },
  {
    kind: "do", id: "r1-first", lesson: "同时盖第 1 张", expect: R1_FIRST, anchor: "card:rose",
    say: "每轮开头，大家同时扣着盖 1 张：点一朵玫瑰。",
    subs: placeSubs(R1_FIRST, ["每轮开头，大家同时扣着盖 1 张：点一朵玫瑰。", "两个咕噜也在同时盖，谁都看不到别人盖了什么。"]),
  },
  {
    kind: "watch", id: "w-r1-first", anchor: "center",
    say: "两个咕噜也盖好了。",
    moves: [by(RIVAL_1, placeFirst("rose")), by(RIVAL_2, placeFirst("rose"))],
  },
  {
    kind: "info", id: "total", anchor: "total",
    say: "这是场上总数：桌上一共盖着几张。",
    note: "叫价最多叫到场上总数，手里的不算。",
  },
  {
    kind: "info", id: "turn", lesson: "盖牌或开叫", anchor: "action-panel",
    say: "接着从先手起顺时针轮：轮到你时，再盖 1 张，或者开叫一个数。",
    note: "第一次轮到就可以直接开叫，不用先盖第 2 张。",
  },
  {
    kind: "do", id: "r1-second", expect: R1_SECOND, anchor: "card:rose",
    say: "这次先再盖一朵玫瑰。",
    subs: placeSubs(R1_SECOND, ["这次先再盖一朵玫瑰：点它。", "新盖的压在上面，翻牌时最先被翻到。"]),
  },
  {
    kind: "watch", id: "w-r1-bid", anchor: "center",
    say: "看两个咕噜怎么走。",
    moves: [by(RIVAL_1, placeDisc("rose")), by(RIVAL_2, { type: "openBid", count: 2 })],
  },
  {
    kind: "info", id: "bid-meaning", lesson: "叫价", anchor: "bid",
    say: "咕噜二号开叫 2：「我能连续翻开 2 张，一张骷髅都不碰到」。",
    note: "叫价最少 1，最多是场上总数，现在是 5。",
  },
  {
    kind: "info", id: "no-place", anchor: "action-panel",
    say: "有人开叫以后，谁都不能再盖牌了。",
    note: "轮到你只能加注（比现在高，加多少都行），或者点「过」。",
  },
  {
    kind: "do", id: "r1-raise", expect: { type: "raise", count: 3 }, anchor: "bid-button",
    say: "点「加到 3」。",
    note: "你板上 2 朵玫瑰，叫 3 只要再翻 1 张别人的。",
  },
  {
    kind: "watch", id: "w-r1-pass", anchor: "center",
    say: "两个咕噜都不跟了。",
    moves: [by(RIVAL_1, { type: "pass" }), by(RIVAL_2, { type: "pass" })],
  },
  {
    kind: "info", id: "pass", lesson: "过", anchor: `mat-${RIVAL_2}`,
    say: "过了这一轮就不能再加注，但他们板上的垫子还在，挑战者照样能翻。",
    note: "只剩一个人没过，他就是挑战者：这一轮是你。",
  },
  {
    kind: "info", id: "own-first", lesson: "翻牌", anchor: "my-mat", face: "think",
    say: "挑战者要先把自己板上的全部翻完，才能翻别人的。",
    note: "叫价比自己的张数少时，只翻顶上那几张。",
  },
  {
    kind: "watch", id: "w-r1-auto", anchor: "my-mat",
    say: "你的 2 张自动翻开……",
    moves: [AUTO, AUTO],
  },
  {
    kind: "do", id: "r1-flip", expect: { type: "flipMat", player: RIVAL_2 }, anchor: `mat-${RIVAL_2}`,
    say: "都是玫瑰，还差 1 张：点咕噜二号的板。",
    note: "每块板只能翻最上面那张；二号刚叫过 2，他顶上多半是玫瑰。",
  },
  {
    kind: "info", id: "r1-success", lesson: "成功", anchor: "my-mat", face: "happy",
    say: "翻满 3 张都是玫瑰：成功 1 次，你的垫板翻到了花面！",
    note: "带着花面再成功一次，就赢下整局。",
  },
  {
    kind: "do", id: "r1-next", expect: { type: "nextRound" }, anchor: "continue-button",
    say: "点「继续」开下一轮。",
    note: "翻开的垫子都收回手里，下一轮照样用。",
  },
  // ---- 第 2 轮：失败的代价 ----
  {
    kind: "do", id: "r2-first", lesson: "失败的代价", expect: R2_FIRST, anchor: "card:rose",
    say: "上一轮的挑战者这一轮先手，还是你。",
    subs: placeSubs(R2_FIRST, ["上一轮的挑战者这一轮先手，还是你：先盖一朵玫瑰。"]),
  },
  {
    kind: "watch", id: "w-r2-first", anchor: "center",
    say: "大家都盖好了，场上 3 张。",
    moves: [by(RIVAL_1, placeFirst("rose")), by(RIVAL_2, placeFirst("skull"))],
  },
  {
    kind: "do", id: "r2-open", expect: { type: "openBid", count: 1 }, anchor: "bid-button",
    say: "这次直接开叫：点「开叫 1」。",
    note: "先手第一次轮到也能直接叫，不用先盖第 2 张。",
  },
  {
    kind: "watch", id: "w-r2-bid", anchor: "center",
    say: "一号加到 2，二号过了。",
    moves: [by(RIVAL_1, { type: "raise", count: 2 }), by(RIVAL_2, { type: "pass" })],
  },
  {
    kind: "do", id: "r2-raise", expect: { type: "raise", count: 3 }, anchor: "bid-button",
    say: "点「加到 3」：叫到场上总数，没人能再加，直接开翻。",
    note: "叫到总数，就要把桌上的垫子全部翻开。",
  },
  {
    kind: "watch", id: "w-r2-auto", anchor: "my-mat",
    say: "先翻你自己的 1 张……",
    moves: [AUTO],
  },
  {
    kind: "do", id: "r2-flip-1", expect: { type: "flipMat", player: RIVAL_1 }, anchor: `mat-${RIVAL_1}`,
    say: "玫瑰。点咕噜一号的板。",
  },
  {
    kind: "do", id: "r2-flip-2", expect: { type: "flipMat", player: RIVAL_2 }, anchor: `mat-${RIVAL_2}`,
    say: "又是玫瑰。最后一张：点咕噜二号的板。",
  },
  {
    kind: "info", id: "r2-skull", anchor: `mat-${RIVAL_2}`, face: "surprised",
    say: "是骷髅：翻到骷髅马上停，挑战失败。",
    note: "只有挑战者受罚，骷髅的主人二号没事。",
  },
  {
    kind: "info", id: "r2-lost", lesson: "失牌", anchor: "round-result", face: "think",
    say: "翻到别人的骷髅，系统从你的垫子里随机丢掉 1 张。",
    note: "丢的是什么只有你知道，别人只看到你剩 3 张；丢掉的那张永远不回来。",
  },
  {
    kind: "do", id: "r2-next", expect: { type: "nextRound" }, anchor: "continue-button",
    say: "点「继续」：翻开的玫瑰都收回手里，只有丢掉的那张没了。",
    note: "挑战者没被淘汰，下一轮还是他先手。",
  },
  // ---- 第 3 轮：骷髅怎么坑人 ----
  {
    kind: "do", id: "r3-first", lesson: "骷髅当诱饵", expect: R3_FIRST, anchor: "card:skull",
    say: "这一轮当诱饵：先盖骷髅。",
    subs: placeSubs(R3_FIRST, ["这一轮当诱饵：点你的骷髅，先把它盖在最底下。"]),
  },
  {
    kind: "watch", id: "w-r3-first", anchor: "center",
    say: "两个咕噜也盖好了。",
    moves: [by(RIVAL_1, placeFirst("rose")), by(RIVAL_2, placeFirst("rose"))],
  },
  {
    kind: "do", id: "r3-second", expect: R3_SECOND, anchor: "card:rose",
    say: "再在上面盖一朵玫瑰。",
    subs: placeSubs(R3_SECOND, ["再在骷髅上面盖一朵玫瑰：点它。"]),
  },
  {
    kind: "watch", id: "w-r3-place", anchor: "center",
    say: "两个咕噜各再盖一张，场上 6 张。",
    moves: [by(RIVAL_1, placeDisc("rose")), by(RIVAL_2, placeDisc("rose"))],
  },
  {
    kind: "info", id: "r3-danger", anchor: "my-mat", face: "think",
    say: "你底下是骷髅、上面是玫瑰：叫 1，翻自己顶上那朵就够。",
    note: "千万别叫到 2：自己的必须先翻，第 2 张就是你自己的骷髅。",
  },
  {
    kind: "do", id: "r3-open", expect: { type: "openBid", count: 1 }, anchor: "bid-button",
    say: "点「开叫 1」。",
  },
  {
    kind: "watch", id: "w-r3-bid", anchor: "center",
    say: "一号直接加到 4，二号过了。",
    moves: [by(RIVAL_1, { type: "raise", count: 4 }), by(RIVAL_2, { type: "pass" })],
  },
  {
    kind: "do", id: "r3-pass", expect: { type: "pass" }, anchor: "pass-button",
    say: "你别跟：点「过」。",
    note: "一号要翻 4 张：他自己的 2 张，再翻别人的 2 张。",
  },
  {
    kind: "watch", id: "w-r3-flips", anchor: "my-mat",
    say: "一号翻完自己的，来翻你的板了……",
    moves: [AUTO, AUTO, by(RIVAL_1, { type: "flipMat", player: TUTORIAL_SELF }), by(RIVAL_1, { type: "flipMat", player: TUTORIAL_SELF })],
  },
  {
    kind: "info", id: "r3-decoy", anchor: "my-mat", face: "happy",
    say: "一号翻到了你的骷髅：他失败，丢了 1 张。",
    note: "你的骷髅保护了你：别人翻到它，受罚的是翻的人。",
  },
  {
    kind: "info", id: "emotes", lesson: "表情和亮牌", anchor: "emotes",
    say: "得意的时候点个快捷表情，它会冒在你头像上给大家看。",
    note: "唬人全靠气氛，没法当面嘴炮，就用表情。",
  },
  {
    kind: "watch", id: "w-r3-reveal", anchor: `seat-${RIVAL_2}`,
    say: "咕噜二号要亮牌了。",
    moves: [by(RIVAL_2, { type: "revealStack" })],
  },
  {
    kind: "info", id: "reveal", anchor: `seat-${RIVAL_2}`,
    say: "有人挑战失败时，其他人可以点「亮出我的垫子」，给大家看自己盖了什么。",
    note: "亮不亮随你，不亮就没人知道。",
  },
  {
    kind: "do", id: "r3-next", expect: { type: "nextRound" }, anchor: "continue-button",
    say: "点「继续」：一号是挑战者又没被淘汰，下一轮他先手。",
  },
  // ---- 第 4 轮：赢下整局 ----
  {
    kind: "info", id: "site", lesson: "超时和托管",
    say: "每一步都限时：超时系统替你走，连续 2 次超时就转托管（人机代打）。",
    note: "点「取消托管」就收回来；掉线了用原昵称和房间码回来，还是你的座位。",
  },
  {
    kind: "do", id: "r4-first", lesson: "赢下整局", expect: R4_FIRST, anchor: "card:rose",
    say: "最后一轮，先盖一朵玫瑰。",
    subs: placeSubs(R4_FIRST, ["最后一轮，先盖一朵玫瑰。"]),
  },
  {
    kind: "watch", id: "w-r4-first", anchor: "center",
    say: "一号先手，两个咕噜都再盖了一张。",
    moves: [by(RIVAL_1, placeFirst("rose")), by(RIVAL_2, placeFirst("rose")), by(RIVAL_1, placeDisc("rose")), by(RIVAL_2, placeDisc("rose"))],
  },
  {
    kind: "do", id: "r4-second", expect: R4_SECOND, anchor: "card:rose",
    say: "再盖一朵玫瑰。",
    subs: placeSubs(R4_SECOND, ["再盖一朵玫瑰：你板上 2 朵，手里只剩骷髅。"]),
  },
  {
    kind: "watch", id: "w-r4-place", anchor: "center",
    say: "两个咕噜又各盖一张，场上 8 张。",
    moves: [by(RIVAL_1, placeDisc("rose")), by(RIVAL_2, placeDisc("rose"))],
  },
  {
    kind: "do", id: "r4-open", expect: { type: "openBid", count: 2 }, anchor: "bid-panel",
    say: "你板上 2 朵玫瑰，叫 2 一定翻得过：点「+」调到 2，再点「开叫 2」。",
    note: "自己板上的先翻，自己盖的最靠得住。",
  },
  {
    kind: "watch", id: "w-r4-end", anchor: "my-mat",
    say: "两个咕噜都过了，翻你自己的 2 张……",
    moves: [by(RIVAL_1, { type: "pass" }), by(RIVAL_2, { type: "pass" }), AUTO, AUTO],
  },
  {
    kind: "info", id: "win", anchor: "final", face: "happy",
    say: "两朵玫瑰，第 2 次成功：你赢下整局！",
    note: "另一种赢法是活到最后：别人都被淘汰。",
  },
  {
    kind: "info", id: "tip-must-bid", lesson: "两条小贴士", face: "think",
    say: "垫子丢光就淘汰；手里没垫子时，轮到你必须开叫，不能跳过。",
    note: "只剩 1 张的人，每轮盖完它就只能叫价。",
  },
  {
    kind: "info", id: "tip-self-skull", face: "think",
    say: "翻到自己的骷髅也算失败，这时丢哪张由你自己挑。",
    note: "被淘汰的挑战者：栽在别人的骷髅上，骷髅主人下一轮先手；栽在自己的骷髅上，由他指定先手。",
  },
  {
    kind: "info", id: "finale", finale: true, face: "happy",
    say: "你已经会玩了！",
    note: "接着和两个咕噜练一局吧，拿不准就点「提示」，我告诉你我会怎么打。",
  },
];

// ---------------------------------------------------------------------------
// 给单测和网页用的小工具

/** 锚点换算：card:<牌面> → hand-disc-<下标>（自己手里第一张那种牌面）；找不到时原样返回（界面上就不会有）。 */
export function resolveAnchor(state: GameState, anchor: Anchor, viewer = TUTORIAL_SELF): string {
  if (!anchor.startsWith("card:")) return anchor;
  const face = anchor.slice(5);
  const me = state.players.find((player) => player.id === viewer);
  const index = me?.hand.findIndex((disc) => !disc.lastChance && disc.face === face) ?? -1;
  return index >= 0 ? `hand-disc-${index}` : anchor;
}

/**
 * 这一步一开始（还没点任何东西时）高亮的锚点，在这个局面下界面上应该看得见吗（剧本单测用，
 * 对应 GameBoard 的显示条件）。只管剧本里用到的锚点。
 */
export function anchorVisible(state: GameState, anchor: Anchor, viewer = TUTORIAL_SELF): boolean {
  const me = state.players.find((player) => player.id === viewer);
  if (!me) return false;
  const actions = legalActions(state, viewer);
  const has = (type: GameCommand["type"]) => actions.some((action) => action.type === type);
  if (anchor.startsWith("card:")) {
    const face = anchor.slice(5);
    return (has("placeFirst") || has("placeDisc") || has("loseDisc")) && me.hand.some((disc) => disc.face === face);
  }
  switch (anchor) {
    case "my-hand":
      return !me.eliminated;
    case "my-mat":
    case "my-seat":
    case "my-plate":
    case "total":
    case "bid":
    case "center":
    case "round-result":
    case "action-panel":
    case "prompt":
    case "emotes":
      return true;
    case "place-button":
      return has("placeFirst") || has("placeDisc");
    case "bid-panel":
    case "bid-button":
      return has("openBid") || has("raise");
    case "pass-button":
      return has("pass");
    case "continue-button":
      return has("nextRound");
    case "final":
      return state.phase === "gameOver";
    default:
      break;
  }
  const seat = /^(mat|seat|plate)-(p\d)$/.exec(anchor);
  if (seat) return state.players.some((player) => player.id === seat[2] && player.id !== viewer);
  return false;
}

/** 场上总数（单测核对剧本数字用）。 */
export const tableTotal = totalDiscsInPlay;

/** 一段话里有几句（按句末的 。！？ 数；最后没有句末标点的半句也算一句；省略号结尾算一句）。 */
export function sentences(text: string | undefined): number {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) return 0;
  const ends = trimmed.match(/[。！？]/g)?.length ?? 0;
  return ends + (/[。！？]$/.test(trimmed) ? 0 : 1);
}
