import type { DayPalette } from "./day-theme";

/**
 * 白天版调色表（烛光地下酒馆）：深棕底、面板、按钮 → 奶白和浅木色；深色像素描边保留成深棕；浅色字 → 深棕字。
 * 牌桌（.sk-stage 下面的一切：木桌背景、垫板、名牌、中央、手牌、操作面板）保持夜间的深色木牌样子，见 keep；
 * 牌桌背景图本身由界面按主题换成白天的蜂蜜色木桌（scene/day-*.png）。手调的部分在 src/theme-day.css。
 */
export const palette: DayPalette = {
  files: ["app-pixel.css", "sk.css"],
  colors: {
    "#140b07": "#fffaf0", // 底色、输入框
    "#1a0f0a": "#fbf3e4", // 底色的棋盘纹
    "#2a1610": "#fdf6ea", // 面板
    "#3a2015": "#f1e4cc", // 面板 2、分隔线、表情按钮
    "#4a2a1a": "#ead8b8", // 普通按钮、分隔线
    "#2e1a0e": "#fbf0d8", // 管理员区
    "#3a2c10": "#fcecc2", // 金色字的底（选中项、状态牌、终局获胜那一行）
    "#070302": "#2b1a10", // 像素描边
    "#7a4a2a": "#ffffff", // 面板亮边
    "#0d0604": "#d8c3a0", // 面板暗边
    "#9a6440": "#ffffff", // 按钮亮边
    "#1e0d07": "#c9ad84", // 按钮暗边
  },
  text: {
    "#f6ead2": "#2b1a10",
    "#c4a684": "#7a5a3a",
    "#8a6a4e": "#a88a6a", // 输入框占位字
  },
  values: {
    // 不能点的按钮：夜间是压暗，白底上压暗成了泥色，改成褪成浅灰
    "grayscale(0.6) brightness(0.7)": "grayscale(0.85) brightness(1.15)",
  },
  textShadows: {
    // 大标题的投影：夜间是黑色，白底上换成浅金色
    "calc(var(--px) * 2) calc(var(--px) * 2) 0 var(--edge)": "calc(var(--px) * 2) calc(var(--px) * 2) 0 #f0d890",
  },
  textVarColors: {
    "--gold": "#94650a",
    "--gold-2": "#94650a",
    "--ok": "#1f8a45",
    "--bad": "#c0302a",
  },
  // 牌桌保持夜间的样子：舞台下面的规则都带 .sk-stage
  keep: [".sk-stage"],
};
