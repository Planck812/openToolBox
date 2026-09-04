/**
 * 截图覆盖层指针交互状态机（拆分自 OverlayView.vue）。
 * 处理鼠标按下/移动/松开、取色、贴图/复制/滚动截图等动作，依赖注入 28 项。
 */
import { getCurrentWindow } from '@tauri-apps/api/window';
import { exportFinalPng, exportOriginalPng } from '@/tools/screenshot-universal/compose-canvas';
import { ToolKind, type AnnotationModel } from '@/tools/screenshot-universal/annotation-model';
import { isValidRect, type SelectionModel } from '@/tools/screenshot-universal/selection-model';
import type { HoverElement } from '@/composables/useElementDetect';
import type { Ref } from 'vue';
import { screenshotUniversalCancel, screenshotUniversalFinish, scrollCaptureStart } from '@/lib/ipc/screenshot';

export interface PointerInteractionDeps {
  activeTool: Ref<ToolKind>;
  busy: Ref<boolean>;
  colorFormat: Ref<string>;
  currentStyle: Ref<{ color: string; strokeWidth: number; fontSize: number; mosaicBlock: number }>;
  errorMessage: Ref<string>;
  frameImage: Ref<HTMLCanvasElement | null>;
  hoverElement: Ref<HoverElement | null>;
  initInfo: Ref<{ sessionId?: string; scaleFactor: number | null; desktopRect: { left: number; top: number; right: number; bottom: number } } | null>;
  isDragging: Ref<boolean>;
  isMovingAnnotation: Ref<boolean>;
  magnifierColor: Ref<{ r: number; g: number; b: number } | null>;
  magnifierEnabled: Ref<boolean>;
  magnifierPos: Ref<{ x: number; y: number } | null>;
  pickerMode: Ref<boolean>;
  showTextInput: Ref<boolean>;
  textInput: Ref<string>;
  textInputPos: Ref<{ left: number; top: number }>;
  selection: SelectionModel;
  annotations: AnnotationModel;
  detectUnderCursor: (p: { x: number; y: number }) => Promise<void>;
  errorText: (e: unknown) => string;
  formatColor: (c: { r: number; g: number; b: number }, format: string) => string;
  render: () => void;
  syncSelectionBox: () => void;
  toLocalPoint: (e: MouseEvent) => { x: number; y: number };
}

export function usePointerInteraction(deps: PointerInteractionDeps) {
  const {
    activeTool,
    busy,
    colorFormat,
    currentStyle,
    errorMessage,
    frameImage,
    hoverElement,
    initInfo,
    isDragging,
    isMovingAnnotation,
    magnifierColor,
    magnifierEnabled,
    magnifierPos,
    pickerMode,
    showTextInput,
    textInput,
    textInputPos,
    selection,
    annotations,
    detectUnderCursor,
    errorText,
    formatColor,
    render,
    syncSelectionBox,
    toLocalPoint,
  } = deps;

  /** 点击吸附阈值：按下到松开位移小于该值视为点击（非拖拽）。 */
  const CLICK_SNAP_DIST = 5;
  /** 按下起点：pointerUp 据此区分「点击」与「拖拽框选」（逻辑像素）。 */
  let downPos: { x: number; y: number } | null = null;

const handlePointerDown = (e: MouseEvent) => {
  // 鼠标中键：若已有有效选区，直接完成「贴图」（业内常见快捷操作）。
  if (e.button === 1) {
    e.preventDefault();
    const sel = selection.selection;
    if (sel && isValidRect(sel)) {
      void confirmCapture('pin');
    }
    return;
  }
  if (e.button !== 0) return;
  const p = toLocalPoint(e);

  // 取色模式：点击取色，按当前格式复制，并直接退出截图。
  if (pickerMode.value) {
    const c = readPixel(p);
    if (c) {
      const formatted = formatColor(c, colorFormat.value);
      currentStyle.value = { ...currentStyle.value, color: formatted };
      navigator.clipboard?.writeText(formatted).catch(() => {});
      pickerMode.value = false;
      magnifierPos.value = null;
      render();
      // 取色完成直接退出截图会话（关闭覆盖层）。
      void escapeCancel();
    }
    return;
  }

  if (activeTool.value === ToolKind.Select) {
    // 先命中标注对象：命中则选中并开始移动；未命中才操作截图选区。
    const hit = annotations.hitTest(p);
    if (hit) {
      if (annotations.beginMove(hit.id, p)) {
        isMovingAnnotation.value = true;
        render();
        return;
      }
    }
    // 记录按下起点，供 pointerUp 判定是否为「点击」。
    // 吸附延迟到 pointerUp：拖拽框选（按下后移动）绝不吸附控件。
    downPos = p;
    selection.pointerDown(p);
    isDragging.value = true;
    syncSelectionBox();
    render();
    return;
  }
  if (activeTool.value === ToolKind.Text) {
    annotations.beginDraw(ToolKind.Text, p, { ...currentStyle.value });
    annotations.endDraw();
    // 弹文字输入框。
    textInputPos.value = { left: p.x, top: p.y };
    textInput.value = '';
    showTextInput.value = true;
    render();
    return;
  }
  if (activeTool.value === ToolKind.Number) {
    // 序号：点击落点立即生成（序号自动递增）。
    annotations.beginDraw(ToolKind.Number, p, { ...currentStyle.value });
    annotations.endDraw();
    render();
    return;
  }
  if (activeTool.value === ToolKind.Eraser) {
    // 橡皮擦：点击擦除命中的标注对象。
    annotations.eraseAt(p);
    render();
    return;
  }
  // 绘制工具。
  annotations.beginDraw(activeTool.value, p, { ...currentStyle.value });
  isDragging.value = true;
  render();
};

const handlePointerMove = (e: MouseEvent) => {
  const p = toLocalPoint(e);
  // 放大镜：仅当启用时跟随光标（进入截图=开，框选完成=关，取色=开）。
  if (magnifierEnabled.value) {
    magnifierPos.value = { x: p.x, y: p.y };
    magnifierColor.value = readPixel(p);
  }
  if (isMovingAnnotation.value) {
    annotations.updateMove(p);
    render();
    return;
  }
  if (isDragging.value) {
    if (activeTool.value === ToolKind.Select) {
      selection.pointerMove(p);
      syncSelectionBox();
    } else {
      annotations.updateDraw(p);
    }
    render();
    return;
  }
  // 非拖拽：悬停识别（节流）+ 重绘让放大镜跟随光标（常驻）。
  void detectUnderCursor(p);
  render();
};

/** 读取采集帧上某点的像素色值（物理像素）。 */
function readPixel(p: { x: number; y: number }): { r: number; g: number; b: number } | null {
  const frame = frameImage.value;
  if (!frame) return null;
  try {
    // 帧是物理分辨率，指针坐标是逻辑像素 → 乘缩放系数换算（同 useElementDetect/startScrollCapture）。
    const sf = initInfo.value?.scaleFactor ?? 1;
    const ctx = (frame as HTMLCanvasElement).getContext('2d');
    if (!ctx) return null;
    const data = ctx.getImageData(Math.round(p.x * sf), Math.round(p.y * sf), 1, 1).data;
    return { r: data[0], g: data[1], b: data[2] };
  } catch {
    return null;
  }
}

/** 切换取色模式。 */
const togglePicker = () => {
  pickerMode.value = !pickerMode.value;
  if (pickerMode.value) {
    // 进入取色：开启放大镜。
    magnifierEnabled.value = true;
  } else {
    magnifierPos.value = null;
  }
  render();
};

const handlePointerUp = (e: MouseEvent) => {
  if (e.button !== 0) return;
  const p = toLocalPoint(e);
  if (isMovingAnnotation.value) {
    annotations.updateMove(p);
    annotations.endMove();
    isMovingAnnotation.value = false;
    render();
    return;
  }
  if (activeTool.value === ToolKind.Select) {
    selection.pointerUp();
    // 点击（按下到松开位移小于阈值）且悬停识别到控件：吸附到控件矩形建立选区。
    // 拖拽框选（按下后移动超过阈值）不吸附，保持自由选区。
    if (downPos) {
      const moved = Math.hypot(p.x - downPos.x, p.y - downPos.y);
      if (moved < CLICK_SNAP_DIST && hoverElement.value) {
        const el = hoverElement.value;
        selection.setRect({
          left: Math.round(el.left),
          top: Math.round(el.top),
          right: Math.round(el.right),
          bottom: Math.round(el.bottom),
        });
        hoverElement.value = null;
        isDragging.value = false;
        downPos = null;
        syncSelectionBox();
        render();
        return;
      }
    }
    downPos = null;
    syncSelectionBox();
    // 框选完成：关闭放大镜（取色模式除外）。
    if (!pickerMode.value) {
      magnifierEnabled.value = false;
      magnifierPos.value = null;
    }
  } else {
    annotations.updateDraw(p);
    annotations.endDraw();
  }
  isDragging.value = false;
  render();
};

const commitText = () => {
  annotations.commitText(textInput.value);
  showTextInput.value = false;
  render();
};

const cancelText = () => {
  annotations.cancelTextEdit();
  showTextInput.value = false;
  render();
};

const undo = () => {
  annotations.undo();
  render();
};

const redo = () => {
  annotations.redo();
  render();
};

const removeSelected = () => {
  annotations.deleteSelected();
  render();
};

const switchTool = (kind: ToolKind) => {
  // 提交/丢弃进行中的文字编辑。
  if (showTextInput.value) commitText();
  activeTool.value = kind;
  if (kind === ToolKind.Select) {
    // 选区工具下，点击标注对象可选中。
  } else {
    // 非选区工具下，清除标注选中，避免误删。
    annotations.select(null);
  }
};

const escapeCancel = async () => {
  try {
    await screenshotUniversalCancel({ sessionId: initInfo.value?.sessionId });
  } catch (e) {
    errorMessage.value = errorText(e);
  }
  try {
    const win = getCurrentWindow();
    await win.close();
  } catch (e) {
    errorMessage.value = errorText(e);
  }
};

const confirmCapture = async (action: 'copy' | 'pin' | 'saveAs') => {
  const sel = selection.selection;
  const img = frameImage.value;
  if (!sel || !isValidRect(sel) || !img || busy.value) return;
  busy.value = true;
  try {
    const originalBlob = await exportOriginalPng(img, sel);
    const finalBlob = await exportFinalPng(img, annotations.items, sel);
    const originalBytes = Array.from(new Uint8Array(await originalBlob.arrayBuffer()));
    const finalBytes = Array.from(new Uint8Array(await finalBlob.arrayBuffer()));
    await screenshotUniversalFinish({
      sessionId: initInfo.value?.sessionId,
      originalPng: originalBytes,
      finalPng: finalBytes,
      action,
    });
    const win = getCurrentWindow();
    await win.close();
  } catch (e) {
    errorMessage.value = errorText(e);
    busy.value = false;
  }
};

/** 开始滚动截图：选区转物理像素 → scroll_capture_start → 关闭覆盖层。 */
const startScrollCapture = async () => {
  const sel = selection.selection;
  const info = initInfo.value;
  if (!sel || !isValidRect(sel) || busy.value) return;
  busy.value = true;
  try {
    // 选区是 CSS 逻辑像素（相对 overlay 窗口 = 显示器）。转物理像素。
    const sf = info?.scaleFactor ?? 1;
    const left = (info?.desktopRect.left ?? 0) + Math.round(sel.left * sf);
    const top = (info?.desktopRect.top ?? 0) + Math.round(sel.top * sf);
    const selectionRect = {
      left,
      top,
      right: left + Math.max(1, Math.round((sel.right - sel.left) * sf)),
      bottom: top + Math.max(1, Math.round((sel.bottom - sel.top) * sf)),
    };
    await scrollCaptureStart({ selection: selectionRect });
    const win = getCurrentWindow();
    await win.close();
  } catch (e) {
    errorMessage.value = errorText(e);
    busy.value = false;
  }
};

  return {
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    escapeCancel,
    confirmCapture,
    startScrollCapture,
    togglePicker,
    commitText,
    cancelText,
    undo,
    redo,
    removeSelected,
    switchTool,
  };
}
