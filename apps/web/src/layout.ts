/**
 * 牌桌排法：量舞台的实际宽高，按对手人数搜垫板倍数（同一屏所有垫板同一个倍数），挑最大放得下的。
 * 座位按真实桌子顺时针摆：我在最下面，下一家在我左手边（屏幕左边），然后上面一排从左到右，最后右边。
 *
 *   对手 ≤3：上面一排（对手）/ 中央一条（场上总数、叫价）/ 下面我那一排
 *   对手 4–5：上面一排 2–3 人 / 中间一排左右各 1 人、中央在正中 / 下面我那一排
 *
 * 手机（窄于 720）另走竖排：对手 3 列网格、中央一条、我的垫板和名牌、手牌、操作面板，见 sk.css。
 */
import { DISC, MAT } from "./art.js";

export interface SeatSlot {
  readonly row: "top" | "left" | "right";
  /** top 排里从左到右第几个。 */
  readonly index: number;
}

export interface BoardLayout {
  readonly mobile: boolean;
  /** 垫板 / 板上垫子的倍数。 */
  readonly scale: number;
  /** 我手牌的倍数（可以比牌桌大一档或小一档）。 */
  readonly handScale: number;
  /** 名牌宽度（px）。 */
  readonly plateW: number;
  /** 操作面板宽度（px）。 */
  readonly actionW: number;
  /** 中间一排有没有左右两个座位。 */
  readonly sides: boolean;
  /** 上面一排几个。 */
  readonly topCount: number;
  /** 每个对手（按顺时针，从我左手边开始）放在哪。 */
  readonly slots: readonly SeatSlot[];
  /** 行间距。 */
  readonly gap: number;
  /** 桌面排法放得下（放不下时界面改走手机竖排）。 */
  readonly fits: boolean;
}

const PLATE_W: Record<number, number> = { 1: 64, 2: 156, 3: 180, 4: 216 };
const ACTION_W: Record<number, number> = { 2: 288, 3: 312, 4: 360 };
/** 没有左右座位时中央那一条的高度。 */
const CENTER_ROW_H = 108;
const CENTER_MIN_W = 300;
const SEAT_GAP = 8;

export function slotsFor(opponents: number): { slots: SeatSlot[]; sides: boolean; topCount: number } {
  if (opponents >= 4) {
    const topCount = opponents - 2;
    const slots: SeatSlot[] = [{ row: "left", index: 0 }];
    for (let index = 0; index < topCount; index += 1) slots.push({ row: "top", index });
    slots.push({ row: "right", index: 0 });
    return { slots, sides: true, topCount };
  }
  return { slots: Array.from({ length: opponents }, (_, index) => ({ row: "top" as const, index })), sides: false, topCount: opponents };
}

/** handCount：手牌最多几张（4，拿着 Last Chance 碟时 5）。 */
export function pickLayout(width: number, height: number, opponents: number, handCount = 4): BoardLayout {
  const { slots, sides, topCount } = slotsFor(opponents);
  if (width < 720) {
    const scale = opponents <= 2 && width >= 360 ? 2 : 1;
    return { mobile: true, scale, handScale: 2, plateW: scale === 2 ? 64 : 60, actionW: width, sides: false, topCount: opponents, slots: Array.from({ length: opponents }, (_, index) => ({ row: "top" as const, index })), gap: 6, fits: true };
  }
  for (const scale of [4, 3, 2]) {
    const matW = MAT.w * scale;
    const matH = MAT.h * scale;
    const plateW = PLATE_W[scale]!;
    const actionW = ACTION_W[scale]!;
    const seatW = matW + SEAT_GAP + plateW;
    const topW = topCount * seatW + (topCount - 1) * 16;
    const midW = sides ? 2 * seatW + CENTER_MIN_W + 32 : 0;
    if (Math.max(topW, midW) > width) continue;
    for (const handScale of [Math.min(3, scale), scale - 1].filter((value, index, list) => value >= 2 && list.indexOf(value) === index)) {
      const handW = handCount * DISC.w * handScale + (handCount - 1) * 8;
      const handH = (DISC.h + 4) * handScale + 24;
      const bottomW = seatW + 16 + handW + 16 + actionW;
      if (bottomW > width) continue;
      const bottomH = Math.max(matH, handH, 168);
      const middleH = sides ? matH : CENTER_ROW_H;
      for (const gap of [12, 8, 4]) {
        const total = matH + middleH + bottomH + 2 * gap;
        if (total <= height) return { mobile: false, scale, handScale, plateW, actionW, sides, topCount, slots, gap, fits: true };
      }
    }
  }
  // 再小也按 2× 排（不会出现在四种验收尺寸里）
  return { mobile: false, scale: 2, handScale: 2, plateW: PLATE_W[2]!, actionW: ACTION_W[2]!, sides, topCount, slots, gap: 4, fits: false };
}
