import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  EMOTE_IDS,
  legalActions,
  type AckResponse,
  type Capacity,
  type ClientToServerEvents,
  type GameCommand,
  type GameState,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type ServerToClientEvents,
} from "@skull/game";

// ---------- 每款游戏不一样的地方 ----------
/** 测试里真人怎么走：骷髅牌——盖第 1 张就盖，轮到就开叫 1，加注就 pass，其余选第一个（对局短）；结算点继续，不亮牌。 */
function humanMove(game: GameState, actions: GameCommand[]): GameCommand {
  if (game.phase === "placeOrBid") return { type: "openBid", count: 1 };
  if (game.phase === "bidding") return { type: "pass" };
  if (game.phase === "roundEnd") return { type: "nextRound" };
  return actions[0]!;
}
/** 这位玩家自己做了点什么（不是超时、不是系统自动的）。 */
function actedBy(room: LobbyRoomSnapshot, playerId: string): boolean {
  if (room.game?.events.some((event) => event.type === "TimedOut" && event.player === playerId)) return false;
  return room.game?.events.some((event) => {
    switch (event.type) {
      case "DiscPlaced":
      case "BidOpened":
      case "BidRaised":
      case "Passed":
      case "PlayerReady":
      case "StackRevealed":
        return event.player === playerId;
      case "DiscRevealed":
        return !event.auto && event.challenger === playerId;
      case "FirstPlayerChosen":
        return event.by === playerId;
      default:
        return false;
    }
  }) === true;
}
/** 最小的房间人数选项、开局至少几人。 */
const MIN_CAPACITY: Capacity = 3;
const MIN_PLAYERS = 3;
/** 「一个人加满人机」用几人房；「加满后加不了」用几人房。 */
const SOLO_CAPACITY: Capacity = 4;
const FULL_TEST_CAPACITY: Capacity = 3;
// ----------------------------------------

// 人机立刻行动、每一步 300 ms 超时、系统翻牌不停顿，测试才跑得快（服务端在导入时读这些变量）。
process.env.BOT_DELAY_SCALE = "0";
process.env.TURN_MS = "300";
process.env.FLIP_MS = "0";
process.env.ROUND_END_MS = "300";
// 对局中所有真人都离线多久后关房（默认 2 分钟，测试调短）
process.env.ROOM_ABANDON_MS = "600";
// 人机该发表情的时候一定发（不掷概率），方便测「只有纯人机发、托管和离线的真人不发」
process.env.BOT_EMOTE_FORCE = "1";


type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
let serverUrl = "";
let httpServer: typeof import("../src/index.js").httpServer;
let serverIo: typeof import("../src/index.js").io;
let nameSeq = 0;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    client.on("room:updated", (room) => latest.set(client, room));
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function nick(prefix: string): string {
  nameSeq += 1;
  return `${prefix}${nameSeq}`;
}

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

async function create(client: TestSocket, name: string, capacity: Capacity): Promise<LobbyRoomSnapshot> {
  const response = await call<LobbyRoomSnapshot>((ack) => client.emit("room:create", { name, capacity } as never, ack));
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

const addBot = (client: TestSocket) => call<void>((ack) => client.emit("room:add-bot", ack));

/** 再加几个人机，凑够开局人数。 */
async function addBotsUpTo(host: TestSocket, humansSeated: number): Promise<void> {
  for (let seat = humansSeated; seat < MIN_PLAYERS; seat += 1) expect((await addBot(host)).ok).toBe(true);
}
const start = (client: TestSocket) => call<LobbyRoomSnapshot>((ack) => client.emit("room:start", ack));

function lobby(client: TestSocket): Promise<PublicRoomSummary[]> {
  return new Promise((resolve) => client.emit("lobby:get", (response) => resolve(response.ok ? response.data : [])));
}

function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 20_000): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const current = latest.get(client);
    if (current && test(current)) {
      resolve(current);
      return;
    }
    const timer = setTimeout(() => {
      client.off("room:updated", handler);
      reject(new Error("等不到想要的房间状态"));
    }, timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

/** 记下这个连接收到的所有快捷表情。 */
function recordEmotes(client: TestSocket): { id: string; from: string }[] {
  const seen: { id: string; from: string }[] = [];
  client.on("room:emote", (emote) => seen.push({ id: emote.id, from: emote.from }));
  return seen;
}

function seatOf(client: TestSocket): string {
  return latest.get(client)?.members.find((member) => member.id === client.id)?.playerId ?? "";
}

/** 轮到这个真人时按 humanMove 自动行动；返回停止函数。 */
function autoplay(client: TestSocket): () => void {
  let sentFor = "";
  const handler = (room: LobbyRoomSnapshot) => {
    const game = room.game;
    if (!game || game.phase === "gameOver") return;
    const actions = legalActions(game, seatOf(client));
    const key = String(game.version);
    if (actions.length === 0 || sentFor === key) return;
    sentFor = key;
    client.emit("game:command", humanMove(game, actions), () => {});
  };
  client.on("room:updated", handler);
  const current = latest.get(client);
  if (current) handler(current);
  return () => client.off("room:updated", handler);
}

describe("人机", () => {
  beforeAll(async () => {
    const serverModule = await import("../src/index.js");
    httpServer = serverModule.httpServer;
    serverIo = serverModule.io;
    await new Promise<void>((resolve, reject) => {
      httpServer.once("error", reject);
      httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => serverIo.close(() => resolve()));
  });

  it("只有房主能加人机；坐满后加不了；房主能移出人机；首页列表标出人机", async () => {
    const host = await connect();
    const hostName = nick("房主");
    const { code } = await create(host, hostName, FULL_TEST_CAPACITY);
    const guest = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => guest.emit("room:join", { name: nick("客人"), code }, ack))).ok).toBe(true);

    expect((await addBot(guest)).ok).toBe(false);
    for (let seat = 2; seat < FULL_TEST_CAPACITY; seat += 1) expect((await addBot(host)).ok).toBe(true);
    const room = await updateWhere(host, (snapshot) => snapshot.members.length === FULL_TEST_CAPACITY);
    const bot = room.members.find((member) => member.bot)!;
    expect(bot).toMatchObject({ name: "咕噜一号", isHost: false, connected: true, bot: true });
    expect((await addBot(host)).ok).toBe(false);

    const summary = (await lobby(host)).find((candidate) => candidate.players[0]?.name === hostName)!;
    expect(summary.players.find((player) => player.name === "咕噜一号")?.bot).toBe(true);

    expect((await call<void>((ack) => host.emit("room:kick", bot.id, ack))).ok).toBe(true);
    await updateWhere(host, (snapshot) => snapshot.members.length === 2 && !snapshot.members.some((member) => member.bot));
  });

  it("一个人加满人机就能开局，人机把整局打完；人机自动同意再来一局", async () => {
    const host = await connect();
    await create(host, nick("独行"), SOLO_CAPACITY);
    for (let seat = 1; seat < SOLO_CAPACITY; seat += 1) expect((await addBot(host)).ok).toBe(true);
    const names = (await updateWhere(host, (snapshot) => snapshot.members.length === SOLO_CAPACITY)).members.map((member) => member.name);
    expect(names.slice(1)).toEqual(["咕噜一号", "咕噜二号", "咕噜三号", "咕噜四号"].slice(0, SOLO_CAPACITY - 1));

    const emotes = recordEmotes(host);
    expect((await start(host)).ok).toBe(true);
    const stop = autoplay(host);
    const finished = await updateWhere(host, (snapshot) => snapshot.game?.phase === "gameOver", 60_000);
    stop();
    // 人机在挑战成败那一下发表情（测试里强制一定发）：只有人机座位发，发的都是合法 id
    await new Promise((resolve) => setTimeout(resolve, 100));
    const botSeats = finished.members.filter((member) => member.bot).map((member) => member.playerId);
    expect(emotes.length).toBeGreaterThan(0);
    for (const emote of emotes) {
      expect(botSeats).toContain(emote.from);
      expect(EMOTE_IDS as readonly string[]).toContain(emote.id);
    }
    const bots = finished.members.filter((member) => member.bot).map((member) => member.id);
    expect(finished.rematch?.acceptedIds.sort()).toEqual(bots.sort());

    expect((await call<void>((ack) => host.emit("room:rematch", true, ack))).ok).toBe(true);
    const again = await updateWhere(host, (snapshot) => snapshot.game !== undefined && snapshot.game.phase !== "gameOver" && !snapshot.rematch);
    expect(again.game!.players).toHaveLength(SOLO_CAPACITY);
  }, 90_000);

  it("等待中最后一个真人离开，只剩人机的房间直接关掉", async () => {
    const host = await connect();
    const hostName = nick("房主");
    await create(host, hostName, MIN_CAPACITY);
    expect((await addBot(host)).ok).toBe(true);
    expect((await lobby(host)).some((candidate) => candidate.players[0]?.name === hostName)).toBe(true);
    expect((await call<void>((ack) => host.emit("room:leave", ack))).ok).toBe(true);
    expect((await lobby(host)).some((candidate) => candidate.players.some((player) => player.name === hostName))).toBe(false);
  });

  it("对局中唯一的真人离开，只剩人机的房间到时自动关掉（人机不会自己一直打下去）", async () => {
    const host = await connect();
    const hostName = nick("独走");
    await create(host, hostName, MIN_CAPACITY);
    await addBotsUpTo(host, 1);
    expect((await start(host)).ok).toBe(true);
    expect((await lobby(host)).some((candidate) => candidate.players[0]?.name === hostName)).toBe(true);
    host.disconnect();
    const watcher = await connect();
    const deadline = Date.now() + 5_000;
    let gone = false;
    while (Date.now() < deadline) {
      if (!(await lobby(watcher)).some((candidate) => candidate.players.some((player) => player.name === hostName))) {
        gone = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(gone).toBe(true);
  }, 15_000);

  it("连续超时两次转托管，由人机代打；取消托管后交还", async () => {
    const idle = await connect();
    const active = await connect();
    const { code } = await create(idle, nick("发呆"), MIN_CAPACITY);
    expect((await call<LobbyRoomSnapshot>((ack) => active.emit("room:join", { name: nick("认真"), code }, ack))).ok).toBe(true);
    await addBotsUpTo(idle, 2);
    const idleEmotes = recordEmotes(active);
    expect((await start(idle)).ok).toBe(true);
    const stop = autoplay(active);

    const isAuto = (snapshot: LobbyRoomSnapshot) => snapshot.members.find((member) => member.id === idle.id)?.auto === true;
    const autoRoom = await updateWhere(idle, isAuto);
    const idleSeat = seatOf(idle);
    expect(autoRoom.game!.events.some((event) => event.type === "TimedOut" && event.player === idleSeat)).toBe(true);

    // 托管后轮到他时没有倒计时，人机替他走：之后他的回合不再超时，而是真的行动
    const hisTurn = await updateWhere(idle, (snapshot) => isAuto(snapshot) && snapshot.game?.turn === idleSeat);
    expect(hisTurn.turnRemainingMs).toBeUndefined();
    await updateWhere(idle, (snapshot) => actedBy(snapshot, idleSeat));

    expect((await call<void>((ack) => idle.emit("room:auto", false, ack))).ok).toBe(true);
    await updateWhere(idle, (snapshot) => !isAuto(snapshot));
    stop();
    // 托管中的真人不会被替着发表情
    expect(idleEmotes.some((emote) => emote.from === idleSeat)).toBe(false);
  }, 30_000);

  it("真人整局托管：人机替他打完，但表情只有纯人机座位发，绝不替托管的真人发", async () => {
    const host = await connect();
    await create(host, nick("全托"), MIN_CAPACITY);
    await addBotsUpTo(host, 1);
    const emotes = recordEmotes(host);
    const started = await start(host);
    if (!started.ok) throw new Error(started.error);
    const hostSeat = started.data.members.find((member) => member.id === host.id)!.playerId;
    expect((await call<void>((ack) => host.emit("room:auto", true, ack))).ok).toBe(true);
    const finished = await updateWhere(host, (snapshot) => snapshot.game?.phase === "gameOver", 60_000);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(emotes.length).toBeGreaterThan(0);
    expect(emotes.some((emote) => emote.from === hostSeat)).toBe(false);
    // 他（由人机代打）当过挑战者或骷髅被人踩到的轮次里，纯人机会发，他不会发；这一局有这种轮次时断言才有分量（多数局都有）
    const hostTriggers = [...finished.game!.history, finished.game!.roundLog].filter((log) => log.challenger === hostSeat || log.skullOwner === hostSeat).length;
    if (hostTriggers === 0) console.warn("这一局托管的真人没当过挑战者，表情断言偏弱");
  }, 90_000);

  it("掉线的人轮到时由人机代打（不算超时），用原昵称回来后交还", async () => {
    const leaver = await connect();
    const stayer = await connect();
    const leaverName = nick("掉线");
    const { code } = await create(leaver, leaverName, MIN_CAPACITY);
    expect((await call<LobbyRoomSnapshot>((ack) => stayer.emit("room:join", { name: nick("留下"), code }, ack))).ok).toBe(true);
    await addBotsUpTo(leaver, 2);
    const started = await start(leaver);
    if (!started.ok) throw new Error(started.error);
    const leaverSeat = started.data.members.find((member) => member.id === leaver.id)!.playerId;
    const stop = autoplay(stayer);
    leaver.disconnect();

    const played = await updateWhere(stayer, (snapshot) => actedBy(snapshot, leaverSeat));
    expect(played.game!.events.some((event) => event.type === "TimedOut")).toBe(false);
    expect(played.members.find((member) => member.playerId === leaverSeat)).toMatchObject({ connected: false });

    const back = await connect();
    const rejoined = await call<LobbyRoomSnapshot>((ack) => back.emit("room:join", { name: leaverName, code }, ack));
    expect(rejoined.ok && rejoined.data.members.find((member) => member.id === back.id)).toMatchObject({ playerId: leaverSeat, connected: true });
    stop();
  }, 30_000);
});
