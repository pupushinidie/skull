import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import {
  buildGame,
  createScene,
  type AckResponse,
  type ClientToServerEvents,
  type EmoteBroadcast,
  type GameCommand,
  type GameState,
  type LobbyRoomSnapshot,
  type PublicRoomSummary,
  type ServerToClientEvents,
} from "@skull/game";

// 服务器在导入时读这些变量：人机立刻行动、每步 2 秒、系统翻牌不停顿、结算画面 0.5 秒。
process.env.BOT_DELAY_SCALE = "0";
process.env.TURN_MS = "2000";
process.env.FLIP_MS = "0";
process.env.ROUND_END_MS = "500";
const ADMIN_TOKEN = "skull-admin-test-token";
process.env.ADMIN_TOKEN = ADMIN_TOKEN;

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
/** 每个连接收到的全部房间快照和收到时自己的连接 id（隐藏信息审计用；断开后 client.id 就没了）。 */
const received = new Map<TestSocket, { room: LobbyRoomSnapshot; self: string }[]>();
let serverUrl = "";
let server: typeof import("../src/index.js");
let nameSeq = 0;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    received.set(client, []);
    client.on("room:updated", (room) => {
      latest.set(client, room);
      received.get(client)!.push({ room, self: client.id ?? "" });
    });
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

function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 8_000): Promise<LobbyRoomSnapshot> {
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 建一个 3 人房（房主 p1，再进来两个人 p2、p3），开局。 */
async function threeHumans(options?: { lastChance?: boolean }): Promise<{ code: string; seats: TestSocket[]; hostName: string }> {
  const host = await connect();
  const hostName = nick("房主");
  const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: hostName, capacity: 3, ...(options ? { options } : {}) }, ack));
  if (!created.ok) throw new Error(created.error);
  const code = created.data.code;
  const seats = [host];
  for (let index = 0; index < 2; index += 1) {
    const guest = await connect();
    const joined = await call<LobbyRoomSnapshot>((ack) => guest.emit("room:join", { name: nick("客人"), code }, ack));
    if (!joined.ok) throw new Error(joined.error);
    seats.push(guest);
  }
  const started = await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack));
  if (!started.ok) throw new Error(started.error);
  return { code, seats, hostName };
}

async function send(client: TestSocket, command: GameCommand): Promise<LobbyRoomSnapshot> {
  const response = await call<LobbyRoomSnapshot>((ack) => client.emit("game:command", command, ack));
  if (!response.ok) throw new Error(response.error);
  return response.data;
}

/** 某个座位自己视角里一张指定牌面的垫子 id。 */
function myDisc(client: TestSocket, face: "rose" | "skull" | "lastChance", where: "hand" | "stack" = "hand"): string {
  const room = latest.get(client)!;
  const seat = room.members.find((member) => member.id === client.id)!.playerId;
  const player = room.game!.players.find((candidate) => candidate.id === seat)!;
  const disc = player[where].find((candidate) => (face === "lastChance" ? candidate.lastChance : !candidate.lastChance && candidate.face === face));
  if (!disc?.id) throw new Error(`${seat} 没有 ${face}`);
  return disc.id;
}

function gameOf(client: TestSocket): GameState {
  return latest.get(client)!.game!;
}

/** 把服务器上的对局换成预览局面工厂造的（座位 id 一致：p1 房主，p2、p3 依次进来的人），等所有人收到。 */
async function inject(code: string, seats: TestSocket[], game: GameState): Promise<void> {
  // 版本号接在服务器当前对局后面，这样能分清收到的是不是新局面
  const version = (server.testHooks.game(code)?.version ?? 0) + 1000;
  server.testHooks.setGame(code, { ...game, version });
  for (const client of seats) await updateWhere(client, (room) => room.game !== undefined && room.game.version >= version);
}

describe("骷髅牌服务器", () => {
  beforeAll(async () => {
    server = await import("../src/index.js");
    await new Promise<void>((resolve, reject) => {
      server.httpServer.once("error", reject);
      server.httpServer.listen(0, resolve);
    });
    serverUrl = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    for (const client of clients) client.disconnect();
    await new Promise<void>((resolve) => server.io.close(() => resolve()));
  });

  it("建房 → 加入 → 开局：3–6 人房、至少 3 人才能开、人数选项不合法会拒；首页列表带开房选项", async () => {
    const host = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 2 } as never, ack))).ok).toBe(false);
    const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 6 }, ack));
    expect(created.ok && created.data.options).toEqual({ lastChance: false });
    const guest = await connect();
    const code = created.ok ? created.data.code : "";
    expect((await call<LobbyRoomSnapshot>((ack) => guest.emit("room:join", { name: nick("客人"), code }, ack))).ok).toBe(true);
    const tooFew = await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack));
    expect(tooFew.ok).toBe(false);
    expect(!tooFew.ok && tooFew.error).toMatch(/至少需要 3 位/);
    const summaries = await call<PublicRoomSummary[]>((ack) => host.emit("lobby:get", ack));
    expect(summaries.ok && summaries.data.find((room) => room.capacity === 6 && room.players.length === 2)?.options).toEqual({ lastChance: false });
  });

  it("开房选项：建房时可以开 Last Chance 碟；等候时只有房主能改；开局后写进对局、不能再改", async () => {
    const host = await connect();
    const bad = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 3, options: { lastChance: "yes" } } as never, ack));
    expect(bad.ok).toBe(false);
    const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 3, options: { lastChance: true } }, ack));
    if (!created.ok) throw new Error(created.error);
    expect(created.data.options.lastChance).toBe(true);
    const guest = await connect();
    await call<LobbyRoomSnapshot>((ack) => guest.emit("room:join", { name: nick("客人"), code: created.data.code }, ack));
    expect((await call<void>((ack) => guest.emit("room:options", { lastChance: false }, ack))).ok).toBe(false);
    expect((await call<void>((ack) => host.emit("room:options", { lastChance: false }, ack))).ok).toBe(true);
    await updateWhere(guest, (room) => room.options.lastChance === false);
    expect((await call<void>((ack) => host.emit("room:options", { lastChance: true }, ack))).ok).toBe(true);
    expect((await call<void>((ack) => host.emit("room:add-bot", ack))).ok).toBe(true);
    const started = await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack));
    expect(started.ok && started.data.game!.config.lastChance).toBe(true);
    expect((await call<void>((ack) => host.emit("room:options", { lastChance: false }, ack))).ok).toBe(false);
  });

  it("每种行动走一遍：同时盖第 1 张 → 盖牌 → 开叫 → 加注 → pass → 系统翻挑战者自己的 → 选板 → 成功 → 大家点继续开下一轮", async () => {
    const { code, seats } = await threeHumans();
    const [p1, p2, p3] = seats as [TestSocket, TestSocket, TestSocket];
    await inject(code, seats, buildGame({ players: 3, phase: "placeInitial", firstPlayer: "p1" }));
    await send(p2, { type: "placeFirst", discId: myDisc(p2, "rose") });
    await send(p3, { type: "placeFirst", discId: myDisc(p3, "rose") });
    expect(gameOf(p1).phase).toBe("placeInitial");
    let room = await send(p1, { type: "placeFirst", discId: myDisc(p1, "skull") });
    expect(room.game!.phase).toBe("placeOrBid");
    expect(room.game!.turn).toBe("p1");
    await send(p1, { type: "placeDisc", discId: myDisc(p1, "rose") });
    // 没轮到的人发命令会被拒
    expect((await call<LobbyRoomSnapshot>((ack) => p3.emit("game:command", { type: "openBid", count: 1 }, ack))).ok).toBe(false);
    await send(p2, { type: "openBid", count: 1 });
    await send(p3, { type: "raise", count: 2 });
    await send(p1, { type: "pass" });
    room = await send(p2, { type: "pass" });
    expect(room.game!.challenger).toBe("p3");
    // 系统自动翻 p3 自己的那 1 张，然后等 p3 选板
    room = await updateWhere(p3, (snapshot) => snapshot.game?.awaitingMatChoice === true);
    expect(room.game!.roundLog.flips).toEqual([{ owner: "p3", depth: 0, face: "rose", auto: true }]);
    // 选板这一步有倒计时，翻牌那一步没有
    expect(room.turnRemainingMs).toBeGreaterThan(0);
    room = await send(p3, { type: "flipMat", player: "p1" });
    expect(room.game!.phase).toBe("roundEnd");
    expect(room.game!.roundLog.result).toBe("success");
    expect(room.game!.players.find((player) => player.id === "p3")!.flowerUp).toBe(true);
    for (const client of seats) await send(client, { type: "nextRound" });
    room = await updateWhere(p1, (snapshot) => snapshot.game?.round === 2);
    expect(room.game!.firstPlayer).toBe("p3");
    expect(room.game!.history).toHaveLength(1);
  });

  it("失败：翻到自己的骷髅自选失牌；结算画面别人可以亮出垫子（所有人都看得到），挑战者不能亮；失牌结果只发给挑战者", async () => {
    const { code, seats } = await threeHumans();
    const [p1, p2, p3] = seats as [TestSocket, TestSocket, TestSocket];
    await inject(code, seats, buildGame({ players: [{ stack: ["rose", "skull"] }, { stack: ["rose", "rose"] }, { stack: ["skull"] }], turn: "p1" }));
    await send(p1, { type: "openBid", count: 1 });
    await send(p2, { type: "pass" });
    await send(p3, { type: "pass" });
    let room = await updateWhere(p1, (snapshot) => snapshot.game?.phase === "loseChoosing");
    expect(room.game!.players[0]!.hand).toHaveLength(4);
    room = await send(p1, { type: "loseDisc", discId: myDisc(p1, "rose") });
    expect(room.game!.events.find((event) => event.type === "DiscLost")).toMatchObject({ face: "rose", method: "chosen" });
    const seenByP2 = await updateWhere(p2, (snapshot) => snapshot.game?.phase === "roundEnd");
    expect(seenByP2.game!.events.find((event) => event.type === "DiscLost")).not.toHaveProperty("face");
    expect(seenByP2.game!.players[0]!.lost).toBeUndefined();
    expect((await call<LobbyRoomSnapshot>((ack) => p1.emit("game:command", { type: "revealStack" }, ack))).ok).toBe(false);
    await send(p2, { type: "revealStack" });
    for (const client of [p1, p3]) {
      const seen = await updateWhere(client, (snapshot) => snapshot.game?.roundLog.reveals.length === 1);
      expect(seen.game!.players[1]!.stack.map((disc) => disc.face)).toEqual(["rose", "rose"]);
      expect(seen.game!.events).toContainEqual({ type: "StackRevealed", player: "p2", discs: [{ depth: 0, face: "rose" }, { depth: 1, face: "rose" }] });
    }
    // p3 没亮，别人还是看不到
    expect(gameOf(p1).players[2]!.stack).toEqual([{ revealed: false }]);
    // 结算画面到点（0.5 秒）自动开下一轮
    room = await updateWhere(p1, (snapshot) => snapshot.game?.round === 2, 3_000);
    expect(room.game!.history[0]!.reveals.map((reveal) => reveal.player)).toEqual(["p2"]);
  });

  it("翻到别人的骷髅随机失牌；被自己的骷髅淘汰时指定先手；第二次成功终局，再来一局", async () => {
    const { code, seats } = await threeHumans();
    const [p1, p2, p3] = seats as [TestSocket, TestSocket, TestSocket];
    // 别人的骷髅
    await inject(code, seats, buildGame({ players: [{ stack: ["rose"] }, { stack: ["skull"] }, { stack: ["rose"] }], turn: "p1" }));
    await send(p1, { type: "openBid", count: 2 });
    await send(p2, { type: "pass" });
    await send(p3, { type: "pass" });
    await updateWhere(p1, (snapshot) => snapshot.game?.awaitingMatChoice === true);
    let room = await send(p1, { type: "flipMat", player: "p2" });
    expect(room.game!.roundLog.loss).toMatchObject({ player: "p1", method: "random" });
    expect(room.game!.events.find((event) => event.type === "DiscLost")).toHaveProperty("face");
    const owner = await updateWhere(p2, (snapshot) => snapshot.game?.phase === "roundEnd");
    expect(owner.game!.events.find((event) => event.type === "DiscLost")).not.toHaveProperty("face");

    // 自淘汰 → 指定先手
    await inject(code, seats, buildGame({ players: [{ stack: ["skull"], lost: ["rose", "rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" }));
    await send(p1, { type: "openBid", count: 1 });
    await send(p2, { type: "pass" });
    await send(p3, { type: "pass" });
    room = await updateWhere(p1, (snapshot) => snapshot.game?.phase === "chooseFirst");
    expect((await call<LobbyRoomSnapshot>((ack) => p2.emit("game:command", { type: "chooseFirstPlayer", player: "p3" }, ack))).ok).toBe(false);
    room = await send(p1, { type: "chooseFirstPlayer", player: "p3" });
    expect(room.game!.nextFirst).toBe("p3");

    // 第二次成功 → 终局 → 再来一局
    await inject(code, seats, buildGame({ players: [{ stack: ["rose"], flowerUp: true }, { stack: ["rose"] }, { stack: ["skull"] }], turn: "p1" }));
    await send(p1, { type: "openBid", count: 1 });
    await send(p2, { type: "pass" });
    await send(p3, { type: "pass" });
    room = await updateWhere(p2, (snapshot) => snapshot.game?.phase === "gameOver");
    expect(room.game!.result).toEqual({ winner: "p1", reason: "twoWins" });
    expect(room.rematch).toBeDefined();
    for (const client of seats) expect((await call<void>((ack) => client.emit("room:rematch", true, ack))).ok).toBe(true);
    room = await updateWhere(p1, (snapshot) => snapshot.game?.phase === "placeInitial" && !snapshot.rematch && snapshot.game.round === 1);
    expect(room.game!.players.every((player) => player.hand.length === 4)).toBe(true);
  });

  it("超时：准备阶段别人盖牌不重置倒计时；到点替没盖的人随机盖一张并记超时；每一步都有超时出路", async () => {
    const { code, seats } = await threeHumans();
    const [p1, p2, p3] = seats as [TestSocket, TestSocket, TestSocket];
    await inject(code, seats, buildGame({ players: 3, phase: "placeInitial" }));
    const before = server.testHooks.turn(code)!;
    await send(p2, { type: "placeFirst", discId: myDisc(p2, "rose") });
    await send(p3, { type: "placeFirst", discId: myDisc(p3, "rose") });
    expect(server.testHooks.turn(code)).toEqual(before);
    const timedOut = await updateWhere(p1, (snapshot) => snapshot.game?.phase === "placeOrBid", 4_000);
    expect(timedOut.game!.events).toContainEqual({ type: "TimedOut", player: "p1", phase: "placeInitial" });

    // 其余每一步用 testHooks 立刻到点。连续两次超时会转托管（人机接手），这里每次到点后把超时次数清掉，好继续手动测
    const resetAuto = async () => {
      for (const client of seats) await call<void>((ack) => client.emit("room:auto", false, ack));
    };
    await resetAuto();
    const expire = async (expect_: (game: GameState) => boolean) => {
      server.testHooks.expireTurn(code);
      const game = (await updateWhere(p1, (snapshot) => snapshot.game !== undefined && expect_(snapshot.game))).game!;
      await resetAuto();
      return game;
    };
    await inject(code, seats, buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" }));
    let game = await expire((state) => state.turn === "p2");
    expect(game.players[0]!.stack).toHaveLength(2);
    await send(p2, { type: "openBid", count: 1 });
    game = await expire((state) => state.players[2]!.passed);
    expect(game.events).toContainEqual({ type: "Passed", player: "p3" });
    game = await expire((state) => state.phase === "resolving");
    expect(game.challenger).toBe("p2");
    // 挑战者 p2 的翻完了以后（叫 1、自己 1 张就成功了）→ 结算画面到点开下一轮
    game = (await updateWhere(p1, (snapshot) => snapshot.game?.round === 2, 3_000)).game!;

    await inject(code, seats, buildGame({ players: [{ stack: ["rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], phase: "resolving", bids: [{ type: "open", player: "p1", count: 3 }], challenger: "p1" }));
    await updateWhere(p1, (snapshot) => snapshot.game?.awaitingMatChoice === true);
    game = await expire((state) => state.roundLog.flips.length === 2);
    expect(game.roundLog.flips[1]!.owner).toBe("p2");

    await inject(code, seats, buildGame({ players: [{ stack: ["skull"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" }));
    await send(p1, { type: "openBid", count: 1 });
    await send(p2, { type: "pass" });
    await send(p3, { type: "pass" });
    await updateWhere(p1, (snapshot) => snapshot.game?.phase === "loseChoosing");
    game = await expire((state) => state.phase === "roundEnd");
    expect(game.roundLog.loss?.method).toBe("chosen");

    await inject(code, seats, buildGame({ players: [{ stack: ["skull"], lost: ["rose", "rose", "rose"] }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" }));
    await send(p1, { type: "openBid", count: 1 });
    await send(p2, { type: "pass" });
    await send(p3, { type: "pass" });
    await updateWhere(p1, (snapshot) => snapshot.game?.phase === "chooseFirst");
    game = await expire((state) => state.phase === "roundEnd");
    expect(game.nextFirst).toBe("p2");
  });

  it("断线后用原昵称加房间码回到自己的座位，看得到自己的垫子", async () => {
    const host = await connect();
    const hostName = nick("房主");
    const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: hostName, capacity: 3 }, ack));
    if (!created.ok) throw new Error(created.error);
    const leaverName = nick("掉线");
    const leaver = await connect();
    await call<LobbyRoomSnapshot>((ack) => leaver.emit("room:join", { name: leaverName, code: created.data.code }, ack));
    const third = await connect();
    await call<LobbyRoomSnapshot>((ack) => third.emit("room:join", { name: nick("客人"), code: created.data.code }, ack));
    await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack));
    const ids = server.testHooks.game(created.data.code)!.players[1]!.hand.map((disc) => disc.id);
    leaver.disconnect();
    await updateWhere(host, (room) => room.members.find((member) => member.name === leaverName)?.connected === false);
    const back = await connect();
    const rejoined = await call<LobbyRoomSnapshot>((ack) => back.emit("room:join", { name: leaverName, code: created.data.code }, ack));
    expect(rejoined.ok).toBe(true);
    if (!rejoined.ok) return;
    expect(rejoined.data.members.find((member) => member.id === back.id)?.playerId).toBe("p2");
    const mine = rejoined.data.game!.players[1]!;
    expect([...mine.hand, ...mine.stack].map((disc) => disc.id).sort()).toEqual(ids.sort());
    // 别人在线的昵称不能顶替
    const impostor = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => impostor.emit("room:join", { name: hostName, code: created.data.code }, ack))).ok).toBe(false);
  });

  it("人机和掉线的人在结算画面替自己点继续、从不亮牌；只等真人点", async () => {
    const host = await connect();
    const created = await call<LobbyRoomSnapshot>((ack) => host.emit("room:create", { name: nick("房主"), capacity: 3 }, ack));
    if (!created.ok) throw new Error(created.error);
    const code = created.data.code;
    expect((await call<void>((ack) => host.emit("room:add-bot", ack))).ok).toBe(true);
    const leaver = await connect();
    await call<LobbyRoomSnapshot>((ack) => leaver.emit("room:join", { name: nick("掉线"), code }, ack));
    await call<LobbyRoomSnapshot>((ack) => host.emit("room:start", ack));
    // p1 叫到场上总数直接揭牌，翻到 p2（人机）的骷髅；p3（掉线的真人）板上那张没翻开，本来可以亮
    await inject(code, [host], buildGame({ players: [{ stack: ["rose"] }, { stack: ["skull"] }, { stack: ["rose"] }], turn: "p1" }));
    leaver.disconnect();
    await updateWhere(host, (room) => room.members.find((member) => member.playerId === "p3")?.connected === false);
    await send(host, { type: "openBid", count: 3 });
    await updateWhere(host, (room) => room.game?.awaitingMatChoice === true);
    await send(host, { type: "flipMat", player: "p2" });
    const waiting = await updateWhere(host, (room) => room.game?.phase === "roundEnd" && room.game.players[1]!.ready && room.game.players[2]!.ready, 2_000);
    expect(waiting.game!.players[0]!.ready).toBe(false);
    expect(waiting.game!.roundLog.reveals).toEqual([]);
    await send(host, { type: "nextRound" });
    const next = await updateWhere(host, (room) => room.game?.round === 2);
    expect(next.game!.history[0]!.reveals).toEqual([]);
  });

  it("快捷表情：座位上的人能发，房间里所有人（含观战）都收到；每 2 秒最多一个；观战的人不能发；没有的表情被拒", async () => {
    const { code, seats } = await threeHumans();
    const [p1, p2] = seats as [TestSocket, TestSocket];
    const viewer = await connect();
    expect((await call<LobbyRoomSnapshot>((ack) => viewer.emit("room:join", { name: nick("看客"), code, spectate: true }, ack))).ok).toBe(true);
    const heard = [...seats, viewer].map((client) => new Promise<EmoteBroadcast>((resolve) => client.once("room:emote", resolve)));
    expect((await call<void>((ack) => p1.emit("room:emote", { id: "taunt" }, ack))).ok).toBe(true);
    for (const emote of await Promise.all(heard)) expect(emote).toMatchObject({ id: "taunt", from: "p1" });
    const tooFast = await call<void>((ack) => p1.emit("room:emote", { id: "rose" }, ack));
    expect(!tooFast.ok && tooFast.error).toMatch(/太快/);
    expect((await call<void>((ack) => p2.emit("room:emote", { id: "shock" }, ack))).ok).toBe(true);
    expect((await call<void>((ack) => p2.emit("room:emote", { id: "dance" } as never, ack))).ok).toBe(false);
    expect((await call<void>((ack) => viewer.emit("room:emote", { id: "rose" }, ack))).ok).toBe(false);
    await delay(2_100);
    expect((await call<void>((ack) => p1.emit("room:emote", { id: "rose" }, ack))).ok).toBe(true);
  });

  it("管理员：lobby:get 列出房间（含花面分数、淘汰标记）；口令不对拒绝；admin:dissolve 关掉房间，玩家和观战都收到通知", async () => {
    const { code, seats, hostName } = await threeHumans();
    const viewer = await connect();
    await call<LobbyRoomSnapshot>((ack) => viewer.emit("room:join", { name: nick("看客"), code, spectate: true }, ack));
    await inject(code, seats, buildGame({ players: [{ stack: ["rose"], flowerUp: true }, { stack: ["rose"] }, { stack: ["rose"] }], turn: "p1" }));
    const admin = await connect();
    const listed = await call<PublicRoomSummary[]>((ack) => admin.emit("lobby:get", ack));
    const summary = listed.ok ? listed.data.find((room) => room.players.some((player) => player.name === hostName)) : undefined;
    expect(summary?.players.find((player) => player.name === hostName)?.score).toBe(1);
    expect(summary?.status).toBe("playing");
    expect(summary?.players.find((player) => player.isActive)).toBeDefined();
    expect((await call<void>((ack) => admin.emit("admin:dissolve", { roomId: summary!.id, token: "wrong" }, ack))).ok).toBe(false);
    await delay(2_100);
    const closed = [...seats, viewer].map((client) => new Promise<string>((resolve) => client.once("room:closed", ({ reason }) => resolve(reason))));
    expect((await call<void>((ack) => admin.emit("admin:dissolve", { roomId: summary!.id, token: ADMIN_TOKEN }, ack))).ok).toBe(true);
    for (const reason of await Promise.all(closed)) expect(reason).toContain("管理员");
  }, 15_000);

  it("抓包审计：这个文件里每个连接收到的每一条房间快照，都没有别人没翻开的牌面、垫子 id、失牌结果、种子", () => {
    let checked = 0;
    for (const snapshots of received.values()) {
      for (const { room, self } of snapshots) {
        const game = room.game;
        if (!game) continue;
        const me = room.members.find((member) => member.id === self)?.playerId ?? "";
        expect(game.seed).toBeUndefined();
        expect(game.rngState).toBeUndefined();
        expect(game.log).toBeUndefined();
        for (const player of game.players) {
          if (player.id === me) continue;
          expect(player.lost).toBeUndefined();
          for (const disc of player.hand) expect(disc).toEqual(disc.lastChance ? { face: "rose", lastChance: true } : {});
          for (const disc of player.stack) {
            expect(disc.id).toBeUndefined();
            if (!disc.revealed && !disc.lastChance) expect(disc).toEqual({ revealed: false });
          }
        }
        for (const event of game.events) if (event.type === "DiscLost" && event.player !== me) expect(event).not.toHaveProperty("face");
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(100);
  });
});
