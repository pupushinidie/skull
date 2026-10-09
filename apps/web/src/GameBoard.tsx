/**
 * 骷髅牌牌桌。
 * - 顶栏：标志、第几轮 · 阶段、规则、白天/夜间、房间设置、记录/聊天抽屉（窄屏）、解散、连接。
 * - 舞台：提示条（轮到谁 + 倒计时）、对手座位（顺时针，我在下面）、中央（场上总数、叫价、揭牌、结算）、我那一排（垫板、名牌、手牌、操作面板）。
 * - 侧栏：快捷表情、本轮叫价和翻牌、动作记录、聊天和语音（窄屏收进抽屉，手机放在下面）。
 *
 * 动画只看 game.version：翻牌时先「按住」上一个状态（hold），等翻面动画的悬念停顿播完再显示结果。
 * 临时特效的计时器放在一张持久表里，只在卸载时清空。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import {
  EMOTE_COOLDOWN_MS,
  EMOTE_IDS,
  flippableMats,
  holdsLastChance,
  legalActions,
  totalDiscsInPlay,
  waitingFor,
  type Disc,
  type EmoteBroadcast,
  type EmoteId,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Phase,
  type Player,
  type StackDisc,
} from "@skull/game";
import { DISC, emoteSheet, EMOTE_NAME, sceneFor, SHEETS } from "./art.js";
import { bidChain, bidPreview, describeEvent, lastBidOf, makeNameOf, promptText, resolvingText, roundResult } from "./describe.js";
import { FinalDialog } from "./FinalDialog.js";
import GameRules from "./GameRules.js";
import { pickLayout, type BoardLayout, type SeatSlot } from "./layout.js";
import { DiscImg, FLIP_MS, Icon, Mat, Plate, Sprite, Thinking, type MatFx, type PushDir } from "./pieces.js";
import { GameRoomMenu, SpectateBar } from "./RoomExtras.js";
import { socket } from "./socket.js";
import type { Theme } from "./theme.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
  readonly theme: Theme;
  readonly chat: ReactNode;
  readonly onCommand: (command: GameCommand) => void;
  readonly onRematch: (accept: boolean) => void;
  /** 打开 / 取消自己的托管。 */
  readonly onAuto: (enabled: boolean) => void;
  readonly onDissolve: () => void;
  /** 观战时从这位玩家的座位看。 */
  readonly watchId: string;
  readonly onWatch: (playerId: string) => void;
  /** 观战的人离开。 */
  readonly onLeave: () => void;
  /** 人机给的一句提示（人机阶段的「理由」接口出来后接上；没有就不显示）。 */
  readonly hint?: string | undefined;
}

const PHASE_NAME: Record<Phase, string> = {
  placeInitial: "盖第 1 张",
  placeOrBid: "盖牌或开叫",
  bidding: "加注",
  resolving: "揭牌",
  loseChoosing: "挑一张丢掉",
  chooseFirst: "指定先手",
  roundEnd: "本轮结算",
  gameOver: "终局",
};

/* ---------------------------------------------------------------- 小工具 hooks */

function useViewport(): { w: number; h: number } {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const handle = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", handle);
    return () => window.removeEventListener("resize", handle);
  }, []);
  return size;
}

function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setSize({ w: Math.floor(element.clientWidth), h: Math.floor(element.clientHeight) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

/** 倒计时（秒）。 */
function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - (now - anchor.at)) / 1000));
}

/** 一张持久的计时器表：只在卸载时清空（状态更新时不取消，免得特效挂住）。 */
function useTimers() {
  const timers = useRef(new Set<number>());
  useEffect(() => () => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current.clear();
  }, []);
  return useCallback((ms: number, run: () => void) => {
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      run();
    }, Math.max(0, ms));
    timers.current.add(timer);
  }, []);
}

/* ---------------------------------------------------------------- 牌桌 */

type FxMap = Record<string, MatFx[]>;
type Spot = { owner: string; face: "rose" | "skull" | "lc"; fast: boolean; key: number };

function GameBoard({ room, busy, error, notice, brand, connection, themeToggle, theme, chat, onCommand, onRematch, onAuto, onDissolve, watchId, onWatch, onLeave, hint }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === socket.id);
  const spectating = !member;
  const selfId = spectating ? "" : member.playerId;
  const viewId = spectating ? watchId : selfId;
  const isHost = member?.isHost ?? false;
  const autoPlaying = member?.auto === true;
  const secondsLeft = useCountdown(room);
  const viewport = useViewport();
  const mobile = viewport.w < 720;
  const wideSide = viewport.w >= 1280;
  const later = useTimers();

  /* ---------- 动画：按住上一个状态 + 特效 ---------- */
  const [hold, setHold] = useState<{ prev: GameState; key: number } | null>(null);
  const [fx, setFx] = useState<FxMap>({});
  const [frozen, setFrozen] = useState<Record<string, StackDisc[]>>({});
  const [drops, setDrops] = useState<Record<string, { depth: number; key: string }>>({});
  const [turnKeys, setTurnKeys] = useState<Record<string, string>>({});
  const [spot, setSpot] = useState<Spot | null>(null);
  const [shake, setShake] = useState(0);
  const [bidPop, setBidPop] = useState(0);
  const [toast, setToast] = useState<{ key: number; face: "rose" | "skull" } | null>(null);
  const [finalReady, setFinalReady] = useState(game.phase === "gameOver");
  const [log, setLog] = useState<{ key: string; text: string }[]>([]);
  const prevGame = useRef<GameState>(game);
  const seenVersion = useRef(-1);
  const fxSeq = useRef(0);

  const addFx = useCallback((playerId: string, item: Omit<MatFx, "key">, ms: number) => {
    fxSeq.current += 1;
    const key = `fx${fxSeq.current}`;
    setFx((current) => ({ ...current, [playerId]: [...(current[playerId] ?? []), { ...item, key }] }));
    later(ms, () => setFx((current) => ({ ...current, [playerId]: (current[playerId] ?? []).filter((entry) => entry.key !== key) })));
  }, [later]);

  useEffect(() => {
    const prev = prevGame.current;
    prevGame.current = game;
    if (seenVersion.current === game.version) return;
    const first = seenVersion.current < 0;
    const restarted = game.version < seenVersion.current;
    seenVersion.current = game.version;
    const nameOfNow = makeNameOf(game, selfId);
    const lines = game.events
      .map((event, index) => ({ key: `${game.version}-${index}`, text: describeEvent(event, nameOfNow) }))
      .filter((line): line is { key: string; text: string } => line.text !== null)
      .reverse();
    const pushLog = () => setLog((previous) => [...lines, ...(restarted ? [] : previous)].slice(0, 80));
    if (first || restarted) {
      pushLog();
      setFinalReady(game.phase === "gameOver");
      return;
    }

    // 翻牌：先按住上一个状态，等悬念停顿播完再揭晓结果
    const key = game.version;
    let holdMs = 0;
    const reveals = game.events.flatMap((event) => (event.type === "DiscRevealed" ? [event] : []));
    for (const event of reveals) {
      const kind = event.auto ? "flipFast" : "flip";
      const duration = FLIP_MS[kind];
      holdMs = Math.max(holdMs, duration);
      const face = event.lastChance ? "lc" : event.face;
      addFx(event.owner, { kind, depth: event.depth, face }, duration + 40);
      later(duration - 60, () => {
        if (face === "skull") {
          addFx(event.owner, { kind: "skullHit", depth: event.depth }, 640);
          setShake((value) => value + 1);
        } else addFx(event.owner, { kind: "rosePop", depth: event.depth }, 460);
      });
      setSpot({ owner: event.owner, face, fast: event.auto, key });
      later(duration + 900, () => setSpot((current) => (current?.key === key ? null : current)));
    }
    if (reveals.length > 0) {
      setHold({ prev, key });
      later(holdMs, () => setHold((current) => (current?.key === key ? null : current)));
    }
    later(holdMs, pushLog);

    const failed = game.events.some((event) => event.type === "ChallengeFailed");
    const freezeMs = 1600;
    for (const event of game.events) {
      switch (event.type) {
        case "DiscPlaced":
          setDrops((current) => ({ ...current, [event.player]: { depth: event.stackSize - 1, key: String(key) } }));
          break;
        case "BidOpened":
        case "BidRaised":
          setBidPop(key);
          break;
        case "ChallengeFailed": {
          const challenger = event.challenger;
          const now = game.players.find((player) => player.id === challenger);
          const before = prev.players.find((player) => player.id === challenger);
          if (now && before && now.stack.length === 0 && before.stack.length > 0) {
            const own = reveals.find((item) => item.owner === challenger);
            const shown: StackDisc[] = before.stack.map((disc, depth) => (own && depth === own.depth ? { ...disc, revealed: true, face: own.face } : disc));
            later(holdMs, () => setFrozen((current) => ({ ...current, [challenger]: shown })));
            later(holdMs + freezeMs, () => setFrozen((current) => {
              const next = { ...current };
              delete next[challenger];
              return next;
            }));
          }
          break;
        }
        case "DiscLost": {
          const delay = failed ? holdMs + freezeMs : 0;
          later(delay, () => addFx(event.player, { kind: "loseDisc" }, 760));
          if (event.face && event.player === selfId) {
            const face = event.face;
            later(delay, () => setToast({ key, face }));
            later(delay + 4200, () => setToast((current) => (current?.key === key ? null : current)));
          }
          break;
        }
        case "PlayerEliminated": {
          const delay = failed ? holdMs + freezeMs + 300 : 0;
          later(delay, () => addFx(event.player, { kind: "snuff" }, 900));
          break;
        }
        case "ChallengeSucceeded":
          later(holdMs, () => {
            addFx(event.challenger, { kind: "success" }, 760);
            addFx(event.challenger, { kind: "matWin" }, 680);
            setTurnKeys((current) => ({ ...current, [event.challenger]: String(key) }));
          });
          break;
        case "StackRevealed":
          event.discs.forEach((disc, index) => {
            later(index * 160, () => addFx(event.player, { kind: "flipFast", depth: disc.depth, face: disc.lastChance ? "lc" : disc.face }, FLIP_MS.flipFast + 40));
          });
          break;
        default:
          break;
      }
    }
    if (game.phase === "gameOver") {
      setFinalReady(false);
      later(holdMs + 1800, () => setFinalReady(true));
    } else setFinalReady(false);
  }, [game.version]);

  useEffect(() => {
    if (shake === 0) return;
    const value = shake;
    later(320, () => setShake((current) => (current === value ? 0 : current)));
  }, [shake]);

  /* ---------- 显示用的状态（按住时是上一个状态） ---------- */
  const view = hold ? hold.prev : game;
  const nameOf = makeNameOf(view, selfId);
  const waiting = waitingFor(view);
  const actions = spectating || hold || autoPlaying ? [] : legalActions(game, selfId);
  const me = view.players.find((player) => player.id === viewId);
  const myTurn = actions.length > 0;
  const total = totalDiscsInPlay(view);

  // 页面在后台、轮到我时标题提示
  useEffect(() => {
    const base = "骷髅牌 · 在线对战";
    const update = () => { document.title = myTurn && document.hidden ? `【轮到你】${base}` : base; };
    update();
    document.addEventListener("visibilitychange", update);
    return () => { document.removeEventListener("visibilitychange", update); document.title = base; };
  }, [myTurn]);

  /* ---------- 选牌和叫价 ---------- */
  const [selected, setSelected] = useState<string | null>(null);
  const minBid = view.phase === "bidding" ? view.bid + 1 : 1;
  const [bidCount, setBidCount] = useState(minBid);
  useEffect(() => setSelected(null), [view.phase, view.turn, view.round]);
  useEffect(() => setBidCount(Math.min(Math.max(minBid, 1), Math.max(total, 1))), [minBid, view.phase, total]);

  const placeType = actions.find((action) => action.type === "placeFirst" || action.type === "placeDisc")?.type as "placeFirst" | "placeDisc" | undefined;
  const canLose = actions.some((action) => action.type === "loseDisc");
  const bidType = actions.find((action) => action.type === "openBid" || action.type === "raise")?.type as "openBid" | "raise" | undefined;
  const canPass = actions.some((action) => action.type === "pass");
  const flippable = new Set(myTurn && view.phase === "resolving" ? flippableMats(view) : []);
  const choosingFirst = myTurn && view.phase === "chooseFirst";
  const canContinue = actions.some((action) => action.type === "nextRound");
  const canReveal = actions.some((action) => action.type === "revealStack");

  const send = useCallback((command: GameCommand) => {
    setSelected(null);
    onCommand(command);
  }, [onCommand]);

  const pickDisc = (discId: string) => {
    if (selected === discId) {
      if (placeType) send({ type: placeType, discId });
      else if (canLose) send({ type: "loseDisc", discId });
      return;
    }
    setSelected(discId);
  };

  // 键盘：1–5 选牌，回车确认，←/→ 调叫价，P 过，空格继续，Esc 取消
  const keyState = useRef({ placeType, canLose, bidType, canPass, canContinue, selected, bidCount, minBid, total, hand: me?.hand ?? [] });
  keyState.current = { placeType, canLose, bidType, canPass, canContinue, selected, bidCount, minBid, total, hand: me?.hand ?? [] };
  useEffect(() => {
    const handle = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const state = keyState.current;
      if (/^[1-5]$/.test(event.key) && (state.placeType || state.canLose)) {
        const disc = state.hand[Number(event.key) - 1];
        if (disc?.id && !(state.canLose && disc.lastChance)) setSelected(disc.id);
        return;
      }
      if (event.key === "Escape") { setSelected(null); return; }
      if (event.key === "Enter") {
        if (target?.tagName === "BUTTON") return;
        if (state.selected && state.placeType) { event.preventDefault(); send({ type: state.placeType, discId: state.selected }); return; }
        if (state.selected && state.canLose) { event.preventDefault(); send({ type: "loseDisc", discId: state.selected }); return; }
        if (state.bidType) { event.preventDefault(); send({ type: state.bidType, count: state.bidCount }); }
        return;
      }
      if (state.bidType && (event.key === "ArrowRight" || event.key === "ArrowUp" || event.key === "+" || event.key === "=")) {
        event.preventDefault();
        setBidCount((value) => Math.min(state.total, value + 1));
        return;
      }
      if (state.bidType && (event.key === "ArrowLeft" || event.key === "ArrowDown" || event.key === "-")) {
        event.preventDefault();
        setBidCount((value) => Math.max(state.minBid, value - 1));
        return;
      }
      if ((event.key === "p" || event.key === "P") && state.canPass) { send({ type: "pass" }); return; }
      if (event.key === " " && state.canContinue && target?.tagName !== "BUTTON") { event.preventDefault(); send({ type: "nextRound" }); }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [send]);

  /* ---------- 快捷表情 ---------- */
  const [bubbles, setBubbles] = useState<Record<string, { id: EmoteId; key: string }>>({});
  const [emoteError, setEmoteError] = useState("");
  const [cooling, setCooling] = useState(false);
  useEffect(() => {
    const handle = (emote: EmoteBroadcast) => {
      const key = `${emote.from}-${emote.at}-${Math.random()}`;
      setBubbles((current) => ({ ...current, [emote.from]: { id: emote.id, key } }));
      later(2400, () => setBubbles((current) => {
        if (current[emote.from]?.key !== key) return current;
        const next = { ...current };
        delete next[emote.from];
        return next;
      }));
    };
    socket.on("room:emote", handle);
    return () => { socket.off("room:emote", handle); };
  }, [later]);
  const sendEmote = useCallback((id: EmoteId) => {
    setCooling(true);
    later(EMOTE_COOLDOWN_MS, () => setCooling(false));
    socket.emit("room:emote", { id }, (response) => {
      setEmoteError(response.ok ? "" : response.error);
      if (!response.ok) later(2400, () => setEmoteError(""));
    });
  }, [later]);

  /* ---------- 排版 ---------- */
  const [tableRef, tableSize] = useElementSize<HTMLDivElement>();
  const opponents = rotateFrom(view.players, viewId).slice(1);
  const handMax = me && (me.hand.length >= 5 || holdsLastChance(view, me)) ? 5 : 4;
  const layout: BoardLayout = useMemo(
    () => pickLayout(mobile ? viewport.w : tableSize.w, tableSize.h, opponents.length, handMax),
    [mobile, viewport.w, tableSize.w, tableSize.h, opponents.length, handMax],
  );
  const [drawer, setDrawer] = useState(false);

  /* ---------- 座位 ---------- */
  const memberOf = (playerId: string): LobbyMember | undefined => room.members.find((candidate) => candidate.playerId === playerId);
  const renderSeat = (player: Player, slot: SeatSlot | "me") => {
    const seated = memberOf(player.id);
    const offline = seated ? !seated.connected : false;
    const isViewer = player.id === viewId;
    const tags: string[] = [];
    if (seated?.bot) tags.push("人机");
    else if (seated?.auto) tags.push("托管");
    if (offline && !seated?.bot) tags.push("离线");
    if (spectating && isViewer) tags.push("视角");
    const shownStack = frozen[player.id] ?? player.stack;
    const eliminatedNow = player.eliminated && !frozen[player.id];
    const acting = waiting.includes(player.id) && view.phase !== "roundEnd";
    const pushDir: PushDir | undefined = player.passed && !player.eliminated ? pushFor(slot) : undefined;
    const canFlip = flippable.has(player.id);
    const canPick = choosingFirst && !player.eliminated;
    const dim = flippable.size > 0 && !canFlip && player.id !== view.challenger;
    const click = canFlip
      ? () => send({ type: "flipMat", player: player.id })
      : canPick
        ? () => send({ type: "chooseFirstPlayer", player: player.id })
        : undefined;
    const label = canFlip ? "翻这块" : canPick ? "让他先手" : undefined;
    const mine = isViewer && (!spectating || room.access.spectatorsSeeAll);
    const flowerBefore = hold ? hold.prev.players.find((item) => item.id === player.id)?.flowerUp ?? false : player.flowerUp;
    const status = {
      first: view.firstPlayer === player.id && view.phase !== "gameOver",
      challenger: view.challenger === player.id && ["resolving", "loseChoosing", "chooseFirst", "roundEnd"].includes(view.phase),
      acting,
      passed: player.passed,
      placed: view.phase === "placeInitial" && player.placedInitial && !player.eliminated,
      ready: view.phase === "roundEnd" && player.ready,
      flower: player.flowerUp,
      lastChance: holdsLastChance(view, player),
      eliminated: player.eliminated,
    };
    const seatClass = [
      "sk-seat",
      slot === "me" ? "me" : `slot-${slot.row}`,
      acting ? "acting" : "",
      player.eliminated ? "out" : "",
      offline ? "offline" : "",
      click ? "pickable" : "",
    ].filter(Boolean).join(" ");
    return (
      <div key={player.id} className={seatClass} data-tutorial={slot === "me" ? "my-seat" : `seat-${player.id}`}>
        <Mat
          seat={player.seat}
          flower={player.flowerUp && flowerBefore}
          stack={shownStack}
          scale={layout.scale}
          mine={mine}
          fx={fx[player.id] ?? []}
          dropDepth={drops[player.id]}
          eliminated={eliminatedNow}
          pushed={pushDir}
          dim={dim}
          glow={Boolean(click)}
          onClick={click}
          label={label}
          tutorial={slot === "me" ? "my-mat" : `mat-${player.id}`}
          turnKey={turnKeys[player.id]}
        />
        <Plate
          name={player.name}
          seat={player.seat}
          isMe={player.id === selfId}
          tags={tags}
          onBoard={shownStack.length}
          inHand={frozen[player.id] ? Math.max(0, player.hand.length - shownStack.length) : player.hand.length}
          status={status}
          lastBid={lastBidOf(view, player.id)}
          shown={view.roundLog.reveals.find((reveal) => reveal.player === player.id)?.discs.map((disc) => (disc.lastChance ? "lc-up" : disc.face))}
          emote={bubbles[player.id]}
          compact={layout.mobile}
          size={layout.scale}
          tutorial={slot === "me" ? "my-plate" : `plate-${player.id}`}
          {...(click ? { onClick: click } : {})}
        />
      </div>
    );
  };

  /* ---------- 中央 ---------- */
  const result = view.phase === "roundEnd" || (view.phase === "gameOver" && view.roundLog.result) || view.phase === "loseChoosing" || view.phase === "chooseFirst"
    ? roundResult(view, selfId, nameOf)
    : null;
  const flippingText = spot && hold ? `翻开 ${nameOf(spot.owner)} 的${spot.owner === view.challenger ? "自己的" : ""}垫子…` : null;
  const center = (
    <div className={["sk-center", result && !hold ? "result" : ""].filter(Boolean).join(" ")} data-tutorial="center">
      {layout.mobile && spot && (
        <div className="sk-spotlight" key={spot.key}>
          <Sprite
            sheet={spot.face === "skull" ? SHEETS.flipSkull : spot.face === "lc" ? SHEETS.flipLc : SHEETS.flipRose}
            scale={3}
            mode={spot.fast ? "flipFast" : "flip"}
            frameMs={60}
          />
        </div>
      )}
      <div className="sk-center-nums">
        <div className="sk-big" data-tutorial="total" title="场上盖着的垫子总数，叫价最多叫到这么多">
          <Icon name="stack" scale={2} />
          <span className="sk-big-label">场上</span>
          <b>{total}</b>
        </div>
        <div className="sk-big bid" data-tutorial="bid" title="当前最高叫价">
          <Icon name="bell" scale={2} />
          <span className="sk-big-label">叫价</span>
          <b key={bidPop} className={bidPop ? "pop" : ""}>{view.bid > 0 ? view.bid : "—"}</b>
          {view.bidder && <span className="sk-big-who">{nameOf(view.bidder)}</span>}
        </div>
      </div>
      <div className="sk-center-line" data-tutorial="round-result">
        {flippingText ? (
          <strong className="sk-suspense">{flippingText}</strong>
        ) : result ? (
          <>
            <strong className={view.roundLog.result === "success" ? "ok" : "bad"}>{result.title}</strong>
            {result.detail && <span>{result.detail}</span>}
            {result.lostFace && (
              <span className="sk-lost-mine">你丢的是 <DiscImg face={result.lostFace} scale={1} /> {result.lostFace === "rose" ? "玫瑰" : "骷髅"}<small>只有你知道</small></span>
            )}
          </>
        ) : view.phase === "resolving" ? (
          <strong>{resolvingText(view, nameOf)}</strong>
        ) : view.phase === "placeInitial" ? (
          <span>第 {view.round} 轮 · {nameOf(view.firstPlayer)} 先手</span>
        ) : view.bid > 0 ? (
          <span>只剩一人没过、或者叫到 {total}，就开翻</span>
        ) : (
          <span>{nameOf(view.firstPlayer)} 先手 · 叫价最多叫到 {total}</span>
        )}
      </div>
    </div>
  );

  /* ---------- 我的手牌 ---------- */
  const handDiscs: Disc[] = me ? me.hand : [];
  const handSelectable = Boolean(placeType || canLose);
  const showFaces = !spectating || room.access.spectatorsSeeAll;
  const hand = me && !me.eliminated ? (
    <div className={["sk-hand", handSelectable ? "selectable" : ""].filter(Boolean).join(" ")} data-tutorial="my-hand">
      {handDiscs.length === 0 ? (
        <span className="sk-hand-empty">手里没有垫子了</span>
      ) : handDiscs.map((disc, index) => {
        const face = disc.lastChance ? "lc-up" : showFaces && disc.face ? disc.face : "back";
        const id = disc.id ?? `x${index}`;
        const blocked = canLose && disc.lastChance;
        const isSelected = selected === id;
        return (
          <button
            key={id}
            type="button"
            className={["sk-hand-disc", isSelected ? "selected" : ""].filter(Boolean).join(" ")}
            data-tutorial={`hand-disc-${index}`}
            data-face={face}
            disabled={!handSelectable || busy || blocked}
            onClick={() => disc.id && pickDisc(disc.id)}
            aria-label={`${face === "rose" ? "玫瑰" : face === "skull" ? "骷髅" : face === "lc-up" ? "Last Chance 碟" : "垫子"}${isSelected ? "（已选中，再点一下确认）" : ""}`}
            style={{ width: DISC.w * layout.handScale, height: (DISC.h + 4) * layout.handScale, "--hs": layout.handScale } as CSSProperties}
          >
            <DiscImg face={face} scale={layout.handScale} />
            {handSelectable && !layout.mobile && <kbd>{index + 1}</kbd>}
          </button>
        );
      })}
      {handSelectable && selected && <span className="sk-hand-tip">再点一下{placeType ? "盖上" : "丢掉"}</span>}
    </div>
  ) : null;

  /* ---------- 操作面板 ---------- */
  const showEmoteButton = !spectating && (!wideSide || layout.mobile);
  const action = (
    <div className="sk-action" data-tutorial="action-panel">
      <ActionContent
        view={view}
        me={me}
        selfId={selfId}
        spectating={spectating}
        autoPlaying={autoPlaying}
        holding={Boolean(hold)}
        busy={busy}
        selected={selected}
        placeType={placeType}
        canLose={canLose}
        bidType={bidType}
        canPass={canPass}
        canContinue={canContinue}
        canReveal={canReveal}
        choosingFirst={choosingFirst}
        bidCount={bidCount}
        minBid={minBid}
        total={total}
        secondsLeft={secondsLeft}
        nameOf={nameOf}
        onBid={setBidCount}
        onSend={send}
        onAuto={onAuto}
        mobile={layout.mobile}
        hint={hint}
      />
      {showEmoteButton && <EmoteButton onSend={sendEmote} cooling={cooling} error={emoteError} />}
    </div>
  );

  /* ---------- 提示条 ---------- */
  let prompt: { text: string; mine: boolean };
  if (flippingText) prompt = { text: flippingText, mine: false };
  else {
    const base = promptText(view, selfId, spectating, nameOf);
    if (spectating) prompt = { text: `观战中 · ${base.text}`, mine: false };
    else if (autoPlaying && view.phase !== "gameOver") prompt = { text: "托管中：人机在替你走", mine: false };
    else if (me?.eliminated && view.phase !== "gameOver" && !myTurn) prompt = { text: `你已出局 · ${base.text}`, mine: false };
    else prompt = base;
  }
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";
  const timerShown = secondsLeft !== null && view.phase !== "gameOver";

  const top = opponents.filter((_, index) => layout.slots[index]?.row === "top");
  const left = opponents.find((_, index) => layout.slots[index]?.row === "left");
  const right = opponents.find((_, index) => layout.slots[index]?.row === "right");

  const side = (
    <>
      {!spectating && !layout.mobile && wideSide && <EmoteTray onSend={sendEmote} cooling={cooling} error={emoteError} />}
      <section className="sk-panel sk-round-log" data-tutorial="round-log">
        <h3>第 {view.round} 轮</h3>
        <div className="sk-chain">
          {bidChain(view, nameOf).map((text, index) => <span key={index} className={text.endsWith("过") ? "pass" : ""}>{text}</span>)}
          {view.roundLog.bids.length === 0 && <span className="muted">还没人开叫</span>}
        </div>
        {view.roundLog.flips.length > 0 && (
          <div className="sk-flips">
            {view.roundLog.flips.map((flip, index) => (
              <span key={index} title={`${nameOf(flip.owner)} 的第 ${flip.depth + 1} 张`}>
                <DiscImg face={flip.lastChance ? "lc-up" : flip.face} scale={1} />
                <small>{nameOf(flip.owner)}</small>
              </span>
            ))}
          </div>
        )}
      </section>
      <section className="sk-panel sk-log" data-tutorial="log">
        <h3>记录</h3>
        {log.length === 0 ? <p className="muted">还没有动作。</p> : <ul>{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul>}
      </section>
      <div className="sk-chat">{chat}</div>
    </>
  );

  const stageStyle = { backgroundImage: `url(${sceneFor(room.code || game.players.map((player) => player.name).join(""), theme === "day")})` } as CSSProperties;

  return (
    <div className={["sk-screen", layout.mobile ? "sk-mobile" : "", wideSide ? "wide" : "narrow"].filter(Boolean).join(" ")}>
      <header className="sk-topbar">
        {brand}
        <div className="sk-round" data-tutorial="round">
          <b>第 {view.round} 轮</b>
          <span>{PHASE_NAME[view.phase]}</span>
        </div>
        <div className="sk-topbar-right">
          <GameRules />
          {themeToggle}
          <GameRoomMenu room={room} />
          {!wideSide && !layout.mobile && (
            <button className="quiet-button" type="button" aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>{drawer ? "收起" : "记录 / 聊天"}</button>
          )}
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {!layout.mobile && connection}
        </div>
      </header>
      {spectating && <SpectateBar room={room} watchId={watchId} onWatch={onWatch} onLeave={onLeave} />}

      <div className="sk-body">
        <section className={["sk-stage", shake ? "shake" : ""].filter(Boolean).join(" ")} style={stageStyle}>
          <div className={["sk-prompt", prompt.mine ? "mine" : "", timerShown && secondsLeft! <= 5 ? "urgent" : ""].filter(Boolean).join(" ")} role="status" data-tutorial="prompt">
            <span className="sk-prompt-text">{prompt.text}</span>
            {timerShown && <b className="sk-timer" data-tutorial="timer" title="剩余秒数，到时系统替你做">{secondsLeft}</b>}
          </div>
          {(error || shownNotice) && <p className={error ? "sk-feedback error" : "sk-feedback"} role={error ? "alert" : "status"}>{error || shownNotice}</p>}
          {toast && (
            <div className="sk-toast" key={toast.key} role="status">
              你丢掉了一张 <DiscImg face={toast.face} scale={1} /> <b>{toast.face === "rose" ? "玫瑰" : "骷髅"}</b> · 只有你知道
            </div>
          )}
          <div
            className={["sk-table", layout.sides ? "sides" : "nosides"].join(" ")}
            ref={tableRef}
            style={{ "--s": layout.scale, "--gap": `${layout.gap}px`, "--plate": `${layout.plateW}px`, "--action": `${layout.actionW}px` } as CSSProperties}
          >
            {(tableSize.w > 0 || layout.mobile) && (
              <>
                <div className={`sk-row-top n${top.length}`}>{top.map((player) => renderSeat(player, layout.slots[opponents.indexOf(player)]!))}</div>
                <div className="sk-row-mid">
                  {left && renderSeat(left, { row: "left", index: 0 })}
                  {center}
                  {right && renderSeat(right, { row: "right", index: 0 })}
                </div>
                <div className="sk-row-me">
                  {me && renderSeat(me, "me")}
                  {hand}
                  {action}
                </div>
              </>
            )}
          </div>
        </section>
        <aside className={["sk-side", drawer ? "open" : ""].filter(Boolean).join(" ")}>{side}</aside>
      </div>
      {view.phase === "gameOver" && finalReady && (
        <FinalDialog game={view} room={room} myId={selfId} spectating={spectating} onRematch={onRematch} onLeave={onLeave} />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- 操作面板 */

function ActionContent(props: {
  view: GameState;
  me: Player | undefined;
  selfId: string;
  spectating: boolean;
  autoPlaying: boolean;
  holding: boolean;
  busy: boolean;
  selected: string | null;
  placeType: "placeFirst" | "placeDisc" | undefined;
  canLose: boolean;
  bidType: "openBid" | "raise" | undefined;
  canPass: boolean;
  canContinue: boolean;
  canReveal: boolean;
  choosingFirst: boolean;
  bidCount: number;
  minBid: number;
  total: number;
  secondsLeft: number | null;
  nameOf: (id: string | null | undefined) => string;
  onBid: (value: number) => void;
  onSend: (command: GameCommand) => void;
  onAuto: (enabled: boolean) => void;
  mobile: boolean;
  hint?: string | undefined;
}) {
  const { view, me, busy, selected, placeType, canLose, bidType, canPass, bidCount, minBid, total, nameOf, onSend } = props;
  if (props.spectating) {
    return <p className="sk-action-note">观战中：看得到大家怎么叫、怎么翻{view.phase === "gameOver" ? "" : "；点上面的名字换视角"}</p>;
  }
  if (props.autoPlaying && view.phase !== "gameOver") {
    return (
      <div className="sk-action-stack">
        <p className="sk-action-note">托管中：人机正在替你走（不会替你亮牌）</p>
        <button className="primary-button sk-big-button" type="button" onClick={() => props.onAuto(false)} data-tutorial="cancel-auto">取消托管</button>
      </div>
    );
  }
  if (props.holding) return <p className="sk-action-note"><Thinking /> 翻牌中…</p>;
  if (view.phase === "gameOver") return <p className="sk-action-note">终局</p>;

  if (view.phase === "roundEnd") {
    const alive = view.players.filter((player) => !player.eliminated);
    const readyCount = alive.filter((player) => player.ready).length;
    return (
      <div className="sk-action-stack">
        {props.canContinue ? (
          <button className="primary-button sk-big-button" type="button" disabled={busy} onClick={() => onSend({ type: "nextRound" })} data-tutorial="continue-button">
            继续{props.secondsLeft !== null ? `（${props.secondsLeft}）` : ""}
          </button>
        ) : (
          <p className="sk-action-note">{me?.ready ? "已继续，等其他人" : "本轮结束"} · {readyCount}/{alive.length}</p>
        )}
        {props.canReveal && (
          <button className="quiet-button sk-mid-button" type="button" disabled={busy} onClick={() => onSend({ type: "revealStack" })} data-tutorial="reveal-button">
            <Icon name="eye" scale={2} /> 亮出我的垫子
          </button>
        )}
        {props.canContinue && !props.mobile && <small className="sk-keys">空格 = 继续 · 已继续 {readyCount}/{alive.length}</small>}
      </div>
    );
  }

  if (me?.eliminated && !props.choosingFirst) {
    return <p className="sk-action-note">你已出局，还能看大家打、发表情</p>;
  }

  if (props.choosingFirst) {
    const alive = view.players.filter((player) => !player.eliminated);
    return (
      <div className="sk-action-stack" data-tutorial="first-picker">
        <p className="sk-action-note">点一个人（或他的板），让他下一轮先手</p>
        <div className="sk-pick-row">
          {alive.map((player) => (
            <button key={player.id} className="quiet-button sk-mid-button" type="button" disabled={busy} onClick={() => onSend({ type: "chooseFirstPlayer", player: player.id })}>
              {player.name}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (canLose) {
    return (
      <div className="sk-action-stack">
        <p className="sk-action-note">点一张选中，再丢掉（别人只看到你少了一张）</p>
        <button className="primary-button sk-big-button" type="button" disabled={!selected || busy} onClick={() => selected && onSend({ type: "loseDisc", discId: selected })} data-tutorial="lose-button">
          {selected ? "丢掉这张" : "先点一张"}
        </button>
      </div>
    );
  }

  if (view.phase === "resolving" && view.awaitingMatChoice && view.challenger === props.selfId) {
    return <p className="sk-action-note big">点一块亮起来的板翻开 · 还差 <b>{view.flipsToDo}</b> 张</p>;
  }

  if (placeType || bidType) {
    const preview = bidType ? bidPreview(me, bidCount) : null;
    return (
      <div className="sk-action-stack">
        {placeType && (
          <button className="primary-button sk-big-button" type="button" disabled={!selected || busy} onClick={() => selected && onSend({ type: placeType, discId: selected })} data-tutorial="place-button">
            {selected ? "盖上这张" : "先点一张手牌"}
          </button>
        )}
        {bidType && (
          <div className="sk-bid" data-tutorial="bid-panel">
            <div className="sk-stepper">
              <button type="button" className="quiet-button sk-step" disabled={bidCount <= minBid || busy} onClick={() => props.onBid(Math.max(minBid, bidCount - 1))} aria-label="少叫一个">−</button>
              <b className="sk-step-value">{bidCount}</b>
              <button type="button" className="quiet-button sk-step" disabled={bidCount >= total || busy} onClick={() => props.onBid(Math.min(total, bidCount + 1))} aria-label="多叫一个">+</button>
              <button type="button" className={["primary-button", "sk-big-button", "sk-bid-go", preview?.danger ? "danger" : ""].filter(Boolean).join(" ")} disabled={busy || bidCount < minBid || bidCount > total} onClick={() => onSend({ type: bidType, count: bidCount })} data-tutorial="bid-button">
                {bidType === "openBid" ? `开叫 ${bidCount}` : `加到 ${bidCount}`}
              </button>
            </div>
            {preview && <small className={preview.danger ? "sk-preview danger" : "sk-preview"}>{preview.text}</small>}
          </div>
        )}
        {canPass && (
          <button className="quiet-button sk-mid-button" type="button" disabled={busy} onClick={() => onSend({ type: "pass" })} data-tutorial="pass-button">
            <Icon name="pass" scale={2} /> 过（这一轮不再叫）
          </button>
        )}
        {props.hint && <small className="sk-hint" data-tutorial="hint">提示：{props.hint}</small>}
        {!props.mobile && <small className="sk-keys">{[placeType ? "1–5 选牌 · 回车盖" : "", bidType ? "←/→ 调数" : "", canPass ? "P 过" : ""].filter(Boolean).join(" · ")}</small>}
      </div>
    );
  }

  // 等别人
  const waiting = waitingFor(view).filter((id) => id !== props.selfId);
  if (view.phase === "placeInitial" && me?.placedInitial) {
    return <p className="sk-action-note"><Thinking /> 已盖好，等 {waiting.length} 人</p>;
  }
  if (view.phase === "resolving" && !view.awaitingMatChoice) {
    return <p className="sk-action-note"><Thinking /> {nameOf(view.challenger)} 正在翻自己的垫子</p>;
  }
  return <p className="sk-action-note"><Thinking /> 等 {waiting.map((id) => nameOf(id)).join("、") || "系统"}</p>;
}

/* ---------------------------------------------------------------- 快捷表情 */

function EmoteTray({ onSend, cooling, error }: { onSend: (id: EmoteId) => void; cooling: boolean; error: string }) {
  return (
    <section className="sk-panel sk-emotes" data-tutorial="emotes" aria-label="快捷表情">
      <h3>快捷表情 <small>{cooling ? "冷却中…" : "点一下冒在你头像上"}</small></h3>
      <div className="sk-emote-row">
        {EMOTE_IDS.map((id) => (
          <button key={id} type="button" className="sk-emote-button" disabled={cooling} onClick={() => onSend(id)} title={EMOTE_NAME[id]} aria-label={EMOTE_NAME[id]}>
            <Sprite sheet={emoteSheet(id)} scale={1} mode="still" />
          </button>
        ))}
      </div>
      {error && <small className="sk-emote-error">{error}</small>}
    </section>
  );
}

function EmoteButton({ onSend, cooling, error }: { onSend: (id: EmoteId) => void; cooling: boolean; error: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="sk-emote-pop-wrap" data-tutorial="emotes">
      <button className="quiet-button sk-emote-toggle" type="button" aria-expanded={open} aria-label="快捷表情" onClick={() => setOpen(!open)}>
        <Sprite sheet={emoteSheet("taunt")} scale={1} mode="still" /><span className="sk-emote-toggle-label">表情</span>
      </button>
      {open && (
        <div className="sk-emote-pop" role="dialog" aria-label="快捷表情">
          {EMOTE_IDS.map((id) => (
            <button key={id} type="button" className="sk-emote-button" disabled={cooling} onClick={() => { onSend(id); setOpen(false); }} title={EMOTE_NAME[id]} aria-label={EMOTE_NAME[id]}>
              <Sprite sheet={emoteSheet(id)} scale={1} mode="still" />
              <small>{EMOTE_NAME[id]}</small>
            </button>
          ))}
        </div>
      )}
      {error && <small className="sk-emote-error">{error}</small>}
    </div>
  );
}

/* ---------------------------------------------------------------- 工具 */

/** 从某人开始按座位顺序（顺时针）排。 */
function rotateFrom(players: readonly Player[], fromId: string): Player[] {
  const index = Math.max(0, players.findIndex((player) => player.id === fromId));
  return [...players.slice(index), ...players.slice(0, index)];
}

function pushFor(slot: SeatSlot | "me"): PushDir {
  if (slot === "me") return "up";
  if (slot.row === "left") return "right";
  if (slot.row === "right") return "left";
  return "down";
}

export default GameBoard;
