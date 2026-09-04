import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const qrcodeRuntimeMock = vi.hoisted(() => ({
  generateQRCode: vi.fn(async (text: string) => `data:image/png;base64,qr-${btoa(text)}`),
  generateBarcode: vi.fn((text: string) => `data:image/png;base64,bar-${btoa(text)}`),
}));
import QRCodeGen from '@/tools/qrcode-gen/QRCodeGen.vue';

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readImage: vi.fn(),
  writeImage: vi.fn(),
  writeText: vi.fn(),
}));

vi.mock('@/tools/qrcode-gen/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/tools/qrcode-gen/runtime')>();
  return {
    ...actual,
    generateBarcode: qrcodeRuntimeMock.generateBarcode,
    generateQRCode: qrcodeRuntimeMock.generateQRCode,
  };
});

describe('二维码/条形码页面布局', () => {
  beforeEach(() => {
    qrcodeRuntimeMock.generateBarcode.mockClear();
    qrcodeRuntimeMock.generateQRCode.mockClear();
    const pinia = createPinia();
    setActivePinia(pinia);
  });

  it('生成模式在窄布局下不应将表单区与预览区强制压成等高两半', () => {
    const pinia = createPinia();
    const wrapper = mount(QRCodeGen, {
      global: {
        plugins: [pinia],
      },
    });

    const generateLayout = wrapper.find('[data-testid="generate-layout"]');
    const formPanel = wrapper.find('[data-testid="generate-form-panel"]');
    const previewPanel = wrapper.find('[data-testid="generate-preview-panel"]');

    expect(generateLayout.exists()).toBe(true);
    // 布局为 grid：移动端单列堆叠，桌面端 30/70 双列（grid-cols-1 → lg:grid-cols-[...]）。
    expect(generateLayout.classes()).toContain('grid');
    expect(generateLayout.classes()).toContain('grid-cols-1');
    expect(generateLayout.classes()).not.toContain('flex-1');
    expect(generateLayout.classes()).toContain('lg:flex-1');
    expect(generateLayout.classes().some((c) => c.startsWith('lg:grid-cols-['))).toBe(true);

    expect(formPanel.exists()).toBe(true);
    expect(formPanel.classes()).not.toContain('flex-1');
    expect(formPanel.classes()).toContain('shrink-0');
    expect(formPanel.classes()).toContain('lg:min-w-0');
    expect(formPanel.classes()).toContain('overflow-visible');
    expect(formPanel.classes()).toContain('lg:overflow-y-auto');

    expect(previewPanel.exists()).toBe(true);
    expect(previewPanel.classes()).toContain('min-h-[260px]');
    expect(previewPanel.classes()).toContain('shrink-0');
    expect(previewPanel.classes()).toContain('lg:min-w-0');
  });

  it('二维码模式应按输入的每个非空行分别生成一张二维码并支持左右切换', async () => {
    const pinia = createPinia();
    const wrapper = mount(QRCodeGen, {
      global: {
        plugins: [pinia],
      },
    });

    const input = wrapper.find('[data-testid="qrcode-generate-input"]');
    await input.setValue('U-1-20260424-9000001-20879108\n\nU-1-20260424-9000002-20879108\nU-1-20260424-9000003-20879108');
    await flushPromises();
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    await flushPromises();

    const images = wrapper.findAll('[data-testid="qrcode-result-image"]');
    expect(images).toHaveLength(1);
    expect(wrapper.find('[data-testid="qrcode-result-text"]').text()).toContain('U-1-20260424-9000001-20879108');
    expect(wrapper.find('[data-testid="qrcode-result-counter"]').text()).toContain('1 / 3');

    await wrapper.find('[data-testid="qrcode-next-button"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="qrcode-result-text"]').text()).toContain('U-1-20260424-9000002-20879108');
    expect(wrapper.find('[data-testid="qrcode-result-counter"]').text()).toContain('2 / 3');

    await wrapper.find('[data-testid="qrcode-prev-button"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="qrcode-result-text"]').text()).toContain('U-1-20260424-9000001-20879108');
    expect(qrcodeRuntimeMock.generateQRCode).toHaveBeenCalledWith('U-1-20260424-9000001-20879108', expect.any(Object));
    expect(qrcodeRuntimeMock.generateQRCode).toHaveBeenCalledWith('U-1-20260424-9000002-20879108', expect.any(Object));
    expect(qrcodeRuntimeMock.generateQRCode).toHaveBeenCalledWith('U-1-20260424-9000003-20879108', expect.any(Object));
  });

  it('条形码模式应按输入的每个非空行分别生成一张条形码并支持左右切换', async () => {
    const pinia = createPinia();
    const wrapper = mount(QRCodeGen, {
      global: {
        plugins: [pinia],
      },
    });

    const barcodeButton = wrapper.findAll('button').find((button) => button.text() === 'tools.qrcode_gen.tab_barcode');
    expect(barcodeButton).toBeTruthy();
    await barcodeButton!.trigger('click');

    const input = wrapper.find('[data-testid="qrcode-generate-input"]');
    await input.setValue('A10001\n\nA10002\nA10003');
    await flushPromises();
    await new Promise((resolve) => window.setTimeout(resolve, 350));
    await flushPromises();

    const images = wrapper.findAll('[data-testid="qrcode-result-image"]');
    expect(images).toHaveLength(1);
    expect(wrapper.find('[data-testid="qrcode-result-text"]').text()).toContain('A10001');
    expect(wrapper.find('[data-testid="qrcode-result-counter"]').text()).toContain('1 / 3');

    await wrapper.find('[data-testid="qrcode-next-button"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="qrcode-result-text"]').text()).toContain('A10002');
    expect(wrapper.find('[data-testid="qrcode-result-counter"]').text()).toContain('2 / 3');
    expect(qrcodeRuntimeMock.generateBarcode).toHaveBeenCalledWith('A10001', expect.any(Object));
    expect(qrcodeRuntimeMock.generateBarcode).toHaveBeenCalledWith('A10002', expect.any(Object));
    expect(qrcodeRuntimeMock.generateBarcode).toHaveBeenCalledWith('A10003', expect.any(Object));
  });


  it('识别模式应将结果信息整理到预览区下方的摘要区域', async () => {
    const pinia = createPinia();
    const wrapper = mount(QRCodeGen, {
      global: {
        plugins: [pinia],
      },
    });

    const recognizeButton = wrapper.findAll('button').find((button) => button.text() === 'tools.qrcode_gen.mode_recognize');
    expect(recognizeButton).toBeTruthy();

    await recognizeButton!.trigger('click');
    await flushPromises();

    const root = wrapper.find('[data-testid="qrcode-root"]');
    const recognizeShell = wrapper.find('[data-testid="recognition-layout"]').element.parentElement;
    const recognizeLayout = wrapper.find('[data-testid="recognition-layout"]');
    const uploadPanel = wrapper.find('[data-testid="recognition-upload-panel"]');
    const mergedPanel = wrapper.find('[data-testid="recognition-merged-panel"]');
    const previewPanel = wrapper.find('[data-testid="recognition-preview-panel"]');

    expect(root.exists()).toBe(true);
    expect(root.classes()).toContain('overflow-auto');
    expect(recognizeShell).not.toBeNull();
    expect(recognizeShell?.className).toContain('overflow-y-auto');
    expect(recognizeShell?.className).toContain('overflow-x-hidden');
    expect(recognizeLayout.exists()).toBe(true);
    expect(recognizeLayout.classes()).toContain('grid-cols-2');
    expect(uploadPanel.exists()).toBe(true);
    expect(mergedPanel.exists()).toBe(true);
    expect(mergedPanel.classes()).toContain('bg-card/95');
    expect(previewPanel.exists()).toBe(true);
    expect(previewPanel.classes()).toContain('min-h-[420px]');
    expect(previewPanel.classes()).toContain('max-h-[clamp(420px,62vh,680px)]');

    await wrapper.setData?.({});
  });

  it('识别成功后应在预览图内部、紧贴二维码下方显示识别文本', async () => {
    const pinia = createPinia();
    const wrapper = mount(QRCodeGen, {
      global: {
        plugins: [pinia],
      },
    });

    const recognizeButton = wrapper.findAll('button').find((button) => button.text() === 'tools.qrcode_gen.mode_recognize');
    expect(recognizeButton).toBeTruthy();

    await recognizeButton!.trigger('click');
    await flushPromises();

    (wrapper.vm as unknown as {
      recognitionPreviewUrl: string;
      recognitionResult: { formatLabel: string; text: string; isQRCode: boolean };
      recognitionError: string;
    }).recognitionPreviewUrl = 'data:image/png;base64,abc';
    (wrapper.vm as unknown as {
      recognitionPreviewUrl: string;
      recognitionResult: { formatLabel: string; text: string; isQRCode: boolean };
      recognitionError: string;
    }).recognitionResult = {
      formatLabel: '二维码',
      text: '20777228',
      isQRCode: true,
    };
    (wrapper.vm as unknown as {
      recognitionPreviewUrl: string;
      recognitionResult: { formatLabel: string; text: string; isQRCode: boolean };
      recognitionError: string;
    }).recognitionError = '';
    await flushPromises();

    const previewPanel = wrapper.find('[data-testid="recognition-preview-panel"]');
    const resultPanel = wrapper.find('[data-testid="recognition-result-panel"]');
    const textBadge = wrapper.find('[data-testid="recognition-text-badge"]');
    const copyButton = wrapper.findAll('button').find((button) => button.text() === 'tools.qrcode_gen.copy_result_btn');

    expect(previewPanel.exists()).toBe(true);
    expect(resultPanel.exists()).toBe(true);
    expect(resultPanel.element.parentElement?.parentElement).toBe(previewPanel.element);
    expect(textBadge.exists()).toBe(true);
    expect(textBadge.text()).toContain('20777228');
    expect(copyButton).toBeTruthy();

    const pageText = wrapper.text();
    expect(pageText.indexOf('tools.qrcode_gen.recognition_title')).toBeLessThan(
      pageText.indexOf('tools.qrcode_gen.image_preview_title'),
    );
  });
});
