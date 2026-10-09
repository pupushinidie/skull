// 抓包脚本：连上真实服务器，检查发给「别人」和观战的数据里有没有不该看到的东西。
//   node scripts/spy.mjs [人数=3] [局数=1]
// 两个 socket 当玩家 A（房主）和 B、一个 socket 观战，其余座位用服务器人机补满；A、B 按简单策略自己打。
// 记录服务器发给每个连接的每一条 room:updated，逐条检查：
//   - 种子、随机数状态、动作序列（seed / rngState / log）不下发；
//   - 别人手里的垫子只有张数（空对象），Last Chance 碟除外；别人板上没翻开的只有 { revealed: false }；
//   - 别人翻开的垫子没有 id；别人失掉的牌面（lost、DiscLost.face）不下发；
//   - A 自己看到的垫子 id 一个都不出现在 B、观战收到的原始 JSON 里（反过来也查）。
// 有问题打印出来并以退出码 1 结束。环境变量：SERVER_URL、LAST_CHANCE=1、SEE_ALL=1（打开观战看底牌再查一遍 id 和种子）。
// 建议对一套测得快的服务跑：BOT_DELAY_SCALE=0.2 FLIP_MS=200 ROUND_END_MS=600 SERVER_PORT=3118 npx tsx apps/server/src/index.ts
import { io } from "socket.io-client";
import { chooseCommand } from "./policy.mjs";

const URL = process.env.SERVER_URL ?? `http://localhost:${process.env.SERVER_PORT ?? 3018}`;
const seats = Number(process.argv[2] ?? 3);
const games = Number(process.argv[3] ?? 1);
const problems = [];
const stats = { snapshots: 0, reveals: 0, losses: 0, rounds: 0 };

function client(name) {
  const socket = io(URL, { transports: ["websocket"], reconnection: false });
  const record = { name, socket, raw: [], latest: null, self: "" };
  socket.on("room:updated", (room) => {
    record.raw.push({ text: JSON.stringify(room), room, self: socket.id });
    record.latest = room;
  });
  return record;
}

const emit = (socket, event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function audit(record) {
  for (const { room, self } of record.raw) {
    const game = room.game;
    if (!game) continue;
    stats.snapshots += 1;
    const me = room.members.find((member) => member.id === self)?.playerId ?? "";
    const where = `${record.name} 第 ${game.round} 轮 v${game.version}`;
    for (const key of ["seed", "rngState", "log"]) if (key in game) problems.push(`${where}：收到了 ${key}`);
    // 房主打开「观战看底牌」时，观战的人本来就能看到牌面和失牌结果；只查 id 和种子
    const godView = me === "" && room.access.spectatorsSeeAll;
    for (const player of game.players) {
      if (player.id === me) continue;
      for (const disc of [...player.hand, ...player.stack]) if ("id" in disc) problems.push(`${where}：${player.id} 的垫子带了 id`);
      if (godView) continue;
      if ("lost" in player) problems.push(`${where}：看得到 ${player.id} 失了什么`);
      for (const disc of player.hand) {
        const ok = disc.lastChance ? disc.face === "rose" : Object.keys(disc).length === 0;
        if (!ok) problems.push(`${where}：${player.id} 手里的垫子漏了 ${JSON.stringify(disc)}`);
      }
      for (const disc of player.stack) {
        if (!disc.revealed && !disc.lastChance && "face" in disc) problems.push(`${where}：${player.id} 没翻开的牌面漏了`);
      }
    }
    for (const event of game.events) {
      if (!godView && event.type === "DiscLost" && event.player !== me && "face" in event) problems.push(`${where}：收到了 ${event.player} 失牌的牌面`);
    }
  }
}

/** a 自己看到过的垫子 id，不能出现在 b 收到的任何数据里。 */
function crossCheck(a, b) {
  const ids = new Set();
  for (const { room, self } of a.raw) {
    const me = room.members.find((member) => member.id === self)?.playerId;
    const player = room.game?.players.find((candidate) => candidate.id === me);
    for (const disc of [...(player?.hand ?? []), ...(player?.stack ?? [])]) if (disc.id && !disc.lastChance) ids.add(disc.id);
  }
  for (const { text } of b.raw) {
    for (const id of ids) if (text.includes(`"${id}"`)) problems.push(`${b.name} 收到了 ${a.name} 的垫子 id ${id}`);
  }
  return ids.size;
}

async function play(players) {
  let finished = false;
  const loop = async (record) => {
    while (!finished) {
      const room = record.latest;
      const game = room?.game;
      if (game?.phase === "gameOver") return;
      const seat = room?.members.find((member) => member.id === record.socket.id)?.playerId;
      const command = game && seat ? chooseCommand(game, seat) : null;
      if (command) {
        const result = await emit(record.socket, "game:command", command);
        if (!result.ok && !/还没轮到|现在不/.test(result.error)) problems.push(`${record.name} 行动被拒：${result.error}`);
      }
      await wait(30);
    }
  };
  const until = new Promise((resolve) => {
    const check = setInterval(() => {
      if (players[0].latest?.game?.phase === "gameOver") {
        clearInterval(check);
        finished = true;
        resolve();
      }
    }, 50);
  });
  await Promise.race([Promise.all(players.map(loop)), until]);
  finished = true;
}

async function main() {
  const a = client("A");
  const b = client("B");
  const watcher = client("观战");
  await Promise.all([a, b, watcher].map((record) => new Promise((resolve, reject) => {
    record.socket.once("connect", resolve);
    record.socket.once("connect_error", (error) => reject(new Error(`连不上 ${URL}：${error.message}`)));
  })));
  const created = await emit(a.socket, "room:create", { name: "间谍A", capacity: seats, options: { lastChance: process.env.LAST_CHANCE === "1" } });
  if (!created.ok) throw new Error(created.error);
  const code = created.data.code;
  if (!(await emit(b.socket, "room:join", { name: "间谍B", code })).ok) throw new Error("B 加不进去");
  if (!(await emit(watcher.socket, "room:join", { name: "看客", code, spectate: true })).ok) throw new Error("观战进不去");
  for (let seat = 2; seat < seats; seat += 1) await emit(a.socket, "room:add-bot");
  if (process.env.SEE_ALL === "1") await emit(a.socket, "room:access", { spectatorsSeeAll: true });
  const started = await emit(a.socket, "room:start");
  if (!started.ok) throw new Error(started.error);
  for (let index = 0; index < games; index += 1) {
    await play([a, b]);
    const game = a.latest.game;
    stats.rounds += game.round;
    stats.reveals += [...game.history, game.roundLog].reduce((total, log) => total + log.reveals.length, 0);
    stats.losses += [...game.history, game.roundLog].filter((log) => log.loss).length;
    console.log(`第 ${index + 1} 局：${game.round} 轮，${game.players.find((player) => player.id === game.winners[0])?.name} 获胜`);
    if (index + 1 < games) {
      await emit(a.socket, "room:rematch", true);
      await emit(b.socket, "room:rematch", true);
      while (a.latest.game?.phase === "gameOver") await wait(50);
    }
  }
  for (const record of [b, watcher, a]) audit(record);
  const aIds = crossCheck(a, b) + crossCheck(a, watcher);
  const bIds = crossCheck(b, a) + crossCheck(b, watcher);
  console.log(`检查了 ${stats.snapshots} 条快照（${games} 局、${stats.rounds} 轮、失牌 ${stats.losses} 次、亮牌 ${stats.reveals} 次）；A 的垫子 id ${aIds} 个、B 的 ${bIds} 个都没出现在别人那里`);
  for (const record of [a, b, watcher]) record.socket.disconnect();
  if (problems.length > 0) {
    console.log(`发现 ${problems.length} 个问题：`);
    for (const problem of problems.slice(0, 30)) console.log(" -", problem);
    process.exit(1);
  }
  console.log("没有发现泄露。");
  process.exit(0);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
