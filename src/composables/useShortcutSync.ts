import { onMounted, onUnmounted, watch } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useRouter, useRoute } from 'vue-router';
import { storeToRefs } from 'pinia';
import { useAppStore } from '@/store/app';
import { useI18n } from 'vue-i18n';
import { logToFile } from '@/lib/logger';
import { useWindowControls } from '@/composables/useWindowControls';
import {
  getShortcutDebugState,
  initShortcutDiagnostics,
  resetShortcutRegistrationState,
  syncHomeShortcut,
  syncPinRecoveryShortcut,
  syncPipelineShortcuts,
  syncShortcutDebugState,
  syncShowShortcut,
  syncSingleStickyShortcut,
  syncStickyShortcut,
  syncToolShortcuts,
  syncUniversalScreenshotShortcut,
  type HomeShortcutTriggeredPayload,
} from '@/lib/shortcut-sync-api';

export type ShortcutSyncNavigation = {
  openHomeView: () => Promise<void>;
  openToolView: (id: string) => Promise<void>;
  openTextPipeline: (target: string, input?: string) => Promise<void>;
  openSettingsView: (section?: string) => Promise<void>;
  runPipelineInBackground: (target: string, input?: string) => Promise<void>;
};

/**
 * 全部快捷键同步 + watch / listen 自管理（拆分自 App.vue）。
 * - watch / listen 在 composable 内部 onMounted 注册、onUnmounted 清理，与 App.vue 原有顺序一致。
 * - quicklaunch 窗口下整个 composable 为 no-op（不注册任何 watch/listen）。
 */
export function useShortcutSync(deps: { navigation: ShortcutSyncNavigation }) {
  const store = useAppStore();
  const { t } = useI18n();
  const router = useRouter();
  const route = useRoute();
  const { homeShortcut, showShortcut, universalScreenshotShortcut } = storeToRefs(store);
  const { refreshWindowMaximizedState, refreshWindowAlwaysOnTopState, isTauriRuntime, getTauriWindow } = useWindowControls();
  const navigation = deps.navigation;

  // 回滚/恢复中的标记：快捷键 watch 在恢复动作期间跳过重复注册，避免回滚与用户输入竞态。
  let isRestoringHomeShortcut = false;
  let isRestoringShowShortcut = false;

  const isQuickLaunchWindow = getTauriWindow()?.label === 'quicklaunch';

  let unlistenScrollFinished: null | (() => void) = null;
  let unlistenOpenShortcutSettings: null | (() => void) = null;
  let unlistenShowDiagnostics: null | (() => void) = null;
  let unlistenHomeShortcutTriggered: null | (() => void) = null;
  let unlistenQuickLaunchOpenTool: null | (() => void) = null;
  let unlistenQuickLaunchOpenHome: null | (() => void) = null;
  let unlistenQuickLaunchOpenPipeline: null | (() => void) = null;
  let unlistenQuickLaunchRunPipeline: null | (() => void) = null;
  let unlistenWindowResized: null | (() => void) = null;
  let unlistenToolShortcutTriggered: null | (() => void) = null;
  let unlistenPipelineShortcutTriggered: null | (() => void) = null;
  let stopWatchHomeShortcut: null | (() => void) = null;
  let stopWatchShowShortcut: null | (() => void) = null;
  let stopWatchToolShortcuts: null | (() => void) = null;
  let stopWatchPipelineShortcuts: null | (() => void) = null;
  // onMounted 中 await 之后创建的 watch 不再自动绑定组件 scope，需手动保存 stop 句柄并在 onUnmounted 释放。
  let stopWatchUniversalScreenshotShortcut: null | (() => void) = null;
  let stopWatchStickyShortcut: null | (() => void) = null;
  let stopWatchSingleStickyShortcut: null | (() => void) = null;
  let stopWatchPinRecoveryShortcut: null | (() => void) = null;
  // 防抖同步定时器：同样在 onUnmounted 清理。
  let toolShortcutsTimer: number | null = null;
  let pipelineShortcutsTimer: number | null = null;

  /**
   * 快捷键注册失败时的统一回滚：尝试恢复上一个可用快捷键，失败则提示更换组合键。
   * 四个快捷键 watch 的回滚逻辑都收敛到这里。
   */
  const handleShortcutSyncFailure = async (
    value: string,
    oldValue: string | undefined,
    sync: (v: string) => Promise<boolean>,
    setter: (v: string) => void,
    label: string,
    markRestoring?: () => void,
  ): Promise<void> => {
    const fallback = oldValue?.trim();
    if (fallback && fallback !== value.trim()) {
      await logToFile('warn', t('app.shortcut_rollback_log', { label, fallback }));

      const fallbackRegistered = await sync(fallback);
      if (fallbackRegistered) {
        markRestoring?.();
        setter(fallback);
        store.showToast(t('app.shortcut_register_failed_rollback', { label, value, fallback }), {
          type: 'error',
          durationMs: 4000,
        });
        return;
      }

      await logToFile('error', t('app.shortcut_rollback_failed_log', { label, fallback }));
    }

    store.showToast(t('app.shortcut_register_failed_change', { label, value }), {
      type: 'error',
      durationMs: 4000,
    });
  };

  onMounted(async () => {
    // 快速唤起窗口或纯浏览器预览环境：跳过主窗口全部初始化（快捷键同步/事件注册等）
    if (isQuickLaunchWindow || !isTauriRuntime()) {
      return;
    }

    await refreshWindowMaximizedState();
    await refreshWindowAlwaysOnTopState();

    // 初始化诊断状态（模块级，不暴露到 window）。
    initShortcutDiagnostics({
      isTauri: isTauriRuntime(),
      homeShortcut: homeShortcut.value,
      showShortcut: showShortcut.value,
    });

    await logToFile('info', '=== Open Toolbox Shortcut Debug ===');
    const diagnostics = getShortcutDebugState();
    await logToFile('info', 'Tauri Environment:', diagnostics.isTauri);
    await logToFile('info', 'Home Shortcut Setting:', diagnostics.homeShortcut);
    await logToFile('info', 'Show Shortcut Setting:', diagnostics.showShortcut);
    await logToFile('info', 'Registered Shortcut:', diagnostics.registeredShortcut);
    await logToFile('info', 'Registered Show Shortcut:', diagnostics.registeredShowShortcut);
    await logToFile('info', 'Last Registration Error:', diagnostics.lastError);
    await logToFile('info', 'Last Show Registration Error:', diagnostics.lastShowError);
    await logToFile('info', 'Last Screenshot Registration Error:', diagnostics.lastScreenshotError);

    // 全局监听滚动截图完成（无论主窗口在哪个路由），导航到截图工具页展示预览。
    try {
      unlistenScrollFinished = await listen<{ previewToken: string }>(
        'scroll_capture_finished',
        (event) => {
          store.pendingScrollPreviewToken = event.payload.previewToken;
          if (route.name !== 'tool' || (route.params.id as string) !== 'screenshot-universal') {
            void router.push('/tool/screenshot-universal');
          }
        },
      );
    } catch (e) {
      console.warn('Failed to register scroll capture listener:', e);
    }

    try {
      const appWindow = getTauriWindow();
      if (appWindow) {
        unlistenWindowResized = await appWindow.onResized(() => {
          refreshWindowMaximizedState();
          refreshWindowAlwaysOnTopState();
        });
      }
    } catch (e) {
      console.warn('Failed to register window resize listener:', e);
    }

    await syncHomeShortcut(homeShortcut.value);
    await syncShowShortcut(showShortcut.value);
    const universalSynced = await syncUniversalScreenshotShortcut(universalScreenshotShortcut.value);
    if (!universalSynced) {
      store.showToast(t('common.screenshot_shortcut_mount_failed'), {
        type: 'error',
        durationMs: 4000,
      });
    }
    const stickySynced = await syncStickyShortcut(store.stickyShortcut);
    if (!stickySynced) {
      store.showToast(t('common.sticky_shortcut_mount_failed'), {
        type: 'error',
        durationMs: 4000,
      });
    }
    const singleStickySynced = await syncSingleStickyShortcut(store.singleStickyShortcut);
    if (!singleStickySynced) {
      store.showToast(t('common.single_sticky_shortcut_mount_failed'), {
        type: 'error',
        durationMs: 4000,
      });
    }
    const pinRecoverySynced = await syncPinRecoveryShortcut(store.pinRecoveryShortcut);
    if (!pinRecoverySynced) {
      store.showToast(t('common.pin_recovery_shortcut_mount_failed'), {
        type: 'error',
        durationMs: 4000,
      });
    }

    try {
      unlistenHomeShortcutTriggered = await listen<HomeShortcutTriggeredPayload>('global_shortcut_triggered', async (event) => {
        await logToFile('info', 'Global shortcut triggered from backend', event.payload);
        syncShortcutDebugState({
          lastTriggeredAt: event.payload?.triggeredAt ?? null,
        });
        await navigation.openHomeView();
      });
      await logToFile('info', 'Registered backend shortcut event listener');
    } catch (e) {
      await logToFile('error', 'Failed to register backend shortcut event listener', e);
    }

    // 监听快速唤起小窗的打开请求：选中工具 / 完整首页后通知主窗口。
    try {
      unlistenQuickLaunchOpenTool = await listen<{ toolId: string; input?: string }>('quicklaunch_open_tool', async (event) => {
        await logToFile('info', 'Quick launch open tool', event.payload);
        if (event.payload?.toolId) {
          if (event.payload.input) store.inputContent = event.payload.input;
          await navigation.openToolView(event.payload.toolId);
        }
      });
      unlistenQuickLaunchOpenHome = await listen('quicklaunch_open_home', async () => {
        await logToFile('info', 'Quick launch open home');
        await navigation.openHomeView();
      });
      unlistenQuickLaunchOpenPipeline = await listen<{ target: string; input?: string }>('quicklaunch_open_pipeline', async (event) => {
        await logToFile('info', 'Quick launch open pipeline', event.payload);
        if (event.payload?.target) {
          await navigation.openTextPipeline(event.payload.target, event.payload.input);
        }
      });
      unlistenQuickLaunchRunPipeline = await listen<{ target: string; input?: string }>('quicklaunch_run_pipeline', async (event) => {
        await logToFile('info', 'Quick launch run pipeline (background)', event.payload);
        if (event.payload?.target) {
          await navigation.runPipelineInBackground(event.payload.target, event.payload.input);
        }
      });
      await logToFile('info', 'Registered quick launch listeners');
    } catch (e) {
      await logToFile('error', 'Failed to register quick launch listeners', e);
    }

    // 监听工具级拉起快捷键触发
    try {
      unlistenToolShortcutTriggered = await listen<{ toolId: string }>('tool_shortcut_triggered', async (event) => {
        await logToFile('info', 'Tool shortcut triggered from backend', event.payload);
        if (event.payload?.toolId) {
          await navigation.openToolView(event.payload.toolId);
        }
      });
      await logToFile('info', 'Registered backend tool shortcut listener');
    } catch (e) {
      await logToFile('error', 'Failed to register backend tool shortcut listener', e);
    }

    // 监听文本管线拉起快捷键触发
    try {
      unlistenPipelineShortcutTriggered = await listen<{ target: string }>('pipeline_shortcut_triggered', async (event) => {
        await logToFile('info', 'Pipeline shortcut triggered from backend', event.payload);
        if (event.payload?.target) {
          await navigation.openTextPipeline(event.payload.target);
        }
      });
      await logToFile('info', 'Registered backend pipeline shortcut listener');
    } catch (e) {
      await logToFile('error', 'Failed to register backend pipeline shortcut listener', e);
    }

    // 监听来自Rust后端的快捷键设置事件
    try {
      const appWindow = getCurrentWindow();
      unlistenOpenShortcutSettings = await appWindow.listen('open_shortcut_settings', async () => {
        await navigation.openSettingsView('shortcut-home');
      });
    } catch (e) {
      console.warn('Failed to register open_shortcut_settings listener:', e);
    }

    // 监听诊断信息请求
    try {
      const appWindow = getCurrentWindow();
      unlistenShowDiagnostics = await appWindow.listen('show_diagnostics', async () => {
        const diagnostics = getShortcutDebugState();
        const hasError = diagnostics?.lastError;
        const diagLines = [
          t('app.diagnostics_title'),
          t('app.diagnostics_tauri_env', { value: diagnostics?.isTauri ? '✓' : '✗' }),
          t('app.diagnostics_shortcut_setting', { value: diagnostics?.homeShortcut || 'N/A' }),
          t('app.diagnostics_registered', { value: diagnostics?.registeredShortcut || 'N/A' }),
        ];
        if (hasError) diagLines.push(t('app.diagnostics_error', { error: hasError }));
        const message = `${diagLines.join('\n')}\n\n${t('app.diagnostics_footer')}`;
        store.showToast(message, { type: hasError ? 'error' : 'info', durationMs: 10000 });
      });
    } catch (e) {
      console.warn('Failed to register show_diagnostics listener:', e);
    }

    // 监听快捷键变更，实时重新注册
    stopWatchHomeShortcut = watch(
      () => homeShortcut.value,
      async (value, oldValue) => {
        if (isRestoringHomeShortcut) {
          await logToFile('info', `Home shortcut restore acknowledged: ${value}`);
          isRestoringHomeShortcut = false;
          syncShortcutDebugState({ homeShortcut: value });
          return;
        }

        syncShortcutDebugState({ homeShortcut: value });

        const registered = await syncHomeShortcut(value);
        if (!registered) {
          await handleShortcutSyncFailure(
            value,
            oldValue,
            syncHomeShortcut,
            (v) => store.setHomeShortcut(v),
            t('app.shortcut_label_home'),
            () => { isRestoringHomeShortcut = true; },
          );
          return;
        }

        await logToFile('info', 'Home shortcut preference updated to:', value);
      }
    );

    stopWatchShowShortcut = watch(
      () => showShortcut.value,
      async (value, oldValue) => {
        if (isRestoringShowShortcut) {
          await logToFile('info', `Show shortcut restore acknowledged: ${value}`);
          isRestoringShowShortcut = false;
          syncShortcutDebugState({ showShortcut: value });
          return;
        }

        syncShortcutDebugState({ showShortcut: value });

        const registered = await syncShowShortcut(value);
        if (!registered) {
          await handleShortcutSyncFailure(
            value,
            oldValue,
            syncShowShortcut,
            (v) => store.setShowShortcut(v),
            t('app.shortcut_label_show'),
            () => { isRestoringShowShortcut = true; },
          );
          return;
        }

        await logToFile('info', 'Show shortcut preference updated to:', value);
      }
    );

    // 监听全平台截图快捷键变更，实时重新注册
    stopWatchUniversalScreenshotShortcut = watch(
      () => universalScreenshotShortcut.value,
      async (value, oldValue) => {
        const registered = await syncUniversalScreenshotShortcut(value);
        if (!registered) {
          await handleShortcutSyncFailure(
            value,
            oldValue,
            syncUniversalScreenshotShortcut,
            (v) => store.setUniversalScreenshotShortcut(v),
            t('app.shortcut_label_screenshot'),
          );
          return;
        }

        await logToFile('info', 'Universal screenshot shortcut preference updated to:', value);
      }
    );

    // 监听便利贴快捷键变更，实时重新注册
    stopWatchStickyShortcut = watch(
      () => store.stickyShortcut,
      async (value, oldValue) => {
        const registered = await syncStickyShortcut(value);
        if (!registered) {
          await handleShortcutSyncFailure(
            value,
            oldValue,
            syncStickyShortcut,
            (v) => store.setStickyShortcut(v),
            t('app.shortcut_label_sticky'),
          );
          return;
        }
        await logToFile('info', 'Sticky shortcut preference updated to:', value);
      }
    );

    // 监听单便利贴快捷键变更，实时重新注册
    stopWatchSingleStickyShortcut = watch(
      () => store.singleStickyShortcut,
      async (value, oldValue) => {
        const registered = await syncSingleStickyShortcut(value);
        if (!registered) {
          await handleShortcutSyncFailure(
            value,
            oldValue,
            syncSingleStickyShortcut,
            (v) => store.setSingleStickyShortcut(v),
            t('app.shortcut_label_single_sticky'),
          );
          return;
        }
        await logToFile('info', 'Single sticky shortcut preference updated to:', value);
      }
    );

    // 监听恢复全部贴图交互快捷键变更，实时重新注册
    stopWatchPinRecoveryShortcut = watch(
      () => store.pinRecoveryShortcut,
      async (value, oldValue) => {
        const registered = await syncPinRecoveryShortcut(value);
        if (!registered) {
          await handleShortcutSyncFailure(
            value,
            oldValue,
            syncPinRecoveryShortcut,
            (v) => store.setPinRecoveryShortcut(v),
            t('app.shortcut_label_pin_recovery'),
          );
          return;
        }
        await logToFile('info', 'Pin recovery shortcut preference updated to:', value);
      }
    );

    // 监听工具级拉起快捷键映射变更，防抖同步到后端；冲突/失败时回滚并提示。
    let toolShortcutsSnapshot: Record<string, string> = JSON.parse(JSON.stringify(store.toolShortcuts));
    stopWatchToolShortcuts = watch(
      () => store.toolShortcuts,
      async (value) => {
        if (toolShortcutsTimer) window.clearTimeout(toolShortcutsTimer);
        toolShortcutsTimer = window.setTimeout(async () => {
          toolShortcutsTimer = null;
          if (JSON.stringify(value) === JSON.stringify(toolShortcutsSnapshot)) return;
          const res = await syncToolShortcuts(JSON.parse(JSON.stringify(value)));
          if (res.success) {
            toolShortcutsSnapshot = JSON.parse(JSON.stringify(value));
            await logToFile('info', 'Tool shortcuts synced to backend');
            return;
          }
          const reason = Object.values(res.errors ?? {})[0] || res.error || 'unknown';
          store.showToast(t('common.tool_shortcuts_sync_failed', { reason }), {
            type: 'error',
            durationMs: 4000,
          });
          try {
            localStorage.setItem('settings.toolShortcuts', JSON.stringify(toolShortcutsSnapshot));
          } catch {}
          store.toolShortcuts = JSON.parse(JSON.stringify(toolShortcutsSnapshot));
          toolShortcutsSnapshot = JSON.parse(JSON.stringify(store.toolShortcuts));
        }, 150);
      },
      { deep: true }
    );

    // 挂载时初次同步一次：恢复持久化配置，并兜底全量重建后工具注册的补回。
    toolShortcutsSnapshot = JSON.parse(JSON.stringify(store.toolShortcuts));
    await syncToolShortcuts(toolShortcutsSnapshot);

    // 监听文本管线快捷键映射变更，防抖同步到后端；冲突/失败时回滚并提示。
    let pipelineShortcutsSnapshot: Record<string, string> = JSON.parse(JSON.stringify(store.pipelineShortcuts));
    stopWatchPipelineShortcuts = watch(
      () => store.pipelineShortcuts,
      async (value) => {
        if (pipelineShortcutsTimer) window.clearTimeout(pipelineShortcutsTimer);
        pipelineShortcutsTimer = window.setTimeout(async () => {
          pipelineShortcutsTimer = null;
          if (JSON.stringify(value) === JSON.stringify(pipelineShortcutsSnapshot)) return;
          const res = await syncPipelineShortcuts(JSON.parse(JSON.stringify(value)));
          if (res.success) {
            pipelineShortcutsSnapshot = JSON.parse(JSON.stringify(value));
            await logToFile('info', 'Pipeline shortcuts synced to backend');
            return;
          }
          const reason = Object.values(res.errors ?? {})[0] || res.error || 'unknown';
          store.showToast(t('common.pipeline_shortcuts_sync_failed', { reason }), {
            type: 'error',
            durationMs: 4000,
          });
          try {
            localStorage.setItem('settings.pipelineShortcuts', JSON.stringify(pipelineShortcutsSnapshot));
          } catch {}
          store.pipelineShortcuts = JSON.parse(JSON.stringify(pipelineShortcutsSnapshot));
          pipelineShortcutsSnapshot = JSON.parse(JSON.stringify(store.pipelineShortcuts));
        }, 150);
      },
      { deep: true }
    );
    pipelineShortcutsSnapshot = JSON.parse(JSON.stringify(store.pipelineShortcuts));
    await syncPipelineShortcuts(pipelineShortcutsSnapshot);
  });

  onUnmounted(() => {
    if (isQuickLaunchWindow) {
      return;
    }

    resetShortcutRegistrationState();

    if (unlistenScrollFinished) {
      unlistenScrollFinished();
      unlistenScrollFinished = null;
    }

    if (unlistenOpenShortcutSettings) {
      logToFile('info', 'Removing open_shortcut_settings listener').catch(() => {});
      unlistenOpenShortcutSettings();
      unlistenOpenShortcutSettings = null;
    }

    if (unlistenShowDiagnostics) {
      logToFile('info', 'Removing show_diagnostics listener').catch(() => {});
      unlistenShowDiagnostics();
      unlistenShowDiagnostics = null;
    }

    if (unlistenHomeShortcutTriggered) {
      logToFile('info', 'Removing backend shortcut listener').catch(() => {});
      unlistenHomeShortcutTriggered();
      unlistenHomeShortcutTriggered = null;
    }

    if (unlistenQuickLaunchOpenTool) {
      logToFile('info', 'Removing quick launch open tool listener').catch(() => {});
      unlistenQuickLaunchOpenTool();
      unlistenQuickLaunchOpenTool = null;
    }

    if (unlistenQuickLaunchOpenHome) {
      logToFile('info', 'Removing quick launch open home listener').catch(() => {});
      unlistenQuickLaunchOpenHome();
      unlistenQuickLaunchOpenHome = null;
    }

    if (unlistenQuickLaunchOpenPipeline) {
      logToFile('info', 'Removing quick launch open pipeline listener').catch(() => {});
      unlistenQuickLaunchOpenPipeline();
      unlistenQuickLaunchOpenPipeline = null;
    }

    if (unlistenQuickLaunchRunPipeline) {
      logToFile('info', 'Removing quick launch run pipeline listener').catch(() => {});
      unlistenQuickLaunchRunPipeline();
      unlistenQuickLaunchRunPipeline = null;
    }

    if (unlistenWindowResized) {
      logToFile('info', 'Removing window resize listener').catch(() => {});
      unlistenWindowResized();
      unlistenWindowResized = null;
    }

    if (unlistenToolShortcutTriggered) {
      logToFile('info', 'Removing tool shortcut listener').catch(() => {});
      unlistenToolShortcutTriggered();
      unlistenToolShortcutTriggered = null;
    }

    if (unlistenPipelineShortcutTriggered) {
      logToFile('info', 'Removing pipeline shortcut listener').catch(() => {});
      unlistenPipelineShortcutTriggered();
      unlistenPipelineShortcutTriggered = null;
    }

    if (stopWatchHomeShortcut) {
      logToFile('info', 'Stopping home shortcut watcher').catch(() => {});
      stopWatchHomeShortcut();
      stopWatchHomeShortcut = null;
    }

    if (stopWatchShowShortcut) {
      logToFile('info', 'Stopping show shortcut watcher').catch(() => {});
      stopWatchShowShortcut();
      stopWatchShowShortcut = null;
    }

    if (stopWatchToolShortcuts) {
      logToFile('info', 'Stopping tool shortcuts watcher').catch(() => {});
      stopWatchToolShortcuts();
      stopWatchToolShortcuts = null;
    }

    if (stopWatchPipelineShortcuts) {
      logToFile('info', 'Stopping pipeline shortcuts watcher').catch(() => {});
      stopWatchPipelineShortcuts();
      stopWatchPipelineShortcuts = null;
    }

    if (stopWatchUniversalScreenshotShortcut) {
      logToFile('info', 'Stopping universal screenshot shortcut watcher').catch(() => {});
      stopWatchUniversalScreenshotShortcut();
      stopWatchUniversalScreenshotShortcut = null;
    }

    if (stopWatchStickyShortcut) {
      logToFile('info', 'Stopping sticky shortcut watcher').catch(() => {});
      stopWatchStickyShortcut();
      stopWatchStickyShortcut = null;
    }

    if (stopWatchSingleStickyShortcut) {
      logToFile('info', 'Stopping single sticky shortcut watcher').catch(() => {});
      stopWatchSingleStickyShortcut();
      stopWatchSingleStickyShortcut = null;
    }

    if (stopWatchPinRecoveryShortcut) {
      logToFile('info', 'Stopping pin recovery shortcut watcher').catch(() => {});
      stopWatchPinRecoveryShortcut();
      stopWatchPinRecoveryShortcut = null;
    }

    if (toolShortcutsTimer) {
      window.clearTimeout(toolShortcutsTimer);
      toolShortcutsTimer = null;
    }

    if (pipelineShortcutsTimer) {
      window.clearTimeout(pipelineShortcutsTimer);
      pipelineShortcutsTimer = null;
    }
  });
}
