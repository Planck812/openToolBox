/**
 * 全局 window 类型补充。
 *
 * 各精简入口（main / pin-main / sticky-main / reminder-main / timer-main）
 * 在启动时执行 `window.global = window`，作为 Node 风格 global polyfill
 * （供依赖 `typeof global !== 'undefined'` 判断的第三方代码使用）。
 */
interface Window {
  global?: Window;
}
