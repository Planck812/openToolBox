import { ref, type Ref } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useI18n } from 'vue-i18n';
import { copyText } from '@/lib/clipboard';
import { exportOriginalPng } from '@/tools/screenshot-universal/compose-canvas';
import { isValidRect, type SelectionModel } from '@/tools/screenshot-universal/selection-model';
import { ocrRecognizePng } from '@/lib/ipc/ocr';
import { screenshotUniversalCancel } from '@/lib/ipc/screenshot';

/**
 * 截图覆盖层「选区 OCR」子系统（拆分自 OverlayView.vue）。
 * 管理 OCR 识别状态、结果展示与复制/关闭，不依赖 canvas 渲染。
 */
export function useOcr(deps: {
  selection: SelectionModel;
  frameImage: Ref<HTMLCanvasElement | null>;
  busy: Ref<boolean>;
  initInfo: Ref<{ sessionId: string | undefined } | null>;
  errorText: (e: unknown) => string;
}) {
  const { t } = useI18n();

  const ocrState = ref<'idle' | 'loading' | 'done' | 'error'>('idle');
  const ocrResult = ref('');
  const ocrError = ref('');
  const ocrCopied = ref(false);
  /** OCR 模式：'best'（精准，默认）或 'fast'（快速）。 */
  const ocrMode = ref<'best' | 'fast'>('best');
  /** 是否显示「识别文字」按钮上方的模式选择浮层（悬停时）。 */
  const ocrModeHover = ref(false);

  /** 对当前选区运行 OCR，结果展示在覆盖层弹窗。 */
  const ocrSelection = async () => {
    const sel = deps.selection.selection;
    const img = deps.frameImage.value;
    if (!sel || !isValidRect(sel) || !img || deps.busy.value || ocrState.value === 'loading') return;
    // 识别期间占用 busy，避免 Enter/复制/贴图等动作在识别中关闭覆盖层丢失结果。
    deps.busy.value = true;
    ocrState.value = 'loading';
    ocrError.value = '';
    ocrResult.value = '';
    ocrCopied.value = false;
    try {
      const blob = await exportOriginalPng(img, sel);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const res = await ocrRecognizePng({
        png: Array.from(bytes),
        mode: ocrMode.value,
      });
      ocrResult.value = res.text;
      ocrState.value = 'done';
    } catch (e) {
      ocrError.value = deps.errorText(e);
      ocrState.value = 'error';
    } finally {
      deps.busy.value = false;
    }
  };

  /** 复制 OCR 结果到剪贴板并退出截图模式（结束会话 + 关闭覆盖层）。 */
  const copyOcrResult = async () => {
    if (!ocrResult.value) return;
    const ok = await copyText(ocrResult.value);
    if (!ok) {
      ocrError.value = t('overlay.ocr.copy_failed');
      return;
    }
    // 复制成功后结束截图会话（避免残留 ACTIVE session），再关闭覆盖层退出截图模式。
    try {
      await screenshotUniversalCancel({ sessionId: deps.initInfo.value?.sessionId });
    } catch {
      // 会话可能已结束，忽略取消错误，仍关闭窗口。
    }
    const win = getCurrentWindow();
    await win.close();
  };

  /** 关闭 OCR 结果弹窗。 */
  const closeOcr = () => {
    ocrState.value = 'idle';
    ocrResult.value = '';
    ocrError.value = '';
  };

  return {
    ocrState,
    ocrResult,
    ocrError,
    ocrCopied,
    ocrMode,
    ocrModeHover,
    ocrSelection,
    copyOcrResult,
    closeOcr,
  };
}
