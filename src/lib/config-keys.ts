/**
 * 应用配置的 localStorage key 常量。
 * 所有应用配置读写统一经 src/lib/config.ts 的 safe 函数 + 本文件 key，
 * 避免在 store / 组件里散落裸 localStorage 访问与 magic string。
 * 主题相关 key（themeMode / themeSkinId）定义在 src/lib/theme.ts，不重复。
 */
export const CONFIG_KEYS = {
  appBackgroundImage: 'settings.appBackgroundImage',
  appBackgroundMode: 'settings.appBackgroundMode',
  homeMotionEnabled: 'settings.homeMotionEnabled',
  homeShortcut: 'settings.homeShortcut',
  /** 旧「主页唤起」迁移标记（Alt+Space → Ctrl+Alt+Q 角色交换时写入）。 */
  homeShortcutMigratedAltSpace: 'settings.homeShortcut.migrated.altSpace',
  /** 快捷键角色迁移标记（Ctrl+Alt+Q 与 Alt+Space 职责互换）。 */
  shortcutRoleMigrated: 'settings.shortcuts.migrated.ctrlAltQHome',
  showShortcut: 'settings.showShortcut',
  universalScreenshotShortcut: 'settings.universalScreenshotShortcut',
  stickyShortcut: 'settings.stickyShortcut',
  singleStickyShortcut: 'settings.singleStickyShortcut',
  pinRecoveryShortcut: 'settings.pinRecoveryShortcut',
  toolShortcuts: 'settings.toolShortcuts',
  pipelineShortcuts: 'settings.pipelineShortcuts',
  favoriteToolIds: 'home.favoriteToolIds',
  recentToolIds: 'home.recentToolIds',
  homeToolOrderIds: 'home.toolOrderIds',
  strongToolIds: 'home.strongToolIds',
} as const;
