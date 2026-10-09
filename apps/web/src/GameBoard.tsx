/**
 * 调试牌桌（引擎阶段放的，正式牌桌由界面阶段做）：把状态原样列出来，每个合法行动一个按钮，方便联调。
 * - 顶栏：第几轮、阶段、倒计时、规则、房间菜单、解散。
 * - 中间：每个座位（手里、板上从底到顶、花面 / pass / 淘汰 / 托管 / 离线标签）、场上总数和叫价、我的合法行动按钮、快捷表情。
 * - 右边：本轮叫价和翻牌记录、事件日志、聊天。
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  EMOTE_IDS,
  legalActions,
  totalDiscsInPlay,
  waitingFor,
  type Disc,
  type EmoteBroadcast,
  type EmoteId,
  type GameCommand,
  type GameEvent,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type Phase,
  type StackDisc,
} from "@skull/game";
import GameRules from "./GameRules.js";
import { GameRoomMenu, SpectateBar } from "./RoomExtras.js";
import { socket } from "./socket.js";

interface GameBoardProps {
  readonly room: LobbyRoomSnapshot;
  readonly busy: boolean;
  readonly error: string;
  readonly notice: string;
  readonly brand: ReactNode;
  readonly connection: ReactNode;
  /** 顶栏的白天 / 夜间切换按钮。 */
  readonly themeToggle: ReactNode;
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
}

const PHASE_NAME: Record<Phase, string> = {
  placeInitial: "准备：同时盖第 1 张",
  placeOrBid: "轮流：盖牌或开叫",
  bidding: "加注",
  resolving: "揭牌",
  loseChoosing: "自选失牌",
  chooseFirst: "指定下一轮先手",
  roundEnd: "本轮结算",
  gameOver: "终局",
};

const EMOTE_NAME: Record<EmoteId, string> = {
  rose: "玫瑰",
  skull: "骷髅",
  taunt: "挑衅",
  shrug: "摊手",
  think: "思考",
  laugh: "大笑",
  sweat: "紧张",
  shock: "吃惊",
};

const FACE = { rose: "玫", skull: "骷" } as const;

function useCountdown(room: LobbyRoomSnapshot): number | null {
  const [now, setNow] = useState(Date.now());
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.turnRemainingMs });
  useEffect(() => setAnchor({ at: Date.now(), ms: room.turnRemainingMs }), [room]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  if (anchor.ms === undefined) return null;
  return Math.max(0, Math.ceil((anchor.ms - (now - anchor.at)) / 1000));
}

function discLabel(disc: Disc | StackDisc): string {
  if (disc.lastChance) return "碟";
  if (!disc.face) return "?";
  return FACE[disc.face];
}

/** 事件写成一句话（调试用）。 */
function describeEvent(event: GameEvent, name: (id: string) => string): string | null {
  switch (event.type) {
    case "RoundStarted":
      return `第 ${event.round} 轮开始，${name(event.firstPlayer)} 先手`;
    case "LastChanceGiven":
      return `${name(event.player)} 拿到 Last Chance 碟`;
    case "DiscPlaced":
      return `${name(event.player)} 盖了一张${event.lastChance ? "（Last Chance 碟）" : ""}，板上 ${event.stackSize} 张`;
    case "PlacementDone":
      return "大家都盖好了";
    case "BidOpened":
      return `${name(event.player)} 开叫 ${event.count}`;
    case "BidRaised":
      return `${name(event.player)} 加到 ${event.count}`;
    case "Passed":
      return `${name(event.player)} pass`;
    case "ChallengeStarted":
      return `${name(event.challenger)} 当挑战者，要翻 ${event.bid} 张`;
    case "DiscRevealed":
      return `翻开 ${name(event.owner)} 的第 ${event.depth + 1} 张：${event.lastChance ? "Last Chance 碟（玫瑰）" : event.face === "rose" ? "玫瑰" : "骷髅"}，还差 ${event.flipsLeft}`;
    case "ChallengeSucceeded":
      return event.won ? `${name(event.challenger)} 第二次成功，赢了！` : `${name(event.challenger)} 挑战成功，垫板翻到花面`;
    case "ChallengeFailed":
      return `${name(event.challenger)} 翻到${event.selfSkull ? "自己" : ` ${name(event.skullOwner)} `}的骷髅，失败`;
    case "DiscLost": {
      const how = { chosen: "自己挑了一张丢掉", forced: "丢掉了最后一张", random: "被随机拿走一张", lastChance: "连同 Last Chance 碟一起失去" }[event.method];
      return `${name(event.player)} ${how}${event.face ? `（${event.face === "rose" ? "玫瑰" : "骷髅"}）` : ""}，还剩 ${event.remaining} 张`;
    }
    case "PlayerEliminated":
      return `${name(event.player)} 淘汰`;
    case "LastChanceEarned":
      return `${name(event.player)} 只剩 1 张，下一轮拿 Last Chance 碟`;
    case "FirstPlayerChosen":
      return `${name(event.by)} 指定 ${name(event.player)} 下一轮先手${event.auto ? "（超时自动）" : ""}`;
    case "RoundEnded":
      return `第 ${event.round} 轮${event.result === "success" ? "成功" : "失败"}，下一轮 ${name(event.nextFirst)} 先手`;
    case "StackRevealed":
      return `${name(event.player)} 亮出垫子：${event.discs.map((disc) => (disc.lastChance ? "碟" : FACE[disc.face])).join(" ")}`;
    case "PlayerReady":
      return `${name(event.player)} 点了继续`;
    case "GameEnded":
      return `${name(event.winner)} 获胜（${event.reason === "twoWins" ? "成功两次" : "活到最后"}）`;
    case "TimedOut":
      return `${name(event.player)} 超时，系统代做`;
  }
}

function commandLabel(command: GameCommand, game: GameState, name: (id: string) => string, me: string): string {
  const mine = game.players.find((player) => player.id === me);
  const discName = (discId: string) => {
    const disc = [...(mine?.hand ?? []), ...(mine?.stack ?? [])].find((candidate) => candidate.id === discId);
    return disc ? (disc.lastChance ? "Last Chance 碟" : disc.face === "rose" ? "玫瑰" : "骷髅") : discId;
  };
  switch (command.type) {
    case "placeFirst":
    case "placeDisc":
      return `盖 ${discName(command.discId)}`;
    case "openBid":
      return `开叫 ${command.count}`;
    case "raise":
      return `加到 ${command.count}`;
    case "pass":
      return "pass";
    case "flipMat":
      return `翻 ${name(command.player)} 的板`;
    case "loseDisc":
      return `丢 ${discName(command.discId)}`;
    case "chooseFirstPlayer":
      return `让 ${name(command.player)} 先手`;
    case "nextRound":
      return "继续";
    case "revealStack":
      return "亮出我的垫子";
  }
}

function GameBoard({ room, busy, error, notice, brand, connection, themeToggle, chat, onCommand, onRematch, onAuto, onDissolve, watchId, onWatch, onLeave }: GameBoardProps) {
  const game = room.game!;
  const member = room.members.find((candidate) => candidate.id === socket.id);
  // 观战的人没有座位：按 watchId 那位玩家的座位看，但什么都不能点，也不叫「你」。
  const spectating = !member;
  const selfId = spectating ? "" : member.playerId;
  const isHost = member?.isHost ?? false;
  const secondsLeft = useCountdown(room);
  const nameOf = (playerId: string) => (playerId === selfId ? "你" : game.players.find((player) => player.id === playerId)?.name ?? "?");
  const memberOf = (playerId: string): LobbyMember | undefined => room.members.find((candidate) => candidate.playerId === playerId);
  const autoPlaying = member?.auto === true;
  const actions = spectating ? [] : legalActions(game, selfId);
  const waiting = waitingFor(game);
  const firstVersion = useRef(game.version);
  const shownNotice = game.version === firstVersion.current ? notice : "";

  const [log, setLog] = useState<{ key: string; text: string }[]>([]);
  const seenVersion = useRef(-1);
  useEffect(() => {
    if (game.version === seenVersion.current) return;
    const restarted = game.version < seenVersion.current;
    seenVersion.current = game.version;
    const lines = game.events
      .map((event, index) => ({ key: `${game.version}-${index}`, text: describeEvent(event, nameOf) }))
      .filter((line): line is { key: string; text: string } => line.text !== null)
      .reverse();
    setLog((previous) => [...lines, ...(restarted ? [] : previous)].slice(0, 80));
  }, [game.version]);

  const [emotes, setEmotes] = useState<(EmoteBroadcast & { key: number })[]>([]);
  const [emoteError, setEmoteError] = useState("");
  useEffect(() => {
    const handle = (emote: EmoteBroadcast) => setEmotes((previous) => [{ ...emote, key: Date.now() + Math.random() }, ...previous].slice(0, 6));
    socket.on("room:emote", handle);
    return () => { socket.off("room:emote", handle); };
  }, []);
  const sendEmote = (id: EmoteId) => socket.emit("room:emote", { id }, (response) => setEmoteError(response.ok ? "" : response.error));

  let prompt: string;
  if (game.phase === "gameOver") prompt = `${nameOf(game.winners[0]!)} 获胜`;
  else if (spectating) prompt = `观战中：${PHASE_NAME[game.phase]}`;
  else if (autoPlaying) prompt = "托管中：轮到你时人机替你走";
  else if (actions.length > 0) prompt = `轮到你：${PHASE_NAME[game.phase]}`;
  else if (game.phase === "resolving" && !game.awaitingMatChoice) prompt = `正在翻 ${nameOf(game.challenger!)} 自己的垫子…`;
  else prompt = `等 ${waiting.map(nameOf).join("、") || "系统"}：${PHASE_NAME[game.phase]}`;

  return (
    <div className="sk-screen">
      <header className="sk-topbar">
        {brand}
        <div className="sk-turn">
          <span>第 {game.round} 轮</span>
          <b>{PHASE_NAME[game.phase]}</b>
          {secondsLeft !== null && game.phase !== "gameOver" && <b className={secondsLeft <= 5 ? "sk-timer low" : "sk-timer"}>{secondsLeft}s</b>}
        </div>
        <div className="sk-topbar-right">
          {themeToggle}
          <GameRules />
          <GameRoomMenu room={room} />
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve}>解散</button>}
          {connection}
        </div>
      </header>
      {spectating && <SpectateBar room={room} watchId={watchId} onWatch={onWatch} onLeave={onLeave} />}

      <div className="sk-layout">
        <section className="sk-table">
          <div className={actions.length > 0 ? "sk-prompt mine" : "sk-prompt"} role="status">
            {prompt}
            {autoPlaying && game.phase !== "gameOver" && <button className="quiet-button" type="button" onClick={() => onAuto(false)}>取消托管</button>}
          </div>
          {(error || shownNotice) && <p className={error ? "sk-feedback error" : "sk-feedback"} role={error ? "alert" : "status"}>{error || shownNotice}</p>}

          <div className="sk-center">
            <span>场上 <b>{totalDiscsInPlay(game)}</b> 张</span>
            <span>叫价 <b>{game.bid || "—"}</b>{game.bidder ? `（${nameOf(game.bidder)}）` : ""}</span>
            {game.challenger && <span>挑战者 <b>{nameOf(game.challenger)}</b>，还差 <b>{game.flipsToDo}</b></span>}
            <span>本轮先手 {nameOf(game.firstPlayer)}</span>
            {game.config.lastChance && <span>Last Chance 碟：开</span>}
          </div>

          <ul className="sk-seats">
            {game.players.map((player) => {
              const seated = memberOf(player.id);
              const offline = !seated?.connected;
              const acting = waiting.includes(player.id);
              const tags = [
                player.id === selfId ? "你" : "",
                seated?.bot ? "人机" : "",
                !seated?.bot && (seated?.auto || offline) ? "托管" : "",
                offline ? "离线" : "",
                player.flowerUp ? "花面" : "",
                player.passed ? "pass" : "",
                player.eliminated ? "淘汰" : "",
                game.phase === "placeInitial" && player.placedInitial ? "已盖" : "",
                game.phase === "roundEnd" && player.ready ? "已继续" : "",
                game.challenger === player.id ? "挑战者" : "",
              ].filter(Boolean);
              return (
                <li key={player.id} className={["sk-seat", acting ? "acting" : "", player.eliminated ? "out" : ""].join(" ")} data-seat={player.seat}>
                  <div className="sk-seat-head">
                    <strong>座位 {player.seat} · {player.name}</strong>
                    {tags.map((tag) => <small key={tag} className="sk-tag">{tag}</small>)}
                    {emotes.filter((emote) => emote.from === player.id).slice(0, 1).map((emote) => <small key={emote.key} className="sk-emote">[{EMOTE_NAME[emote.id]}]</small>)}
                  </div>
                  <div className="sk-row">
                    <span className="sk-label">手里 {player.hand.length}</span>
                    {player.hand.map((disc, index) => <span key={index} className={disc.face ? `sk-disc ${disc.lastChance ? "lc" : disc.face}` : "sk-disc back"}>{discLabel(disc)}</span>)}
                  </div>
                  <div className="sk-row">
                    <span className="sk-label">板上 {player.stack.length}</span>
                    {player.stack.map((disc, index) => (
                      <span key={index} className={["sk-disc", disc.revealed ? "up" : "", disc.face ? (disc.lastChance ? "lc" : disc.face) : "back"].join(" ")} title={disc.revealed ? "已翻开" : "扣着"}>
                        {discLabel(disc)}{disc.revealed ? "↑" : ""}
                      </span>
                    ))}
                  </div>
                  <div className="sk-row sk-muted">
                    失 {player.lostCount} 张{player.lost && player.lost.length > 0 ? `（${player.lost.map((face) => FACE[face]).join("")}）` : ""}
                    {player.lastChanceRound !== null ? ` · Last Chance 第 ${player.lastChanceRound} 轮` : ""}
                  </div>
                </li>
              );
            })}
          </ul>

          {actions.length > 0 && (
            <div className="sk-actions" role="group" aria-label="能做的行动">
              {actions.map((action, index) => (
                <button key={index} className={action.type === "revealStack" ? "primary-button" : "quiet-button"} type="button" disabled={busy} onClick={() => onCommand(action)}>
                  {commandLabel(action, game, nameOf, selfId)}
                </button>
              ))}
            </div>
          )}

          {!spectating && (
            <div className="sk-emotes" role="group" aria-label="快捷表情">
              {EMOTE_IDS.map((id) => <button key={id} className="quiet-button" type="button" onClick={() => sendEmote(id)}>{EMOTE_NAME[id]}</button>)}
              {emoteError && <small className="sk-muted">{emoteError}</small>}
            </div>
          )}
        </section>

        <aside className="sk-side">
          <section className="sk-panel">
            <h3>本轮</h3>
            <p>叫价：{game.roundLog.bids.map((bid) => (bid.type === "pass" ? `${nameOf(bid.player)} pass` : `${nameOf(bid.player)} ${bid.count}`)).join(" → ") || "还没人叫"}</p>
            <p>翻牌：{game.roundLog.flips.map((flip) => `${nameOf(flip.owner)}#${flip.depth + 1}${flip.lastChance ? "碟" : FACE[flip.face]}`).join(" ") || "—"}</p>
            {game.roundLog.reveals.map((reveal) => <p key={reveal.player}>{nameOf(reveal.player)} 亮牌：{reveal.discs.map((disc) => (disc.lastChance ? "碟" : FACE[disc.face])).join(" ")}</p>)}
            <p className="sk-muted">之前 {game.history.length} 轮：{game.history.map((log) => `${log.round}:${log.challenger ? nameOf(log.challenger) : "?"}${log.result === "success" ? "成" : "败"}`).join(" ")}</p>
          </section>
          <section className="sk-panel sk-log">
            <h3>记录</h3>
            {log.length === 0 ? <p className="sk-muted">还没有动作。</p> : <ul>{log.map((line) => <li key={line.key}>{line.text}</li>)}</ul>}
          </section>
          <div className="sk-chat">{chat}</div>
        </aside>
      </div>
      {game.phase === "gameOver" && <FinalDialog game={game} room={room} myId={selfId} spectating={spectating} onRematch={onRematch} onLeave={onLeave} />}
    </div>
  );
}

function FinalDialog({ game, room, myId, spectating, onRematch, onLeave }: {
  game: GameState;
  room: LobbyRoomSnapshot;
  myId: string;
  spectating: boolean;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
}) {
  const winner = game.players.find((player) => player.id === game.winners[0])!;
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  return (
    <div className="gm-modal-backdrop" role="presentation">
      <section className="gm-panel sk-final" role="dialog" aria-modal="true" aria-labelledby="sk-final-title">
        <h2 id="sk-final-title">{winner.id === myId ? "你赢了！" : `${winner.name} 获胜`}</h2>
        <p>{game.result?.reason === "twoWins" ? "第二次挑战成功" : "别人都被淘汰了"} · 打了 {game.round} 轮</p>
        <ol>
          {game.players.map((player) => (
            <li key={player.id}>
              {player.name}{player.id === myId ? "（你）" : ""}：{player.id === winner.id ? "获胜" : player.eliminated ? `第 ${player.eliminatedRound} 轮淘汰` : player.flowerUp ? "成功 1 次" : "没成功过"}
            </li>
          ))}
        </ol>
        {spectating ? (
          <div className="gm-panel-actions"><button className="quiet-button" type="button" onClick={onLeave}>离开观战</button></div>
        ) : room.rematch && (
          <div>
            <span>再来一局？还剩 {Math.ceil(room.rematch.remainingMs / 1000)} 秒（{room.rematch.acceptedIds.length}/{room.members.length} 人同意）</span>
            <div className="gm-panel-actions">
              <button className="quiet-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button" type="button" disabled={accepted} onClick={() => onRematch(true)}>{accepted ? "等待其他人" : "再来一局"}</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

export default GameBoard;
