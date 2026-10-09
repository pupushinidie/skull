/**
 * 预览页（提交进仓库，界面维护；教程、验收可以往里加场景，不要删别人的）。生产构建只打包 index.html，不带它。
 * 不连服务器：用规则包的预览局面工厂造局面，渲染真正的 GameBoard / 首页 / 等候房间。在牌桌上点的命令直接在浏览器里跑引擎。
 *
 * 地址：/preview.html?s=<场景>&...
 *   s=<场景>      规则包 SCENE_NAMES 里的名字（opening、myTurn、bidding、chooseMat、sixPlayers……），另外有：
 *                 fullTable（6 人每人板上 4 张，场上 24 张）、
 *                 home（首页）、home-rooms（首页带在线牌桌）、
 *                 waiting-1 / waiting-full / waiting-bots / waiting-guest / waiting-spec（等候房间）
 *   n=<人数>       3–6，默认 4（固定人数的场景忽略）
 *   v=<座位>       从哪个座位看（默认场景自带的「我」，一般是 p1）
 *   bots=p2,p3    人机座位    auto=p1  托管中    offline=p3  离线
 *   spec=1        观战（all=1 观战能看底牌）
 *   t=<毫秒>       倒计时剩余；t=none 不显示
 *   chat=1        带几条聊天
 *   live=1        别人的回合由人机（随机占位）自动走、系统自动翻牌，可以一直玩下去
 *   emotes=p2:laugh,p3:skull   这些座位每 2 秒冒一次表情气泡（截图用）
 *   rematch=1     终局带「再来一局」投票
 *   lc=1          等候房间 / 首页打开 Last Chance 碟
 *   hint=1        操作面板显示人机给的提示（botHint 的理由，教程的「提示」按钮用）
 */
import { useEffect, useMemo, useState, type FormEvent } from "react";
import ReactDOM from "react-dom/client";
import {
  advance,
  applyCommand,
  botCommand,
  botHint,
  buildGame,
  createScene,
  DEFAULT_ROOM_ACCESS,
  needsAdvance,
  previewRoom,
  redactGameForViewer,
  SCENE_NAMES,
  waitingFor,
  type Capacity,
  type EmoteBroadcast,
  type EmoteId,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type RoomChatMessage,
  type SceneName,
} from "@skull/game";
import { HomeScreen, RoomScreen } from "./App.js";
import { useConfirm } from "./confirm.js";
import GameBoard from "./GameBoard.js";
import RoomChat from "./RoomChat.js";
import { socket } from "./socket.js";
import { applyTheme, readTheme, ThemeToggle, useTheme } from "./theme.js";
import { useVoice } from "./voice.js";
import "./styles.css";
import "./app-pixel.css";
import "./sk.css";
import "./theme-day.css";

applyTheme(readTheme());

const params = new URLSearchParams(location.search);
const sceneName = params.get("s") ?? "opening";
const players = Math.min(6, Math.max(3, Number(params.get("n") ?? 4)));
const list = (key: string) => (params.get(key) ?? "").split(",").filter(Boolean);
const spectator = params.get("spec") === "1";
const seeAll = params.get("all") === "1";
const live = params.get("live") === "1";
const timeParam = params.get("t");
const turnRemainingMs = timeParam === "none" ? null : timeParam ? Number(timeParam) : undefined;
const lastChanceOption = params.get("lc") === "1";

/* ---------- 造局面 ---------- */

/** 6 人每人板上 4 张（场上 24 张），有人花面、有人 pass：手牌最多、版面最满的样子。 */
function fullTable(): GameState {
  return buildGame({
    players: [
      { stack: ["rose", "rose", "skull", "rose"] },
      { stack: ["skull", "rose", "rose", "rose"], flowerUp: true },
      { stack: ["rose", "rose", "rose", "skull"] },
      { stack: ["rose", "skull", "rose", "rose"] },
      { stack: ["rose", "rose", "skull", "rose"], flowerUp: true },
      { stack: ["skull", "rose", "rose", "rose"] },
    ],
    phase: "bidding",
    round: 6,
    firstPlayer: "p3",
    bids: [{ type: "open", player: "p3", count: 5 }, { type: "raise", player: "p4", count: 9 }, { type: "pass", player: "p5" }, { type: "raise", player: "p6", count: 12 }],
    turn: "p1",
  });
}

function buildScene(): { game: GameState; viewer: string; flags: { offline?: readonly string[]; auto?: readonly string[]; bots?: readonly string[]; turnRemainingMs?: number } } {
  if (sceneName === "fullTable") return { game: fullTable(), viewer: "p1", flags: { turnRemainingMs: 14_000 } };
  const name = ((SCENE_NAMES as readonly string[]).includes(sceneName) ? sceneName : "opening") as SceneName;
  const scene = createScene(name, { players });
  return { game: scene.game, viewer: scene.viewer, flags: scene.room };
}

const built = buildScene();
const viewer = params.get("v") ?? (sceneName === "waiting-guest" ? "p2" : built.viewer);
const sockOf = (playerId: string) => `sock-${playerId}`;

Object.defineProperty(socket, "id", { get: () => (spectator || sceneName === "waiting-spec" ? "sock-watcher" : sockOf(viewer)), configurable: true });

/** 预览页不连服务器：房间操作回一个失败；表情直接在本页冒出来。 */
socket.emit = ((event: string, ...args: unknown[]) => {
  const ack = args[args.length - 1];
  if (event === "room:emote") {
    const payload = args[0] as { id: EmoteId };
    fireEmote(viewer, payload.id);
    if (typeof ack === "function") (ack as (response: unknown) => void)({ ok: true, data: undefined });
    return socket;
  }
  if (typeof ack === "function") (ack as (response: unknown) => void)({ ok: false, error: `预览页不连服务器（${event}）` });
  return socket;
}) as typeof socket.emit;

function fireEmote(from: string, id: EmoteId) {
  const payload: EmoteBroadcast = { id, from, name: from, at: Date.now() };
  for (const listener of socket.listeners("room:emote")) (listener as (emote: EmoteBroadcast) => void)(payload);
}

// emotes=p2:laugh,p3:skull：每 2 秒冒一次（截图时一定看得到）
const emoteList = list("emotes").map((item) => item.split(":") as [string, EmoteId]);
if (emoteList.length > 0) {
  const fire = () => { for (const [from, id] of emoteList) fireEmote(from, id); };
  window.setTimeout(fire, 300);
  window.setInterval(fire, 2000);
}

const CHAT: RoomChatMessage[] = [
  { id: "c1", senderId: sockOf("p2"), name: "老K", message: "我这摞全是玫瑰，放心翻～", createdAt: "2026-10-09T20:01:00.000Z" },
  { id: "c2", senderId: sockOf("p1"), name: "阿玫", message: "信你才怪", createdAt: "2026-10-09T20:01:30.000Z" },
  { id: "c3", senderId: "sock-watcher", name: "看客", message: "叫 5！", createdAt: "2026-10-09T20:02:00.000Z", spectator: true },
];

function withChat(room: LobbyRoomSnapshot): LobbyRoomSnapshot {
  return params.get("chat") === "1" ? { ...room, chat: CHAT } : room;
}

/* ---------- 牌桌 ---------- */

function BoardPreview() {
  const [theme, toggleTheme] = useTheme();
  const [full, setFull] = useState<GameState>(built.game);
  const [error, setError] = useState("");
  const [autoIds, setAutoIds] = useState<string[]>(list("auto").length ? list("auto") : [...(built.flags.auto ?? [])]);
  const room = useMemo(() => {
    const snapshot = previewRoom(full, {
      viewer,
      bots: list("bots").length ? list("bots") : built.flags.bots ?? [],
      auto: autoIds,
      offline: list("offline").length ? list("offline") : built.flags.offline ?? [],
      ...(spectator ? { spectator: true, spectatorsSeeAll: seeAll } : {}),
      ...(turnRemainingMs === null ? {} : turnRemainingMs !== undefined ? { turnRemainingMs } : built.flags.turnRemainingMs !== undefined ? { turnRemainingMs: built.flags.turnRemainingMs } : full.phase === "gameOver" ? {} : { turnRemainingMs: 18_000 }),
      ...(params.get("rematch") === "1" && full.phase === "gameOver" ? { rematch: { remainingMs: 25_000, acceptedIds: [sockOf("p2")] } } : {}),
    });
    return withChat(spectator ? { ...snapshot, access: { ...snapshot.access, spectatorsSeeAll: seeAll } } : snapshot);
  }, [full, autoIds]);
  const voice = useVoice(room);
  const [watchId, setWatchId] = useState(full.players[0]!.id);
  const [confirm, confirmDialog] = useConfirm();

  function command(cmd: GameCommand, as = viewer) {
    try {
      setFull((state) => applyCommand(state, as, cmd));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }

  // 系统自动翻挑战者自己的垫子（和服务器一样每张停 1 秒）
  useEffect(() => {
    if (!needsAdvance(full)) return;
    const timer = window.setTimeout(() => setFull((state) => (needsAdvance(state) ? advance(state) : state)), 1000);
    return () => window.clearTimeout(timer);
  }, [full]);

  // live=1：别人的回合由人机按自己能看到的信息走
  useEffect(() => {
    if (!live || full.phase === "gameOver") return;
    const actor = waitingFor(full).find((id) => id !== viewer || autoIds.includes(viewer));
    if (!actor) return;
    const timer = window.setTimeout(() => {
      const cmd = full.phase === "roundEnd" ? ({ type: "nextRound" } as const) : botCommand(redactGameForViewer(full, actor), actor);
      if (cmd) command(cmd, actor);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [full, autoIds]);

  async function dissolve() {
    await confirm({ title: "解散房间？", detail: "所有玩家都会被移出，当前对局也会结束。", confirmLabel: "解散" });
  }

  return (
    <main className="app-shell sk-game">
      <GameBoard
        room={room}
        busy={false}
        error={error}
        notice=""
        brand={<a className="brand" href="#"><img className="brand-icon" src="/art/discs/skull.png" width={32} height={36} alt="" /><span className="brand-name">骷髅牌<span> 预览</span></span></a>}
        connection={<div className="connection-status online"><span className="connection-dot" />预览</div>}
        themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
        theme={theme}
        chat={<RoomChat room={room} voice={voice} />}
        onCommand={(cmd) => command(cmd)}
        onRematch={() => setFull(built.game)}
        onAuto={(enabled) => setAutoIds((ids) => (enabled ? [...ids, viewer] : ids.filter((id) => id !== viewer)))}
        onDissolve={dissolve}
        watchId={watchId}
        onWatch={setWatchId}
        onLeave={() => setError("预览页：离开")}
        hint={params.get("hint") === "1" ? botHint(redactGameForViewer(full, viewer), viewer, () => 0.5)?.reason : undefined}
      />
      {confirmDialog}
    </main>
  );
}

/* ---------- 首页 ---------- */

const LOBBY: PublicRoomSummary[] = [
  {
    id: "r1", status: "playing", capacity: 5, options: { lastChance: false }, open: true, allowSpectators: true, spectators: 2,
    players: [
      { name: "阿玫", isHost: true, connected: true, score: 1, isActive: true },
      { name: "老K", isHost: false, connected: true, score: 0 },
      { name: "咕噜一号", isHost: false, connected: true, bot: true, score: 1 },
      { name: "铜壶", isHost: false, connected: false, score: 0, eliminated: true },
      { name: "灰猫", isHost: false, connected: true, score: 0 },
    ],
  },
  {
    id: "r2", status: "waiting", capacity: 4, options: { lastChance: true }, open: true, allowSpectators: true, spectators: 0,
    players: [{ name: "烛影摇红", isHost: true, connected: true }, { name: "麦酒先生", isHost: false, connected: true }],
  },
];

function HomePreview({ rooms }: { rooms: boolean }) {
  const [theme, toggleTheme] = useTheme();
  const [mode, setMode] = useState<"create" | "join">("create");
  const [name, setName] = useState("阿玫");
  const [capacity, setCapacity] = useState<Capacity>(4);
  const [lastChance, setLastChance] = useState(lastChanceOption);
  const [code, setCode] = useState("");
  return (
    <HomeScreen
      themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
      connected
      mode={mode}
      onMode={setMode}
      name={name}
      onName={setName}
      capacity={capacity}
      onCapacity={setCapacity}
      lastChance={lastChance}
      onLastChance={setLastChance}
      roomCode={code}
      onRoomCode={setCode}
      canSubmit
      busy={false}
      error=""
      notice=""
      onSubmit={(event: FormEvent<HTMLFormElement>) => event.preventDefault()}
      lobbyRooms={rooms ? LOBBY : []}
      onJoinListed={() => undefined}
    />
  );
}

/* ---------- 等候房间 ---------- */

const NAMES = ["阿玫", "老K", "烛影摇红", "铜壶", "麦酒先生", "灰猫"];

function waitingRoom(): LobbyRoomSnapshot {
  const kind = sceneName.replace("waiting-", "");
  const capacity = (kind === "1" ? 4 : players) as Capacity;
  const count = kind === "1" ? 1 : kind === "full" || kind === "bots" ? capacity : Math.min(3, capacity);
  const members: LobbyMember[] = Array.from({ length: count }, (_, index) => {
    const bot = kind === "bots" && index >= 1;
    return {
      id: sockOf(`p${index + 1}`),
      playerId: `p${index + 1}`,
      name: bot ? `咕噜${["一", "二", "三", "四", "五"][index - 1]}号` : NAMES[index]!,
      isHost: index === 0,
      connected: true,
      ...(bot ? { bot: true } : {}),
    };
  });
  return withChat({
    code: kind === "spec" ? "" : "SKULL7",
    spectators: kind === "spec" ? [{ id: "sock-watcher", name: "看客" }] : [],
    access: DEFAULT_ROOM_ACCESS,
    options: { lastChance: lastChanceOption },
    capacity,
    status: "waiting",
    members,
    chat: [],
    voice: [],
  });
}

function RoomPreview() {
  const [theme, toggleTheme] = useTheme();
  const room = useMemo(waitingRoom, []);
  const voice = useVoice(room);
  const [confirm, confirmDialog] = useConfirm();
  return (
    <RoomScreen
      room={room}
      busy={false}
      error=""
      notice=""
      connected
      themeToggle={<ThemeToggle theme={theme} onToggle={toggleTheme} />}
      chat={<RoomChat room={room} voice={voice} />}
      onCopyCode={() => undefined}
      onLeave={() => undefined}
      onStart={() => undefined}
      onKick={() => undefined}
      onAddBot={() => undefined}
      onDissolve={() => { void confirm({ title: "解散房间？", detail: "所有玩家都会被移出。", confirmLabel: "解散" }); }}
      dialog={confirmDialog}
    />
  );
}

function Preview() {
  if (sceneName === "home") return <HomePreview rooms={false} />;
  if (sceneName === "home-rooms") return <HomePreview rooms />;
  if (sceneName.startsWith("waiting-")) return <RoomPreview />;
  return <BoardPreview />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(<Preview />);
