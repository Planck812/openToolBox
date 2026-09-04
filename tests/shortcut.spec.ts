/// <reference types="vitest" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { createRouter, createMemoryHistory } from 'vue-router';
import App from '@/App.vue';
import HomeView from '@/views/HomeView.vue';
import ToolView from '@/views/ToolView.vue';
import SettingsView from '@/views/SettingsView.vue';
import { useAppStore } from '@/store/app';

type SyncShortcutResult = {
  success: boolean;
  requestedShortcut: string;
  registeredShortcut: string | null;
  error: string | null;
};

// ---- Tauri API Mocks ----
vi.mock('@tauri-apps/api/core', () => {
  const eventListeners: Record<string, (event: any) => void | Promise<void>> = {};
  const syncResults: Record<string, SyncShortcutResult> = {};
  const deferredSyncs: Record<string, { resolve: (r: SyncShortcutResult) => void; reject: (e?: any) => void }> = {};

  const defaultResult = (shortcut: string): SyncShortcutResult => ({
    success: true,
    requestedShortcut: shortcut,
    registeredShortcut: shortcut,
    error: null,
  });

  const api = {
    invoke: vi.fn(async (command: string, args?: Record<string, any>) => {
      if (command === 'sync_home_shortcut' || command === 'sync_show_shortcut') {
        const shortcut = String(args?.shortcut ?? '');
        const deferred = deferredSyncs[shortcut];
        if (deferred) {
          return new Promise<SyncShortcutResult>((resolve, reject) => {
            deferred.resolve = resolve;
            deferred.reject = reject;
          });
        }
        return syncResults[shortcut] ?? defaultResult(shortcut);
      }

      throw new Error(`Unexpected invoke command: ${command}`);
    }),
    __eventListeners: eventListeners,
    __setSyncResult: (shortcut: string, result: Partial<SyncShortcutResult>) => {
      syncResults[shortcut] = {
        ...defaultResult(shortcut),
        ...result,
        requestedShortcut: shortcut,
      };
    },
    __reset: () => {
      api.invoke.mockClear();
      Object.keys(eventListeners).forEach((key) => delete eventListeners[key]);
      Object.keys(syncResults).forEach((key) => delete syncResults[key]);
      Object.keys(deferredSyncs).forEach((key) => delete deferredSyncs[key]);
    },
  };

  return api;
});

vi.mock('@tauri-apps/api/event', () => {
  const listeners: Record<string, (event: any) => void | Promise<void>> = {};

  const api = {
    listen: vi.fn(async (event: string, handler: (event: any) => void | Promise<void>) => {
      listeners[event] = handler;
      return () => {
        delete listeners[event];
      };
    }),
    __listeners: listeners,
    __reset: () => {
      api.listen.mockClear();
      Object.keys(listeners).forEach((key) => delete listeners[key]);
    },
  };

  return api;
});

vi.mock('@tauri-apps/api/window', () => {
  const windowListeners: Record<string, (event: any) => void | Promise<void>> = {};
  const mockWindow = {
    show: vi.fn(async () => {}),
    unminimize: vi.fn(async () => {}),
    setFocus: vi.fn(async () => {}),
    hide: vi.fn(async () => {}),
    isMaximized: vi.fn(async () => false),
    isAlwaysOnTop: vi.fn(async () => false),
    onResized: vi.fn(async () => () => {}),
    listen: vi.fn(async (event: string, handler: (event: any) => void | Promise<void>) => {
      windowListeners[event] = handler;
      return () => {
        delete windowListeners[event];
      };
    }),
  };

  return {
    getCurrentWindow: () => mockWindow,
    __mockWindow: mockWindow,
    __windowListeners: windowListeners,
    __resetWindow: () => {
      mockWindow.show.mockClear();
      mockWindow.unminimize.mockClear();
      mockWindow.setFocus.mockClear();
      mockWindow.hide.mockClear();
      mockWindow.isMaximized.mockClear();
      mockWindow.isAlwaysOnTop.mockClear();
      mockWindow.onResized.mockClear();
      mockWindow.listen.mockClear();
      Object.keys(windowListeners).forEach((key) => delete windowListeners[key]);
    },
  };
});

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn(async () => ''),
}));

vi.mock('@tauri-apps/plugin-log', () => ({
  info: vi.fn(async () => {}),
  error: vi.fn(async () => {}),
  warn: vi.fn(async () => {}),
  debug: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(async () => {}),
  BaseDirectory: { Document: 'document' },
}));

// ---- Helpers ----
const createTestRouter = () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'home', component: HomeView },
      { path: '/tool/:id', name: 'tool', component: ToolView },
      { path: '/settings', name: 'settings', component: SettingsView },
    ],
  });
  return router;
};

const mountApp = async (startPath = '/') => {
  const pinia = createPinia();
  setActivePinia(pinia);

  const router = createTestRouter();
  router.push(startPath);
  await router.isReady();

  const wrapper = mount(App, {
    global: {
      plugins: [pinia, router],
    },
  });

  return { wrapper, router };
};

// ---- Tests ----
describe('主页全局快捷键', () => {
  let coreMod: any;
  let eventMod: any;
  let windowMod: any;

  beforeEach(async () => {
    window.localStorage.clear();
    coreMod = await import('@tauri-apps/api/core');
    coreMod.__reset();
    eventMod = await import('@tauri-apps/api/event');
    eventMod.__reset();
    windowMod = await import('@tauri-apps/api/window');
    windowMod.__resetWindow();
  });

  it('挂载时同步默认快捷键并在后端触发时跳转首页', async () => {
    const { wrapper, router } = await mountApp('/tool/demo');

    await vi.waitFor(() => {
      expect(coreMod.invoke).toHaveBeenCalledWith('sync_home_shortcut', { shortcut: 'Ctrl+Alt+Q' });
      expect(eventMod.listen).toHaveBeenCalledWith('global_shortcut_triggered', expect.any(Function));
    });

    await eventMod.__listeners.global_shortcut_triggered({
      event: 'global_shortcut_triggered',
      id: 1,
      payload: { shortcut: 'Ctrl+Alt+Q' },
    });
    await nextTick();

    expect(router.currentRoute.value.name).toBe('home');
    wrapper.unmount();
  });

  it('挂载时同步默认窗口唤起快捷键并响应快速唤起窗口的打开工具请求', async () => {
    const { wrapper, router } = await mountApp('/tool/demo');
    const store = useAppStore();

    await vi.waitFor(() => {
      expect(coreMod.invoke).toHaveBeenCalledWith('sync_show_shortcut', { shortcut: 'Alt+Space' });
      expect(eventMod.listen).toHaveBeenCalledWith('quicklaunch_open_tool', expect.any(Function));
    });

    await eventMod.__listeners.quicklaunch_open_tool({
      event: 'quicklaunch_open_tool',
      id: 5,
      payload: { toolId: 'json-viewer', input: '{"a":1}' },
    });
    await nextTick();

    // 携带的输入写入 inputContent（供工具页 initial-data），并跳转到对应工具页
    expect(store.inputContent).toBe('{"a":1}');
    expect(router.currentRoute.value.name).toBe('tool');
    expect(router.currentRoute.value.params.id).toBe('json-viewer');

    wrapper.unmount();
  });

  it('修改快捷键时会请求后端重新注册', async () => {
    const { wrapper } = await mountApp('/');
    const store = useAppStore();

    store.setHomeShortcut('Ctrl+Shift+K');
    await nextTick();

    await vi.waitFor(() => {
      expect(coreMod.invoke).toHaveBeenCalledWith('sync_home_shortcut', { shortcut: 'Ctrl+Shift+K' });
    });

    wrapper.unmount();
  });

  it('最小化/隐藏后仍可通过后端事件唤起并聚焦首页', async () => {
    const { wrapper, router } = await mountApp('/tool/demo');
    const mockWindow = windowMod.__mockWindow;

    await vi.waitFor(() => {
      expect(eventMod.listen).toHaveBeenCalledWith('global_shortcut_triggered', expect.any(Function));
    });

    mockWindow.unminimize.mockRejectedValueOnce(new Error('not minimized'));

    await eventMod.__listeners.global_shortcut_triggered({
      event: 'global_shortcut_triggered',
      id: 2,
      payload: { shortcut: 'Ctrl+Alt+Q' },
    });
    await nextTick();

    expect(mockWindow.show).toHaveBeenCalled();
    expect(mockWindow.setFocus).toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe('home');

    wrapper.unmount();
  });

  it('托盘快捷键设置事件会打开设置页而不是首页', async () => {
    const { wrapper, router } = await mountApp('/');
    const mockWindow = windowMod.__mockWindow;
    const listeners = windowMod.__windowListeners;

    await vi.waitFor(() => {
      expect(mockWindow.listen).toHaveBeenCalledWith('open_shortcut_settings', expect.any(Function));
    });

    router.push('/tool/demo');
    await router.isReady();
    await nextTick();

    await listeners.open_shortcut_settings({ event: 'open_shortcut_settings', id: 3, payload: null });
    await nextTick();

    expect(mockWindow.show).toHaveBeenCalled();
    expect(mockWindow.unminimize).toHaveBeenCalled();
    expect(mockWindow.setFocus).toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe('settings');

    wrapper.unmount();
  });

  it('托盘快捷键设置事件在 unminimize 失败时仍会打开设置页', async () => {
    const { wrapper, router } = await mountApp('/');
    const mockWindow = windowMod.__mockWindow;
    const listeners = windowMod.__windowListeners;

    await vi.waitFor(() => {
      expect(mockWindow.listen).toHaveBeenCalledWith('open_shortcut_settings', expect.any(Function));
    });

    router.push('/tool/demo');
    await router.isReady();
    await nextTick();

    mockWindow.unminimize.mockRejectedValueOnce(new Error('not minimized'));

    await listeners.open_shortcut_settings({ event: 'open_shortcut_settings', id: 4, payload: null });
    await nextTick();

    expect(mockWindow.show).toHaveBeenCalled();
    expect(mockWindow.setFocus).toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe('settings');

    wrapper.unmount();
  });

  it('快捷键变更后若后端同步失败会回滚到上一个可用快捷键', async () => {
    const { wrapper } = await mountApp('/');
    const store = useAppStore();

    await vi.waitFor(() => {
      expect(coreMod.invoke).toHaveBeenCalledWith('sync_home_shortcut', { shortcut: 'Ctrl+Alt+Q' });
    });

    coreMod.__setSyncResult('Ctrl+Alt+I', {
      success: false,
      registeredShortcut: null,
      error: 'register failed',
    });

    store.setHomeShortcut('Ctrl+Alt+I');
    await nextTick();

    await vi.waitFor(() => {
      expect(coreMod.invoke).toHaveBeenCalledWith('sync_home_shortcut', { shortcut: 'Ctrl+Alt+I' });
      expect(coreMod.invoke).toHaveBeenCalledWith('sync_home_shortcut', { shortcut: 'Ctrl+Alt+Q' });
      // 回滚后的最终状态也纳入轮询，避免断言早于 store 更新（时序脆弱）。
      expect(store.homeShortcut).toBe('Ctrl+Alt+Q');
    });

    wrapper.unmount();
  });
});
