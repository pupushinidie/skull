// 本地测试用的陪玩机器人（先 npm run dev，或者另起一套服务后用 SERVER_URL 指过去）。
//   node scripts/test-bot.mjs host [人数] [脚本玩家数]  → 脚本建房（自己算一个），再拉够脚本玩家，等真人凑满后自动开局
//   node scripts/test-bot.mjs join <房间码> [昵称]      → 以一个脚本玩家的身份加入别人的房间
// 例：host 3 1 —— 3 人房，脚本只占 1 个座位，你在网页上用房间码加入（再加一个人或人机凑满 3 人）；
//     host 4 4 —— 四个脚本自己打完一整局。
// 环境变量：
//   BOT_DELAY_MS   每步的思考时间（默认 1200）
//   BOT_IDLE=1     只挂着不动（等服务器超时代做）
//   SERVER_BOTS=n  建房后让房主再加 n 个服务器人机（咕噜一号……）
//   LAST_CHANCE=1  建房时打开 Last Chance 碟
//   REMATCH=1      终局后同意再来一局（默认打完一局就退出）
//   EMOTE=1        偶尔发快捷表情
//   SERVER_URL     服务器地址（默认 http://localhost:${SERVER_PORT:-3018}）
import { io } from "socket.io-client";
import { chooseCommand } from "./policy.mjs";

const URL = process.env.SERVER_URL ?? `http://localhost:${process.env.SERVER_PORT ?? 3018}`;
const PATH = process.env.SOCKET_PATH ?? "/socket.io";
const DELAY = Number(process.env.BOT_DELAY_MS ?? 1200);
const IDLE = process.env.BOT_IDLE === "1";
const REMATCH = process.env.REMATCH === "1";
const EMOTE = process.env.EMOTE === "1";
const NAMES = ["酒保", "玫瑰客", "独眼龙", "老烛台", "麦芽", "铜锅"];
const EMOTES = ["rose", "skull", "taunt", "shrug", "think", "laugh", "sweat", "shock"];

function bot(name, onRoom) {
  const socket = io(URL, { path: PATH, transports: ["websocket"] });
  let acting = false;
  let latest = null;
  let rematchSent = false;
  const emit = (event, ...args) => new Promise((resolve) => socket.emit(event, ...args, resolve));
  // 回执和新状态的广播可能在同一批消息里到达：每做完一步都回头看最新状态，免得漏掉轮到自己。
  async function tick() {
    const room = latest;
    const game = room?.game;
    if (!game || game.phase === "gameOver" || IDLE || acting) return;
    const seat = room.members.find((member) => member.id === socket.id)?.playerId;
    if (!seat) return;
    const command = chooseCommand(game, seat);
    if (!command) return;
    acting = true;
    await new Promise((resolve) => setTimeout(resolve, game.phase === "roundEnd" ? Math.min(DELAY, 800) : DELAY));
    try {
      const fresh = latest?.game;
      // 等的这段时间里局面可能变了（别人先动、超时、托管），按最新的重新挑
      const now = fresh && fresh.version !== game.version ? chooseCommand(fresh, seat) : command;
      if (now) {
        const result = await emit("game:command", now);
        if (!result.ok) console.log(name, "行动失败", result.error, JSON.stringify(now));
        if (EMOTE && Math.random() < 0.15) await emit("room:emote", { id: EMOTES[Math.floor(Math.random() * EMOTES.length)] });
      }
    } finally {
      acting = false;
    }
    if (latest !== room) void tick();
  }
  socket.on("room:updated", (room) => {
    latest = room;
    onRoom?.(room, socket);
    const game = room.game;
    if (game?.phase === "gameOver") {
      if (!rematchSent) {
        rematchSent = true;
        const winner = game.players.find((player) => player.id === game.winners[0]);
        console.log(name, `终局：第 ${game.round} 轮，${winner?.name} 获胜（${game.result?.reason === "twoWins" ? "成功两次" : "活到最后"}）`);
        if (REMATCH) void emit("room:rematch", true);
        else setTimeout(() => process.exit(0), 300);
      }
      return;
    }
    rematchSent = false;
    void tick();
  });
  socket.on("room:closed", ({ reason }) => { console.log(name, "房间关闭：", reason); process.exit(0); });
  socket.on("connect_error", (error) => { console.log(name, "连不上服务器", URL, error.message); process.exit(1); });
  return { socket, emit };
}

const [mode, arg1, arg2] = process.argv.slice(2);
if (mode === "join") {
  const name = arg2 ?? NAMES[1];
  const { socket, emit } = bot(name);
  socket.on("connect", async () => {
    const result = await emit("room:join", { name, code: arg1 });
    console.log("加入", result.ok ? "成功" : result.error);
    if (!result.ok) process.exit(1);
  });
} else {
  const capacity = Number(arg1 ?? 3);
  const scripted = Number(arg2 ?? capacity);
  const serverBots = Number(process.env.SERVER_BOTS ?? 0);
  let started = false;
  const host = bot(NAMES[0], async (room) => {
    if (!started && room.status === "waiting" && room.members.length === capacity) {
      started = true;
      const result = await host.emit("room:start");
      console.log("开局", result.ok ? "成功" : result.error);
    }
  });
  host.socket.on("connect", async () => {
    const created = await host.emit("room:create", { name: NAMES[0], capacity, options: { lastChance: process.env.LAST_CHANCE === "1" } });
    if (!created.ok) { console.log(created.error); process.exit(1); }
    console.log("房间码", created.data.code);
    for (let index = 0; index < serverBots; index += 1) console.log("加人机", (await host.emit("room:add-bot")).ok);
    for (let index = 1; index < scripted; index += 1) {
      const name = NAMES[index];
      const other = bot(name);
      other.socket.on("connect", async () => console.log("加入", name, (await other.emit("room:join", { name, code: created.data.code })).ok));
    }
  });
}
