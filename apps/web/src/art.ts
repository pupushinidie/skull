/**
 * 美术文件的地址和尺寸（照 art/spec.md 第 7 节）。简洁版和正式美术同名，换图不用改这里。
 * 所有像素图按整数倍显示，并且一律 image-rendering: pixelated（sk.css）。
 */
import type { EmoteId } from "@skull/game";

const ROOT = `${import.meta.env.BASE_URL}art/`;

/** 座位 0–5：hex 是亮色（缝线、名牌、围巾）。 */
export const SEATS = [
  { key: "red", name: "红", hex: "#e5533f", animal: "狐狸" },
  { key: "blue", name: "蓝", hex: "#3b82f0", animal: "乌鸦" },
  { key: "green", name: "绿", hex: "#44b860", animal: "蛤蟆" },
  { key: "yellow", name: "黄", hex: "#f0c030", animal: "浣熊" },
  { key: "purple", name: "紫", hex: "#9b6ad6", animal: "黑猫" },
  { key: "cyan", name: "青", hex: "#36c2c9", animal: "獾" },
] as const;

export const seatHex = (seat: number) => SEATS[((seat % 6) + 6) % 6]!.hex;

/** 原图尺寸（像素）。DISC 上面 32×32 是正面，下面 4 行是厚度；往上叠一张移 step。 */
export const DISC = { w: 32, h: 36, step: 4 } as const;
export const FLIP = { w: 32, h: 40, frames: 8 } as const;
export const MAT = { w: 56, h: 64 } as const;
/** 垫子在垫板上的位置：第 i 张（0 = 最底下）左上角在 (12, 22 - 4i)。 */
export const STACK_ORIGIN = { x: 12, y: 22 } as const;

export type DiscFace = "back" | "rose" | "skull" | "lc-down" | "lc-up";
export const discArt = (face: DiscFace) => `${ROOT}discs/${face}.png`;
export const flipArt = (to: "rose" | "skull" | "lc") => `${ROOT}fx/flip-${to}.png`;
export const matArt = (seat: number, flower: boolean) => `${ROOT}mats/mat-${seat % 6}-${flower ? "flower" : "blank"}.png`;
export const avatarArt = (seat: number) => `${ROOT}avatars/avatar-${seat % 6}.png`;
export const emoteArt = (id: EmoteId) => `${ROOT}emotes/${id}.png`;

export type UiIcon = "disc" | "stack" | "bell" | "pass" | "key" | "rose" | "eye" | "ready" | "lc" | "lantern" | "out" | "trophy" | "ribbon" | "bubble" | "frame";
export const uiArt = (name: UiIcon | "thinking") => `${ROOT}ui/${name}.png`;
/** 小图标原图尺寸。 */
export const UI_SIZE: Record<UiIcon, readonly [number, number]> = {
  disc: [16, 16],
  stack: [16, 16],
  bell: [16, 16],
  pass: [16, 16],
  key: [16, 16],
  rose: [16, 16],
  eye: [16, 16],
  ready: [16, 16],
  lc: [16, 16],
  lantern: [32, 32],
  out: [32, 32],
  trophy: [48, 48],
  ribbon: [96, 24],
  bubble: [40, 44],
  frame: [24, 24],
};

/** 精灵图（横排，每帧一样大）。 */
export interface SheetSpec {
  readonly src: string;
  readonly w: number;
  readonly h: number;
  readonly frames: number;
}

const sheet = (path: string, w: number, h: number, frames: number): SheetSpec => ({ src: `${ROOT}${path}`, w, h, frames });

export const SHEETS = {
  flipRose: sheet("fx/flip-rose.png", 32, 40, 8),
  flipSkull: sheet("fx/flip-skull.png", 32, 40, 8),
  flipLc: sheet("fx/flip-lc.png", 32, 40, 8),
  skullHit: sheet("fx/skull-hit.png", 64, 64, 8),
  rosePop: sheet("fx/rose-pop.png", 48, 48, 6),
  success: sheet("fx/success.png", 96, 96, 8),
  matWin: sheet("fx/mat-win.png", 56, 64, 8),
  loseDisc: sheet("fx/lose-disc.png", 32, 40, 8),
  snuff: sheet("fx/snuff.png", 32, 48, 8),
  candle: sheet("fx/candle.png", 16, 32, 4),
  petals: sheet("fx/petals.png", 64, 64, 8),
  sparkle: sheet("fx/sparkle.png", 16, 16, 6),
  thinking: sheet("ui/thinking.png", 16, 16, 4),
} as const;

export const emoteSheet = (id: EmoteId): SheetSpec => ({ src: emoteArt(id), w: 32, h: 32, frames: 4 });

export const EMOTE_NAME: Record<EmoteId, string> = {
  rose: "玫瑰",
  skull: "骷髅",
  taunt: "挑衅",
  shrug: "摊手",
  think: "思考",
  laugh: "大笑",
  sweat: "紧张",
  shock: "吃惊",
};

/** 每个房间按房间码固定一张牌桌背景。 */
export function sceneFor(room: string, day: boolean): string {
  let hash = 0;
  for (const char of room) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `${ROOT}scene/${day ? "day" : "night"}-${hash % 2}.png`;
}

export const heroArt = `${ROOT}scene/hero.png`;
