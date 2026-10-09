import { describe, expect, it } from "vitest";
import {
  botCommand,
  checkInvariants,
  legalActions,
  needsAdvance,
  redactGameForViewer,
  startGame,
  runScript,
  totalDiscsInPlay,
  TUTORIAL_SCRIPT,
  type GameState,
} from "@skull/game";
import {
  anchorVisible,
  createPracticeGame,
  createTutorialGame,
  resolveAnchor,
  RIVAL_1,
  RIVAL_2,
  sameCommand,
  sentences,
  SYSTEM,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  tutorialApply,
  tutorialBot,
  tutorialCanAct,
  type TutorialCommand,
} from "./script.js";

const NAME = "小蒲";

/** 按剧本走到第 upTo 步之前（不含），返回那时的局面。 */
function playScript(upTo = TUTORIAL_STEPS.length): GameState {
  let game = createTutorialGame(NAME);
  for (const step of TUTORIAL_STEPS.slice(0, upTo)) {
    if (step.kind === "do") game = tutorialApply(game, TUTORIAL_SELF, step.expect, true);
    if (step.kind === "watch") for (const move of step.moves) game = tutorialApply(game, tutorialActor(game)!, move, true);
  }
  return game;
}

const after = (id: string) => playScript(TUTORIAL_STEPS.findIndex((step) => step.id === id) + 1);
const before = (id: string) => playScript(TUTORIAL_STEPS.findIndex((step) => step.id === id));
const player = (game: GameState, id: string) => game.players.find((candidate) => candidate.id === id)!;
const discs = (game: GameState, id: string) => player(game, id).hand.length + player(game, id).stack.length;

describe("骷髅牌新手教程剧本", () => {
  it("从头走到尾：要你做的都合法，对手和系统的每一步合法，高亮的东西在那时看得见", () => {
    let game = createTutorialGame(NAME);
    for (const step of TUTORIAL_STEPS) {
      const first = step.subs?.[0]?.anchor ?? step.anchor;
      if (first) expect(anchorVisible(game, first), `「${step.id}」高亮的 ${first} 看不见`).toBe(true);
      if (first?.startsWith("card:")) expect(resolveAnchor(game, first), `「${step.id}」的 ${first} 换算不出`).toMatch(/^hand-disc-\d$/);
      if (step.kind === "do") {
        const legal = legalActions(game, TUTORIAL_SELF);
        expect(legal.some((action) => sameCommand(action, step.expect)), `「${step.id}」要你做的不在合法行动里`).toBe(true);
        expect(needsAdvance(game), `「${step.id}」时系统还要翻牌`).toBe(false);
        game = tutorialApply(game, TUTORIAL_SELF, step.expect, true);
      }
      if (step.kind === "watch") {
        for (const move of step.moves) {
          if (move.type === "auto") expect(needsAdvance(game), `「${step.id}」这时没有要系统翻的`).toBe(true);
          if (move.type === "as") {
            const legal = legalActions(game, move.player);
            expect(legal.some((action) => sameCommand(action, move.command)), `「${step.id}」${move.player} 的 ${move.command.type} 不合法`).toBe(true);
          }
          game = tutorialApply(game, tutorialActor(game)!, move, true);
        }
      }
      // 讲解步骤之后的锚点（第二下）在那一刻也要成立：盖牌的「盖上这张」要在能盖的时候
      for (const sub of step.subs ?? []) {
        if (sub.anchor === "place-button") expect(step.kind === "do" && ["placeFirst", "placeDisc"].includes(step.expect.type)).toBe(true);
      }
      expect(checkInvariants(game), `「${step.id}」之后状态不自洽`).toEqual([]);
    }
    expect(game.phase).toBe("gameOver");
    expect(game.winners).toEqual([TUTORIAL_SELF]);
  });

  it("剧本数字和补充 2.3 / 引擎 TUTORIAL_SCRIPT 一致：总数 5 / 3 / 6 / 8，你叫 3 / 3 / 1 / 2", () => {
    expect(totalDiscsInPlay(before("r1-raise"))).toBe(5);
    expect(totalDiscsInPlay(before("r2-raise"))).toBe(3);
    expect(totalDiscsInPlay(before("r3-open"))).toBe(6);
    expect(totalDiscsInPlay(before("r4-open"))).toBe(8);
    // 引擎那份剧本走出来的终局和教程一样：你赢，你剩 3 张、一号剩 3 张、二号 4 张
    let engine = startGame({ players: 3, first: "p1" });
    for (const round of TUTORIAL_SCRIPT) engine = runScript(engine, round.steps);
    const ours = playScript();
    for (const id of [TUTORIAL_SELF, RIVAL_1, RIVAL_2]) {
      expect(discs(ours, id), `${id} 剩几张`).toBe(discs(engine, id));
      expect(player(ours, id).flowerUp).toBe(player(engine, id).flowerUp);
    }
    expect(ours.round).toBe(engine.round);
  });

  it("关键几幕一定发生", () => {
    // 第 1 轮：只剩你没过，你是挑战者；翻满 3 张，垫板翻到花面
    expect(after("w-r1-pass").challenger).toBe(TUTORIAL_SELF);
    const r1 = after("r1-flip");
    expect(r1.roundLog.result).toBe("success");
    expect(player(r1, TUTORIAL_SELF).flowerUp).toBe(true);
    expect(r1.roundLog.flips.map((flip) => flip.owner)).toEqual([TUTORIAL_SELF, TUTORIAL_SELF, RIVAL_2]);
    // 第 2 轮：叫到总数直接开翻；翻到二号的骷髅，随机丢的是你的一朵玫瑰，二号不受罚
    expect(after("r2-raise").phase).toBe("resolving");
    const r2 = after("r2-flip-2");
    expect(r2.roundLog.result).toBe("fail");
    expect(r2.roundLog.skullOwner).toBe(RIVAL_2);
    expect(r2.roundLog.loss?.method).toBe("random");
    expect(player(r2, TUTORIAL_SELF).lost).toEqual(["rose"]);
    expect(discs(r2, TUTORIAL_SELF)).toBe(3);
    expect(discs(r2, RIVAL_2)).toBe(4);
    // 别人看不到你丢了什么
    expect(player(redactGameForViewer(r2, RIVAL_1), TUTORIAL_SELF).lost).toBeUndefined();
    // 下一轮你先手（挑战者没淘汰）
    expect(after("r2-next").firstPlayer).toBe(TUTORIAL_SELF);
    // 第 3 轮：你底下骷髅、上面玫瑰；一号加到 4，翻到你的骷髅失败，随机丢 1 张（剧本固定丢骷髅，第 4 轮他才盖得出 3 朵玫瑰）
    const decoy = before("r3-danger");
    expect(player(decoy, TUTORIAL_SELF).stack.map((disc) => disc.face)).toEqual(["skull", "rose"]);
    const r3 = after("w-r3-flips");
    expect(r3.roundLog.challenger).toBe(RIVAL_1);
    expect(r3.roundLog.skullOwner).toBe(TUTORIAL_SELF);
    expect(discs(r3, RIVAL_1)).toBe(3);
    expect(discs(r3, TUTORIAL_SELF)).toBe(3);
    // 二号亮牌：板上 2 朵玫瑰公开
    const reveal = after("w-r3-reveal");
    expect(reveal.roundLog.reveals).toEqual([{ player: RIVAL_2, discs: [{ depth: 0, face: "rose" }, { depth: 1, face: "rose" }] }]);
    expect(after("r3-next").firstPlayer).toBe(RIVAL_1);
    // 第 4 轮：第 2 次成功，赢下整局
    const end = playScript();
    expect(end.result).toEqual({ winner: TUTORIAL_SELF, reason: "twoWins" });
  });

  it("剧本自身：id 不重复、finale 唯一且在最后、每步最多两句话、主句不空、高亮不用颜色形容", () => {
    const ids = TUTORIAL_STEPS.map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
    const finales = TUTORIAL_STEPS.filter((step) => step.kind === "info" && step.finale);
    expect(finales).toHaveLength(1);
    expect(TUTORIAL_STEPS[TUTORIAL_STEPS.length - 1]).toBe(finales[0]);
    for (const step of TUTORIAL_STEPS) {
      for (const part of [step, ...(step.subs ?? [])]) {
        expect(part.say.trim().length, `「${step.id}」主句为空`).toBeGreaterThan(0);
        expect(sentences(part.say) + sentences(part.note), `「${step.id}」超过两句：${part.say} ${part.note ?? ""}`).toBeLessThanOrEqual(2);
        expect(sentences(part.say) + sentences(part.noteTouch), `「${step.id}」触屏说法超过两句`).toBeLessThanOrEqual(2);
        expect(`${part.say}${part.note ?? ""}`, `「${step.id}」不要按图上的颜色写`).not.toMatch(/红色|蓝色|绿色|黄色|紫色|金色的/);
        expect(`${part.say}${part.note ?? ""}`, `「${step.id}」不说内部术语`).not.toMatch(/command|phase|stack|bid|pass|flip/i);
      }
    }
  });

  it("盖牌只比牌面：剧本说盖玫瑰，哪一朵都算；盖骷髅不算", () => {
    const game = createTutorialGame(NAME);
    const roses = player(game, TUTORIAL_SELF).hand.filter((disc) => disc.face === "rose");
    const skull = player(game, TUTORIAL_SELF).hand.find((disc) => disc.face === "skull")!;
    expect(roses).toHaveLength(3);
    for (const rose of roses) expect(sameCommand({ type: "placeFirst", discId: rose.id! }, { type: "placeFirst", discId: "rose" })).toBe(true);
    expect(sameCommand({ type: "placeFirst", discId: skull.id! }, { type: "placeFirst", discId: "rose" })).toBe(false);
    expect(sameCommand({ type: "openBid", count: 2 }, { type: "openBid", count: 1 })).toBe(false);
    expect(sameCommand({ type: "flipMat", player: RIVAL_1 }, { type: "flipMat", player: RIVAL_2 })).toBe(false);
  });

  it("剧本走完接练习局：两边交给人机，打一百多局都能结束", () => {
    const stuck: number[] = [];
    let total = 0;
    for (let seed = 1; seed <= 120; seed += 1) {
      let game = createPracticeGame(NAME, seed);
      let steps = 0;
      while (game.phase !== "gameOver" && steps < 2000) {
        const actor = tutorialActor(game);
        if (!actor) break;
        // 你那一边也交给人机（练习局里你点了什么都行，这里只看能不能打完）
        const command: TutorialCommand | null = actor === SYSTEM
          ? tutorialBot(game, SYSTEM, botCommand)
          : botCommand(redactGameForViewer(game, actor), actor);
        if (!command) break;
        if (actor !== SYSTEM) expect(tutorialCanAct(game, actor)).toBe(true);
        game = tutorialApply(game, actor, command, false);
        steps += 1;
      }
      total += steps;
      if (game.phase !== "gameOver") stuck.push(seed);
    }
    expect(stuck).toEqual([]);
    expect(total).toBeGreaterThan(0);
  });

  it("同时行动的阶段先让人机走：准备阶段你没盖时，也能先让咕噜们盖", () => {
    const game = createTutorialGame(NAME);
    expect(tutorialActor(game)).toBe(RIVAL_1);
    expect(tutorialCanAct(game, TUTORIAL_SELF)).toBe(true);
  });
});
