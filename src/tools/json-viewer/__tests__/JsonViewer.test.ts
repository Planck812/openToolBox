import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import JsonViewer from '../JsonViewer.vue';
import { useAppStore } from '@/store/app';

vi.mock('vue3-ts-jsoneditor', () => ({
  default: {
    name: 'JsonEditor',
    props: ['json', 'text', 'mode', 'darkTheme', 'readOnly', 'onRenderMenu'],
    template: '<div data-testid="json-editor-stub"></div>',
  },
}));

describe('JsonViewer', () => {
  let wrapper: any;
  let pinia: ReturnType<typeof createPinia>;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    pinia = createPinia();
    setActivePinia(pinia);
  });

  describe('JSON 解析功能', () => {
    it('应该正确解析有效的 JSON 字符串', async () => {
      const validJson = '{"name": "test", "value": 123}';
      wrapper = mount(JsonViewer, {
        global: {
          plugins: [pinia],
        },
        props: {
          initialData: validJson
        }
      });
      
      expect(wrapper.vm.jsonData).toEqual(JSON.parse(validJson));
      expect(wrapper.vm.error).toBe('');
    });

    it('应该处理无效的 JSON 字符串', async () => {
      const invalidJson = '{"name": "test", "value": 123,}';
      wrapper = mount(JsonViewer, {
        global: {
          plugins: [pinia],
        },
        props: {
          initialData: invalidJson
        }
      });
      
      expect(wrapper.vm.error).not.toBe('');
    });
  });

  describe('复制功能', () => {
    it('应该能够复制压缩后的 JSON', async () => {
      const validJson = '{\n  "name": "test"\n}';
      wrapper = mount(JsonViewer, {
        global: {
          plugins: [pinia],
        },
        props: {
          initialData: validJson
        }
      });
      
      await wrapper.vm.copyMinified();
      // 这里可以进一步检查 clipboard 模拟
    });
  });

  describe('主题联动', () => {
    it('深色模式时应给编辑器传入 darkTheme', async () => {
      const store = useAppStore();
      store.setThemeMode('dark');

      wrapper = mount(JsonViewer, {
        global: {
          plugins: [pinia],
        },
      });

      const editor = wrapper.getComponent({ name: 'JsonEditor' });
      expect(editor.props('darkTheme')).toBe(true);
    });

    it('浅色模式时应关闭编辑器 darkTheme', async () => {
      const store = useAppStore();
      store.setThemeMode('light');

      wrapper = mount(JsonViewer, {
        global: {
          plugins: [pinia],
        },
      });

      const editor = wrapper.getComponent({ name: 'JsonEditor' });
      expect(editor.props('darkTheme')).toBe(false);
    });
  });
});
