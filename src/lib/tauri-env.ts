import { mockIPC, mockWindows } from '@tauri-apps/api/mocks';

/**
 * 判断是否运行在真实 Tauri 桌面环境（排除纯浏览器 dev 调试模式）
 */
export const isTauriEnvironment = (): boolean => {
  if (typeof window === 'undefined') return false;
  const tauri = window as unknown as Record<string, unknown>;
  const internals = tauri.__TAURI_INTERNALS__ as Record<string, unknown> | undefined;
  if (internals?.__IS_BROWSER_MOCK__ && !(typeof process !== 'undefined' && process?.env?.VITEST)) {
    return false;
  }
  return Boolean(tauri.__TAURI_IPC__ || tauri.__TAURI_INTERNALS__ || tauri.__TAURI__);
};

// 在纯浏览器环境（如 vite dev standalone）下自动安装 mock，确保窗口/事件不报错，界面正常渲染
if (typeof window !== 'undefined') {
  const tauri = window as unknown as Record<string, unknown>;
  if (!tauri.__TAURI_IPC__ && !tauri.__TAURI_INTERNALS__) {
    mockWindows('main');
    const internals = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ as Record<string, unknown>;
    if (internals) {
      internals.__IS_BROWSER_MOCK__ = true;
    }
    mockIPC((cmd) => {
      switch (cmd) {
        case 'plugin:window|is_maximized':
        case 'plugin:window|is_minimized':
        case 'plugin:window|is_fullscreen':
        case 'plugin:window|is_always_on_top':
          return false;
        case 'plugin:window|inner_size':
        case 'plugin:window|outer_size':
          return { width: window.innerWidth, height: window.innerHeight };
        case 'plugin:window|scale_factor':
          return window.devicePixelRatio || 1;
        case 'plugin:event|listen':
          return 1;
        case 'plugin:event|unlisten':
          return null;
        case 'plugin:store|get':
        case 'plugin:store|set':
        case 'plugin:store|has':
          return null;
        case 'timer_get_alarms':
          return [
            { id: '1', label: '癌股尾盘盯盘发财 (14:50)', hour: 14, minute: 50, enabled: true, repeatDays: [1, 2, 3, 4, 5] },
            { id: '2', label: '每日早会同步', hour: 9, minute: 30, enabled: true, repeatDays: [1, 2, 3, 4, 5] },
            { id: '3', label: '下班打卡', hour: 18, minute: 30, enabled: true, repeatDays: [1, 2, 3, 4, 5] }
          ];
        case 'timer_get_countdown':
          return null;
        case 'timer_get_pomodoro':
          return {
            config: { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15, roundsBeforeLongBreak: 4 },
            state: { status: 'idle', remainingSeconds: 1500, currentRound: 1, completedPomodoros: 6 }
          };
        case 'timer_get_history':
          return [];
        case 'sedentary_get_config':
          return {
            supported: true,
            enabled: true,
            remindMinutes: 45,
            idleResetMinutes: 5,
            message: '### 💥 电脑都要被你干坏了！\n\n> 竹岳大哥一巴掌拍碎了你的屏幕：\n> **老弟，坐了 45 分钟了，快站起来活动活动腰椎！**',
            videoEnabled: true,
            videoPath: 'user-video.mp4',
            quietPeriods: [{ start: '12:00', end: '14:00' }]
          };
        case 'sedentary_get_state':
          return {
            supported: true,
            enabled: true,
            sittingSeconds: 2715,
            remindSeconds: 2700,
            quietActive: false,
            quietRemainingSeconds: 0
          };
        default:
          return null;
      }
    });
  }
}
