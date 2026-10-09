/**
 * 骷髅牌的新手教程：在浏览器里按剧本走（./script.ts），牌桌就是真正对局的 GameBoard，咕噜嘎的对话框叠在上面；
 * 剧本走完（你赢下整局）接一局新的人机练习，可以点「提示」。
 * 不连服务器，不占房间；首页、等候房间都能进来（从等候房间进来时，房主开局会自动回到牌桌，见 App.tsx）。
 *
 * 和情书的 TutorialMode 一样接 useTutorial；盖牌要点两下（选中 → 盖上），每 150 毫秒看一眼界面决定这一下指哪里。
 * 系统翻挑战者自己的垫子在 useTutorial 里当成一个座位（SYSTEM），剧本里写成 { type: "auto" }。
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  botCommand,
  DEFAULT_ROOM_ACCESS,
  needsAdvance,
  redactGameForViewer,
  type GameCommand,
  type GameState,
  type LobbyMember,
  type LobbyRoomSnapshot,
} from "@skull/game";
import GameBoard from "../GameBoard.js";
import type { Theme } from "../theme.js";
import { anchorSelector, Coach, isTouchDevice, StepPips, type CoachView } from "./Coach.js";
import { GAME_ID } from "./hints.js";
import {
  createPracticeGame,
  createTutorialGame,
  resolveAnchor,
  RIVAL_1,
  RIVAL_2,
  RIVAL_NAMES,
  sameCommand,
  SYSTEM,
  TUTORIAL_SELF,
  TUTORIAL_STEPS,
  tutorialActor,
  tutorialApply,
  tutorialBot,
  tutorialCanAct,
  type Cond,
  type SubStep,
  type TutorialCommand,
  type TutorialStep,
} from "./script.js";
import { writeTutorial } from "./storage.js";
import { useTutorial } from "./useTutorial.js";
import "./sk-tutorial.css";

const SELF_MEMBER = "tutorial-self";
/** 房间码只用来按哈希挑背景场景。 */
const TUTORIAL_CODE = "GULU01";

/**
 * 刚翻完一张牌就讲结果的步骤：等翻面动画（悬念停顿）播完再露面，免得字先说出了答案。
 * 值是毫秒，对应 pieces.tsx 的 FLIP_MS.flip（1220）再留一点。
 */
const AFTER_FLIP: Readonly<Record<string, number>> = {
  "r1-success": 1500,
  "r2-flip-2": 1400,
  "r2-skull": 1500,
  "r2-lost": 200,
};

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

export default function TutorialMode({ name, brand, themeToggle, theme, waitingRoom, onExit }: {
  /** 首页填过的昵称；没填叫「新玩家」。 */
  name: string;
  brand: ReactNode;
  themeToggle: ReactNode;
  theme: Theme;
  /** 从等候房间点进来的：那个房间的房间码。 */
  waitingRoom?: string | undefined;
  onExit: () => void;
}) {
  const selfName = name.trim().length >= 2 ? name.trim() : "新玩家";
  // 剧本进行中（不是练习局）：固定失牌、你点「继续」时咕噜们一起点。每次渲染更新，apply 读它。
  const scriptRef = useRef(true);

  const tutorial = useTutorial<GameState, TutorialCommand, TutorialStep>({
    steps: TUTORIAL_STEPS,
    self: TUTORIAL_SELF,
    start: () => createTutorialGame(selfName),
    restart: () => createPracticeGame(selfName, randomSeed()),
    apply: (state, playerId, command) => tutorialApply(state, playerId, command, scriptRef.current),
    same: sameCommand,
    actor: tutorialActor,
    canAct: tutorialCanAct,
    bot: (state, playerId) => tutorialBot(state, playerId, botCommand),
    // 系统翻自己的垫子快一点；人机出手前停一下，让人看清上一步
    botDelay: (state) => (needsAdvance(state) ? 1100 : state.phase === "roundEnd" ? 1200 : state.phase === "placeInitial" ? 900 : 1500),
    watchDelay: (command) => (command.type === "auto" ? 1300 : command.type === "as" && command.command.type === "flipMat" ? 2200 : 1200),
  });
  const { game, step, index, practice, flash } = tutorial;
  scriptRef.current = !practice;

  // 走到最后一步或进了练习局就算学完（之后首页不再邀请）
  useEffect(() => {
    if (practice || (step?.kind === "info" && step.finale)) writeTutorial(GAME_ID, "done");
  }, [practice, step?.id]);

  function leave() {
    writeTutorial(GAME_ID, "skipped");
    onExit();
  }

  // ---------- 一步里的「这一下」：看界面决定 ----------
  const [sub, setSub] = useState(0);
  // 讲解步骤的高亮元素在这个尺寸的界面上一直不出现：1.2 秒后不指它，照样讲
  const [lostAnchor, setLostAnchor] = useState<string | null>(null);
  // 刚翻完牌的步骤先等动画（AFTER_FLIP）
  const [shownStep, setShownStep] = useState<string | null>(null);
  useEffect(() => {
    setSub(0);
    setLostAnchor(null);
    if (!step) return;
    const wait = AFTER_FLIP[step.id] ?? 0;
    setShownStep(wait > 0 ? null : step.id);
    const reveal = wait > 0 ? window.setTimeout(() => setShownStep(step.id), wait) : 0;
    let missingSince: number | null = null;
    const check = () => {
      if (step.kind !== "do" && step.anchor) {
        const resolved = resolveAnchor(game, step.anchor);
        const present = document.querySelector(anchorSelector(resolved));
        if (present) missingSince = null;
        else {
          missingSince ??= performance.now();
          if (performance.now() - missingSince > 1200) setLostAnchor(resolved);
        }
      }
      const subs = step.subs ?? [];
      let at = 0;
      subs.forEach((candidate, position) => {
        if (position > 0 && candidate.when && condMet(game, candidate.when)) at = position;
      });
      setSub(at);
    };
    check();
    const timer = window.setInterval(check, 150);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(reveal);
    };
  }, [step?.id, game.version]);

  const members = useMemo<LobbyMember[]>(() => [
    { id: SELF_MEMBER, playerId: TUTORIAL_SELF, name: selfName, isHost: false, connected: true },
    { id: "tutorial-bot-1", playerId: RIVAL_1, name: RIVAL_NAMES[RIVAL_1]!, isHost: false, connected: true, bot: true },
    { id: "tutorial-bot-2", playerId: RIVAL_2, name: RIVAL_NAMES[RIVAL_2]!, isHost: false, connected: true, bot: true },
  ], [selfName]);
  const room = useMemo<LobbyRoomSnapshot>(() => ({
    code: TUTORIAL_CODE,
    spectators: [],
    access: DEFAULT_ROOM_ACCESS,
    capacity: 3,
    status: "playing",
    members,
    chat: [],
    voice: [],
    options: { lastChance: false },
    game: redactGameForViewer(game, TUTORIAL_SELF),
  }), [game, members]);

  let view: CoachView | null = null;
  if (step && shownStep === step.id) {
    const current: SubStep | TutorialStep = step.subs?.[Math.min(sub, step.subs.length - 1)] ?? step;
    const touchNote = isTouchDevice() && current.noteTouch ? current.noteTouch : current.note;
    const finale = step.kind === "info" && step.finale === true;
    view = {
      key: step.subs ? `${step.id}-${sub}` : step.id,
      say: current.say,
      ...(touchNote ? { note: touchNote } : {}),
      ...(flash ? { flash } : {}),
      anchor: pickAnchor(game, current, lostAnchor),
      focus: step.kind !== "watch",
      face: flash ? "surprised" : step.face ?? "base",
      footer: (
        <>
          <StepPips index={index} total={TUTORIAL_STEPS.length} />
          {!finale && <button className="tut-link" type="button" onClick={leave}>跳过教程</button>}
        </>
      ),
      actions: step.kind !== "info" ? null : finale ? (
        <>
          <button className="quiet-button" type="button" onClick={onExit}>结束教程</button>
          <button className="primary-button tut-main" type="button" onClick={tutorial.newPractice}>和人机练一局</button>
        </>
      ) : (
        <button className="primary-button tut-main" type="button" onClick={tutorial.next}>下一步 ▶</button>
      ),
    };
  }
  // 练习局打完：结算框旁边贴一句，给「再练一局」「结束教程」（真实对局的「再来一局」要连服务器，这里不显示）
  if (practice && game.phase === "gameOver") {
    const won = game.winners[0] === TUTORIAL_SELF;
    view = {
      key: `practice-end-${game.version}`,
      say: won ? "赢了！你已经是骷髅牌老手了。" : "这局输了，再来一局？",
      note: "去首页建个房间，就能和朋友一起玩。",
      anchor: "final",
      focus: false,
      face: won ? "happy" : "think",
      actions: (
        <>
          <button className="quiet-button" type="button" onClick={onExit}>结束教程</button>
          <button className="primary-button tut-main" type="button" onClick={tutorial.newPractice}>再练一局</button>
        </>
      ),
    };
  }

  // 剧本进行中和练习局的侧栏挤法不一样（见 sk-tutorial.css 的 .tut-script / .tut-practice）
  return (
    <div className={practice ? "tut-practice" : "tut-script"} style={{ display: "contents" }}>
      <GameBoard
        room={room}
        busy={false}
        error=""
        notice=""
        brand={brand}
        connection={
          <>
            <span className="connection-status online"><span className="connection-dot" />{practice ? "练习局" : "新手教程"}</span>
            <button className="quiet-button tut-exit" type="button" onClick={practice ? onExit : leave}>退出教程</button>
          </>
        }
        themeToggle={themeToggle}
        theme={theme}
        chat={<Checklist index={index} practice={practice} waitingRoom={waitingRoom} onExit={practice ? onExit : leave} />}
        onCommand={(command: GameCommand) => tutorial.onCommand(command)}
        onRematch={() => undefined}
        onAuto={() => undefined}
        onDissolve={() => undefined}
        watchId={TUTORIAL_SELF}
        onWatch={() => undefined}
        onLeave={onExit}
        selfMemberId={SELF_MEMBER}
        mode={practice ? "practice" : "tutorial"}
      />
      {view && <Coach view={view} />}
      {/* 给走查脚本看的：现在第几步、高亮哪里（不显示） */}
      {step && (
        <span hidden data-tut-step={step.id} data-tut-kind={step.kind} data-tut-anchor={view?.anchor ?? ""} data-tut-lost={lostAnchor ?? ""} data-tut-shown={view ? "1" : "0"} />
      )}
      {practice && <span hidden data-tut-practice={game.phase} data-tut-actor={tutorialActor(game) ?? ""} data-tut-system={tutorialActor(game) === SYSTEM ? "1" : "0"} />}
    </div>
  );
}

/** 这一下高亮哪里：按局面换算；在这个尺寸上找不到就不指。 */
function pickAnchor(game: GameState, current: SubStep | TutorialStep, lost: string | null): string | null {
  if (!current.anchor) return null;
  const resolved = resolveAnchor(game, current.anchor);
  return resolved === lost ? null : resolved;
}

/** 界面条件：按锚点去页面上找元素（card:… 先按局面换算成 hand-disc-…）。 */
function condMet(game: GameState, cond: Cond): boolean {
  const find = (anchor: string) => document.querySelector<HTMLElement>(anchorSelector(resolveAnchor(game, anchor)));
  const shown = (element: HTMLElement | null) => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  };
  if (cond.present && !shown(find(cond.present))) return false;
  if (cond.enabled) {
    const element = find(cond.enabled);
    if (!shown(element) || (element as HTMLButtonElement).disabled) return false;
  }
  if (cond.absent && shown(find(cond.absent))) return false;
  return true;
}

/** 侧栏（聊天的位置）放教程进度：剧本进行中列出这次学哪几样；练习局只留一句话。手机上顶栏没有「退出教程」，这里也放一个。 */
function Checklist({ index, practice, waitingRoom, onExit }: { index: number; practice: boolean; waitingRoom: string | undefined; onExit: () => void }) {
  const lessons = TUTORIAL_STEPS.map((step, at) => ({ step, at })).filter(({ step }) => step.lesson);
  // 一课从它那一步开始，到下一课开始时算学完
  const endOf = (position: number) => lessons[position + 1]?.at ?? TUTORIAL_STEPS.length;
  const done = lessons.filter((_, position) => index >= endOf(position)).length;
  return (
    <section className="sk-panel tut-checklist sk-tut-progress" aria-label="新手教程进度">
      {practice ? (
        <>
          <h3>练习局 <small>教程学完了</small></h3>
          <p>拿不准就点提示条上的「提示」（键盘 H），我告诉你我会怎么走。</p>
        </>
      ) : (
        <>
          <h3>新手教程 <small>{done}/{lessons.length}</small></h3>
          <ul>
            {lessons.map(({ step, at }, position) => {
              const state = index >= endOf(position) ? "done" : index >= at ? "now" : "";
              return (
                <li key={step.id} className={state}>
                  <i aria-hidden="true">{state === "done" ? "✓" : state === "now" ? "▶" : "·"}</i>
                  {step.lesson}
                </li>
              );
            })}
          </ul>
        </>
      )}
      {waitingRoom && <p>你还在房间 {waitingRoom} 里，房主一开局就自动回到牌桌。</p>}
      <button className="quiet-button tut-exit sk-tut-exit" type="button" onClick={onExit}>退出教程</button>
    </section>
  );
}
