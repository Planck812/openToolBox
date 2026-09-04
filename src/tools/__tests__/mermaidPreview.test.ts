import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia } from 'pinia';
import { nextTick } from 'vue';
import { getToolById } from '@/tools/registry';
import MermaidPreview from '@/tools/mermaid-preview/MermaidPreview.vue';
import { DEFAULT_MERMAID_SOURCE } from '@/tools/mermaid-preview/default-source';

const panZoomMocks = vi.hoisted(() => {
  const fit = vi.fn();
  const center = vi.fn();
  const zoomIn = vi.fn();
  const zoomOut = vi.fn();
  const resetZoom = vi.fn();
  const resize = vi.fn();
  const destroy = vi.fn();
  const svgPanZoomMock = vi.fn(() => ({
    fit,
    center,
    zoomIn,
    zoomOut,
    resetZoom,
    resize,
    destroy,
  }));

  return { fit, center, zoomIn, zoomOut, resetZoom, resize, destroy, svgPanZoomMock };
});

const defaultMermaidRender = async (_id: string, source: string) => ({
  svg: `<svg viewBox="0 0 100 100" data-source="${source.length}"></svg>`,
});

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

const resizeObserverMocks = vi.hoisted(() => {
  const observe = vi.fn();
  const disconnect = vi.fn();
  let callback = null as null | ResizeObserverCallback;

  class ResizeObserverMock {
    constructor(cb: ResizeObserverCallback) {
      callback = cb;
    }

    observe = observe;
    disconnect = disconnect;
  }

  return {
    observe,
    disconnect,
    ResizeObserverMock,
    trigger(entries: Partial<ResizeObserverEntry>[] = []) {
      callback?.(entries as ResizeObserverEntry[], {} as ResizeObserver);
    },
  };
});

vi.mock('mermaid', () => ({
  default: {
    initialize: mermaidMocks.initialize,
    render: mermaidMocks.render,
  },
}));

vi.mock('svg-pan-zoom', () => ({
  default: panZoomMocks.svgPanZoomMock,
}));

vi.stubGlobal('ResizeObserver', resizeObserverMocks.ResizeObserverMock);

beforeEach(() => {
  mermaidMocks.render.mockReset();
  mermaidMocks.render.mockImplementation(defaultMermaidRender);
});

afterEach(() => {
  document.body.querySelectorAll('[data-leaked-mermaid-error="true"]').forEach((node) => node.remove());
});

describe('Mermaid 工具接入', () => {
  it('注册表中应包含 mermaid 预览工具', () => {
    const tool = getToolById('mermaid-preview');

    expect(tool).toBeTruthy();
    expect(tool?.metadata.name).toBe('tools.mermaid_preview.name');
  });

  it('无初始内容时应回落到默认示例代码', () => {
    const wrapper = mount(MermaidPreview, {
      props: {
        initialData: '',
      },
      global: {
        plugins: [createPinia()],
      },
    });

    const textarea = wrapper.get('textarea');
    expect((textarea.element as HTMLTextAreaElement).value).toBe(DEFAULT_MERMAID_SOURCE);
  });

  it('有初始内容时应优先使用传入代码', () => {
    const source = 'graph TD\nA[开始] --> B[结束]';
    const wrapper = mount(MermaidPreview, {
      props: {
        initialData: source,
      },
      global: {
        plugins: [createPinia()],
      },
    });

    const textarea = wrapper.get('textarea');
    expect((textarea.element as HTMLTextAreaElement).value).toBe(source);
  });

  it('桌面端应使用 30/70 布局并展示缩放按钮', async () => {
    const wrapper = mount(MermaidPreview, {
      attachTo: document.body,
      props: {
        initialData: 'graph TD\nA --> B',
      },
      global: {
        plugins: [createPinia()],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 220));
    await nextTick();

    // 桌面端 30/70 布局由外层 grid 类实现（minmax(320px,var(--panel-first-width,30%)) 1fr）。
    const container = wrapper
      .findAll('div')
      .find((el) => (el.classes() as string[]).some((c) => c.startsWith('lg:grid-cols-[')));
    expect(container).toBeDefined();
    expect(wrapper.findAll('section').length).toBe(2);
    expect(wrapper.text()).toContain('tools.mermaid_preview.zoom_in');
    expect(wrapper.text()).toContain('tools.mermaid_preview.zoom_out');
    expect(wrapper.text()).toContain('tools.mermaid_preview.reset_view');

    wrapper.unmount();
  });

  it('渲染成功后应初始化 svg 缩放实例', async () => {
    const wrapper = mount(MermaidPreview, {
      attachTo: document.body,
      props: {
        initialData: 'graph TD\nA --> B',
      },
      global: {
        plugins: [createPinia()],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 220));
    await nextTick();

    expect(panZoomMocks.svgPanZoomMock).toHaveBeenCalled();
    expect(panZoomMocks.fit).toHaveBeenCalled();
    expect(panZoomMocks.center).toHaveBeenCalled();

    wrapper.unmount();
  });

  it('初始化前应按预览容器尺寸接管 svg 宽高限制', async () => {
    const wrapper = mount(MermaidPreview, {
      attachTo: document.body,
      props: {
        initialData: 'graph TD\nA --> B',
      },
      global: {
        plugins: [createPinia()],
      },
    });

    const previewFrame = wrapper.findAll('div').find((node) =>
      node.attributes('class')?.includes('rounded-[28px]')
    );

    expect(previewFrame).toBeTruthy();

    Object.defineProperty(previewFrame!.element, 'clientWidth', {
      configurable: true,
      value: 900,
    });
    Object.defineProperty(previewFrame!.element, 'clientHeight', {
      configurable: true,
      value: 600,
    });

    await new Promise((resolve) => setTimeout(resolve, 220));
    await nextTick();

    const svg = wrapper.find('.mermaid-diagram svg');
    expect(svg.attributes('width')).toBeUndefined();
    expect((svg.element as SVGElement).style.width).toBe('900px');
    expect((svg.element as SVGElement).style.height).toBe('600px');
    expect((svg.element as SVGElement).style.maxWidth).toBe('none');

    wrapper.unmount();
  });

  it('预览容器尺寸变化后应重新触发 fit 与 center', async () => {
    const wrapper = mount(MermaidPreview, {
      attachTo: document.body,
      props: {
        initialData: 'graph TD\nA --> B',
      },
      global: {
        plugins: [createPinia()],
      },
    });

    const previewFrame = wrapper.findAll('div').find((node) =>
      node.attributes('class')?.includes('rounded-[28px]')
    );
    expect(previewFrame).toBeTruthy();

    Object.defineProperty(previewFrame!.element, 'clientWidth', {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(previewFrame!.element, 'clientHeight', {
      configurable: true,
      value: 700,
    });

    await new Promise((resolve) => setTimeout(resolve, 220));
    await nextTick();

    panZoomMocks.fit.mockClear();
    panZoomMocks.center.mockClear();
    panZoomMocks.resize.mockClear();

    resizeObserverMocks.trigger([{ target: previewFrame!.element }]);
    await nextTick();

    expect(panZoomMocks.resize).toHaveBeenCalled();
    expect(panZoomMocks.fit).toHaveBeenCalled();
    expect(panZoomMocks.center).toHaveBeenCalled();

    wrapper.unmount();
  });

  it('渲染失败时应启用 Mermaid 错误抑制并展示错误提示', async () => {
    mermaidMocks.render.mockRejectedValueOnce(new Error('mock mermaid parse error'));

    const wrapper = mount(MermaidPreview, {
      attachTo: document.body,
      props: {
        initialData: 'random invalid content',
      },
      global: {
        plugins: [createPinia()],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 220));
    await nextTick();

    expect(mermaidMocks.initialize).toHaveBeenCalledWith(expect.objectContaining({
      suppressErrorRendering: true,
    }));
    expect(wrapper.text()).toContain('tools.mermaid_preview.render_failed');

    wrapper.unmount();
  });

  it('渲染时不应把受 Vue 管理的预览容器直接交给 Mermaid', async () => {
    const wrapper = mount(MermaidPreview, {
      attachTo: document.body,
      props: {
        initialData: 'flowchart TB\nA-->B',
      },
      global: {
        plugins: [createPinia()],
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 220));
    await nextTick();

    expect(mermaidMocks.render).toHaveBeenCalledTimes(1);
    expect(mermaidMocks.render.mock.calls[0]).toEqual([
      expect.any(String),
      'flowchart TB\nA-->B',
    ]);

    wrapper.unmount();
  });
});
