import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ImageBase64Converter from '@/tools/image-base64/ImageBase64Converter.vue';

const { writeTextMock } = vi.hoisted(() => ({
  writeTextMock: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: writeTextMock,
}));

const SAMPLE_RAW_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAUAAAAFCAYAAACNbyblAAAAHElEQVQI12P4////fwYGBgYGJgYGJgYGJgYGJgYGJwAAAP//AwAOD4s4kAAAAAElFTkSuQmCC';

describe('图片/Base64 转换页面', () => {
  beforeEach(() => {
    writeTextMock.mockReset();
  });

  it('默认展示固定左右布局且不再显示中间转换按钮', () => {
    const wrapper = mount(ImageBase64Converter);
    const layout = wrapper.find('[data-testid="converter-layout"]');

    expect(layout.exists()).toBe(true);
    expect(layout.attributes('style')).toContain('grid-template-columns: minmax(360px, 1fr) minmax(360px, 1fr);');
    expect(wrapper.find('[data-testid="base64-textarea"]').exists()).toBe(true);
    expect(wrapper.findAll('button')).toHaveLength(0);
  });

  it('输入合法 data url 后会自动出现图片预览', async () => {
    const wrapper = mount(ImageBase64Converter);
    const textarea = wrapper.find('[data-testid="base64-textarea"]');

    await textarea.setValue('data:image/png;base64,YWJj');
    await flushPromises();

    const preview = wrapper.find('[data-testid="image-preview"]');
    expect(preview.exists()).toBe(true);
    expect(preview.attributes('src')).toBe('data:image/png;base64,YWJj');
  });

  it('输入裸 base64 后也会自动出现图片预览', async () => {
    const wrapper = mount(ImageBase64Converter);
    const textarea = wrapper.find('[data-testid="base64-textarea"]');

    await textarea.setValue(SAMPLE_RAW_BASE64);
    await flushPromises();

    const preview = wrapper.find('[data-testid="image-preview"]');
    expect(preview.exists()).toBe(true);
    expect(preview.attributes('src')).toContain('data:image/png;base64,');
  });

  it('输入非法内容会自动显示错误', async () => {
    const wrapper = mount(ImageBase64Converter);
    const textarea = wrapper.find('[data-testid="base64-textarea"]');

    await textarea.setValue('not-valid');
    await flushPromises();

    expect(wrapper.text()).toContain('tools.image_base64.invalid_base64');
  });

  it('选择图片后会自动显示预览并回填 Base64 文本', async () => {
    const wrapper = mount(ImageBase64Converter);
    const originalFileReader = globalThis.FileReader;

    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

      readAsDataURL() {
        this.result = 'data:image/png;base64,YWJjZA==';
        if (this.onload) {
          this.onload.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
        }
      }
    }

    globalThis.FileReader = MockFileReader as unknown as typeof FileReader;

    try {
      const fileInput = wrapper.find('input[type="file"]');
      const file = new File(['demo'], 'demo.png', { type: 'image/png' });
      Object.defineProperty(fileInput.element, 'files', {
        value: [file],
        configurable: true,
      });

      await fileInput.trigger('change');
      await flushPromises();

      const preview = wrapper.find('[data-testid="image-preview"]');
      const textarea = wrapper.find('[data-testid="base64-textarea"]');

      expect(preview.exists()).toBe(true);
      expect(preview.attributes('src')).toBe('data:image/png;base64,YWJjZA==');
      expect((textarea.element as HTMLTextAreaElement).value).toContain('YWJjZA==');
    } finally {
      globalThis.FileReader = originalFileReader;
    }
  });

  it('粘贴图片后会自动显示预览并回填 Base64 文本', async () => {
    const wrapper = mount(ImageBase64Converter);
    const originalFileReader = globalThis.FileReader;

    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

      readAsDataURL() {
        this.result = 'data:image/png;base64,UEFTVEU=';
        if (this.onload) {
          this.onload.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
        }
      }
    }

    globalThis.FileReader = MockFileReader as unknown as typeof FileReader;

    try {
      const file = new File(['paste'], 'clipboard-image.png', { type: 'image/png' });
      const pasteEvent = new Event('paste') as ClipboardEvent;

      Object.defineProperty(pasteEvent, 'clipboardData', {
        value: {
          items: [
            {
              kind: 'file',
              type: 'image/png',
              getAsFile: () => file,
            },
          ],
        },
      });

      window.dispatchEvent(pasteEvent);
      await flushPromises();

      const preview = wrapper.find('[data-testid="image-preview"]');
      const textarea = wrapper.find('[data-testid="base64-textarea"]');

      expect(preview.exists()).toBe(true);
      expect(preview.attributes('src')).toBe('data:image/png;base64,UEFTVEU=');
      expect((textarea.element as HTMLTextAreaElement).value).toContain('UEFTVEU=');
    } finally {
      globalThis.FileReader = originalFileReader;
    }
  });

  it('图片导入成功后会清理之前的错误信息', async () => {
    const wrapper = mount(ImageBase64Converter);
    const textarea = wrapper.find('[data-testid="base64-textarea"]');
    const originalFileReader = globalThis.FileReader;

    class MockFileReader {
      result: string | ArrayBuffer | null = null;
      onload: ((this: FileReader, ev: ProgressEvent<FileReader>) => unknown) | null = null;

      readAsDataURL() {
        this.result = 'data:image/png;base64,YWJjZA==';
        if (this.onload) {
          this.onload.call(this as unknown as FileReader, {} as ProgressEvent<FileReader>);
        }
      }
    }

    globalThis.FileReader = MockFileReader as unknown as typeof FileReader;

    try {
      await textarea.setValue('not-valid');
      await flushPromises();
      expect(wrapper.text()).toContain('tools.image_base64.invalid_base64');

      const fileInput = wrapper.find('input[type="file"]');
      const file = new File(['demo'], 'demo.png', { type: 'image/png' });
      Object.defineProperty(fileInput.element, 'files', {
        value: [file],
        configurable: true,
      });

      await fileInput.trigger('change');
      await flushPromises();

      expect(wrapper.text()).not.toContain('tools.image_base64.invalid_base64');
    } finally {
      globalThis.FileReader = originalFileReader;
    }
  });
});
