import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import path from "path";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// 目标平台：`tauri dev` / `tauri build` 会为 beforeDevCommand / beforeBuildCommand
// 注入 TAURI_ENV_PLATFORM（windows / darwin / linux …），供按平台条件编译前端。
// 纯浏览器 `npm run dev` 下该变量缺失，回退到宿主机平台。
// @ts-expect-error process is a nodejs global
const targetPlatform: string = process.env.TAURI_ENV_PLATFORM ?? process.platform;
const isWindowsTarget = targetPlatform === "windows" || targetPlatform === "win32";
const isMacTarget = targetPlatform === "darwin" || targetPlatform === "macos";

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    vue(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },

  // 编译期平台常量：让仅适用于特定平台的工具能被整体 tree-shake 掉，
  // 而不是打包进产物后在运行时才发现不可用。
  define: {
    __IS_WINDOWS__: JSON.stringify(isWindowsTarget),
    __IS_MACOS__: JSON.stringify(isMacTarget),
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  build: {
    // 多入口：主应用 + 贴图/便利贴/久坐提醒/计时弹窗精简入口。
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        pin: path.resolve(__dirname, "pin.html"),
        sticky: path.resolve(__dirname, "sticky.html"),
        reminder: path.resolve(__dirname, "reminder.html"),
        timer: path.resolve(__dirname, "timer.html"),
      },
    },
    // 允许按需加载的 JSON 编辑器块保持较大体积，避免对已拆离主入口的懒加载块继续报噪音告警。
    chunkSizeWarningLimit: 1400,
  },
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: false,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
