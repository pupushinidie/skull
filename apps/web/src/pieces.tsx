/**
 * 牌桌上的小零件：精灵图、小图标、垫子、垫板（含叠放和特效）、名牌、表情气泡。
 * 像素图全部按整数倍显示（scale 是整数），样式在 sk.css。
 */
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { EmoteId, StackDisc } from "@skull/game";
import {
  avatarArt,
  DISC,
  discArt,
  emoteSheet,
  EMOTE_NAME,
  FLIP,
  MAT,
  matArt,
  seatHex,
  SHEETS,
  STACK_ORIGIN,
  uiArt,
  UI_SIZE,
  type DiscFace,
  type SheetSpec,
  type UiIcon,
} from "./art.js";

/* ---------------------------------------------------------------- 精灵图 */

export type SpriteMode = "once" | "loop" | "flip" | "flipFast" | "still";

/** 横排精灵图。once：播一次停在最后一帧；loop：循环；flip：翻面（第 1 帧停 700ms 的悬念）；still：只显示 frame 那一帧。 */
export function Sprite({ sheet, scale, mode = "once", frameMs = 90, frame = 0, className = "", style, delayMs }: {
  sheet: SheetSpec;
  scale: number;
  mode?: SpriteMode;
  frameMs?: number;
  frame?: number;
  className?: string;
  style?: CSSProperties;
  delayMs?: number;
}) {
  const css = {
    width: sheet.w * scale,
    height: sheet.h * scale,
    backgroundImage: `url(${sheet.src})`,
    backgroundSize: `${sheet.frames * 100}% 100%`,
    "--n": sheet.frames,
    "--dur": `${sheet.frames * frameMs}ms`,
    ...(mode === "still" ? { backgroundPositionX: `${sheet.frames > 1 ? (frame / (sheet.frames - 1)) * 100 : 0}%` } : {}),
    ...(delayMs ? { animationDelay: `${delayMs}ms` } : {}),
    ...style,
  } as CSSProperties;
  return <span className={`sk-sprite sk-sprite-${mode} ${className}`} style={css} aria-hidden="true" />;
}

/** 界面小图标（16×16 等），scale 倍显示。 */
export function Icon({ name, scale = 2, className = "", title }: { name: UiIcon; scale?: number; className?: string; title?: string }) {
  const [w, h] = UI_SIZE[name];
  return <img className={`sk-icon ${className}`} src={uiArt(name)} width={w * scale} height={h * scale} alt={title ?? ""} title={title} draggable={false} />;
}

/** 沙漏：还在想 / 等待其他人。 */
export function Thinking({ scale = 2 }: { scale?: number }) {
  return <Sprite sheet={SHEETS.thinking} scale={scale} mode="loop" frameMs={250} className="sk-thinking" />;
}

/** 一张垫子的图（不带位置）。 */
export function DiscImg({ face, scale, className = "", style }: { face: DiscFace; scale: number; className?: string; style?: CSSProperties }) {
  return <img className={`sk-disc ${className}`} src={discArt(face)} width={DISC.w * scale} height={DISC.h * scale} alt="" draggable={false} style={style} />;
}

/** 板上一张垫子该画哪一面。mine：自己的垫子（没翻开的也画正面，压暗，别人看不到）。 */
export function stackFace(disc: StackDisc, mine: boolean): { face: DiscFace; peek: boolean } {
  if (disc.lastChance) return { face: disc.revealed ? "lc-up" : "lc-down", peek: false };
  if (disc.revealed && disc.face) return { face: disc.face, peek: false };
  if (mine && disc.face) return { face: disc.face, peek: true };
  return { face: "back", peek: false };
}

/* ---------------------------------------------------------------- 垫板 */

/** 叠在一块垫板上的临时特效。 */
export interface MatFx {
  readonly key: string;
  readonly kind: "flip" | "flipFast" | "skullHit" | "rosePop" | "success" | "matWin" | "loseDisc" | "snuff";
  /** 翻面 / 冲击 / 花瓣：第几张（0 = 最底下）。 */
  readonly depth?: number;
  readonly face?: "rose" | "skull" | "lc";
}

export type PushDir = "down" | "up" | "left" | "right";

export function Mat({ seat, flower, stack, scale, mine, fx = [], dropDepth, eliminated, pushed, dim, glow, onClick, label, tutorial, turnKey }: {
  seat: number;
  flower: boolean;
  stack: readonly StackDisc[];
  scale: number;
  mine: boolean;
  fx?: readonly MatFx[];
  /** 刚盖上的那一张（播一次落下动画）。 */
  dropDepth?: { depth: number; key: string } | undefined;
  eliminated: boolean;
  /** pass：往桌子中间推。 */
  pushed?: PushDir | undefined;
  dim?: boolean;
  /** 金色闪框：能点的板（选板、指定先手）。 */
  glow?: boolean;
  onClick?: (() => void) | undefined;
  /** 闪框上写的字（「翻这块」）。 */
  label?: string | undefined;
  tutorial?: string;
  /** 赢下一轮时翻面：key 变化时播一次。 */
  turnKey?: string | undefined;
}) {
  const s = scale;
  const flipping = new Map<number, MatFx>();
  for (const item of fx) if ((item.kind === "flip" || item.kind === "flipFast") && item.depth !== undefined) flipping.set(item.depth, item);
  const snuffing = fx.some((item) => item.kind === "snuff");
  const Tag = onClick ? "button" : "div";
  const classes = [
    "sk-mat",
    pushed ? `pushed-${pushed}` : "",
    dim ? "dim" : "",
    glow ? "glow" : "",
    onClick ? "clickable" : "",
    eliminated ? "out" : "",
  ].filter(Boolean).join(" ");
  return (
    <Tag
      className={classes}
      style={{ width: MAT.w * s, height: MAT.h * s, "--s": s } as CSSProperties}
      {...(onClick ? { type: "button" as const, onClick, "aria-label": label ?? "翻这块板" } : {})}
      {...(tutorial ? { "data-tutorial": tutorial } : {})}
    >
      {eliminated ? (
        <>
          <span className="sk-mat-ghost" />
          {snuffing ? (
            <Sprite sheet={SHEETS.snuff} scale={s >= 3 ? 2 : 1} mode="once" frameMs={110} className="sk-snuff" />
          ) : (
            <Icon name="out" scale={s >= 3 ? 2 : 1} className="sk-out" title="已淘汰" />
          )}
        </>
      ) : (
        <>
          <img key={turnKey ?? "mat"} className={turnKey ? "sk-mat-img turn" : "sk-mat-img"} src={matArt(seat, flower)} width={MAT.w * s} height={MAT.h * s} alt="" draggable={false} />
          {stack.map((disc, depth) => {
            const flip = flipping.get(depth);
            const left = STACK_ORIGIN.x * s;
            const top = (STACK_ORIGIN.y - DISC.step * depth) * s;
            if (flip) {
              const sheet = flip.face === "skull" ? SHEETS.flipSkull : flip.face === "lc" ? SHEETS.flipLc : SHEETS.flipRose;
              return (
                <Sprite
                  key={`flip-${flip.key}`}
                  sheet={sheet}
                  scale={s}
                  mode={flip.kind === "flip" ? "flip" : "flipFast"}
                  frameMs={60}
                  className="sk-stack-disc"
                  style={{ left, top: top - DISC.step * s, zIndex: depth + 1 }}
                />
              );
            }
            const { face, peek } = stackFace(disc, mine);
            const drop = dropDepth?.depth === depth;
            return (
              <DiscImg
                key={drop ? `d${depth}-${dropDepth!.key}` : `d${depth}`}
                face={face}
                scale={s}
                className={["sk-stack-disc", peek ? "peek" : "", drop ? "drop" : ""].filter(Boolean).join(" ")}
                style={{ left, top, zIndex: depth + 1 }}
              />
            );
          })}
        </>
      )}
      {fx.map((item) => {
        const depth = item.depth ?? Math.max(0, stack.length - 1);
        const cx = (STACK_ORIGIN.x + DISC.w / 2) * s;
        const cy = (STACK_ORIGIN.y - DISC.step * depth + 16) * s;
        switch (item.kind) {
          case "skullHit":
            return <Sprite key={item.key} sheet={SHEETS.skullHit} scale={s} frameMs={70} className="sk-fx" style={{ left: cx - 32 * s, top: cy - 32 * s }} />;
          case "rosePop":
            return <Sprite key={item.key} sheet={SHEETS.rosePop} scale={s} frameMs={70} className="sk-fx" style={{ left: cx - 24 * s, top: cy - 24 * s }} />;
          case "success":
            return <Sprite key={item.key} sheet={SHEETS.success} scale={s} frameMs={90} className="sk-fx" style={{ left: (28 - 48) * s, top: (32 - 48) * s }} />;
          case "matWin":
            return <Sprite key={item.key} sheet={SHEETS.matWin} scale={s} frameMs={80} className="sk-fx" style={{ left: 0, top: 0 }} />;
          case "loseDisc":
            return <Sprite key={item.key} sheet={SHEETS.loseDisc} scale={s} frameMs={90} className="sk-fx" style={{ left: 12 * s, top: 12 * s }} />;
          default:
            return null;
        }
      })}
      {glow && label && <span className="sk-mat-label">{label}</span>}
    </Tag>
  );
}

/* ---------------------------------------------------------------- 名牌 */

export interface PlateStatus {
  readonly first?: boolean;
  readonly challenger?: boolean;
  readonly acting?: boolean;
  readonly passed?: boolean;
  readonly placed?: boolean;
  readonly ready?: boolean;
  readonly flower?: boolean;
  readonly lastChance?: boolean;
  readonly eliminated?: boolean;
}

export function Plate({ name, seat, isMe, tags, onBoard, inHand, status, lastBid, shown, emote, compact, size, tutorial, onClick }: {
  name: string;
  seat: number;
  isMe: boolean;
  tags: readonly string[];
  onBoard: number;
  inHand: number;
  status: PlateStatus;
  /** 本轮最近一次叫价：「叫 3」「过」。 */
  lastBid?: string | undefined;
  /** 结算时自愿亮出的垫子（从底到顶）。 */
  shown?: readonly DiscFace[] | undefined;
  emote?: { id: EmoteId; key: string } | undefined;
  /** 手机：窄名牌。 */
  compact?: boolean;
  /** 垫板倍数，决定名牌里的字和头像大小。 */
  size: number;
  tutorial?: string;
  /** 能点时（选板、指定先手）整块名牌也能点。 */
  onClick?: () => void;
}) {
  const avatarScale = compact ? 1 : size >= 3 ? 2 : 1;
  const iconScale = compact ? 1 : 2;
  const icons: ReactNode[] = [];
  if (status.flower) icons.push(<Icon key="rose" name="rose" scale={iconScale} title="已经成功 1 次（垫板花面）" />);
  if (status.first) icons.push(<Icon key="key" name="key" scale={iconScale} title="本轮先手" />);
  if (status.challenger) icons.push(<Icon key="lantern" name="lantern" scale={iconScale === 2 ? 1 : 1} title="挑战者" className="lantern" />);
  if (status.lastChance) icons.push(<Icon key="lc" name="lc" scale={iconScale} title="拿着 Last Chance 碟（公开的玫瑰）" />);
  if (status.passed) icons.push(<Icon key="pass" name="pass" scale={iconScale} title="本轮已过" />);
  if (status.placed) icons.push(<Icon key="ready" name="ready" scale={iconScale} title="已盖好" />);
  if (status.acting) icons.push(<Thinking key="think" scale={iconScale} />);
  return (
    <div
      className={["sk-plate", isMe ? "me" : "", compact ? "compact" : "", status.acting ? "acting" : "", status.eliminated ? "out" : "", onClick ? "clickable" : ""].filter(Boolean).join(" ")}
      style={{ "--seat": seatHex(seat), "--s": size } as CSSProperties}
      {...(onClick ? { role: "button", tabIndex: 0, onClick, onKeyDown: (event: ReactKeyboardEvent) => { if (event.key === "Enter") onClick(); } } : {})}
      {...(tutorial ? { "data-tutorial": tutorial } : {})}
    >
      <div className="sk-plate-head">
        <span className="sk-avatar">
          <img src={avatarArt(seat)} width={32 * avatarScale} height={32 * avatarScale} alt="" draggable={false} />
          {emote && <EmoteBubble key={emote.key} id={emote.id} />}
        </span>
        <span className="sk-plate-name">
          <b title={name}>{isMe ? "你" : name}</b>
          {tags.length > 0 && <span className="sk-tags">{tags.map((tag) => <i key={tag} className={`sk-tag tag-${tag}`}>{tag}</i>)}</span>}
        </span>
      </div>
      {status.eliminated ? (
        <div className="sk-plate-out">出局</div>
      ) : (
        <div className="sk-counts">
          <span className="sk-count" title={`板上 ${onBoard} 张`}>
            {!compact && <Icon name="stack" scale={iconScale} />}
            <small>{compact ? "板" : "板上"}</small>
            <b>{onBoard}</b>
          </span>
          <span className="sk-count" title={`手里 ${inHand} 张`}>
            {!compact && <Icon name="disc" scale={iconScale} />}
            <small>{compact ? "手" : "手里"}</small>
            <b>{inHand}</b>
          </span>
        </div>
      )}
      {shown && shown.length > 0 && (
        <div className="sk-plate-shown" title="亮出的垫子（从下往上）">
          <Icon name="eye" scale={1} />
          {shown.map((face, index) => <DiscImg key={index} face={face} scale={1} />)}
        </div>
      )}
      {(icons.length > 0 || lastBid) && (
        <div className="sk-plate-status">
          {icons}
          {lastBid && <span className={lastBid === "过" ? "sk-lastbid pass" : "sk-lastbid"}>{lastBid}</span>}
        </div>
      )}
    </div>
  );
}

/** 快捷表情气泡：奶白气泡 2× + 表情 2× 循环，2.4 秒后由上层收走。 */
export function EmoteBubble({ id }: { id: EmoteId }) {
  return (
    <span className="sk-bubble" role="img" aria-label={EMOTE_NAME[id]}>
      <img src={uiArt("bubble")} width={80} height={88} alt="" draggable={false} />
      <Sprite sheet={emoteSheet(id)} scale={2} mode="loop" frameMs={160} className="sk-bubble-emote" />
    </span>
  );
}

export const FLIP_MS = { flip: 80 + 700 + 6 * 60, flipFast: 8 * 60 } as const;
export { FLIP };
