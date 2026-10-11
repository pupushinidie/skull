import { useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { CAPACITY_OPTIONS, EMOTE_IDS, type Capacity, type EmoteBroadcast, type EmoteId, type GameCommand, type LobbyRoomSnapshot, type PublicRoomSummary } from "@skull/game";
import { avatarArt, discArt, emoteSheet, EMOTE_NAME, heroArt, seatHex } from "./art.js";
import { useConfirm } from "./confirm.js";
import GameBoard from "./GameBoard.js";
import GameRules from "./GameRules.js";
import OnlineRooms from "./OnlineRooms.js";
import { DiscImg, EmoteBubble, Icon, Sprite } from "./pieces.js";
import RoomChat from "./RoomChat.js";
import { roomRole, RoomSettingsPanel, SeatSwitch } from "./RoomExtras.js";
import { socket } from "./socket.js";
import { ThemeToggle, useTheme } from "./theme.js";
import { GAME_ID } from "./tutorial/hints.js";
import { TutorialInvite } from "./tutorial/Invite.js";
import { readTutorial } from "./tutorial/storage.js";
import TutorialMode from "./tutorial/TutorialMode.js";
import { useVoice } from "./voice.js";

type EntryMode = "create" | "join";

const validRoomCode = /^[A-HJ-NP-Z2-9]{6}$/;

// 线上游戏中心在站点根路径；本地开发时跑在 5175 端口。
const CENTER_URL = import.meta.env.DEV ? `${window.location.protocol}//${window.location.hostname}:5175/` : "/";

function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, "").slice(0, 6);
}

function App() {
  const [mode, setMode] = useState<EntryMode>("create");
  const [name, setName] = useState("");
  const [capacity, setCapacity] = useState<Capacity>(4);
  // 开房选项：Last Chance 碟（默认关）
  const [lastChance, setLastChance] = useState(false);
  const [confirmAction, confirmDialog] = useConfirm();
  // 白天 / 夜间画面：首页、等候房间、牌桌共用，顶栏按钮随时切换；和游戏中心、其他游戏共用同一个选择。
  const [theme, toggleTheme] = useTheme();
  const themeToggle = <ThemeToggle theme={theme} onToggle={toggleTheme} />;
  const [roomCode, setRoomCode] = useState("");
  const [room, setRoom] = useState<LobbyRoomSnapshot | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lobbyRooms, setLobbyRooms] = useState<PublicRoomSummary[]>([]);
  // 观战时从谁的座位看（默认第一位玩家）。
  const [watchId, setWatchId] = useState("");
  const voice = useVoice(room);
  // 新手教程：首页或等候房间点进来（地址带 ?tutorial 时直接打开，游戏中心可以直接链过来）
  const [tutorialOpen, setTutorialOpen] = useState(() => new URLSearchParams(window.location.search).has("tutorial"));

  function closeTutorial() {
    setTutorialOpen(false);
    const params = new URLSearchParams(window.location.search);
    if (params.has("tutorial")) {
      params.delete("tutorial");
      const query = params.toString();
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    }
  }

  // 在等候房间里看教程时，房主一开局就回到牌桌（不然这一步会超时、转成托管）
  useEffect(() => {
    if (tutorialOpen && room?.status === "playing") {
      closeTutorial();
      setNotice("对局开始了，教程先停在这里。");
    }
  }, [tutorialOpen, room?.status]);

  // 在房间里时服务端不推送在线牌桌列表；回到首页时主动拉一次最新的。
  useEffect(() => {
    if (room || !socket.connected) return;
    socket.emit("lobby:get", (response) => {
      if (response.ok) setLobbyRooms(response.data);
    });
  }, [room === null]);

  useEffect(() => {
    const handleConnect = () => {
      setConnected(true);
      socket.emit("lobby:get", (response) => {
        if (response.ok) setLobbyRooms(response.data);
      });
    };
    const handleDisconnect = () => setConnected(false);
    const handleRoomUpdate = (snapshot: LobbyRoomSnapshot) => setRoom(snapshot);
    const handleRoomError = (message: string) => setError(message);
    const handleLobbyUpdate = (rooms: PublicRoomSummary[]) => setLobbyRooms(rooms);
    const handleRoomClosed = ({ reason }: { reason: string }) => {
      setRoom(null);
      setBusy(false);
      setError("");
      setNotice(reason);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("room:updated", handleRoomUpdate);
    socket.on("room:error", handleRoomError);
    socket.on("lobby:updated", handleLobbyUpdate);
    socket.on("room:closed", handleRoomClosed);
    socket.connect();

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("room:updated", handleRoomUpdate);
      socket.off("room:error", handleRoomError);
      socket.off("lobby:updated", handleLobbyUpdate);
      socket.off("room:closed", handleRoomClosed);
      socket.disconnect();
    };
  }, []);

  const canSubmit = useMemo(() => {
    if (!connected || busy || name.trim().length < 2 || name.trim().length > 18) return false;
    return mode === "create" || validRoomCode.test(roomCode);
  }, [busy, connected, mode, name, roomCode]);

  /** 从首页列表加入空座位或进去观战（用上面填的昵称）。 */
  function joinListed(roomId: string, spectate: boolean) {
    const nickname = name.trim();
    if (nickname.length < 2 || nickname.length > 18) {
      setNotice("");
      setError("先在上面填好你的昵称（2–18 个字符）。");
      document.getElementById("player-name")?.focus();
      return;
    }
    setError("");
    setNotice("");
    setBusy(true);
    socket.emit("room:join", { name: nickname, roomId, spectate }, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice(spectate ? "正在观战。" : "已加入房间。");
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusy(true);
    const nickname = name.trim();

    const complete = (response: { ok: true; data: LobbyRoomSnapshot } | { ok: false; error: string }) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice(mode === "create"
        ? "房间已创建，可以邀请朋友加入。"
        : response.data.status === "playing" ? "已回到对局，继续游戏吧。" : "已加入房间。");
    };

    if (mode === "create") {
      socket.emit("room:create", { name: nickname, capacity, options: { lastChance } }, complete);
    } else {
      socket.emit("room:join", { name: nickname, code: roomCode }, complete);
    }
  }

  function startGame() {
    setError("");
    setBusy(true);
    socket.emit("room:start", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
      setNotice("");
    });
  }

  function leaveRoom() {
    setBusy(true);
    socket.emit("room:leave", (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(null);
      setError("");
      setNotice("已离开房间。");
    });
  }

  function submitGameCommand(command: GameCommand) {
    setBusy(true);
    setError("");
    setNotice("");
    socket.emit("game:command", command, (response) => {
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRoom(response.data);
    });
  }

  /** 房间管理类操作：只关心成败，界面更新由服务端广播。 */
  function roomCommand(send: (ack: (response: { ok: true; data: void } | { ok: false; error: string }) => void) => void) {
    setError("");
    send((response) => {
      if (!response.ok) setError(response.error);
    });
  }

  const kickMember = (memberId: string) => roomCommand((ack) => socket.emit("room:kick", memberId, ack));
  const addBot = () => roomCommand((ack) => socket.emit("room:add-bot", ack));
  const setAuto = (enabled: boolean) => roomCommand((ack) => socket.emit("room:auto", enabled, ack));
  const voteRematch = (accept: boolean) => roomCommand((ack) => socket.emit("room:rematch", accept, ack));
  async function dissolveRoom() {
    const ok = await confirmAction({
      title: "解散房间？",
      detail: "所有玩家都会被移出，当前对局也会结束。",
      confirmLabel: "解散",
    });
    if (ok) roomCommand((ack) => socket.emit("room:dissolve", ack));
  }

  async function copyRoomCode() {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(room.code);
      setNotice("房间码已复制。");
    } catch {
      setNotice("请手动复制房间码。");
    }
  }

  if (tutorialOpen && room?.status !== "playing") {
    return (
      <main data-gc-table className="app-shell sk-game tut-on">
        <TutorialMode name={name} brand={<Brand />} themeToggle={themeToggle} theme={theme} waitingRoom={room?.code} onExit={closeTutorial} />
      </main>
    );
  }

  if (room?.status === "playing" && room.game) {
    const players = room.game.players;
    const watched = players.some((player) => player.id === watchId) ? watchId : players[0]!.id;
    return (
      <main data-gc-table className="app-shell sk-game">
        <GameBoard
          room={room}
          busy={busy}
          error={error}
          notice={notice}
          brand={<Brand />}
          connection={<ConnectionStatus connected={connected} />}
          themeToggle={themeToggle}
          theme={theme}
          chat={<RoomChat room={room} voice={voice} />}
          onCommand={submitGameCommand}
          onRematch={voteRematch}
          onAuto={setAuto}
          onDissolve={dissolveRoom}
          watchId={watched}
          onWatch={setWatchId}
          onLeave={leaveRoom}
        />
        {confirmDialog}
      </main>
    );
  }

  if (room) {
    return (
      <RoomScreen
        room={room}
        busy={busy}
        error={error}
        notice={notice}
        connected={connected}
        themeToggle={themeToggle}
        chat={<RoomChat room={room} voice={voice} />}
        onCopyCode={copyRoomCode}
        onLeave={leaveRoom}
        onStart={startGame}
        onKick={kickMember}
        onAddBot={addBot}
        onDissolve={dissolveRoom}
        dialog={confirmDialog}
        onTutorial={() => setTutorialOpen(true)}
      />
    );
  }

  return (
    <HomeScreen
      themeToggle={themeToggle}
      connected={connected}
      mode={mode}
      onMode={(next) => { setMode(next); setError(""); }}
      name={name}
      onName={setName}
      capacity={capacity}
      onCapacity={setCapacity}
      lastChance={lastChance}
      onLastChance={setLastChance}
      roomCode={roomCode}
      onRoomCode={(value) => setRoomCode(normalizeRoomCode(value))}
      canSubmit={canSubmit}
      busy={busy}
      error={error}
      notice={notice}
      onSubmit={handleSubmit}
      lobbyRooms={lobbyRooms}
      onJoinListed={joinListed}
      onTutorial={() => setTutorialOpen(true)}
    />
  );
}

/* ---------- 首页 ---------- */

export interface HomeScreenProps {
  themeToggle: ReactNode;
  connected: boolean;
  mode: EntryMode;
  onMode: (mode: EntryMode) => void;
  name: string;
  onName: (name: string) => void;
  capacity: Capacity;
  onCapacity: (capacity: Capacity) => void;
  lastChance: boolean;
  onLastChance: (on: boolean) => void;
  roomCode: string;
  onRoomCode: (code: string) => void;
  canSubmit: boolean;
  busy: boolean;
  error: string;
  notice: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  lobbyRooms: PublicRoomSummary[];
  onJoinListed: (roomId: string, spectate: boolean) => void;
  /** 打开新手教程（预览页不传就不显示入口）。 */
  onTutorial?: () => void;
}

export function HomeScreen(props: HomeScreenProps) {
  const { mode, busy, error, notice } = props;
  return (
    <main className="app-shell sk-home">
      <header className="topbar">
        <Brand />
        <div className="topbar-right">
          <a className="center-link" href={CENTER_URL}>← <span className="sk-long">游戏中心</span><span className="sk-short">大厅</span></a>
          <GameRules />
          {props.themeToggle}
          <ConnectionStatus connected={props.connected} />
        </div>
      </header>

      <section className="welcome-grid">
        <div className="welcome-copy">
          <div className="eyebrow"><span className="eyebrow-line" /> 在线对战 · 3–6 人 · 空座可以加人机</div>
          <h1>骷髅牌</h1>
          <p className="welcome-description">
            每人 4 张背面一样的垫子：3 朵玫瑰、1 个骷髅。扣着往自己板上叠，再叫价「我能连翻几张都是玫瑰」。
            叫得最高的人去翻，碰到骷髅就永久丢一张。成功两次，或者活到最后，就赢了。
          </p>
          <ul className="sk-home-points">
            <li><DiscImg face="back" scale={1} /><b>盖</b>扣着盖一张，玫瑰还是骷髅只有你知道</li>
            <li><Icon name="bell" scale={2} /><b>叫</b>叫个数：我能连翻这么多张都是玫瑰</li>
            <li><DiscImg face="skull" scale={1} /><b>翻</b>先翻自己的，再翻别人的，碰到骷髅就输</li>
          </ul>
          {props.onTutorial && (
            <TutorialInvite
              record={readTutorial(GAME_ID)}
              title="第一次玩？3 分钟学会"
              text="咕噜嘎在真牌桌上带你打一局，学完和人机练一局。"
              again="再看一遍新手教程"
              onOpen={props.onTutorial}
            />
          )}
          <div className="sk-hero" style={{ backgroundImage: `url(${heroArt})` }} role="img" aria-label="皮垫板上一摞黄铜垫子，旁边一朵玫瑰、一个骷髅" />
        </div>

        <div className="sk-home-side">
          <section className="entry-card" aria-labelledby="entry-title">
            <div className="entry-card-heading">
              <div>
                <span className="section-kicker">准备开始</span>
                <h2 id="entry-title">进入酒馆</h2>
              </div>
              <span className="step-indicator">01 <i /> 02</span>
            </div>

            <div className="mode-switch" role="tablist" aria-label="选择房间操作">
              <button className={mode === "create" ? "mode-tab active" : "mode-tab"} type="button" role="tab" aria-selected={mode === "create"} onClick={() => props.onMode("create")}>
                创建房间
              </button>
              <button className={mode === "join" ? "mode-tab active" : "mode-tab"} type="button" role="tab" aria-selected={mode === "join"} onClick={() => props.onMode("join")}>
                加入房间
              </button>
            </div>

            <form className="entry-form" onSubmit={props.onSubmit}>
              <label className="field-label" htmlFor="player-name">你的昵称</label>
              <input
                id="player-name"
                className="text-input"
                value={props.name}
                onChange={(event) => props.onName(event.target.value)}
                placeholder="输入 2–18 个字符"
                minLength={2}
                maxLength={18}
                autoComplete="nickname"
                required
              />

              {mode === "create" ? (
                <>
                  <label className="field-label field-label-spaced" htmlFor="room-capacity">房间人数</label>
                  <div className="capacity-options capacity-many" id="room-capacity" role="group" aria-label="选择房间人数">
                    {CAPACITY_OPTIONS.map((seats) => (
                      <button
                        key={seats}
                        type="button"
                        className={props.capacity === seats ? "capacity-option selected" : "capacity-option"}
                        aria-pressed={props.capacity === seats}
                        onClick={() => props.onCapacity(seats)}
                      >
                        <strong>{seats}</strong>
                        <span>位玩家</span>
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className={props.lastChance ? "room-setting sk-lc-toggle on" : "room-setting sk-lc-toggle"}
                    aria-pressed={props.lastChance}
                    onClick={() => props.onLastChance(!props.lastChance)}
                    title="挑战失败后只剩 1 张的人，下一轮多拿一张大家都知道是玫瑰的银碟"
                  >
                    <i aria-hidden="true" /><img src={discArt("lc-up")} width={32} height={36} alt="" />
                    Last Chance 碟：{props.lastChance ? "开" : "关"}
                  </button>
                  <p className="field-hint">至少 3 人才能开始，空座位可以加人机。Last Chance 碟：只剩 1 张时多给一张公开的玫瑰碟。</p>
                </>
              ) : (
                <>
                  <label className="field-label field-label-spaced" htmlFor="room-code">房间码</label>
                  <input
                    id="room-code"
                    className="text-input room-code-input"
                    value={props.roomCode}
                    onChange={(event) => props.onRoomCode(event.target.value)}
                    placeholder="例如：7KQ2TX"
                    autoComplete="off"
                    maxLength={6}
                    required
                  />
                  <p className="field-hint">房间码为 6 位字母或数字。掉线后用原昵称和房间码能回到进行中的对局。</p>
                </>
              )}

              {error && <p className="feedback feedback-error" role="alert">{error}</p>}
              {notice && <p className="feedback feedback-success" role="status">{notice}</p>}

              <button className="primary-button" type="submit" disabled={!props.canSubmit}>
                {busy ? <><span className="spinner" /> 正在连接</> : mode === "create" ? "创建私人房间" : "加入牌桌"}
                {!busy && <span aria-hidden="true">↗</span>}
              </button>
            </form>
            <div className="entry-footnote"><span className="lock-icon">◇</span> 默认邀请制 · 房主可以设为公开</div>
          </section>
          <OnlineRooms rooms={props.lobbyRooms} connected={props.connected} busy={busy} onJoin={props.onJoinListed} />
        </div>
      </section>
    </main>
  );
}

function Brand() {
  return (
    <a className="brand" href={import.meta.env.BASE_URL} aria-label="骷髅牌首页">
      <img className="brand-icon" src={discArt("skull")} width={32} height={36} alt="" />
      <span className="brand-name">骷髅牌<span> SKULL</span></span>
    </a>
  );
}

function ConnectionStatus({ connected }: { connected: boolean }) {
  return (
    <div className={connected ? "connection-status online" : "connection-status"}>
      <span className="connection-dot" />
      {connected ? "服务已连接" : "连接中…"}
    </div>
  );
}

/* ---------- 等候房间 ---------- */

export interface RoomScreenProps {
  room: LobbyRoomSnapshot;
  busy: boolean;
  error: string;
  notice: string;
  connected: boolean;
  themeToggle: ReactNode;
  chat: ReactNode;
  onCopyCode: () => void;
  onLeave: () => void;
  onStart: () => void;
  onKick: (memberId: string) => void;
  onAddBot: () => void;
  onDissolve: () => void;
  dialog?: ReactNode;
  /** 打开新手教程（不离开房间；预览页不传就不显示入口）。 */
  onTutorial?: () => void;
}

export function RoomScreen(props: RoomScreenProps) {
  return (
    <main className="app-shell sk-room">
      <header className="topbar">
        <Brand />
        <div className="topbar-right">
          <GameRules />
          {props.themeToggle}
          <ConnectionStatus connected={props.connected} />
        </div>
      </header>
      <RoomView {...props} />
      {props.dialog}
    </main>
  );
}

/** 等候房间里的表情：气泡冒在成员头像上。 */
function useRoomEmotes() {
  const [bubbles, setBubbles] = useState<Record<string, { id: EmoteId; key: string }>>({});
  const timers = useRef(new Set<number>());
  useEffect(() => {
    const handle = (emote: EmoteBroadcast) => {
      const key = `${emote.at}-${Math.random()}`;
      setBubbles((current) => ({ ...current, [emote.from]: { id: emote.id, key } }));
      const timer = window.setTimeout(() => {
        timers.current.delete(timer);
        setBubbles((current) => {
          if (current[emote.from]?.key !== key) return current;
          const next = { ...current };
          delete next[emote.from];
          return next;
        });
      }, 2400);
      timers.current.add(timer);
    };
    socket.on("room:emote", handle);
    return () => {
      socket.off("room:emote", handle);
      for (const timer of timers.current) window.clearTimeout(timer);
    };
  }, []);
  return bubbles;
}

function RoomView({ room, busy, error, notice, onCopyCode, onLeave, onStart, onKick, onAddBot, onDissolve, chat, onTutorial }: RoomScreenProps) {
  const { isHost, spectating } = roomRole(room);
  const openSeats = Math.max(0, room.capacity - room.members.length);
  const bubbles = useRoomEmotes();
  const [emoteError, setEmoteError] = useState("");
  const [optionError, setOptionError] = useState("");
  const toggleLastChance = () => socket.emit("room:options", { lastChance: !room.options.lastChance }, (response) => setOptionError(response.ok ? "" : response.error));
  const sendEmote = (id: EmoteId) => socket.emit("room:emote", { id }, (response) => setEmoteError(response.ok ? "" : response.error));
  // 教程入口：电脑上放在标题那一行（压成一行，不占栏里的高度）；手机放在房间码一栏底下。CSS 只显示其中一个。
  const roomInvite = onTutorial && !spectating ? (
    <TutorialInvite
      record={readTutorial(GAME_ID)}
      title="等人的时候，先学一下？"
      text="咕噜嘎带你在真牌桌上打一局。不会离开房间，房主一开局就自动回来。"
      again="再看一遍新手教程（不离开房间）"
      onOpen={onTutorial}
    />
  ) : null;

  return (
    <section className="room-layout">
      <div className="room-heading">
        <div>
          <div className="eyebrow"><span className="eyebrow-line" /> {room.status === "waiting" ? "等待大厅" : "对局已创建"} · 骷髅牌</div>
          <h1>{spectating ? "你在观战。" : room.status === "waiting" ? "酒馆里点上了蜡烛。" : "好戏即将开始。"}</h1>
          <p>{spectating ? "等房主开始对局；有空座位时可以坐下一起玩。" : "把房间码分享给朋友，等大家就位后开始；空座位可以加人机。"}</p>
        </div>
        {roomInvite && <div className="sk-invite-slot in-heading">{roomInvite}</div>}
        <div className="room-heading-actions">
          {isHost && <button className="quiet-button danger" type="button" onClick={onDissolve} disabled={busy}>解散房间</button>}
          <button className="quiet-button" type="button" onClick={onLeave} disabled={busy || (room.status === "playing" && !spectating)}>
            {spectating ? "离开观战" : "离开房间"}
          </button>
        </div>
      </div>

      {room.status === "waiting" ? (
        <div className="room-grid">
          <section className="room-panel room-code-panel">
            <div className="panel-label">房间码 <span>仅分享给朋友</span></div>
            {room.code ? (
              <>
                <button className="room-code-display" type="button" onClick={onCopyCode} title="复制房间码">
                  {room.code}<span aria-hidden="true">⧉</span>
                </button>
                <div className="room-code-caption">点击复制 · 6 位邀请代码</div>
              </>
            ) : (
              <div className="room-code-caption">从首页列表进来观战，看不到房间码</div>
            )}
            <div className="sk-room-options" data-tutorial="room-options">
              <div className="panel-label">开房选项 <span>{isHost ? "房主可以改" : "只有房主能改"}</span></div>
              <button
                type="button"
                className={room.options.lastChance ? "room-setting sk-lc-toggle on" : "room-setting sk-lc-toggle"}
                aria-pressed={room.options.lastChance}
                disabled={!isHost}
                onClick={toggleLastChance}
              >
                <i aria-hidden="true" /><img src={discArt("lc-up")} width={32} height={36} alt="" />
                Last Chance 碟：{room.options.lastChance ? "开" : "关"}
              </button>
              <p className="field-hint">开了以后：挑战失败、只剩 1 张的人，下一轮多拿一张大家都知道是玫瑰的银碟。</p>
              {optionError && <p className="feedback feedback-error">{optionError}</p>}
            </div>
            <RoomSettingsPanel room={room} />
            <p className="field-hint">每一步有时限（盖牌 20 秒、开叫 25 秒、加注 20 秒）；超时系统替你走，连续两次超时转人机托管，掉线时也由人机代打。</p>
            <div className="sk-room-cheat" aria-label="垫子一览">
              <div className="panel-label">每人 4 张 <span>背面都一样</span></div>
              <div className="sk-room-discs">
                <DiscImg face="rose" scale={1} /><DiscImg face="rose" scale={1} /><DiscImg face="rose" scale={1} /><DiscImg face="skull" scale={1} />
                <span>成功两次就赢，丢光出局</span>
              </div>
            </div>
            {roomInvite && <div className="sk-invite-slot in-code">{roomInvite}</div>}
          </section>

          <section className="room-panel player-panel">
            <div className="panel-topline">
              <div className="panel-label">玩家 <span>{room.members.length} / {room.capacity}</span></div>
              <span className="waiting-pill"><i /> 等待中</span>
            </div>
            <div className="player-list">
              {room.members.map((member, index) => (
                <div className="player-row" key={member.id}>
                  <div className="player-avatar sk-member-avatar" style={{ "--seat": seatHex(index) } as CSSProperties}>
                    <img src={avatarArt(index)} alt="" width={32} height={32} />
                    {bubbles[member.playerId] && <EmoteBubble key={bubbles[member.playerId]!.key} id={bubbles[member.playerId]!.id} scale={1} />}
                  </div>
                  <div className="player-details">
                    <strong>{member.name}{member.id === socket.id ? <small>你</small> : null}</strong>
                    <span>{member.isHost ? "房主" : member.bot ? "人机 · 普通难度" : member.connected ? "已加入" : "离线"}</span>
                  </div>
                  {member.isHost && <span className="host-badge">房主</span>}
                  {member.bot && <span className="bot-badge">人机</span>}
                  {isHost && !member.isHost && (
                    <button className="kick-button" type="button" onClick={() => onKick(member.id)} title={`把 ${member.name} 移出房间`}>移出</button>
                  )}
                </div>
              ))}
              {Array.from({ length: openSeats }, (_, index) => (
                <div className="player-row open-seat" key={`open-${index}`}>
                  <div className="empty-avatar"><span>＋</span></div>
                  <div className="player-details"><strong>等待玩家加入</strong><span>{room.access.open ? "公开房间，路过的人也能加入" : "分享房间码邀请朋友"}</span></div>
                  {isHost && <button className="quiet-button add-bot-button" type="button" onClick={onAddBot} disabled={busy} data-tutorial="add-bot">加人机</button>}
                </div>
              ))}
            </div>
            {!spectating && (
              <div className="sk-room-emotes" aria-label="快捷表情">
                {EMOTE_IDS.map((id) => (
                  <button key={id} type="button" className="sk-emote-button" onClick={() => sendEmote(id)} title={EMOTE_NAME[id]} aria-label={EMOTE_NAME[id]}>
                    <Sprite sheet={emoteSheet(id)} scale={1} mode="still" />
                  </button>
                ))}
                {emoteError && <small className="sk-emote-error">{emoteError}</small>}
              </div>
            )}
            <SeatSwitch room={room} />
            <div className="room-actions">
              {isHost ? (
                <button className="primary-button" type="button" onClick={onStart} disabled={busy || room.members.length < 3} data-tutorial="start-button">
                  {busy ? <><span className="spinner" /> 正在开始</> : "开始对局"}<span aria-hidden="true">↗</span>
                </button>
              ) : (
                <div className="host-wait-note"><span className="pulse-dot" /> {spectating ? "等房主开始，开始后在这里观战" : "等待房主开始对局"}</div>
              )}
              {isHost && room.members.length < 3 && <p className="field-hint centered">还差 {3 - room.members.length} 人，可以点空座位上的「加人机」。</p>}
            </div>
          </section>
          <div className="sk-room-chat">{chat}</div>
        </div>
      ) : null}

      {error && <p className="feedback feedback-error room-feedback" role="alert">{error}</p>}
      {notice && <p className="feedback feedback-success room-feedback" role="status">{notice}</p>}
    </section>
  );
}

export default App;
