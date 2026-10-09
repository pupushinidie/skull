/**
 * 离线代打要先等 3 秒（全站约定：刷新页面、短暂断线的人来得及回来）。
 * bots.test.ts 里把人机停顿调成 0（BOT_DELAY_SCALE=0）跑得快，测不到这 3 秒，所以单独一个文件用真实停顿（BOT_DELAY_SCALE=1）。
 */
import { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import type { AckResponse, ClientToServerEvents, LobbyRoomSnapshot, ServerToClientEvents } from "@skull/game";

process.env.BOT_DELAY_SCALE = "1";
process.env.TURN_MS = "20000";
process.env.FLIP_MS = "0";

type TestSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
const clients = new Set<TestSocket>();
const latest = new Map<TestSocket, LobbyRoomSnapshot>();
let serverUrl = "";
let serverIo: typeof import("../src/index.js").io;

function connect(): Promise<TestSocket> {
  return new Promise((resolve, reject) => {
    const client: TestSocket = createClient(serverUrl, { transports: ["websocket"], reconnection: false });
    clients.add(client);
    client.on("room:updated", (room) => latest.set(client, room));
    client.once("connect", () => resolve(client));
    client.once("connect_error", reject);
  });
}

function call<T>(send: (ack: (response: AckResponse<T>) => void) => void): Promise<AckResponse<T>> {
  return new Promise((resolve) => send(resolve));
}

function updateWhere(client: TestSocket, test: (room: LobbyRoomSnapshot) => boolean, timeoutMs = 15_000): Promise<LobbyRoomSnapshot> {
  return new Promise((resolve, reject) => {
    const current = latest.get(client);
    if (current && test(current)) {
      resolve(current);
      return;
    }
    const timer = setTimeout(() => reject(new Error("等不到想要的房间状态")), timeoutMs);
    const handler = (room: LobbyRoomSnapshot) => {
      if (!test(room)) return;
      clearTimeout(timer);
      client.off("room:updated", handler);
      resolve(room);
    };
    client.on("room:updated", handler);
  });
}

describe("离线代打的 3 秒宽限", () => {
  beforeAll(async () => {
    const serverModule = await import("../src/index.js");
    serverIo = serverModule.io;
    const httpServer = serverModule.httpServer;
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

  it("掉线的人要盖第 1 张：等满 3 秒才由人机替他盖（不算超时），不会立刻代打", async () => {
    const leaver = await connect();
    const stayer = await connect();
    const created = await call<LobbyRoomSnapshot>((ack) => leaver.emit("room:create", { name: "掉线者", capacity: 3 } as never, ack));
    if (!created.ok) throw new Error(created.error);
    expect((await call<LobbyRoomSnapshot>((ack) => stayer.emit("room:join", { name: "留下者", code: created.data.code }, ack))).ok).toBe(true);
    expect((await call<void>((ack) => leaver.emit("room:add-bot", ack))).ok).toBe(true);
    const started = await call<LobbyRoomSnapshot>((ack) => leaver.emit("room:start", ack));
    if (!started.ok) throw new Error(started.error);
    const seat = started.data.members.find((member) => member.id === leaver.id)!.playerId;

    const leftAt = Date.now();
    leaver.disconnect();
    const placed = await updateWhere(stayer, (room) => room.game?.players.find((player) => player.id === seat)?.placedInitial === true);
    const waited = Date.now() - leftAt;
    expect(waited).toBeGreaterThanOrEqual(2_900);
    expect(waited).toBeLessThan(6_000);
    expect(placed.game!.events.some((event) => event.type === "TimedOut")).toBe(false);
  }, 20_000);
});
