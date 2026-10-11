import { useEffect, useRef } from "react";
import type { GameState } from "@skull/game";
import { sfx, synth } from "./gm-sound.js";
import { FLIP_MS } from "./pieces.js";

/**
 * 骷髅牌的动作音效。声音都走共用的 gm-sound.tsx（♪ 面板「音效」那一路），这里按引擎每一步的 events
 * （GameState.events，version 每个动作加 1）决定响什么，时间和 GameBoard 的翻牌悬念动画对齐：
 *
 * - 盖垫子（准备时大家同时盖、轮流时一张张盖）：一张皮垫子扣在垫板上的闷响
 * - 开叫 / 加价：一声「喊价」，叫得越多音越高；放弃：pass
 * - 发起挑战（招牌）：一阵越来越快的鼓点
 * - 翻牌：先一声翻动，悬念停顿后揭晓——翻到花是一声清亮的铃，翻到骷髅是 bust + 一声低沉的怪响（招牌）
 * - 新的一轮：把垫子收回手里；挑战成功：得分；失去垫子：hit；有人出局：boom；Last Chance 碟：sparkle；失败后亮出自己的垫子：reveal
 * - 轮到你、超时被代做、终局输赢、最后 5 秒倒计时用共用提示音
 *
 * 自己的动作（翻牌算挑战者的）mine=true，别人的减半；观战都算别人的。
 * 第一次拿到局面（进房间、重连、观战）不出声，一下跳了好几步不出声。
 */

/** 开发时把响过的声音名字记在 window.__sfxLog（别人的动作带「@他」），给自测脚本看。 */
function log(name: string, mine = true) {
  if (import.meta.env.DEV) {
    const w = window as unknown as { __sfxLog?: string[] };
    (w.__sfxLog ??= []).push(mine ? name : `${name}@他`);
  }
}

const { tone, noise, level, jitter } = synth;
const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms);

export const skullSfx = {
  /** 皮垫子扣在垫板上：低沉的「噗」。 */
  place(mine: boolean) {
    log("place", mine);
    const v = level(mine);
    noise({ duration: 0.07, volume: 0.32 * v, filter: "lowpass", freq: 900 * jitter(), freqTo: 300 });
    tone(150 * jitter(), { duration: 0.1, volume: 0.2 * v, type: "triangle", glideTo: 110 });
    noise({ at: 0.015, duration: 0.03, volume: 0.08 * v, freq: 2600, q: 1.2 });
  },
  /** 喊价：叫得越多音越高。 */
  bid(count: number, raise: boolean, mine: boolean) {
    log(raise ? "raise" : "openBid", mine);
    const v = level(mine);
    const base = 392 * 2 ** (Math.min(count, 12) / 12);
    tone(base, { duration: 0.1, volume: 0.13 * v, type: "square" });
    tone(base * 1.5, { at: 0.09, duration: 0.18, volume: 0.11 * v, type: "square" });
    noise({ duration: 0.04, volume: 0.12 * v, filter: "lowpass", freq: 800 });
  },
  pass(mine: boolean) {
    log("pass", mine);
    sfx.pass(mine);
  },
  /** 招牌：发起挑战，一阵越来越快的鼓点。 */
  challenge(mine: boolean) {
    log("challenge", mine);
    const v = level(mine);
    let at = 0;
    for (let i = 0; i < 8; i += 1) {
      noise({ at, duration: 0.05, volume: (0.18 + i * 0.03) * v, filter: "lowpass", freq: 700 });
      tone(110 + i * 6, { at, duration: 0.07, volume: (0.12 + i * 0.02) * v, type: "triangle" });
      at += 0.14 - i * 0.012;
    }
  },
  flip(mine: boolean) {
    log("flip", mine);
    sfx.flip(mine);
  },
  /** 翻到花：清亮的一声铃。 */
  rose(mine: boolean) {
    log("rose", mine);
    sfx.reveal(mine);
    const v = level(mine);
    tone(1047, { at: 0.05, duration: 0.3, volume: 0.12 * v, type: "triangle" });
    tone(1568, { at: 0.12, duration: 0.35, volume: 0.09 * v, type: "triangle" });
  },
  /** 招牌：翻到骷髅，bust + 一声不和谐的低沉怪响。 */
  skull(mine: boolean) {
    log("skull", mine);
    sfx.bust(mine);
    const v = level(mine);
    tone(147, { duration: 0.55, volume: 0.16 * v, type: "sawtooth", glideTo: 73 });
    tone(156, { duration: 0.55, volume: 0.12 * v, type: "sawtooth", glideTo: 78 });
    noise({ duration: 0.35, volume: 0.2 * v, filter: "lowpass", freq: 500, freqTo: 100 });
  },
  success(mine: boolean) {
    log("success", mine);
    sfx.score(mine, true);
  },
  lose(mine: boolean) {
    log("loseDisc", mine);
    sfx.hit(mine);
  },
  eliminated(mine: boolean) {
    log("eliminated", mine);
    sfx.boom(mine);
  },
  lastChance(mine: boolean) {
    log("lastChance", mine);
    sfx.sparkle(mine);
  },
  revealStack(mine: boolean) {
    log("revealStack", mine);
    sfx.reveal(mine);
  },
  /** 新的一轮：大家把垫子收回手里。 */
  newRound() {
    log("newRound");
    sfx.draw(true, 3);
  },
  firstChosen(mine: boolean) {
    log("chooseFirst", mine);
    sfx.place(mine);
  },
};

function cue(name: "yourTurn" | "timeout" | "gameOver", won = false) {
  log(name === "gameOver" ? (won ? "gameOver:win" : "gameOver:lose") : name);
  if (name === "gameOver") sfx.gameOver(won);
  else sfx[name]();
}

/**
 * game：引擎局面；myId：自己的玩家 id（观战传 ""）；needMe：现在要自己做决定（不算「继续」「亮出垫子」）；
 * turnKey：阶段 + 轮到谁 + 第几轮，同一个 turnKey 里只提示一次「轮到你」（挑战时一张张翻不会每张都响）。
 */
export function useGameSfx(game: GameState, myId: string, needMe: boolean, turnKey: string) {
  const seen = useRef(-1);
  useEffect(() => {
    const before = seen.current;
    seen.current = game.version;
    if (before < 0 || game.version === before) return;
    // 跳了好几步（重连）或换了一局：不出声
    if (game.version !== before + 1) return;

    const failed = game.events.some((e) => e.type === "ChallengeFailed");
    let hold = 0;
    for (const e of game.events) {
      if (e.type !== "DiscRevealed") continue;
      const mine = e.challenger === myId;
      const ms = FLIP_MS[e.auto ? "flipFast" : "flip"];
      hold = Math.max(hold, ms);
      skullSfx.flip(mine);
      later(ms - 60, () => (e.face === "skull" ? skullSfx.skull(mine) : skullSfx.rose(mine)));
    }
    const freeze = failed ? hold + 1600 : 0;

    let placed = 0;
    for (const e of game.events) {
      const mine = "player" in e && e.player === myId;
      switch (e.type) {
        case "RoundStarted":
          skullSfx.newRound();
          break;
        case "DiscPlaced":
          later(placed * 70, () => skullSfx.place(mine));
          placed += 1;
          break;
        case "LastChanceGiven":
        case "LastChanceEarned":
          if (e.player === myId) later(300, () => skullSfx.lastChance(true));
          break;
        case "BidOpened":
          skullSfx.bid(e.count, false, mine);
          break;
        case "BidRaised":
          skullSfx.bid(e.count, true, mine);
          break;
        case "Passed":
          skullSfx.pass(mine);
          break;
        case "ChallengeStarted":
          later(250, () => skullSfx.challenge(e.challenger === myId));
          break;
        case "ChallengeSucceeded":
          later(hold + 100, () => skullSfx.success(e.challenger === myId));
          break;
        case "DiscLost":
          later(freeze, () => skullSfx.lose(mine));
          break;
        case "PlayerEliminated":
          later(freeze + 300, () => skullSfx.eliminated(mine));
          break;
        case "FirstPlayerChosen":
          if (!e.auto) skullSfx.firstChosen(e.by === myId);
          break;
        case "StackRevealed":
          skullSfx.revealStack(mine);
          break;
        case "TimedOut":
          if (mine) cue("timeout");
          break;
        case "GameEnded":
          later(Math.max(hold, freeze) + 1200, () => cue("gameOver", e.winner === myId));
          break;
        default:
          break;
      }
    }
  }, [game.version]);

  // 轮到你：要自己做决定的那一刻（GameBoard 等翻牌悬念播完才算轮到）
  const cued = useRef(needMe ? turnKey : "");
  useEffect(() => {
    if (!needMe || cued.current === turnKey) return;
    cued.current = turnKey;
    later(150, () => cue("yourTurn"));
  }, [needMe, turnKey]);
}
