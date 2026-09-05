import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import QuickLaunchRoot from '@/components/QuickLaunchRoot.vue';
import { useAppStore } from '@/store/app';

const { emitToMock, hideMock, readTextMock } = vi.hoisted(() => ({
  emitToMock: vi.fn(),
  hideMock: vi.fn(),
  readTextMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: (...args: unknown[]) => Promise.resolve(emitToMock(...args)),
  listen: () => Promise.resolve(() => {}),
}));
vi.mock('@tauri-apps/plugin-log', () => ({
  info: () => Promise.resolve(),
  error: () => Promise.resolve(),
  warn: () => Promise.resolve(),
  debug: () => Promise.resolve(),
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: 'quicklaunch', hide: hideMock }),
}));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: () => readTextMock(),
}));

describe('QuickLaunchRoot', () => {
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    emitToMock.mockReset();
    hideMock.mockReset();
    readTextMock.mockReset();
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
  });

  const mountRoot = async () => {
    const wrapper = mount(QuickLaunchRoot, {
      global: {
        plugins: [pinia],
      },
    });
    await flushPromises();
    return wrapper;
  };

  it('打开时读取剪贴板填充搜索词并渲染推荐 + 打开首页入口', async () => {
    readTextMock.mockResolvedValue('{"a":1}');
    const store = useAppStore();
    const wrapper = await mountRoot();

    expect((wrapper.find('input').element as HTMLInputElement).value).toBe('{"a":1}');
    // 推荐工具（json 内容 → json-viewer 强命中）
    expect(wrapper.findAll('.ql-recommended-list .ql-item').length).toBeGreaterThan(0);
    // 固定「打开首页」入口
    expect(wrapper.find('.ql-home-item').exists()).toBe(true);
  });

  it('推荐工具最多 4 个', async () => {
    readTextMock.mockResolvedValue('json');
    const wrapper = await mountRoot();
    expect(wrapper.findAll('.ql-recommended-list .ql-item').length).toBeLessThanOrEqual(4);
  });

  it('点击推荐工具：emitTo main 携带 toolId 与输入并隐藏窗口', async () => {
    readTextMock.mockResolvedValue('{"a":1}');
    const wrapper = await mountRoot();

    await wrapper.find('.ql-recommended-list .ql-item').trigger('click');
    expect(emitToMock).toHaveBeenCalledWith('main', 'quicklaunch_open_tool', {
      toolId: 'json-viewer',
      input: '{"a":1}',
    });
    expect(hideMock).toHaveBeenCalled();
  });

  it('点击打开首页：emitTo main 并隐藏窗口', async () => {
    readTextMock.mockResolvedValue('hello');
    const wrapper = await mountRoot();

    await wrapper.find('.ql-home-item').trigger('click');
    expect(emitToMock).toHaveBeenCalledWith('main', 'quicklaunch_open_home');
    expect(hideMock).toHaveBeenCalled();
  });

  it('按 Esc 隐藏窗口', async () => {
    readTextMock.mockResolvedValue('hello');
    const wrapper = await mountRoot();

    await wrapper.find('input').trigger('keydown', { key: 'Escape' });
    expect(hideMock).toHaveBeenCalled();
  });

  it('有已存管线时渲染管线区，点击通知主窗口打开该管线', async () => {
    localStorage.setItem(
      'open-toolbox:text-processor:pipelines',
      JSON.stringify([{ name: 'T1', steps: [{ id: 's1', op: 'upper' }], updatedAt: 1 }])
    );
    readTextMock.mockResolvedValue('hello');
    const wrapper = await mountRoot();

    expect(wrapper.text()).toContain('common.quick_launch_pipelines_title');
    const pipelineBtn = wrapper.findAll('.ql-pipeline-list .ql-item').find((b) => b.text() === 'T1');
    expect(pipelineBtn).toBeDefined();

    await pipelineBtn!.trigger('click');
    expect(emitToMock).toHaveBeenCalledWith('main', 'quicklaunch_run_pipeline', {
      target: 'T1',
      input: 'hello',
    });
    expect(hideMock).toHaveBeenCalled();
  });

  it('没有已存管线时不渲染管线区', async () => {
    localStorage.setItem('open-toolbox:text-processor:pipelines', '[]');
    readTextMock.mockResolvedValue('hello');
    const wrapper = await mountRoot();

    expect(wrapper.text()).not.toContain('common.quick_launch_pipelines_title');
  });
});
