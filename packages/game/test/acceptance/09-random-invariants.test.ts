/**
 * 独立写的随机整局检查（不用引擎自己的 checkInvariants）：从规则书推出来、每一步都必须成立的事。
 * - 垫子守恒：每人「手里 + 板上（不含碟子）+ 失掉的」= 3 玫瑰 + 1 骷髅；自己的垫子只减不增，只有挑战者会失，一次 1 张（§5.3）
 * - 淘汰 ⇔ 一张都不剩（§5.4）；没结束时至少 2 人存活
 * - 进入轮流时每个存活玩家板上 ≥ 1 张（补充 3.5(e)）；加注阶段叫价 < 场上总数（叫到总数就该开翻，补充 3.2 #2）
 * - 垫板花面只会由「这一轮成功的挑战者」翻上去（§5.2）
 * - Last Chance 碟只在变体开时出现，持碟人只剩 1 张自己的垫子（§7）
 * - 终局只有 1 个赢家：twoWins 的赢家是带着花面成功的挑战者，lastStanding 的赢家是唯一存活者（§6）
 * - 每一步都能推进（随机驱动里检查），version 递增，apply 不改输入
 */
import { describe, expect, it } from "vitest";
import { alivePlayers, discCount, totalDiscsInPlay, type GameState } from "../../src/index.js";
import { countFaces, randomGame } from "./_helpers.js";

function check(g: GameState, prev: GameState, lastChanceOn: boolean): string[] {
  const out: string[] = [];
  if (g.version <= prev.version) out.push(`version 没有递增 ${prev.version} → ${g.version}`);
  for (const p of g.players) {
    const q = prev.players.find((x) => x.id === p.id)!;
    const own = [...p.hand, ...p.stack].filter((d) => !d.lastChance);
    const c = countFaces(own);
    const lost = p.lost ?? [];
    const lr = lost.filter((f) => f === "rose").length;
    const ls = lost.filter((f) => f === "skull").length;
    if (c.rose + lr !== 3 || c.skull + ls !== 1) out.push(`${p.id} 垫子不守恒：现有 ${c.rose}花${c.skull}骷，失掉 ${lr}花${ls}骷`);
    if (p.lostCount !== lost.length) out.push(`${p.id} lostCount ${p.lostCount} ≠ lost ${lost.length}`);
    const n = discCount(p);
    const m = discCount(q);
    if (n > m) out.push(`${p.id} 垫子变多了 ${m} → ${n}`);
    if (n < m) {
      if (n !== m - 1) out.push(`${p.id} 一次失了 ${m - n} 张`);
      if (prev.challenger !== p.id && g.challenger !== p.id) out.push(`${p.id} 不是挑战者却失了牌`);
    }
    if (p.eliminated !== (n === 0)) out.push(`${p.id} eliminated=${p.eliminated} 但还剩 ${n} 张`);
    if (p.flowerUp && !q.flowerUp) {
      if (g.challenger !== p.id || g.roundLog.result !== "success") out.push(`${p.id} 不是成功的挑战者却翻了花面`);
    }
    if (!p.flowerUp && q.flowerUp) out.push(`${p.id} 花面又翻回去了`);
    const lc = c.lastChance;
    if (lc > 1) out.push(`${p.id} 有 ${lc} 张碟子`);
    if (lc > 0 && !lastChanceOn) out.push(`变体关却出现了碟子`);
    if (lc > 0 && n !== 1) out.push(`${p.id} 持碟但自己有 ${n} 张`);
  }
  if (g.phase === "placeOrBid") {
    for (const p of alivePlayers(g)) if (p.stack.length < 1) out.push(`进入轮流时 ${p.id} 板上没有垫子`);
  }
  if (g.phase === "bidding") {
    if (g.bid < 1 || g.bid >= totalDiscsInPlay(g)) out.push(`加注阶段叫价 ${g.bid}、总数 ${totalDiscsInPlay(g)}`);
    const live = alivePlayers(g).filter((p) => !p.passed);
    if (live.length < 2) out.push(`加注阶段只剩 ${live.length} 人没 pass 却没开翻`);
  }
  if (g.phase === "resolving" && g.bid > totalDiscsInPlay(g)) out.push(`叫价 ${g.bid} 超过场上总数`);
  if (g.phase !== "gameOver") {
    if (alivePlayers(g).length < 2) out.push(`只剩 ${alivePlayers(g).length} 人却没结束`);
  } else {
    if (g.winners.length !== 1) out.push(`赢家 ${g.winners.length} 个`);
    const w = g.winners[0]!;
    if (g.result?.winner !== w) out.push("result.winner 和 winners 不一致");
    if (g.result?.reason === "twoWins") {
      const before = prev.players.find((x) => x.id === w)!;
      if (!before.flowerUp || g.roundLog.challenger !== w || g.roundLog.result !== "success") out.push("twoWins 但不是带花面成功的挑战者");
    } else if (g.result?.reason === "lastStanding") {
      const alive = alivePlayers(g);
      if (alive.length !== 1 || alive[0]!.id !== w) out.push("lastStanding 但存活的不止赢家");
    } else out.push("没有终局原因");
  }
  return out;
}

describe("随机整局：规则推出来的不变量（独立检查）", () => {
  for (const n of [3, 4, 5, 6]) {
    for (const lastChance of [false, true]) {
      it(`${n} 人${lastChance ? "（Last Chance 开）" : ""}：150 局每一步都成立，都能打到终局`, { timeout: 60_000 }, () => {
        const problems: string[] = [];
        const reasons = { twoWins: 0, lastStanding: 0 };
        let maxSteps = 0;
        for (let k = 0; k < 150; k++) {
          const seed = 70_000 + 1000 * n + k + (lastChance ? 500 : 0);
          let lastJson = "";
          const { state, steps } = randomGame(n, seed, { lastChance, timeoutRate: 0.05 }, (g, prev) => {
            if (lastJson && JSON.stringify(prev) !== lastJson) problems.push(`种子 ${seed}：apply 改了输入状态`);
            lastJson = JSON.stringify(g);
            if (problems.length < 20) for (const msg of check(g, prev, lastChance)) problems.push(`种子 ${seed} 第 ${g.round} 轮 ${g.phase}：${msg}`);
          });
          maxSteps = Math.max(maxSteps, steps);
          if (state.result) reasons[state.result.reason]++;
        }
        expect(problems).toEqual([]);
        // 两种胜法都会出现
        expect(reasons.twoWins).toBeGreaterThan(0);
        expect(reasons.lastStanding).toBeGreaterThan(0);
        expect(maxSteps).toBeLessThan(5000);
      });
    }
  }
});
