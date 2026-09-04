import { ref, type Ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { readImage } from '@tauri-apps/plugin-clipboard-manager';
import {
  clipboardImageToDataUrl,
  recognizeCodeFromImage,
  type RecognitionResult,
  type ToolMode,
} from '@/tools/qrcode-gen/runtime';

/**
 * 二维码/条形码「识别模式」子系统（拆分自 QRCodeGen.vue）。
 * 管理识别预览、结果状态与从文件/剪贴板识别，不依赖 UI 布局。
 */
export function useQrRecognizer(deps: { activeMode: Ref<ToolMode> }) {
  const { t } = useI18n();

  const recognitionPreviewUrl = ref('');
  const recognitionFileName = ref('');
  const recognitionResult = ref<RecognitionResult | null>(null);
  const recognitionError = ref('');
  let recognitionObjectUrl: string | null = null;

  /** 释放旧的图片预览 URL，避免重复选择图片后泄漏 */
  const revokeRecognitionUrl = () => {
    if (!recognitionObjectUrl) {
      return;
    }

    URL.revokeObjectURL(recognitionObjectUrl);
    recognitionObjectUrl = null;
  };

  /** 将本地或剪贴板图片加载为 HTMLImageElement */
  const loadImageElement = (source: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = 'async';
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(t('tools.qrcode_gen.image_load_failed')));
      image.src = source;
    });
  };

  /** 统一重置识别态，供上传、粘贴与剪贴板回退共用 */
  const resetRecognitionState = () => {
    deps.activeMode.value = 'recognize';
    recognitionError.value = '';
    recognitionResult.value = null;
    revokeRecognitionUrl();
  };

  /** 设置当前识别预览源；只有对象 URL 需要在后续销毁 */
  const setRecognitionPreview = (previewUrl: string, fileName: string, shouldRevoke: boolean) => {
    recognitionPreviewUrl.value = previewUrl;
    recognitionFileName.value = fileName;
    recognitionObjectUrl = shouldRevoke ? previewUrl : null;
  };

  /** 使用给定预览源执行识别 */
  const recognizeFromPreview = async (previewUrl: string, fileName: string, shouldRevoke: boolean) => {
    setRecognitionPreview(previewUrl, fileName, shouldRevoke);
    const image = await loadImageElement(previewUrl);
    const result = await recognizeCodeFromImage(image);
    recognitionResult.value = result;
    return result;
  };

  /** 当 paste 事件给出的图片文件不可用时，回退到 Tauri 直接读取剪贴板图像 */
  const recognizeFromClipboardImage = async () => {
    const clipboardImage = await readImage();
    revokeRecognitionUrl();
    const previewUrl = await clipboardImageToDataUrl(clipboardImage);
    return recognizeFromPreview(previewUrl, t('tools.qrcode_gen.pasted_image_default_name'), false);
  };

  return {
    recognitionPreviewUrl,
    recognitionFileName,
    recognitionResult,
    recognitionError,
    revokeRecognitionUrl,
    loadImageElement,
    resetRecognitionState,
    setRecognitionPreview,
    recognizeFromPreview,
    recognizeFromClipboardImage,
  };
}
