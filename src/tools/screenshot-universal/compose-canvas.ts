/**
 * 全平台截图：canvas 渲染与出图。
 *
 * 覆盖层窗口内用 canvas 显示采集帧 + 标注；确认时导出两个 PNG：
 * - original：仅采集帧（无标注）——作为历史 original 快照。
 * - final：采集帧 + 标注 ——作为最终图。
 *
 * 导出使用 offscreen canvas 按物理像素重建，避免 HiDPI 缩放丢失。
 */

import { AnnotationObject, ToolKind } from './annotation-model';
import i18n from '@/i18n';

/**
 * 在 canvas 上绘制采集帧（image）与标注列表。
 *
 * @param ctx 目标 2D 上下文（逻辑像素坐标系）。
 * @param image 采集帧 HTMLImageElement（已加载）。
 * @param annotations 标注对象（物理像素）。
 * @param scale 物理像素 → 逻辑像素 的缩放（= 1 / devicePixelRatio，供显示用）。
 */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  annotations: AnnotationObject[],
  scale = 1,
): void {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.drawImage(image, 0, 0, ctx.canvas.width, ctx.canvas.height);
  for (const ann of annotations) {
    drawAnnotation(ctx, ann, scale);
  }
}

function drawAnnotation(
  ctx: CanvasRenderingContext2D,
  ann: AnnotationObject,
  scale: number,
  origin: { x: number; y: number } = { x: 0, y: 0 },
): void {
  const color = ann.style?.color ?? '#ff4757';
  const strokeWidth = (ann.style?.strokeWidth ?? 3) * scale;
  const fontSize = (ann.style?.fontSize ?? 18) * scale;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.lineWidth = strokeWidth;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px sans-serif`;

  switch (ann.kind) {
    case ToolKind.Rect:
      ctx.strokeRect(
        ann.rect.left - origin.x,
        ann.rect.top - origin.y,
        ann.rect.right - ann.rect.left,
        ann.rect.bottom - ann.rect.top,
      );
      break;
    case ToolKind.Arrow: {
      const from = { x: ann.from.x - origin.x, y: ann.from.y - origin.y };
      const to = { x: ann.to.x - origin.x, y: ann.to.y - origin.y };
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      // 箭头尖。
      const angle = Math.atan2(to.y - from.y, to.x - from.x);
      const headLen = 12;
      ctx.beginPath();
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - headLen * Math.cos(angle - Math.PI / 6), to.y - headLen * Math.sin(angle - Math.PI / 6));
      ctx.moveTo(to.x, to.y);
      ctx.lineTo(to.x - headLen * Math.cos(angle + Math.PI / 6), to.y - headLen * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
      break;
    }
    case ToolKind.Stroke: {
      ctx.beginPath();
      ann.points.forEach((p, i) => {
        const x = p.x - origin.x;
        const y = p.y - origin.y;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      break;
    }
    case ToolKind.Text:
      ctx.fillText(ann.text || '', ann.origin.x - origin.x, ann.origin.y - origin.y + fontSize);
      break;
    case ToolKind.Mosaic: {
      // 真实马赛克：从 canvas 当前内容读区域像素，按块平均化。
      drawMosaic(ctx, ann.rect, { x: origin.x, y: origin.y }, ann.style?.mosaicBlock);
      break;
    }
    case ToolKind.Number: {
      // 序号：圆圈 + 数字（导出与预览一致）。
      const x = ann.origin.x - origin.x;
      const y = ann.origin.y - origin.y;
      const r = Math.max(12, fontSize * 0.7);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = `bold ${Math.round(fontSize)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(ann.index), x, y);
      break;
    }
    case ToolKind.Blur: {
      // 高斯模糊：从 canvas 已绘制像素读区域，模糊后重画。
      drawBlur(ctx, ann.rect, { x: origin.x, y: origin.y });
      break;
    }
  }
  ctx.restore();
}

/** 高斯模糊：把 ctx 上已绘制的区域像素用 filter blur 模糊化。 */
function drawBlur(
  ctx: CanvasRenderingContext2D,
  rect: { left: number; top: number; right: number; bottom: number },
  origin: { x: number; y: number },
): void {
  const width = Math.max(1, Math.round(rect.right - rect.left));
  const height = Math.max(1, Math.round(rect.bottom - rect.top));
  const ox = Math.round(rect.left - origin.x);
  const oy = Math.round(rect.top - origin.y);
  try {
    // 从 canvas 当前内容读区域像素到离屏 canvas。
    const off = document.createElement('canvas');
    off.width = width;
    off.height = height;
    const offCtx = off.getContext('2d');
    if (!offCtx) return;
    offCtx.drawImage(ctx.canvas, ox, oy, width, height, 0, 0, width, height);
    const blur = Math.max(6, Math.min(24, Math.round(Math.min(width, height) / 8)));
    ctx.save();
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(off, ox, oy);
    ctx.restore();
  } catch {
    ctx.fillStyle = 'rgba(128,128,128,0.5)';
    ctx.fillRect(ox, oy, width, height);
  }
}

/** 真实马赛克：把 ctx 上已绘制的区域像素按块平均化，产生模糊颗粒。 */
function drawMosaic(
  ctx: CanvasRenderingContext2D,
  rect: { left: number; top: number; right: number; bottom: number },
  origin: { x: number; y: number },
  blockOverride?: number,
): void {
  const width = Math.max(1, Math.round(rect.right - rect.left));
  const height = Math.max(1, Math.round(rect.bottom - rect.top));
  // 块大小：显式指定或按区域自适应（大区域用大块，小区域用小块）。
  const block = blockOverride && blockOverride > 0
    ? blockOverride
    : Math.max(6, Math.min(24, Math.round(Math.min(width, height) / 8)));
  // canvas 坐标系：标注坐标减去 origin。
  const ox = Math.round(rect.left - origin.x);
  const oy = Math.round(rect.top - origin.y);
  try {
    // getImageData 读取像素缓冲（不受 transform 影响），用 canvas 坐标。
    const data = ctx.getImageData(ox, oy, width, height).data;
    for (let by = 0; by < height; by += block) {
      for (let bx = 0; bx < width; bx += block) {
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
          ctx.fillRect(ox + bx, oy + by, block, block);
        }
      }
    }
  } catch {
    // 读取失败时回退半透明占位。
    ctx.fillStyle = 'rgba(128,128,128,0.5)';
    ctx.fillRect(ox, oy, width, height);
  }
}

/**
 * 把原始 RGBA 字节构造成离屏 canvas。
 *
 * 全平台截图用「原始像素直传」取代 PNG 编码（4K 全屏 PNG 编码需 1~2s，
 * 原始 RGBA 传输 + putImageData 近乎零成本）。后续 drawImage 可直接用
 * 这个 canvas（drawImage 对 canvas 与 img 一视同仁）。
 */
export function frameFromRgba(rgba: Uint8ClampedArray, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
  return canvas;
}

/**
 * 从采集帧（img 或 canvas）导出「原图」PNG（无标注）。
 * 输出尺寸 = 选区的物理像素尺寸。
 */
export async function exportOriginalPng(
  image: CanvasImageSource,
  rect: { left: number; top: number; right: number; bottom: number },
): Promise<Blob> {
  const width = Math.max(1, Math.round(rect.right - rect.left));
  const height = Math.max(1, Math.round(rect.bottom - rect.top));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // 采集帧与画布同坐标系（物理像素），直接裁剪。
  ctx.drawImage(image, rect.left, rect.top, width, height, 0, 0, width, height);
  return blobFromCanvas(canvas);
}

/**
 * 导出「最终图」PNG（采集帧 + 标注）。
 * 输出尺寸 = 选区的物理像素尺寸；标注以物理像素绘制。
 */
export async function exportFinalPng(
  image: CanvasImageSource,
  annotations: AnnotationObject[],
  rect: { left: number; top: number; right: number; bottom: number },
): Promise<Blob> {
  const width = Math.max(1, Math.round(rect.right - rect.left));
  const height = Math.max(1, Math.round(rect.bottom - rect.top));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  // 1) 绘制采集帧选区。
  ctx.drawImage(image, rect.left, rect.top, width, height, 0, 0, width, height);
  // 2) 绘制标注（物理像素；origin 偏移到选区坐标系）。
  ctx.save();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#ff4757';
  ctx.fillStyle = '#ff4757';
  ctx.font = '18px sans-serif';
  for (const ann of annotations) {
    drawAnnotation(ctx, ann, 1, { x: rect.left, y: rect.top });
  }
  ctx.restore();
  return blobFromCanvas(canvas);
}

function blobFromCanvas(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(i18n.global.t('tools.screenshot.export_png_failed')));
    }, 'image/png');
  });
}
