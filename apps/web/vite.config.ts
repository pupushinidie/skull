import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { dayTheme } from "./day-theme";
import { palette } from "./day-palette";
import { gmPreload } from "./gm-preload-plugin";

// 端口从环境变量读：WEB_PORT（网页，默认 5191）、SERVER_PORT（服务器，默认 3018）。
// 另起一套服务（人机、界面用特殊环境变量测试）时改这两个，代理目标跟着变。
const webPort = Number(process.env.WEB_PORT ?? 5191);
const serverTarget = `http://localhost:${process.env.SERVER_PORT ?? 3018}`;

export default defineConfig({
  // 部署在子路径时用 BASE_PATH 指定，例如 BASE_PATH=/skull/ npm run build。
  base: process.env.BASE_PATH ?? "/",
  plugins: [react(), dayTheme(palette), gmPreload()],
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      "/socket.io": { target: serverTarget, ws: true },
      "/health": serverTarget
    }
  }
});
