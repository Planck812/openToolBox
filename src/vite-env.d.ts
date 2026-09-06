/// <reference types="vite/client" />

/**
 * 构建目标是否为 Windows。由 vite.config.ts 的 `define` 在编译期替换为字面量，
 * 使仅 Windows 可用的工具在其他平台的产物中被完整 tree-shake 掉。
 */
declare const __IS_WINDOWS__: boolean;

declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<{}, {}, any>;
  export default component;
}
