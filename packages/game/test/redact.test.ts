import { describe, expect, it } from "vitest";
import { createGame, redactGameForViewer, timeoutTurn } from "../src/engine.js";
import { previewPlayers, runScript, startGame } from "../src/scenes.js";
import type { GameState } from "../src/types.js";
import { hasKey, P } from "./helpers.js";

/** 一局里各种时刻的完整状态（全靠超时推进 + 几个手工局面）。 */
function moments(): GameState[] {
  const result: GameState[] = [];
  for (const count of [3, 6]) {
    for (let seed = 1; seed <= 6; seed += 1) {
      let game = createGame(previewPlayers(count), seed, { lastChance: seed % 2 === 0 });
      for (let step = 0; step < 300 && game.phase !== "gameOver"; step += 1) {
        result.push(game);
        game = timeoutTurn(game);
      }
      result.push(game);
    }
  }
  let failed = startGame({ players: 4 });
  failed = runScript(failed, [
    ["p1", "place", "rose"], ["p2", "place", "rose"], ["p3", "place", "rose"], ["p4", "place", "skull"],
    ["p1", "place", "rose"], ["p2", "place", "skull"], ["p3", "bid", 4], ["p4", "pass"], ["p1", "pass"], ["p2", "pass"],
    ["autoAll"], ["p3", "flip", "p1"], ["p3", "flip", "p1"], ["p3", "flip", "p2"],
  ]);
  result.push(failed, runScript(failed, [["p4", "reveal"]]));
  return result;
}

const MOMENTS = moments();

function ownIds(state: GameState, playerId: string): string[] {
  const player = P(state, playerId);
  return [...player.hand, ...player.stack].map((disc) => disc.id!).filter((id) => id !== "lastchance");
}

describe("隐藏信息：每个玩家视角", () => {
  it(`${MOMENTS.length} 个时刻 × 每个座位：别人手里和没翻开的垫子没有牌面和 id，别人的失牌结果看不到，种子 / 随机数状态 / 动作序列不下发`, () => {
    let checked = 0;
    for (const state of MOMENTS) {
      for (const viewer of state.players) {
        const view = redactGameForViewer(state, viewer.id);
        const text = JSON.stringify(view);
        expect(view.seed).toBeUndefined();
        expect(view.rngState).toBeUndefined();
        expect(view.log).toBeUndefined();
        for (const other of state.players) {
          if (other.id === viewer.id) continue;
          for (const id of ownIds(state, other.id)) expect(text.includes(id)).toBe(false);
          const seen = P(view, other.id);
          expect(seen.lost).toBeUndefined();
          for (const disc of seen.hand) expect(disc).toEqual(disc.lastChance ? { face: "rose", lastChance: true } : {});
          seen.stack.forEach((disc, depth) => {
            const real = P(state, other.id).stack[depth]!;
            if (disc.lastChance) expect(disc).toEqual({ revealed: real.revealed, face: "rose", lastChance: true });
            else if (real.revealed) expect(disc).toEqual({ revealed: true, face: real.face });
            else expect(disc).toEqual({ revealed: false });
          });
        }
        // 自己的全都看得到
        expect(P(view, viewer.id).hand).toEqual(P(state, viewer.id).hand);
        expect(P(view, viewer.id).stack).toEqual(P(state, viewer.id).stack);
        expect(P(view, viewer.id).lost).toEqual(P(state, viewer.id).lost);
        for (const event of view.events) {
          if (event.type === "DiscLost") expect("face" in event).toBe(event.player === viewer.id);
        }
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("裁剪不改原状态", () => {
    const state = MOMENTS[MOMENTS.length - 1]!;
    const before = JSON.stringify(state);
    for (const viewer of ["p1", "p2", ""]) redactGameForViewer(state, viewer);
    redactGameForViewer(state, "", { seeAll: true });
    expect(JSON.stringify(state)).toBe(before);
  });
});

describe("隐藏信息：观战视角", () => {
  it("默认观战（viewerId 为空）谁的牌面都看不到，翻开的和 Last Chance 碟除外；看不到任何失牌结果", () => {
    for (const state of MOMENTS) {
      const view = redactGameForViewer(state, "");
      const text = JSON.stringify(view);
      for (const player of state.players) {
        for (const id of ownIds(state, player.id)) expect(text.includes(id)).toBe(false);
        const seen = P(view, player.id);
        expect(seen.lost).toBeUndefined();
        for (const disc of seen.hand) if (!disc.lastChance) expect(disc).toEqual({});
        for (const disc of seen.stack) if (!disc.revealed && !disc.lastChance) expect(disc).toEqual({ revealed: false });
      }
      for (const event of view.events) if (event.type === "DiscLost") expect(event).not.toHaveProperty("face");
      expect(hasKey(view, "seed")).toBe(false);
      expect(hasKey(view, "rngState")).toBe(false);
    }
  });

  it("房主打开「观战看底牌」：看得到每个人的牌面和失牌结果，但仍然没有 id、种子、随机数状态", () => {
    for (const state of MOMENTS.slice(0, 400)) {
      const view = redactGameForViewer(state, "", { seeAll: true });
      const text = JSON.stringify(view);
      for (const player of state.players) {
        for (const id of ownIds(state, player.id)) expect(text.includes(id)).toBe(false);
        expect(P(view, player.id).hand.map((disc) => disc.face)).toEqual(P(state, player.id).hand.map((disc) => disc.face));
        expect(P(view, player.id).stack.map((disc) => disc.face)).toEqual(P(state, player.id).stack.map((disc) => disc.face));
      }
      expect(view.seed).toBeUndefined();
      expect(view.rngState).toBeUndefined();
      expect(view.log).toBeUndefined();
    }
  });
});

describe("隐藏信息：公开记录", () => {
  it("roundLog / history 里只有翻开过的牌面和自愿亮出的牌面，没有失牌牌面、没有 id", () => {
    for (const state of MOMENTS) {
      const logs = [...state.history, state.roundLog];
      const text = JSON.stringify(logs);
      expect(text).not.toMatch(/"id"/);
      expect(text).not.toMatch(/"lost"/);
      for (const log of logs) {
        if (log.loss) expect(Object.keys(log.loss).sort()).toEqual(["count", "eliminated", "method", "player"]);
      }
    }
  });

  it("同一个公开局面、对手板上的牌面不同，别人看到的完全一样（牌面不会从别处漏出来）", () => {
    const a = runScript(startGame({ players: 3, seed: 1 }), [["p1", "place", "rose"], ["p2", "place", "rose"], ["p3", "place", "rose"]]);
    const b = runScript(startGame({ players: 3, seed: 1 }), [["p1", "place", "skull"], ["p2", "place", "rose"], ["p3", "place", "rose"]]);
    const strip = (state: GameState) => {
      const view = redactGameForViewer(state, "p2");
      return JSON.stringify({ ...view, players: view.players.map((player) => (player.id === "p2" ? null : player)) });
    };
    expect(strip(a)).toBe(strip(b));
  });
});
