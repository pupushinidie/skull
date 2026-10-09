# 骷髅牌（Skull）

3–6 人的唬人叫价桌游，网页联机版（gulugagame.com/skull）。脚手架从欲罢不能 cantstop@2864ee0 复制，规则引擎和服务器正在流水线引擎阶段改写，完整说明稍后补上。

```bash
npm install
npm run dev          # 服务器 :3018，网页 :5191（WEB_PORT / SERVER_PORT 可改）
npm test
npm run typecheck
BASE_PATH=/skull/ npm run build
```
