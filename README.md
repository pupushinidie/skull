# 骷髅牌（Skull）

3–6 人的唬人叫价桌游，网页联机版。每人 4 张背面一模一样的圆垫子（3 朵玫瑰、1 个骷髅），扣着往自己板上叠，然后叫价「我能连翻 N 张都是玫瑰」，叫到最高的人去翻。翻满不碰骷髅就赢一轮，赢两轮获胜；碰到骷髅就永久丢一张，丢光淘汰，活到最后也算赢。界面文案、规则说明和美术都是自己的。

线上地址（上线后）：<https://gulugagame.com/skull/>

## 本地运行

```bash
npm install
npm run dev          # 服务器 :3018，网页 :5191
npm test             # 122 项：规则书和补充用例 56、3–6 人各 300 整局随机对局、隐藏信息 6、预览局面和教程剧本 34、服务器 21
npm run typecheck    # 规则包、测试、服务器、网页
BASE_PATH=/skull/ npm run build
```

端口从环境变量读：`WEB_PORT`（网页，默认 5191）、`SERVER_PORT`（服务器，默认 3018；线上 pm2 用 `PORT`）。另起一套服务时 `WEB_PORT=5291 SERVER_PORT=3118 npm run dev`，vite 的代理和服务器允许的开发来源会一起跟着变。

改了 `packages/game` 要先 `npm run build:game` 再跑服务器测试（服务器读的是 `packages/game/dist`）。

测试用的环境变量（服务器导入时读）：`TURN_MS`（每个决定的限时，毫秒，覆盖默认值）、`FLIP_MS`（系统自动翻挑战者自己的垫子之间停多久）、`ROUND_END_MS`（结算画面停多久，成功失败一样）、`BOT_DELAY_SCALE`（人机停顿倍数，0 = 立刻）。

### 一个人怎么测

- `node scripts/test-bot.mjs host 3 1`：陪玩脚本建一个 3 人房、自己坐一个座位，打印房间码；你在网页里用房间码加入凑满后自动开局。`host 4 4` 是四个脚本自己打完一整局。
- `node scripts/test-bot.mjs join <房间码> [昵称]`：以一个脚本玩家的身份加入别人的房间。
- `BOT_DELAY_MS` 调思考时间（默认 1200），`BOT_IDLE=1` 只挂着不动（等超时），`SERVER_URL` 换服务器地址，`LAST_CHANCE=1` 建房时打开 Last Chance 碟。
- `node scripts/spy.mjs [人数] [局数]`：抓包。两个 socket 当玩家、一个观战，连上 dev 服务器打完整局，逐条检查发给 B 和观战的数据里有没有别人的牌面、垫子 id、种子、失牌结果，有问题退出码 1。
- 两个脚本共用 `scripts/policy.mjs` 里的简单打法（不是人机，只求各种行动都走到）。
- 网页上的牌桌现在是**调试牌桌**（`apps/web/src/GameBoard.tsx`：把状态列出来，每个合法行动一个按钮），正式牌桌由界面阶段来做。

## 规则（用自己的话说）

**配件**：每人一块垫板（空白面 / 花面）和 4 张垫子：3 朵玫瑰、1 个骷髅，背面完全一样。

**目标**：当挑战者成功两次（第一次垫板翻到花面，带着花面再成功一次就赢），或者别人都被淘汰、只剩你。不会平局。

**一轮怎么打**：
1. **准备**：所有还在场上的人同时挑一张垫子，扣着盖到自己板上（本站是同时盖，盖好的人显示「已盖」）。
2. **轮流**：从本轮先手起顺时针，轮到的人二选一：再从手里盖一张（叠在上面），或者**开叫**一个数（1 到场上盖着的总数）。谁都可以第一次轮到就开叫，不用先盖第二张。手里没垫子了，轮到你就只能开叫。
3. **加注**：有人开叫后谁都不能再盖。继续顺时针，轮到的人加注（比当前叫价大、不超过场上总数，加多少都行）或者 pass。pass 了这一轮就不能再加，但你板上的垫子还在，可能被翻。只剩一个人没 pass，或者有人直接叫到了场上总数（这时别人不再表态），叫价最高的人就是**挑战者**。
4. **揭牌**：挑战者要翻开叫价那么多张、一张骷髅都不碰到。先翻**自己板上的**，从最上面往下翻（叫价比自己的张数少就只翻上面几张）；自己的翻完还差的，再一张张翻别人的，每块板只能翻最上面那张，每翻一张都可以换一块板。系统替挑战者自动翻他自己的，翻别人的由他自己选板。
5. **成功**：翻满都是玫瑰，垫板翻到花面；已经是花面就赢下整局。
6. **失败**：翻到骷髅马上停。只有挑战者受罚，骷髅的主人没事。挑战者先把自己盖出去的垫子全部收回手里，然后失去一张，永久移出：
   - 翻到**别人**的骷髅：系统随机拿走一张（相当于骷髅主人闭着眼抽）；
   - 翻到**自己**的骷髅：自己挑一张丢掉；只剩 1 张就没得挑，直接丢掉。
   - 丢的是玫瑰还是骷髅，**只有挑战者自己知道**，别人（包括骷髅主人）只看到他少了一张。
   - 垫子丢光就淘汰。
7. **下一轮先手**：挑战者还在场上就是他；他被别人的骷髅淘汰，由那个骷髅的主人先手；他被自己的骷髅淘汰，由他指定一位还在场上的人先手。
8. **收牌**：结算后大家把板上的垫子收回手里（翻开过的玫瑰照样收回，只有丢掉的那张没了），pass 清空，开下一轮。

**亮出我的垫子（本站加的，官方规则书旁注）**：挑战**失败**的那次结算画面上，挑战者以外、板上还有没翻开垫子的人，可以点「亮出我的垫子」，把自己板上没翻开的**全部**公开给所有人（不能挑着亮，手里的不算）。不点就谁也看不到。成功的那次结算没有这个按钮。

**Last Chance 碟（开房选项，默认关）**：挑战失败后只剩 1 张垫子的人，下一轮多拿一张大家都知道是玫瑰的碟子：手里有它就不算「没垫子」，盖不盖、什么时候盖自己定，盖上去算进场上总数，能被翻，翻到算一朵玫瑰；它在谁手里、在板上第几张，所有人都看得到。拿碟那一轮当挑战者失败：碟子和最后一张一起失去，直接淘汰。那一轮结束碟子收走。垫子只减不增，所以每人一局最多拿一次。

## 默认规则表（规则书没写死、这里这样处理的地方）

| 项目 | 本站做法 | 依据 |
|---|---|---|
| 人数 | 3–6 人；一个人也能开局（空座加人机凑够 3 人） | 规则书 §7；全站约定 |
| 第一轮先手 | 随机 | 开工拍板 |
| 准备阶段 | 所有人同时盖第 1 张（不做「先手最后盖」） | 开工拍板 |
| 叫到场上总数 | 立刻开始揭牌，别人不再表态（开叫直接叫到总数也一样） | 补充 3.2 #2、3.5(b) |
| 先手第一次轮到 | 可以直接开叫，不用先盖第 2 张 | 补充 3.3 #1 |
| 失牌公开度 | 失的是什么只私发给挑战者；骷髅主人也不知道 | 开工拍板；补充 3.3 #9 |
| 翻到自己骷髅、只剩 1 张 | 不进自选，直接丢掉、淘汰 | 补充 3.3 #4 |
| 自淘汰指定先手 | 新阶段 chooseFirst，挑战者指定；超时 = 他顺时针下一位存活玩家 | 补充 3.2 #5、3.3 #7 |
| 失败后自愿亮牌 | 做（只在失败那次的结算画面，全部亮，不能挑） | 开工拍板（他额外要的） |
| Last Chance 碟 | 开房选项，默认关；细节见上 | 开工拍板；补充 3.3 #2 |
| 结算画面 | 板上的垫子留着给大家看；所有还在场上的人点「继续」，或成功 5 秒 / 失败 8 秒后自动开下一轮（下一轮开头才收牌、收走 Last Chance 碟）。人机和托管、离线的人由人机替他点继续 | 规则书 §8.2「房主或自动」改成人人可点 |
| 挑战者自己的垫子 | 系统自动一张张翻，每张之间停 1 秒（留悬念）；翻完还要翻别人的才轮到他选板 | 规则书 §8.2 |
| 结束 | 第 2 次成功，或只剩 1 人；没有平局 | 规则书 §6 |
| 托管 | 连续 2 次超时转托管 = 人机代打；离线的人轮到时等 3 秒后由人机代打；用原昵称加房间码回到座位 | 全站约定（覆盖规则书超时写法） |
| 快捷表情 | 8 个（rose、skull、taunt、shrug、think、laugh、sweat、shock），座位上的人每 2 秒最多发 1 个，房间里所有人（含观战）都收到 | 开工拍板 |
| 观战 | 默认能观战、看不到牌面；房主可以打开「观战看底牌」（看得到牌面，看不到 id 和种子） | 全站约定 |

## 超时规则

| 步骤 | 限时 | 到点自动做 |
|---|---|---|
| 准备（同时盖第 1 张） | 20 秒 | 随机盖 1 张（不选 Last Chance 碟） |
| 轮流（盖牌或开叫，一个决定） | 25 秒 | 手里有自己的垫子就随机盖 1 张（不选碟子），没有就开叫 1 |
| 加注 | 20 秒 | pass |
| 揭牌选板 | 20 秒 | 挑战者顺时针第一块还有没翻开垫子的板 |
| 翻到自己骷髅，自选失牌 | 20 秒 | 随机丢 1 张 |
| 自淘汰，指定先手 | 15 秒 | 挑战者顺时针下一位存活玩家 |
| 结算画面 | 成功 5 秒 / 失败 8 秒 | 开下一轮（不算超时，不亮牌） |

- 一个决定一个计时：准备阶段别人盖牌、结算画面别人点继续或亮牌，都不会重置你的倒计时（计时 key 见 `stepKey`）。
- 超时、托管、人机都**不会**替你亮牌。
- 轮到人机（人机座位、托管、离线的人）时不显示倒计时。

## 对外接口（packages/game，`@skull/game`）

所有东西都从 `packages/game/src/index.ts` 导出。类型定义在 `src/types.ts`，注释写了每个字段谁能看到。

### 状态 `GameState`

| 字段 | 说明 |
|---|---|
| `phase` | `placeInitial`（同时盖第 1 张）→ `placeOrBid`（轮流盖或开叫）→ `bidding`（加注）→ `resolving`（揭牌）→ 失败时可能 `loseChoosing`（自选失牌）/ `chooseFirst`（自淘汰指定先手）→ `roundEnd`（结算画面）→ 下一轮 `placeInitial`；终局 `gameOver` |
| `players[]` | 座位顺序 = 顺时针。每人：`id`（p1…）、`name`、**`seat`（座位下标 0–5，美术 `mats/mat-{seat}-*.png`、`avatars/avatar-{seat}.png`、座位色都按它取）**、`hand`、`stack`（从底到顶，最后一张在最上面）、`flowerUp`、`eliminated`、`eliminatedRound`、`passed`、`placedInitial`、`ready`、`lastChanceRound`、`lostCount`、`lost`（只有自己的视角有） |
| `hand[]` / `stack[]` 里的垫子 | 自己的：`{ id, face, lastChance? }`（板上的多一个 `revealed`）。**别人没翻开的是空对象 `{}` / `{ revealed: false }`，只能数张数**；别人翻开的 `{ revealed: true, face }`（没有 id）；Last Chance 碟任何视角都是 `{ face: "rose", lastChance: true }` |
| `round`、`firstPlayer` | 第几轮、本轮先手 |
| `turn` | 单人决定的阶段轮到谁：`placeOrBid`/`bidding` 是轮到的人，`resolving`/`loseChoosing`/`chooseFirst` 是挑战者；`placeInitial`/`roundEnd`/`gameOver` 为 `null`（看 `waitingFor`） |
| `bid`、`bidder` | 当前最高叫价（0 = 没人叫）和叫的人 |
| `challenger`、`flipsToDo`、`awaitingMatChoice` | 挑战者、还差几张、是否在等他选板（false 时系统正在自动翻他自己的） |
| `selfSkull` | 翻出的骷髅是挑战者自己的 |
| `nextFirst` | 下一轮先手（结算画面时有值） |
| `roundLog` | 本轮公开记录：`placements`（谁盖了、是不是第 1 张、是不是碟子）、`bids`（开叫 / 加注 / pass 序列）、`stackSizes`（挑战开始时各家张数）、`challenger`、`bid`、`flips`（每张翻开的：主人、从底往上的 `depth`、牌面、是不是系统自动翻的）、`result`、`skullOwner`、`loss`（谁、方式 `chosen`/`forced`/`random`/`lastChance`、是否淘汰，**不含牌面**）、`lastChanceEarned`、`reveals`（自愿亮牌）、`nextFirst` |
| `history[]` | 打完的各轮 `roundLog`（终局时最后一轮还在 `roundLog`） |
| `winners`、`result` | 终局：`[获胜者]`、`{ winner, reason: "twoWins" | "lastStanding" }` |
| `events` | 最近一步的事件（见下） |
| `version` | 每一步 +1，网页据此触发动画 |
| `step` | 换人 / 换步骤 / 系统每翻一张时 +1（计时用） |
| `seed`、`rngState`、`log` | 只在服务器，下发前去掉 |

### 命令 `GameCommand`（`{ type, ... }`）

| 阶段 | 命令 | 参数 | 谁 |
|---|---|---|---|
| placeInitial | `placeFirst` | `discId` | 每个还没盖的存活玩家 |
| placeOrBid | `placeDisc` | `discId` | 轮到的人，手里有垫子 |
| placeOrBid | `openBid` | `count`（1 ≤ count ≤ 场上总数） | 轮到的人 |
| bidding | `raise` | `count`（当前叫价 < count ≤ 场上总数） | 轮到的人 |
| bidding | `pass` | — | 轮到的人 |
| resolving | `flipMat` | `player`（别人、板上还有没翻开的） | 挑战者，自己的翻完后 |
| loseChoosing | `loseDisc` | `discId`（自己的，不能是碟子） | 挑战者 |
| chooseFirst | `chooseFirstPlayer` | `player`（存活玩家） | 刚被自己骷髅淘汰的挑战者 |
| roundEnd | `nextRound` | — | 每个存活玩家各点一次；都点了就开下一轮 |
| roundEnd（失败时） | `revealStack` | — | 挑战者以外、板上有没翻开垫子的存活玩家 |

### 事件 `GameEvent`

`RoundStarted`、`LastChanceGiven`、`DiscPlaced`（谁、是不是第 1 张、盖完几张，不含牌面）、`PlacementDone`、`BidOpened`、`BidRaised`、`Passed`、`ChallengeStarted`、`DiscRevealed`（翻谁的、`depth`、牌面、`auto`、`flipsLeft`）、`ChallengeSucceeded`（`won`：第 2 次成功）、`ChallengeFailed`（骷髅主人、`selfSkull`）、`DiscLost`（方式、剩几张；`face` 只在失牌人自己的视角里有）、`PlayerEliminated`、`LastChanceEarned`、`FirstPlayerChosen`、`RoundEnded`（结果、下一轮先手）、`StackRevealed`（自愿亮牌：每张的 `depth` 和牌面）、`PlayerReady`、`GameEnded`（获胜者、原因）、`TimedOut`（谁、哪个阶段）。

### 函数

| 函数 | 说明 |
|---|---|
| `createGame(players, seed?, overrides?)` | 开局（3–6 人，`players` 是 `{ id, name }[]`），先手随机，进入第 1 轮准备阶段。`overrides` 是 `Partial<Config>`（比如 `{ lastChance: true }`） |
| `apply(state, playerId, command, rng)` | 纯函数，返回 `{ state, events }`；不改输入；不合法时抛中文 Error。需要随机（别人骷髅时随机失牌）时用传进来的 `rng` |
| `applyCommand(state, playerId, command)` | 服务器用：用状态里的随机数状态执行，并记进动作序列 |
| `needsAdvance(state)` / `advance(state)` / `advanceWith(state, rng)` | 揭牌时系统自动翻挑战者自己的下一张（`needsAdvance` 为真时服务器停 `flipPauseMs` 后调用） |
| `legalActions(state, playerId)` | 这个人现在所有合法命令（叫价每个数都列出来） |
| `waitingFor(state)` | 现在等谁做决定（准备阶段、结算画面可能有多人） |
| `stepKey(state)`、`stepTimeoutMs(state)` | 计时用的 key、这一步多久后自动处理 |
| `timeoutCommand(state, playerId, rng)` | 超时时替他做的命令（见超时规则） |
| `timeoutTurn(state)` | 这一步到点：替每个还没做决定的人做 `timeoutCommand`（系统翻牌就翻一张，结算画面就开下一轮） |
| `redactGameForViewer(state, viewerId, { seeAll? })` | 给某个视角看的状态（**所有下发都要经过它**）；观战用 `""`，「观战看底牌」用 `{ seeAll: true }` |
| `totalDiscsInPlay`、`discCount`、`unrevealedCount`、`alivePlayers`、`nextPlayer`、`holdsLastChance`、`flippableMats`、`canRevealStack`、`findPlayer` | 常用查询 |
| `checkInvariants(state)` | 完整状态自洽检查，返回问题列表（空 = 没问题） |
| `botCommand(view, playerId)` | 人机（现在是随机占位，人机阶段换成正式策略）；`view` 必须是 `redactGameForViewer(game, playerId)` |
| `createRng(seed)`、`scriptedRng(ints, seed?)` | 种子随机数；按剧本出 `int` 的随机数（教程、测试用） |

### 预览局面工厂（`src/scenes.ts`）

界面的预览页、教程剧本、验收测试都用它。造出来的都是**完整状态**（含牌面和 id），给界面看前用 `redactGameForViewer(game, viewer)` 或 `previewRoom`。座位 id 是 `p1…p6`，昵称 `PREVIEW_NAMES`。

**1. 从开局按剧本走真实规则**

```ts
import { startGame, runScript, discOf, act, passAround } from "@skull/game";

let game = startGame({ players: 3, first: "p1", options: { lastChance: false }, seed: 7 }); // 第 1 轮准备阶段，先手 p1
game = runScript(game, [
  ["p1", "place", "rose"], ["p2", "place", "skull"], ["p3", "place", "rose"], // 准备阶段（placeFirst）
  ["p1", "place", "rose"],          // 轮流时盖（placeDisc）
  ["p2", "bid", 2],                 // 开叫（还没人叫）或加注（bidding 阶段）
  ["p3", "pass"], ["p1", "pass"],   // 只剩 p2 → 挑战者
  ["autoAll"],                      // 系统把 p2 自己的翻完（["auto"] 只翻一张）
  ["p2", "flip", "p1", "rose"],     // 翻 p1 的板；要是翻到别人骷髅随机失牌，第 4 项指定失掉的牌面
  ["readyAll"],                     // 结算画面所有存活玩家点继续 → 下一轮
]);
```

其余步骤：`[p, "lose", "rose"|"skull"]`（自选失牌）、`[p, "first", 目标]`（指定先手）、`[p, "ready"]`、`[p, "reveal"]`（亮牌）、`["timeout"]`（这一步到点）、`[p, 命令对象]`（直接发 GameCommand）。牌面写 `"lastChance"` 表示 Last Chance 碟。不合法会抛「剧本第几步：原因」。`discOf(state, p, face, "hand"|"stack"|"any")` 拿某张牌面的 id；`act(state, p, command, lossFace?)` 执行一条命令；`passAround(state)` 让加注阶段轮到的人都 pass 直到产生挑战者。

**2. 按参数造任意精确局面**

```ts
import { buildGame } from "@skull/game";

const game = buildGame({
  players: [
    { stack: ["rose", { face: "rose", revealed: true }] },        // p1：板上两张，顶上那张已翻开
    { stack: ["skull", "rose"], flowerUp: true },                // p2：花面
    { hand: ["lastChance"], stack: ["rose"], lost: ["rose", "rose", "skull"] }, // p3：只剩 1 张 + Last Chance 碟
    { eliminated: true },                                        // p4：已淘汰
  ],
  options: { lastChance: true },
  round: 4,
  phase: "resolving",                                            // 不给：板都空是 placeInitial，否则 placeOrBid
  bids: [{ type: "open", player: "p1", count: 3 }, { type: "pass", player: "p2" }, { type: "pass", player: "p3" }],
});
```

`GameSpec` 的字段：`players`（人数或每座的 `PlayerSpec`）、`options`、`config`、`seed`、`round`、`phase`、`firstPlayer`（默认 p1）、`turn`、`bid`/`bidder`/`bids`（不给 bid、bidder、passed 就从 `bids` 推出来）、`challenger`、`flipsToDo`、`awaitingMatChoice`、`selfSkull`、`nextFirst`、`winners`、`result`、`roundLog`（覆盖本轮记录的某几项）、`history`、`events`、`version`。`PlayerSpec`：`name`、`hand`、`stack`（从底到顶，`{ face, revealed }` 表示翻开）、`lost`、`flowerUp`、`eliminated`、`eliminatedRound`、`passed`、`placedInitial`、`ready`、`lastChanceRound`。手里不写就是「3 玫瑰 1 骷髅」减去板上和 `lost` 的。造完跑 `checkInvariants`，不自洽就抛错并列出原因。

**3. 命名局面**

`createScene(name, { players })` 返回 `{ name, title, game, viewer, room }`：`viewer` 是「我」（大多是 p1），`room` 是房间层面的标记（`offline` 掉线座位、`auto` 托管座位、`bots`、`turnRemainingMs`）。`players` 3–6，默认 4（`sixPlayers` 固定 6，`revealAfterFail` 至少 4）。`SCENE_NAMES` / `SCENE_TITLES` 列出全部：

| 名字 | 局面 |
|---|---|
| `opening` | 开局，第 1 轮准备阶段，谁都没盖 |
| `placing` / `placedWaiting` | 准备阶段：别人盖好我没盖 / 我盖好了等别人 |
| `myTurn` / `otherTurn` | 轮流：轮到我（盖或开叫）/ 轮到别人 |
| `forcedBid` | 我手里没垫子，只能开叫 |
| `bidding` / `biddingOther` | 加注中（有人 pass）：轮到我 / 轮到别人 |
| `bidMax` | 我叫到场上总数，直接进揭牌（还没翻） |
| `revealOwn` | 我是挑战者，系统在翻我自己的 |
| `chooseMat` / `chooseMatOther` | 等挑战者选板：我是挑战者 / 别人是挑战者 |
| `skullOther` / `skullOtherSeen` | 翻到别人骷髅随机失牌：我是挑战者（看得到失了什么）/ 我是骷髅主人（看不到） |
| `loseChoosing` | 我翻到自己的骷髅，自选失牌 |
| `chooseFirst` | 我被自己的骷髅淘汰，指定先手 |
| `roundEndSuccess` | 我挑战成功，垫板翻花面 |
| `revealAfterFail` | 失败结算：有人亮了牌，我也可以亮 |
| `lastChance` / `lastChanceOther` | Last Chance 碟：我拿着（在手里）/ 别人盖在板顶 |
| `sixPlayers` | 6 人满桌加注中 |
| `gameOverTwoWins` / `gameOverLastStanding` | 终局：我第 2 次成功 / 别人都淘汰了 |
| `opponentOffline` | 轮到的对手掉线 |
| `timeout` | 上家刚超时被代盖，轮到我，倒计时 4 秒 |
| `autoPlay` | 我被托管 |
| `eliminatedViewer` | 我已淘汰，看别人打 |
| `laterRound` | 第 4 轮，有 3 轮历史记录 |

**4. 教程剧本**：`TUTORIAL_SCRIPT` 是补充文件 2.3 的推荐剧本（3 人、你 p1 先手、四轮），按轮分好的 `ScriptStep[]`，从 `startGame({ players: 3, first: "p1" })` 起逐轮 `runScript` 就能走到终局（测试核对过总数 5 / 3 / 6 / 8 和失牌结果）。

**5. 包成房间快照**：`previewRoom(sceneOrGame, { viewer?, spectator?, spectatorsSeeAll?, offline?, auto?, bots?, turnRemainingMs?, rematch? })` 返回服务器会发给这个视角的 `LobbyRoomSnapshot`（游戏已裁剪；成员的连接 id 是 `sock-<座位>`，房主是 p1），预览页渲染真正的 GameBoard 用。

### 房间事件（`roomTypes.ts`，比模板多的）

- 建房 `room:create` 的 payload 可以带 `options: { lastChance }`；等候时房主用 `room:options` 改；快照和首页列表里都有 `options`。
- `room:emote`（客户端 → 服务器）`{ id }`，`id` 是 `EMOTE_IDS` 之一；只有座位上的人能发，每 `EMOTE_COOLDOWN_MS`（2 秒）一次。服务器向房间里所有人（含观战）广播 `room:emote` `{ id, from（座位 id）, name, at }`。
- 快照 `turnRemainingMs`：当前这一步剩余毫秒（轮到人机时没有）；首页列表 `score` 是垫板花面（1）或没有（0），`eliminated` 标出淘汰的人。

## 目录

| 位置 | 内容 |
|---|---|
| `packages/game/src/types.ts` | 状态、命令、事件、阶段（注释写了每个字段谁能看到） |
| `packages/game/src/engine.ts` | 规则引擎、超时动作、隐藏信息裁剪 |
| `packages/game/src/scenes.ts` | 预览局面工厂 |
| `packages/game/src/invariants.ts` | 不变量检查 |
| `packages/game/src/bot.ts` | 人机（人机阶段负责） |
| `packages/game/src/roomTypes.ts` | 房间协议（人数、开房选项、表情） |
| `packages/game/test/` | 规则书用例、随机对局、隐藏信息、预览局面的测试；`test/acceptance/` 归规则核对，引擎不改 |
| `apps/server/` | Socket.IO 房间服务器和测试 |
| `apps/web/` | 网页（现在是调试牌桌） |
| `scripts/test-bot.mjs`、`scripts/spy.mjs` | 陪玩脚本、抓包脚本 |
| `art/` | 美术规格、占位图、出图脚本（美术阶段负责） |
