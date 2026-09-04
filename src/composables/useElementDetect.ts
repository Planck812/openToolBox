import type { Ref } from 'vue';
import { elementFromPoint } from '@/lib/ipc/element-detect';
import { isValidRect, type SelectionModel } from '@/tools/screenshot-universal/selection-model';

/** 悬停识别到的元素矩形（覆盖层逻辑像素）。 */
export interface HoverElement {
  left: number;
  top: number;
  right: number;
  bottom: number;
  windowRect: { left: number; top: number; right: number; bottom: number } | null;
}

/**
 * 截图覆盖层「悬停控件识别」子系统（拆分自 OverlayView.vue）。
 * 节流调用后端 element_from_point，用序号防止 async 请求乱序覆盖。
 */
export function useElementDetect(deps: {
  initInfo: Ref<{ scaleFactor: number | null; desktopRect: { left: number; top: number; right: number; bottom: number } } | null>;
  frameImage: Ref<HTMLCanvasElement | null>;
  selection: SelectionModel;
  isDragging: Ref<boolean>;
  isMovingAnnotation: Ref<boolean>;
  pickerMode: Ref<boolean>;
  hoverElement: Ref<HoverElement | null>;
  render: () => void;
}) {
  const { initInfo, frameImage, selection, isDragging, isMovingAnnotation, pickerMode, hoverElement, render } = deps;

  /** 悬停识别节流：两次 UIA 查询间隔（ms）。 */
  let lastElementDetect = 0;
  let elementDetectSeq = 0;
  const ELEMENT_DETECT_THROTTLE = 100;

  const detectUnderCursor = async (p: { x: number; y: number }) => {
    const info = initInfo.value;
    // 拖拽/标注/取色中不识别；有正式选区时也不识别（避免干扰手柄）。
    if (!info || !frameImage.value || isDragging.value || isMovingAnnotation.value || pickerMode.value) {
      return;
    }
    if (selection.selection && isValidRect(selection.selection)) {
      hoverElement.value = null;
      return;
    }
    const now = performance.now();
    if (now - lastElementDetect < ELEMENT_DETECT_THROTTLE) return;
    lastElementDetect = now;
    // 转物理桌面点（复用 startScrollCapture 的换算）。
    const sf = info.scaleFactor ?? 1;
    const pt = {
      x: info.desktopRect.left + Math.round(p.x * sf),
      y: info.desktopRect.top + Math.round(p.y * sf),
    };
    const seq = ++elementDetectSeq;
    try {
      const el = await elementFromPoint(pt);
      // 仅当没有更新的请求时应用结果。
      if (seq !== elementDetectSeq) return;
      // 结果返回时若已建选区（点击吸附/框选完成），丢弃并清空高亮，避免残留。
      if (selection.selection && isValidRect(selection.selection)) {
        if (hoverElement.value) hoverElement.value = null;
        return;
      }
      if (el) {
        // 物理像素 → 覆盖层逻辑像素。
        const toLogical = (v: number) => (v - info.desktopRect.left) / sf;
        const toLogicalY = (v: number) => (v - info.desktopRect.top) / sf;
        hoverElement.value = {
          left: toLogical(el.left),
          top: toLogicalY(el.top),
          right: toLogical(el.right),
          bottom: toLogicalY(el.bottom),
          windowRect: el.windowRect
            ? {
                left: toLogical(el.windowRect[0]),
                top: toLogicalY(el.windowRect[1]),
                right: toLogical(el.windowRect[2]),
                bottom: toLogicalY(el.windowRect[3]),
              }
            : null,
        };
      } else {
        hoverElement.value = null;
      }
      render();
    } catch {
      if (seq === elementDetectSeq) hoverElement.value = null;
    }
  };

  return { detectUnderCursor };
}
