/**
 * 终局弹窗：奖杯 + 缎带上写获胜者，每个人的结果（成功次数、还剩几张、第几轮出局），再来一局投票。
 */
import { useEffect, useState, type CSSProperties } from "react";
import { discCount, type GameState, type LobbyRoomSnapshot } from "@skull/game";
import { avatarArt, seatHex, SHEETS, uiArt } from "./art.js";
import { Icon, Sprite } from "./pieces.js";
import { socket } from "./socket.js";

export function FinalDialog({ game, room, myId, spectating, onRematch, onLeave }: {
  game: GameState;
  room: LobbyRoomSnapshot;
  myId: string;
  spectating: boolean;
  onRematch: (accept: boolean) => void;
  onLeave: () => void;
}) {
  const winner = game.players.find((player) => player.id === game.winners[0]) ?? game.players[0]!;
  const accepted = room.rematch?.acceptedIds.includes(socket.id ?? "") ?? false;
  // 「再来一局」倒计时：快照里是发送时剩余的毫秒数，本地往下数
  const [anchor, setAnchor] = useState({ at: Date.now(), ms: room.rematch?.remainingMs ?? 0 });
  const [now, setNow] = useState(Date.now());
  useEffect(() => setAnchor({ at: Date.now(), ms: room.rematch?.remainingMs ?? 0 }), [room.rematch?.remainingMs]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, []);
  const rematchLeft = Math.max(0, Math.ceil((anchor.ms - (now - anchor.at)) / 1000));
  // 名次：获胜者、还活着的（按成功次数、剩余张数）、出局的（越晚出局越靠前）
  const ranked = [...game.players].sort((a, b) => {
    if (a.id === winner.id) return -1;
    if (b.id === winner.id) return 1;
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1;
    if (a.eliminated && b.eliminated) return (b.eliminatedRound ?? 0) - (a.eliminatedRound ?? 0);
    if (a.flowerUp !== b.flowerUp) return a.flowerUp ? -1 : 1;
    return discCount(b) - discCount(a);
  });
  return (
    <div className="gm-modal-backdrop sk-final-backdrop" role="presentation">
      <div className="sk-petals" aria-hidden="true">
        {[0, 1, 2, 3, 4].map((index) => (
          <Sprite key={index} sheet={SHEETS.petals} scale={2} mode="loop" frameMs={120} delayMs={-index * 230} style={{ left: `${index * 22}%` }} />
        ))}
      </div>
      <section className="gm-panel sk-final" role="dialog" aria-modal="true" aria-labelledby="sk-final-title" data-tutorial="final">
        <div className="sk-final-head">
          <Icon name="trophy" scale={2} />
          <div className="sk-ribbon" style={{ backgroundImage: `url(${uiArt("ribbon")})` }}>
            <h2 id="sk-final-title">{winner.id === myId ? "你赢了！" : `${winner.name} 赢了`}</h2>
          </div>
        </div>
        <p className="sk-final-reason">{game.result?.reason === "lastStanding" ? "别人都出局了，活到最后" : "第二次挑战成功"} · 一共打了 {game.round} 轮</p>
        <ol className="sk-final-list">
          {ranked.map((player, index) => (
            <li key={player.id} className={player.id === winner.id ? "win" : player.eliminated ? "out" : ""} style={{ "--seat": seatHex(player.seat) } as CSSProperties}>
              <span className="sk-final-rank">{index + 1}</span>
              <img src={avatarArt(player.seat)} width={32} height={32} alt="" />
              <span className="sk-final-name">{player.name}{player.id === myId ? "（你）" : ""}</span>
              <span className="sk-final-what">
                {player.id === winner.id ? "获胜" : player.eliminated ? `第 ${player.eliminatedRound} 轮出局` : player.flowerUp ? "成功 1 次" : "没成功过"}
              </span>
              <span className="sk-final-discs" title="还剩几张垫子">{player.eliminated ? "—" : `剩 ${discCount(player)} 张`}</span>
            </li>
          ))}
        </ol>
        {spectating ? (
          <div className="gm-panel-actions"><button className="quiet-button" type="button" onClick={onLeave}>离开观战</button></div>
        ) : room.rematch ? (
          <div className="sk-rematch">
            <span>再来一局？还剩 <b>{rematchLeft}</b> 秒 · {room.rematch.acceptedIds.length}/{room.members.length} 人同意</span>
            <div className="gm-panel-actions">
              <button className="quiet-button sk-mid-button" type="button" onClick={() => onRematch(false)}>离开</button>
              <button className="primary-button sk-big-button" type="button" disabled={accepted} onClick={() => onRematch(true)} data-tutorial="rematch-button">{accepted ? "等其他人" : "再来一局"}</button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}
