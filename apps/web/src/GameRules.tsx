import { useEffect, useState } from "react";
import { DiscImg, Icon } from "./pieces.js";
import { matArt } from "./art.js";

/** 规则说明：顶栏一个按钮，点开是像素弹窗。用自己的话写，配游戏里的图。 */
function GameRules({ label = "规则" }: { label?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const handle = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  }, [open]);

  return (
    <>
      <button className="quiet-button sk-rules-button" type="button" aria-expanded={open} onClick={() => setOpen(true)} data-tutorial="rules-button">{label}</button>
      {open && (
        <div className="gm-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <section className="gm-panel sk-rules" role="dialog" aria-modal="true" aria-labelledby="sk-rules-title">
            <header className="sk-rules-head">
              <h2 id="sk-rules-title">骷髅牌怎么玩</h2>
              <button className="quiet-button" type="button" onClick={() => setOpen(false)}>关闭</button>
            </header>
            <div className="sk-rules-body">
              <div className="sk-rules-block">
                <h3>每人 4 张垫子</h3>
                <div className="sk-rules-pics">
                  <DiscImg face="rose" scale={2} /><DiscImg face="rose" scale={2} /><DiscImg face="rose" scale={2} /><DiscImg face="skull" scale={2} />
                  <span className="sk-rules-eq">背面都一样</span>
                  <DiscImg face="back" scale={2} />
                </div>
                <p>3 朵<b>玫瑰</b>、1 个<b>骷髅</b>。当挑战者<b>成功两次</b>就赢：第一次垫板翻到花面
                  <img className="sk-rules-mat" src={matArt(0, true)} width={56} height={64} alt="" />，再成功一次赢下整局。别人都出局、只剩你，也算赢。</p>
              </div>
              <div className="sk-rules-block">
                <h3>一轮怎么打</h3>
                <ol>
                  <li><b>大家同时</b>扣着盖 1 张到自己板上。</li>
                  <li>轮到你：<b>再盖一张</b>，或者<b>开叫</b>一个数——「我能连翻这么多张，一张骷髅都不碰」。最少 1，最多是<b>场上盖着的总数</b>。谁都可以第一次轮到就开叫；手里没垫子了只能开叫。</li>
                  <li>有人开叫后谁都不能再盖：轮到你就<b>加注</b>（更大的数）或者<b>过</b>。过了这一轮就不能再叫。</li>
                  <li>只剩一人没过，或者有人叫到场上总数，叫得最高的人当<b>挑战者</b> <Icon name="lantern" scale={1} />。</li>
                </ol>
              </div>
              <div className="sk-rules-block">
                <h3>翻牌</h3>
                <ul>
                  <li>挑战者<b>先翻自己板上的</b>（从上往下，系统自动翻），再一张张翻别人的：每块板<b>只能翻最上面那张</b>，每翻一张都可以换板。</li>
                  <li>翻满都是玫瑰：<b>成功</b>。翻到骷髅马上停：<b>失败</b>，只有挑战者受罚，骷髅的主人没事。</li>
                  <li>失败要丢一张：翻到别人的骷髅，系统随机拿走你一张；翻到自己的骷髅，你自己挑一张。<b>丢的是什么只有你知道</b>。丢光就出局。</li>
                  <li>失败后，其他人可以点 <Icon name="eye" scale={1} />「亮出我的垫子」，给大家看看自己没唬人。</li>
                </ul>
              </div>
              <div className="sk-rules-block">
                <h3>其他</h3>
                <ul>
                  <li>下一轮挑战者先手 <Icon name="key" scale={1} />；他出局了由那个骷髅的主人先手，被自己骷髅弄出局的由他指定。</li>
                  <li>每一步都有时限，超时系统替你随机盖一张、开叫 1、过或随机翻；连续两次超时由人机托管，点「取消托管」就拿回来。掉线了用原昵称和房间码回到座位。</li>
                  <li>Last Chance 碟 <Icon name="lc" scale={1} />（开房选项）：失败后只剩 1 张的人，下一轮多拿一张大家都知道是玫瑰的银碟。</li>
                </ul>
              </div>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default GameRules;
