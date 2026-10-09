import { useState } from "react";

/** 规则说明：用自己的话写，不照搬原版规则书。 */
function GameRules() {
  const [open, setOpen] = useState(false);

  return (
    <section className={open ? "game-rules open" : "game-rules"}>
      <button
        className="game-rules-toggle"
        type="button"
        aria-expanded={open}
        aria-controls="game-rules-panel"
        onClick={() => setOpen((current) => !current)}
      >
        <span aria-hidden="true">✦</span> 游戏规则
        <i aria-hidden="true">{open ? "收起 ▴" : "展开 ▾"}</i>
      </button>

      {open && (
        <div className="game-rules-panel" id="game-rules-panel">
          <div className="game-rules-block">
            <h3>目标</h3>
            <p>
              每人 4 张背面一样的垫子：<b>3 朵玫瑰、1 个骷髅</b>。当挑战者<b>成功两次</b>就赢（第一次垫板翻到花面）；
              或者别人都被淘汰、只剩你。
            </p>
          </div>

          <div className="game-rules-block">
            <h3>一轮怎么打</h3>
            <ul>
              <li><b>同时盖第 1 张</b>：所有人挑一张扣着盖到自己板上。</li>
              <li><b>轮流</b>：轮到你时再盖一张，或者<b>开叫</b>一个数：「我能连翻这么多张都是玫瑰」，最少 1，最多是场上盖着的总数。谁都可以第一次轮到就开叫；手里没垫子了只能开叫。</li>
              <li><b>加注</b>：有人开叫后谁都不能再盖。轮到你就加注（更大的数）或者 pass；pass 了这一轮就不能再加。只剩一人没 pass、或者有人叫到场上总数，叫得最高的人当<b>挑战者</b>。</li>
            </ul>
          </div>

          <div className="game-rules-block">
            <h3>翻牌</h3>
            <ul>
              <li>挑战者<b>先翻自己板上的</b>（从最上面往下，系统自动翻），再一张张翻别人的：每块板只能翻最上面那张，每翻一张都可以换板。</li>
              <li>翻满都是玫瑰：<b>成功</b>，垫板翻到花面；已经是花面就赢了。</li>
              <li>翻到骷髅马上停：<b>失败</b>，只有挑战者受罚。翻到别人的骷髅，系统随机拿走你一张；翻到自己的骷髅，你自己挑一张丢。丢的是什么只有你知道。垫子丢光就淘汰。</li>
              <li>失败后，其他人可以点「亮出我的垫子」，把自己板上没翻开的全部亮给大家看。</li>
            </ul>
          </div>

          <div className="game-rules-block">
            <h3>其他</h3>
            <ul>
              <li>下一轮由挑战者先手；他被别人的骷髅淘汰时由那个骷髅的主人先手，被自己的骷髅淘汰时由他指定。</li>
              <li>超时：系统替你随机盖一张、没垫子时开叫 1、加注时 pass、选板时翻顺时针第一块、自选丢牌时随机丢。连续两次超时由人机托管。</li>
              <li>Last Chance 碟（开房选项）：失败后只剩 1 张的人，下一轮多拿一张大家都知道是玫瑰的碟子。</li>
              <li>所有随机都在服务器上，谁也做不了手脚。掉线后用原昵称和房间码可以回到自己的座位。</li>
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}

export default GameRules;
