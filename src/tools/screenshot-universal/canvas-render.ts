/**
 * 截图覆盖层标注渲染（纯函数，拆分自 OverlayView.vue）。
 * 这些绘制函数只依赖参数（ctx/标注对象/采集帧），不依赖组件状态，可独立单测。
 */
import { ToolKind } from './annotation-model';
import type { AnnotationModel } from './annotation-model';

export function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: AnnotationModel['items'][number],
  frame?: CanvasImageSource,
) {
  const color = ann.style?.color ?? '#ff4757';
  const strokeWidth = ann.style?.strokeWidth ?? 3;
  const fontSize = ann.style?.fontSize ?? 18;
  ctx.save();
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px sans-serif`;
  switch (ann.kind) {
    case ToolKind.Rect:
      ctx.strokeRect(ann.rect.left, ann.rect.top, ann.rect.right - ann.rect.left, ann.rect.bottom - ann.rect.top);
      break;
    case ToolKind.Arrow: {
      const { from, to } = ann;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const h = 12;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - h * Math.cos(angle - Math.PI / 6), to.y - h * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - h * Math.cos(angle + Math.PI / 6), to.y - h * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
      break;
    }
    case ToolKind.Stroke: {
      ctx.beginPath();
      ann.points.forEach((p, i) => {
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      break;
    }
    case ToolKind.Text:
      ctx.fillText(ann.text || '', ann.origin.x, ann.origin.y + fontSize);
      break;
    case ToolKind.Mosaic:
      drawMosaic(ctx, ann.rect, frame, ann.style?.mosaicBlock);
      break;
    case ToolKind.Number: {
      // 序号：圆圈 + 数字。
      const r = Math.max(12, fontSize * 0.7);
      ctx.beginPath();
      ctx.arc(ann.origin.x, ann.origin.y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `bold ${Math.round(fontSize)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(ann.index), ann.origin.x, ann.origin.y);
      break;
    }
    case ToolKind.Blur:
      drawBlur(ctx, ann.rect, frame);
      break;
  }
  ctx.restore();
}

/** 真实马赛克：把区域像素按块平均化，产生模糊颗粒效果。 */
export function drawMosaic(
  ctx: CanvasRenderingContext2D,
  rect: { left: number; top: number; right: number; bottom: number },
  frame?: CanvasImageSource,
  blockOverride?: number,
) {
  const width = Math.max(1, Math.round(rect.right - rect.left));
  const height = Math.max(1, Math.round(rect.bottom - rect.top));
  // 块大小：显式指定或按区域自适应。
  const block = blockOverride && blockOverride > 0
    ? blockOverride
    : Math.max(6, Math.min(24, Math.round(Math.min(width, height) / 8)));

  if (frame) {
    // 有帧：读区域像素，按块平均颜色后绘制。
    try {
      const off = document.createElement('canvas');
      off.width = width;
      off.height = height;
      const offCtx = off.getContext('2d');
      if (offCtx) {
        offCtx.drawImage(frame, rect.left, rect.top, width, height, 0, 0, width, height);
        const data = offCtx.getImageData(0, 0, width, height).data;
        for (let by = 0; by < height; by += block) {
          for (let bx = 0; bx < width; bx += block) {
            // 计算块内平均色。
            let r = 0, g = 0, b = 0, count = 0;
            for (let y = by; y < Math.min(by + block, height); y++) {
              for (let x = bx; x < Math.min(bx + block, width); x++) {
                const idx = (y * width + x) * 4;
                r += data[idx];
                g += data[idx + 1];
                b += data[idx + 2];
                count++;
              }
            }
            if (count > 0) {
              ctx.fillStyle = `rgb(${Math.round(r / count)}, ${Math.round(g / count)}, ${Math.round(b / count)})`;
              ctx.fillRect(rect.left + bx, rect.top + by, block, block);
            }
          }
        }
        return;
      }
    } catch {
      // 帧读取失败时回退到半透明占位。
    }
  }
  // 无帧/读取失败：半透明灰块占位。
  ctx.fillStyle = 'rgba(128,128,128,0.5)';
  ctx.fillRect(rect.left, rect.top, width, height);
}

/** 高斯模糊：把区域像素用 canvas filter blur 模糊化。 */
export function drawBlur(
  ctx: CanvasRenderingContext2D,
  rect: { left: number; top: number; right: number; bottom: number },
  frame?: CanvasImageSource,
) {
  const width = Math.max(1, Math.round(rect.right - rect.left));
  const height = Math.max(1, Math.round(rect.bottom - rect.top));
  if (!frame) {
    // 无帧：半透明灰块占位。
    ctx.fillStyle = 'rgba(128,128,128,0.5)';
    ctx.fillRect(rect.left, rect.top, width, height);
    return;
  }
  try {
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    offCtx.drawImage(frame, rect.left, rect.top, width, height, 0, 0, width, height);
    // 高斯模糊：offcanvas 模糊后画回主 canvas（模糊半径随区域缩放）。
    const blur = Math.max(6, Math.min(24, Math.round(Math.min(width, height) / 8)));
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(off, rect.left, rect.top);
    ctx.restore();
  } catch {
    // 失败回退灰块。
    ctx.fillStyle = 'rgba(128,128,128,0.5)';
    ctx.fillRect(rect.left, rect.top, width, height);
  }
}

/** 计算标注对象的外包围盒（用于选中高亮）。返回 null 表示空对象。 */
export function annotationBbox(ann: AnnotationModel['items'][number]): { left: number; top: number; width: number; height: number } | null {
  switch (ann.kind) {
    case ToolKind.Rect:
    case ToolKind.Mosaic:
    case ToolKind.Blur:
      return {
        left: ann.rect.left,
        top: ann.rect.top,
        width: ann.rect.right - ann.rect.left,
        height: ann.rect.bottom - ann.rect.top,
      };
    case ToolKind.Arrow: {
      const left = Math.min(ann.from.x, ann.to.x);
      const top = Math.min(ann.from.y, ann.to.y);
      return {
        left,
        top,
        width: Math.abs(ann.to.x - ann.from.x),
        height: Math.abs(ann.to.y - ann.from.y),
      };
    }
    case ToolKind.Stroke: {
      if (ann.points.length === 0) return null;
      const xs = ann.points.map((p) => p.x);
      const ys = ann.points.map((p) => p.y);
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      return {
        left,
        top,
        width: Math.max(...xs) - left,
        height: Math.max(...ys) - top,
      };
    }
    case ToolKind.Text:
    case ToolKind.Number:
      return { left: ann.origin.x, top: ann.origin.y, width: 160, height: 32 };
  }
}
