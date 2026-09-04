<script setup lang="ts">
import { getCurrentWindow } from '@tauri-apps/api/window';
import { screenshotUniversalOverlayInit, type OverlayInitInfo } from '@/lib/ipc/screenshot';
import { logToFile } from '@/lib/logger';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { Eraser, Grid2x2, ListOrdered, MousePointer2, MoveUpRight, PaintbrushVertical, Pencil, Square, Type } from 'lucide-vue-next';
import OcrPanel from './overlay/OcrPanel.vue';
import OverlayToolbar from './overlay/OverlayToolbar.vue';
import type { StyleState, ToolButton } from './overlay/OverlayToolbar.vue';
import { SelectionModel, rectSize, rectFromPoints, isValidRect, Handle } from '@/tools/screenshot-universal/selection-model';
import { AnnotationModel, ToolKind } from '@/tools/screenshot-universal/annotation-model';
import { frameFromRgba } from '@/tools/screenshot-universal/compose-canvas';
import { drawAnnotation, annotationBbox } from '@/tools/screenshot-universal/canvas-render';
import { useOcr } from '@/composables/useOcr';
import { useElementDetect, type HoverElement } from '@/composables/useElementDetect';
import { usePointerInteraction } from '@/composables/usePointerInteraction';

const WINDOW_LABEL_PREFIX = 'overlay-';

const { t } = useI18n();

const selection = new SelectionModel();
const annotations = new AnnotationModel();
const canvasRef = ref<HTMLCanvasElement | null>(null);
const frameImage = ref<HTMLCanvasElement | null>(null);
const initInfo = ref<OverlayInitInfo | null>(null);
const errorMessage = ref('');
const activeTool = ref<ToolKind>(ToolKind.Select);
/** OCR 识别状态：null=未识别，loading=识别中，否则为结果文本。 */
/** OCR 模式：'best'（精准，默认）或 'fast'（快速）。 */
/** 是否显示「识别文字」按钮上方的模式选择浮层（悬停时）。 */
// 当前工具样式（新建标注时应用；选中已有标注时改样式也用它）。
const currentStyle = ref<{ color: string; strokeWidth: number; fontSize: number; mosaicBlock: number }>({
  color: '#ff4757',
  strokeWidth: 3,
  fontSize: 18,
  mosaicBlock: 0,
});

/** 常用颜色预设。 */
const presetColors = ['#ff4757', '#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ffffff', '#111827', '#ef4444'];

/** 是否显示样式调节条（选择/橡皮擦工具不显示）。 */
const showStyleBar = computed(() => ![ToolKind.Select, ToolKind.Eraser].includes(activeTool.value));
/** 线宽滑杆：矩形/箭头/画笔显示。 */
const showStrokeWidth = computed(() =>
  [ToolKind.Rect, ToolKind.Arrow, ToolKind.Stroke].includes(activeTool.value),
);
/** 字号：文字/序号工具显示。 */
const showFontSize = computed(() => [ToolKind.Text, ToolKind.Number].includes(activeTool.value));
/** 马赛克块大小：马赛克工具显示。 */
const showMosaicBlock = computed(() => activeTool.value === ToolKind.Mosaic);

// 放大镜：拖拽时跟随光标显示局部放大预览。
const magnifierPos = ref<{ x: number; y: number } | null>(null);
// 放大镜中心像素色值（取色用）。
const magnifierColor = ref<{ r: number; g: number; b: number } | null>(null);
// 放大镜是否允许显示：进入截图模式=开，框选完成=关，取色=开。
const magnifierEnabled = ref(true);
// 取色模式：点击屏幕取色并复制。
const pickerMode = ref(false);
// 取色输出的颜色格式（C 键循环切换）。
const colorFormat = ref<'hex' | 'rgb' | 'rgba' | 'hsl'>('hex');

/** 按当前格式格式化颜色。 */
function formatColor(c: { r: number; g: number; b: number }, format: string): string {
  const { r, g, b } = c;
  switch (format) {
    case 'rgb':
      return `rgb(${r}, ${g}, ${b})`;
    case 'rgba':
      return `rgba(${r}, ${g}, ${b}, 1)`;
    case 'hsl': {
      const rp = r / 255, gp = g / 255, bp = b / 255;
      const max = Math.max(rp, gp, bp), min = Math.min(rp, gp, bp);
      const l = (max + min) / 2;
      const d = max - min;
      let h = 0, s = 0;
      if (d !== 0) {
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === rp) h = ((gp - bp) / d + (gp < bp ? 6 : 0)) * 60;
        else if (max === gp) h = ((bp - rp) / d + 2) * 60;
        else h = ((rp - gp) / d + 4) * 60;
      }
      return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
    }
    default:
      return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  }
}

// 样式变化只影响「接下来画的标注」；不影响已画/选中的标注（用户要求各自独立）。
// （不做 watch 联动已画标注）
const busy = ref(false);
const isDragging = ref(false);
const isMovingAnnotation = ref(false);
const showTextInput = ref(false);
const textInput = ref('');
const textInputPos = ref({ left: 0, top: 0 });
// 帧未就绪时显示 loading（遮罩中央），避免用户误以为软件卡住。
const frameLoading = computed(() => !frameImage.value && !errorMessage.value);
// 选区框的 DOM 镜像（逻辑像素），帧未就位时由纯 DOM 层提供拖拽反馈，
// 避免「阴影已出现但拖拽无视觉反馈」的等待感。
const selectionBox = ref<{ left: number; top: number; right: number; bottom: number } | null>(null);
/** 悬停识别的元素矩形（逻辑像素），非空时绘制高亮框。
 * windowRect：控件所在窗口的矩形（逻辑像素，可为 null）——用于「控件所在窗口去阴影」。 */
const hoverElement = ref<HoverElement | null>(null);
const selectionBoxStyle = computed(() => {
  const s = selectionBox.value;
  if (!s) return null;
  return {
    left: `${s.left}px`,
    top: `${s.top}px`,
    width: `${Math.max(0, s.right - s.left)}px`,
    height: `${Math.max(0, s.bottom - s.top)}px`,
  };
});

/** 按下起点：pointerUp 据此区分「点击」与「拖拽框选」（逻辑像素）。 */
/** 点击吸附阈值：按下到松开位移小于该值视为点击（非拖拽）。 */

const syncSelectionBox = () => {
  const sel = selection.selection;
  selectionBox.value = sel && isValidRect(sel) ? { ...sel } : null;
};

/** 工具栏是否显示：框选完成（选区有效且非正在创建/拖拽）。 */
const toolbarVisible = computed(() => {
  const sel = selection.selection;
  if (!selectionBox.value || !sel || !isValidRect(sel)) return false;
  // move/resize 时选区已确定，工具栏跟随选区实时移动。
  return selection.dragMode.kind !== 'create';
});

/** 工具栏位置：紧挨选区下方；若会超出底部则放到选区上方。 */
const toolbarStyle = computed(() => {
  const s = selectionBox.value;
  if (!s) return null;
  const GAP = 8;
  const TOOLBAR_H = 52;
  const viewportH = window.innerHeight;
  // 默认放选区下方。
  let top = s.bottom + GAP;
  // 若超出视口底部，放选区上方。
  if (top + TOOLBAR_H > viewportH) {
    top = Math.max(0, s.top - GAP - TOOLBAR_H);
  }
  return {
    left: `${s.left}px`,
    top: `${top}px`,
  };
});

const statusMessage = computed(() => {
  if (!initInfo.value) return t('overlay.status.loading');
  const size = selection.selection ? rectSize(selection.selection) : null;
  if (size) return `${size.width} × ${size.height}`;
  return t('overlay.status.drag_hint');
});

const toolButtons: ToolButton[] = [
  { kind: ToolKind.Select, icon: MousePointer2, label: 'overlay.tool.select' },
  { kind: ToolKind.Rect, icon: Square, label: 'overlay.tool.rect' },
  { kind: ToolKind.Arrow, icon: MoveUpRight, label: 'overlay.tool.arrow' },
  { kind: ToolKind.Stroke, icon: Pencil, label: 'overlay.tool.stroke' },
  { kind: ToolKind.Number, icon: ListOrdered, label: 'overlay.tool.number' },
  { kind: ToolKind.Text, icon: Type, label: 'overlay.tool.text' },
  { kind: ToolKind.Mosaic, icon: Grid2x2, label: 'overlay.tool.mosaic' },
  { kind: ToolKind.Blur, icon: PaintbrushVertical, label: 'overlay.tool.blur' },
  { kind: ToolKind.Eraser, icon: Eraser, label: 'overlay.tool.eraser' },
];

/** 应用工具栏子组件发出的样式局部更新（color/strokeWidth/fontSize/mosaicBlock 的子集）。 */
const applyStyle = (patch: Partial<StyleState>) => {
  Object.assign(currentStyle.value, patch);
};

const errorText = (e: unknown) =>
  typeof e === 'string' ? e : e instanceof Error ? e.message : String(e ?? t('overlay.error.unknown'));
const { ocrState, ocrResult, ocrError, ocrCopied, ocrMode, ocrModeHover, ocrSelection, copyOcrResult, closeOcr } = useOcr({
  selection,
  frameImage,
  busy,
  initInfo,
  errorText,
});

// 画布尺寸 = 窗口覆盖的显示器区域（逻辑像素）。
const fitCanvas = () => {
  const canvas = canvasRef.value;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
};

const render = () => {
  const canvas = canvasRef.value;
  if (!canvas || !frameImage.value) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  // 绘制采集帧（铺满窗口 = 显示器）。
  ctx.drawImage(frameImage.value, 0, 0, window.innerWidth, window.innerHeight);

  // 标注。
  for (const ann of annotations.items) {
    drawAnnotation(ctx, ann, frameImage.value ?? undefined);
  }
  // 选中的标注：外框高亮（蓝色虚线），便于识别选中对象。
  const selectedId = annotations.selected;
  if (selectedId) {
    const selAnn = annotations.items.find((o) => o.id === selectedId);
    if (selAnn) {
      const bb = annotationBbox(selAnn);
      if (bb) {
        ctx.save();
        ctx.strokeStyle = '#3b82f6';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]);
        ctx.strokeRect(bb.left - 6, bb.top - 6, bb.width + 12, bb.height + 12);
        ctx.restore();
      }
    }
  }
  // 进行中的绘制（拖拽时实时预览：箭头/矩形/画笔/马赛克）。
  const drawing = annotations.drawing;
  if (drawing) {
    drawInProgress(ctx, drawing);
  }

  // 悬停识别的元素高亮：最细亮蓝色边框（不干扰框选，无正式选区时）。
  const hv = hoverElement.value;
  if (hv && !(selection.selection && isValidRect(selection.selection))) {
    const w = hv.right - hv.left;
    const h = hv.bottom - hv.top;
    ctx.save();
    ctx.strokeStyle = '#00b4ff';
    ctx.lineWidth = 1;
    ctx.strokeRect(hv.left + 0.5, hv.top + 0.5, w - 1, h - 1);
    ctx.restore();
  }

  // 选区：外部压暗遮罩 + 白色边框（非红色，红色留给标注）。
  const sel = selection.selection;
  if (sel && isValidRect(sel)) {
    // 1) 选区外压暗：绘制四块半透明暗层，选区内保持清晰。
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.fillRect(0, 0, window.innerWidth, sel.top); // 上
    ctx.fillRect(0, sel.bottom, window.innerWidth, window.innerHeight - sel.bottom); // 下
    ctx.fillRect(0, sel.top, sel.left, sel.bottom - sel.top); // 左
    ctx.fillRect(sel.right, sel.top, window.innerWidth - sel.right, sel.bottom - sel.top); // 右

    // 2) 选区白色细边框。
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(sel.left - 0.75, sel.top - 0.75, sel.right - sel.left + 1.5, sel.bottom - sel.top + 1.5);

    // 3) 白色手柄（带白色描边，黑底白点更醒目）。
    const s = 8;
    const handles: Array<[Handle, number, number]> = [
      [Handle.TopLeft, sel.left, sel.top],
      [Handle.TopRight, sel.right, sel.top],
      [Handle.BottomLeft, sel.left, sel.bottom],
      [Handle.BottomRight, sel.right, sel.bottom],
      [Handle.Top, (sel.left + sel.right) / 2, sel.top],
      [Handle.Bottom, (sel.left + sel.right) / 2, sel.bottom],
      [Handle.Left, sel.left, (sel.top + sel.bottom) / 2],
      [Handle.Right, sel.right, (sel.top + sel.bottom) / 2],
    ];
    for (const [, x, y] of handles) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.strokeRect(x - s / 2, y - s / 2, s, s);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(x - s / 2, y - s / 2, s, s);
    }
  } else {
    // 无选区时整屏压暗，让用户明确知道已进入截图模式。
    // 若悬停识别到控件且带回其所在窗口矩形，则对该窗口区域不压暗（去除阴影），
    // 让用户看清目标窗口内容；其余区域压暗。
    const winR = hoverElement.value?.windowRect;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
    if (winR && winR.right > winR.left && winR.bottom > winR.top) {
      const W = window.innerWidth;
      const H = window.innerHeight;
      ctx.fillRect(0, 0, W, winR.top); // 窗口上方
      ctx.fillRect(0, winR.bottom, W, H - winR.bottom); // 窗口下方
      ctx.fillRect(0, winR.top, winR.left, winR.bottom - winR.top); // 窗口左方
      ctx.fillRect(winR.right, winR.top, W - winR.right, winR.bottom - winR.top); // 窗口右方
    } else {
      ctx.fillRect(0, 0, window.innerWidth, window.innerHeight);
    }
  }

  // 放大镜：仅在启用且有关键位置时绘制。
  if (magnifierEnabled.value && magnifierPos.value) {
    drawMagnifier(ctx, magnifierPos.value);
  }
};

/** 绘制放大镜：光标附近帧局部放大 + 中心像素色值。 */
function drawMagnifier(ctx: CanvasRenderingContext2D, pos: { x: number; y: number }) {
  const frame = frameImage.value;
  if (!frame) return;
  const zoom = 4;
  // 宽度 1.5×（容纳长色码 + 提示文字），高度不变。
  const sizeW = 144;
  const sizeH = 96;
  // 放大源区域（物理像素）。
  const srcHalf = (sizeH / zoom) / 2;
  // 帧是物理分辨率，光标坐标是逻辑像素 → 源坐标乘缩放系数换算（同 readPixel）。
  const sf = initInfo.value?.scaleFactor ?? 1;
  try {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    // 位置：光标右下方，避免遮挡。
    const dx = pos.x + 24;
    const dy = pos.y + 24;
    ctx.fillStyle = 'rgba(17,24,39,0.9)';
    ctx.fillRect(dx, dy, sizeW, sizeH);
    // 从帧绘制放大区域（clip 到圆角矩形内）。
    ctx.beginPath();
    ctx.rect(dx + 2, dy + 2, sizeW - 4, sizeH - 4);
    ctx.clip();
    ctx.drawImage(frame, pos.x * sf - srcHalf, pos.y * sf - srcHalf, srcHalf * 2, srcHalf * 2, dx + 2, dy + 2, sizeW - 4, sizeH - 4);
    ctx.restore();
    // 中心十字准星 + 色值文本。
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dx + sizeW / 2, dy + sizeH / 2 - 8);
    ctx.lineTo(dx + sizeW / 2, dy + sizeH / 2 + 8);
    ctx.moveTo(dx + sizeW / 2 - 8, dy + sizeH / 2);
    ctx.lineTo(dx + sizeW / 2 + 8, dy + sizeH / 2);
    ctx.stroke();
    if (magnifierColor.value) {
      const c = magnifierColor.value;
      const formatted = formatColor(c, colorFormat.value);
      // 色值行（24px）+ 提示行（18px），宽度与放大镜一致。
      ctx.fillStyle = 'rgba(17,24,39,0.9)';
      ctx.fillRect(dx, dy + sizeH, sizeW, 42);
      ctx.fillStyle = '#fff';
      ctx.font = '12px monospace';
      ctx.fillText(formatted, dx + 8, dy + sizeH + 16);
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.font = '10px monospace';
      ctx.fillText(t('overlay.magnifier.hint'), dx + 8, dy + sizeH + 34);
    }
    ctx.restore();
  } catch {
    // 帧读取失败忽略放大镜。
  }
}

/** 绘制进行中的标注（拖拽时实时预览）。转成临时对象复用 drawAnnotation。 */
function drawInProgress(ctx: CanvasRenderingContext2D, d: NonNullable<AnnotationModel['drawing']>) {
  switch (d.kind) {
    case ToolKind.Rect: {
      const rect = rectFromPoints(d.start, d.current);
      if (isValidRect(rect)) {
        drawAnnotation(ctx, { id: 'in-progress', kind: ToolKind.Rect, rect });
      }
      break;
    }
    case ToolKind.Arrow:
      drawAnnotation(ctx, { id: 'in-progress', kind: ToolKind.Arrow, from: d.start, to: d.current });
      break;
    case ToolKind.Stroke:
      if (d.points.length > 0) {
        drawAnnotation(ctx, { id: 'in-progress', kind: ToolKind.Stroke, points: d.points });
      }
      break;
    case ToolKind.Mosaic: {
      const rect = rectFromPoints(d.start, d.current);
      if (isValidRect(rect)) {
        drawAnnotation(ctx, { id: 'in-progress', kind: ToolKind.Mosaic, rect, style: currentStyle.value });
      }
      break;
    }
    case ToolKind.Blur: {
      const rect = rectFromPoints(d.start, d.current);
      if (isValidRect(rect)) {
        drawAnnotation(ctx, { id: 'in-progress', kind: ToolKind.Blur, rect, style: currentStyle.value });
      }
      break;
    }
    case ToolKind.Number: {
      // 序号：在落点画一个预览圆（实际序号在 endDraw 生成）。
      drawAnnotation(ctx, { id: 'in-progress', kind: ToolKind.Number, origin: d.origin, index: 0, style: currentStyle.value });
      break;
    }
    case ToolKind.Text:
      break;
  }
}

const toLocalPoint = (e: MouseEvent) => {
  const rect = canvasRef.value?.getBoundingClientRect();
  return {
    x: e.clientX - (rect?.left ?? 0),
    y: e.clientY - (rect?.top ?? 0),
  };
};

const { detectUnderCursor } = useElementDetect({
  initInfo,
  frameImage,
  selection,
  isDragging,
  isMovingAnnotation,
  pickerMode,
  hoverElement,
  render,
});

const { handlePointerDown, handlePointerMove, handlePointerUp, escapeCancel, confirmCapture, startScrollCapture, togglePicker, commitText, cancelText, undo, redo, removeSelected, switchTool } = usePointerInteraction({
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
});

const handleKeydown = (e: KeyboardEvent) => {
  if (showTextInput.value) return;
  if (e.key === 'Escape') {
    if (selection.selection || annotations.items.length > 0) {
      selection.clear();
      hoverElement.value = null;
      syncSelectionBox();
      render();
    } else {
      void escapeCancel();
    }
    return;
  }
  if (e.key === 'Enter') {
    confirmCapture('copy');
    return;
  }
  if (e.key === 'Backspace' || e.key === 'Delete') {
    removeSelected();
    return;
  }
  // Alt+C：复制光标处颜色并退出截图（仅放大镜可见时可用）。优先于 Z 切格式。
  if (e.altKey && (e.key === 'c' || e.key === 'C')) {
    e.preventDefault();
    if (magnifierEnabled.value && magnifierColor.value) {
      const formatted = formatColor(magnifierColor.value, colorFormat.value);
      navigator.clipboard?.writeText(formatted).catch(() => {});
      // 复制后直接退出截图会话（关闭覆盖层）。
      void escapeCancel();
    }
    return;
  }
  // 放大镜可见时：Z 键切换颜色格式（hex → rgb → rgba → hsl）。Ctrl+Z 仍为撤销。
  if (!e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'z' || e.key === 'Z') && magnifierEnabled.value) {
    e.preventDefault();
    const order: Array<'hex' | 'rgb' | 'rgba' | 'hsl'> = ['hex', 'rgb', 'rgba', 'hsl'];
    const idx = order.indexOf(colorFormat.value);
    colorFormat.value = order[(idx + 1) % order.length];
    render(); // 刷新放大镜色值格式
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
    if (e.shiftKey) redo();
    else undo();
    return;
  }
  const toolKeys: Record<string, ToolKind> = {
    '1': ToolKind.Select,
    '2': ToolKind.Rect,
    '3': ToolKind.Arrow,
    '4': ToolKind.Stroke,
    '5': ToolKind.Number,
    '6': ToolKind.Text,
    '7': ToolKind.Mosaic,
    '8': ToolKind.Blur,
    '9': ToolKind.Eraser,
  };
  if (toolKeys[e.key]) {
    switchTool(toolKeys[e.key]);
  }
};

/** 滚轮微调选区尺寸（选区存在时）：默认 1px，Shift 10px。 */
const handleWheelAdjust = (e: WheelEvent) => {
  const sel = selection.selection;
  if (!sel || !isValidRect(sel) || pickerMode.value) return;
  e.preventDefault();
  const step = e.shiftKey ? 10 : 1;
  const delta = e.deltaY < 0 ? step : -step;
  // 微调选区右下角（扩展/收缩宽高），保持最小 2×2。
  const right = Math.max(sel.left + 2, sel.right + delta);
  const bottom = Math.max(sel.top + 2, sel.bottom + delta);
  selection.setRect({ ...sel, right, bottom });
  syncSelectionBox();
  render();
};

let cleanupKeydown: (() => void) | null = null;
let cleanupWheel: (() => void) | null = null;
let cleanupResize: (() => void) | null = null;

onMounted(async () => {
  fitCanvas();
  // 命名引用以便 onUnmounted 移除（避免匿名监听泄漏）。
  const handleResize = () => {
    fitCanvas();
    render();
  };
  cleanupResize = () => window.removeEventListener('resize', handleResize);
  window.addEventListener('resize', handleResize);

  const win = getCurrentWindow();
  const label = win.label;
  if (!label.startsWith(WINDOW_LABEL_PREFIX)) {
    errorMessage.value = t('overlay.error.not_overlay_window');
    return;
  }

  // 确保 WebView 获得键盘焦点：WebView2 首次加载后焦点可能不在 WebView，
  // 导致键盘事件（Z/Alt+C/快捷键）不触发，需点击才生效。
  win.setFocus().catch(() => {});

  // 覆盖层窗口由后端可见创建；页面背景已通过 html.overlay-window 强制透明，
  // 加载期间透出桌面，采集帧就绪后由 canvas 覆盖显示。
  const t0 = performance.now();
  try {
    const info = await screenshotUniversalOverlayInit();
    await logToFile('debug', `[overlay] overlay_init 完成 ${Math.round(performance.now() - t0)} ms`);
    initInfo.value = info;
    const t1 = performance.now();

    // 通过 frame-image 协议取原始 RGBA 字节（无 PNG 编解码），
    // 用 putImageData 构造成离屏 canvas 供 drawImage 渲染。
    const resp = await fetch(info.frameUrl);
    if (!resp.ok) throw new Error(t('overlay.error.frame_fetch_failed', { status: resp.status }));
    const buffer = await resp.arrayBuffer();
    const width = info.desktopRect.right - info.desktopRect.left;
    const height = info.desktopRect.bottom - info.desktopRect.top;
    await logToFile('debug', `[overlay] 帧字节就绪 ${Math.round(performance.now() - t1)} ms`, { width, height, bytes: buffer.byteLength });
    frameImage.value = frameFromRgba(new Uint8ClampedArray(buffer), width, height);
    // 帧就位后 canvas 接管完整渲染（含选区挖洞遮罩），DOM 选区框关闭避免重叠。
    selectionBox.value = null;
    render();
    // DOM 就绪后再聚焦一次，确保键盘事件（Z/Alt+C）到达。
    win.setFocus().catch(() => {});
  } catch (e) {
    await logToFile('error', '[overlay] init 异常', e);
    errorMessage.value = errorText(e);
  }

  cleanupKeydown = () => window.removeEventListener('keydown', handleKeydown);
  window.addEventListener('keydown', handleKeydown);
  cleanupWheel = () => window.removeEventListener('wheel', handleWheelAdjust);
  window.addEventListener('wheel', handleWheelAdjust, { passive: false });
});

onUnmounted(() => {
  cleanupKeydown?.();
  cleanupWheel?.();
  cleanupResize?.();
});
</script>

<template>
  <div class="overlay-root" @mousedown="handlePointerDown" @mousemove="handlePointerMove" @mouseup="handlePointerUp">
    <!-- 采集帧加载完成前用 CSS 全屏压暗，让「截图模式」阴影立即出现（canvas 渲染依赖帧，会晚 1~2 秒）。 -->
    <div v-if="frameLoading" class="overlay-dim-css"></div>
    <!-- 帧加载中的 loading 提示：避免用户误以为软件卡住。 -->
    <div v-if="frameLoading" class="overlay-loading">
      <div class="overlay-loading-spinner"></div>
      <span>{{ t('overlay.loading') }}</span>
    </div>
    <!-- DOM 选区框：帧未就位时提供拖拽反馈（白色边框，不依赖 canvas/帧）。 -->
    <div v-if="selectionBox && selectionBoxStyle" class="overlay-selection-dom" :style="selectionBoxStyle"></div>
    <canvas ref="canvasRef" class="overlay-canvas" />

    <!-- 错误提示 -->
    <div v-if="errorMessage" class="overlay-error">
      <span>{{ errorMessage }}</span>
      <button class="overlay-error-btn" @click="escapeCancel">{{ t('overlay.close') }}</button>
    </div>

    <!-- 文字输入框 -->
    <div
      v-if="showTextInput"
      class="overlay-text-input"
      :style="{ left: textInputPos.left + 'px', top: textInputPos.top + 'px' }"
      @mousedown.stop
    >
      <input
        v-model="textInput"
        class="overlay-text-field"
        type="text"
        :placeholder="t('overlay.text_input_placeholder')"
        @keydown.enter="commitText"
        @keydown.escape="cancelText"
      />
      <div class="overlay-text-actions">
        <button @click="commitText">{{ t('overlay.confirm') }}</button>
        <button @click="cancelText">{{ t('overlay.cancel') }}</button>
      </div>
    </div>

    <!-- OCR 结果弹窗 -->
    <OcrPanel
      v-if="ocrState !== 'idle'"
      :state="ocrState"
      :result="ocrResult"
      :error="ocrError"
      :copied="ocrCopied"
      @close="closeOcr"
      @copy="copyOcrResult"
    />

    <!-- 工具栏 -->
    <OverlayToolbar
      v-if="toolbarVisible"
      v-model:ocr-mode="ocrMode"
      v-model:ocr-mode-hover="ocrModeHover"
      :toolbar-style="toolbarStyle"
      :active-tool="activeTool"
      :tool-buttons="toolButtons"
      :show-style-bar="showStyleBar"
      :show-stroke-width="showStrokeWidth"
      :show-font-size="showFontSize"
      :show-mosaic-block="showMosaicBlock"
      :current-style="currentStyle"
      :preset-colors="presetColors"
      :busy="busy"
      :selection-box="selectionBox"
      :picker-mode="pickerMode"
      @switch-tool="switchTool"
      @undo="undo"
      @redo="redo"
      @remove-selected="removeSelected"
      @capture="confirmCapture"
      @scroll-capture="startScrollCapture"
      @ocr="ocrSelection"
      @toggle-picker="togglePicker"
      @cancel="escapeCancel"
      @update:style="applyStyle"
    />

    <div class="overlay-status">{{ statusMessage }}</div>
  </div>
</template>

<style>
/* 覆盖层窗口必须全透明：全局 style.css 的 body/html 有背景色，会盖住
   桌面形成白底。这里用非 scoped 样式块把 html/body 背景强制透明。
   !important 覆盖 @layer base 的 @apply bg-background。 */
html.overlay-window,
html.overlay-window body {
  background: transparent !important;
  background-image: none !important;
  background-color: transparent !important;
}
html.overlay-window::before {
  display: none !important;
}
</style>

<style scoped>
.overlay-root {
  position: fixed;
  inset: 0;
  overflow: hidden;
  cursor: crosshair;
  user-select: none;
  background: transparent;
}
.overlay-dim-css {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: rgba(0, 0, 0, 0.35);
  /* 关键：遮罩与 loading 不得拦截鼠标，事件必须直达 root 供选区拖拽。 */
  pointer-events: none;
}
.overlay-loading {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: rgba(255, 255, 255, 0.9);
  font-size: 14px;
  background: rgba(17, 24, 39, 0.75);
  backdrop-filter: blur(8px);
  padding: 20px 28px;
  border-radius: 12px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  /* 不拦截鼠标：用户可能在 loading 期间就开始框选。 */
  pointer-events: none;
}
.overlay-loading-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(255, 255, 255, 0.2);
  border-top-color: #fff;
  border-radius: 50%;
  animation: overlay-spin 0.8s linear infinite;
}
@keyframes overlay-spin {
  to {
    transform: rotate(360deg);
  }
}
/* 帧未就位时的选区反馈：白色细边框，与 canvas 的选区样式一致。 */
.overlay-selection-dom {
  position: absolute;
  z-index: 2;
  border: 1.5px solid #ffffff;
  box-sizing: border-box;
  pointer-events: none;
}
.overlay-canvas {
  position: absolute;
  inset: 0;
}
.overlay-error {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 20;
  display: flex;
  gap: 12px;
  align-items: center;
  background: rgba(220, 38, 38, 0.9);
  color: #fff;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 14px;
}
.overlay-error-btn {
  background: rgba(255, 255, 255, 0.2);
  border: none;
  color: #fff;
  border-radius: 4px;
  padding: 2px 10px;
  cursor: pointer;
}
.overlay-status {
  position: fixed;
  bottom: 70px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(17, 24, 39, 0.7);
  padding: 4px 12px;
  border-radius: 6px;
  font-size: 13px;
  font-family: monospace;
}
.overlay-text-input {
  position: fixed;
  z-index: 30;
  background: rgba(17, 24, 39, 0.9);
  padding: 8px;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}
.overlay-text-field {
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.3);
  color: #fff;
  border-radius: 4px;
  padding: 6px 8px;
  font-size: 14px;
  outline: none;
  width: 180px;
}
.overlay-text-actions {
  display: flex;
  gap: 6px;
  margin-top: 6px;
}
.overlay-text-actions button {
  flex: 1;
  background: rgba(255, 255, 255, 0.15);
  border: none;
  color: #fff;
  border-radius: 4px;
  padding: 4px 0;
  cursor: pointer;
}
</style>