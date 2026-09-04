/**
 * 全平台截图：标注状态机（纯逻辑，可单测）。
 *
 * 标注坐标与选区一致：物理像素（相对采集帧左上角）。
 */

/** 标注工具类型（与现有 Windows 截图的 ToolKind 语义一致）。 */
export enum ToolKind {
  Select = 'select',
  Rect = 'rect',
  Arrow = 'arrow',
  Stroke = 'stroke',
  Text = 'text',
  Mosaic = 'mosaic',
  Number = 'number',
  Eraser = 'eraser',
  Blur = 'blur',
}

export type Point = { x: number; y: number };

/** 标注样式：颜色/线宽/字号/马赛克块大小。缺省用渲染时的默认值。 */
export type AnnotationStyle = {
  color?: string;
  strokeWidth?: number;
  fontSize?: number;
  mosaicBlock?: number;
};

/** 标注对象（可撤销/重做的最小单元）。style 可选，渲染时用默认值兼容旧对象。 */
export type AnnotationObject =
  | { id: string; kind: ToolKind.Rect; rect: { left: number; top: number; right: number; bottom: number }; style?: AnnotationStyle }
  | { id: string; kind: ToolKind.Arrow; from: Point; to: Point; style?: AnnotationStyle }
  | { id: string; kind: ToolKind.Stroke; points: Point[]; style?: AnnotationStyle }
  | { id: string; kind: ToolKind.Text; origin: Point; text: string; style?: AnnotationStyle }
  | { id: string; kind: ToolKind.Mosaic; rect: { left: number; top: number; right: number; bottom: number }; style?: AnnotationStyle }
  | { id: string; kind: ToolKind.Number; origin: Point; index: number; style?: AnnotationStyle }
  | { id: string; kind: ToolKind.Blur; rect: { left: number; top: number; right: number; bottom: number }; style?: AnnotationStyle };

let nextId = 0;
const genId = () => `ann-${nextId++}`;

/** 进行中的绘制。 */
export type InProgress =
  | { kind: ToolKind.Rect; start: Point; current: Point }
  | { kind: ToolKind.Arrow; start: Point; current: Point }
  | { kind: ToolKind.Stroke; points: Point[] }
  | { kind: ToolKind.Text; origin: Point }
  | { kind: ToolKind.Mosaic; start: Point; current: Point }
  | { kind: ToolKind.Number; origin: Point }
  | { kind: ToolKind.Blur; start: Point; current: Point };

/** 标注状态机。 */
export class AnnotationModel {
  private objects: AnnotationObject[] = [];
  private undoStack: AnnotationObject[][] = [];
  private redoStack: AnnotationObject[][] = [];
  private selectedId: string | null = null;
  private inProgress: InProgress | null = null;
  private editingTextId: string | null = null;
  /** 正在移动的对象（拖拽移动标注）。 */
  private moveState: { id: string; start: Point; origin: AnnotationObject } | null = null;

  /** 当前全部标注对象。 */
  get items(): AnnotationObject[] {
    return this.objects;
  }

  /** 选中的标注 id。 */
  get selected(): string | null {
    return this.selectedId;
  }

  /** 进行中的绘制。 */
  get drawing(): InProgress | null {
    return this.inProgress;
  }

  /** 正在编辑文字的标注 id。 */
  get editingText(): string | null {
    return this.editingTextId;
  }

  private pushHistory(): void {
    this.undoStack.push(this.objects.map((o) => ({ ...o })));
    this.redoStack = [];
    // 历史深度上限，避免极端场景内存膨胀。
    if (this.undoStack.length > 100) {
      this.undoStack.shift();
    }
  }

  /** 开始绘制（Rect/Arrow/Stroke/Text/Mosaic）。style 为当前工具样式。 */
  beginDraw(kind: ToolKind, p: Point, style?: AnnotationStyle): void {
    switch (kind) {
      case ToolKind.Rect:
        this.inProgress = { kind, start: p, current: p };
        break;
      case ToolKind.Arrow:
        this.inProgress = { kind, start: p, current: p };
        break;
      case ToolKind.Stroke:
        this.inProgress = { kind, points: [p] };
        break;
      case ToolKind.Text:
        this.inProgress = { kind, origin: p };
        break;
      case ToolKind.Mosaic:
        this.inProgress = { kind, start: p, current: p };
        break;
      case ToolKind.Number:
        this.inProgress = { kind, origin: p };
        break;
      case ToolKind.Blur:
        this.inProgress = { kind, start: p, current: p };
        break;
      default:
        this.inProgress = null;
    }
    // 拷贝 style，防止外部传入的引用被后续修改污染（样式各自独立）。
    this.pendingStyle = style ? { ...style } : undefined;
  }

  /** 应用样式到新提交的标注对象（beginDraw 时暂存）。 */
  private pendingStyle?: AnnotationStyle;

  /** 更新进行中的绘制。 */
  updateDraw(p: Point): void {
    const d = this.inProgress;
    if (!d) return;
    switch (d.kind) {
      case ToolKind.Rect:
      case ToolKind.Arrow:
      case ToolKind.Mosaic:
      case ToolKind.Blur:
        d.current = p;
        break;
      case ToolKind.Stroke:
        d.points.push(p);
        break;
      default:
        break;
    }
  }

  /** 橡皮擦：擦除命中的标注对象（返回是否擦除了）。 */
  eraseAt(p: Point, padding = 12): boolean {
    const hit = this.hitTest(p, padding);
    if (!hit) return false;
    this.pushHistory();
    this.objects = this.objects.filter((o) => o.id !== hit.id);
    if (this.selectedId === hit.id) this.selectedId = null;
    return true;
  }

  /** 结束绘制，将进行中的对象提交为正式对象。 */
  endDraw(): void {
    const d = this.inProgress;
    if (!d) return;
    this.inProgress = null;
    const style = this.pendingStyle;
    this.pendingStyle = undefined;

    switch (d.kind) {
      case ToolKind.Rect: {
        const rect = rectFromPoints(d.start, d.current);
        if (isValidRect(rect)) {
          this.pushHistory();
          this.objects.push({ id: genId(), kind: ToolKind.Rect, rect, style });
          this.selectedId = null;
        }
        break;
      }
      case ToolKind.Arrow:
        this.pushHistory();
        this.objects.push({ id: genId(), kind: ToolKind.Arrow, from: d.start, to: d.current, style });
        this.selectedId = null;
        break;
      case ToolKind.Stroke:
        if (d.points.length >= 2) {
          this.pushHistory();
          this.objects.push({ id: genId(), kind: ToolKind.Stroke, points: d.points, style });
          this.selectedId = null;
        }
        break;
      case ToolKind.Text:
        // 文字对象在用户确认输入后通过 commitText 提交；此处仅记录起点。
        this.editingTextId = genId();
        this.pushHistory();
        this.objects.push({ id: this.editingTextId, kind: ToolKind.Text, origin: d.origin, text: '', style });
        this.selectedId = this.editingTextId;
        break;
      case ToolKind.Mosaic: {
        const rect = rectFromPoints(d.start, d.current);
        if (isValidRect(rect)) {
          this.pushHistory();
          this.objects.push({ id: genId(), kind: ToolKind.Mosaic, rect, style });
          this.selectedId = null;
        }
        break;
      }
      case ToolKind.Number: {
        this.pushHistory();
        // 序号自动递增：已有 Number 对象的最大 index + 1。
        const maxIndex = this.objects
          .filter((o): o is Extract<AnnotationObject, { kind: ToolKind.Number }> => o.kind === ToolKind.Number)
          .reduce((max, o) => Math.max(max, o.index), 0);
        this.objects.push({ id: genId(), kind: ToolKind.Number, origin: d.origin, index: maxIndex + 1, style });
        this.selectedId = null;
        break;
      }
      case ToolKind.Blur: {
        const rect = rectFromPoints(d.start, d.current);
        if (isValidRect(rect)) {
          this.pushHistory();
          this.objects.push({ id: genId(), kind: ToolKind.Blur, rect, style });
          this.selectedId = null;
        }
        break;
      }
    }
  }

  /** 提交文字内容（结束文字编辑）。 */
  commitText(text: string): void {
    if (!this.editingTextId) return;
    const obj = this.objects.find((o) => o.id === this.editingTextId);
    if (obj && obj.kind === ToolKind.Text) {
      obj.text = text;
    }
    this.editingTextId = null;
  }

  /** 取消进行中的文字编辑。 */
  cancelTextEdit(): void {
    if (this.editingTextId) {
      this.objects = this.objects.filter((o) => o.id !== this.editingTextId);
      this.editingTextId = null;
      this.selectedId = null;
    }
  }

  /** 命中测试：返回光标处最上层的标注对象（近似命中）。 */
  hitTest(p: Point, padding = 8): AnnotationObject | null {
    for (let i = this.objects.length - 1; i >= 0; i--) {
      const o = this.objects[i];
      if (objContains(o, p, padding)) return o;
    }
    return null;
  }

  /** 选中标注对象。 */
  select(id: string | null): void {
    this.selectedId = id;
  }

  /** 应用样式到指定标注（进 undo 栈，可撤销）。 */
  applyStyle(id: string, style: AnnotationStyle): boolean {
    const obj = this.objects.find((o) => o.id === id);
    if (!obj) return false;
    this.pushHistory();
    obj.style = { ...(obj.style ?? {}), ...style };
    return true;
  }

  /** 删除选中对象。 */
  deleteSelected(): boolean {
    if (!this.selectedId) return false;
    this.pushHistory();
    this.objects = this.objects.filter((o) => o.id !== this.selectedId);
    this.selectedId = null;
    return true;
  }

  /** 开始移动对象：记录起点与对象原始几何。 */
  beginMove(id: string, p: Point): boolean {
    const obj = this.objects.find((o) => o.id === id);
    if (!obj) return false;
    this.selectedId = id;
    this.moveState = { id, start: p, origin: structuredClone(obj) };
    return true;
  }

  /** 更新移动：按位移更新对象几何。 */
  updateMove(p: Point): void {
    const ms = this.moveState;
    if (!ms) return;
    const dx = p.x - ms.start.x;
    const dy = p.y - ms.start.y;
    const obj = this.objects.find((o) => o.id === ms.id);
    if (!obj) return;
    switch (obj.kind) {
      case ToolKind.Rect:
      case ToolKind.Mosaic:
      case ToolKind.Blur:
        if (ms.origin.kind === obj.kind) {
          obj.rect = {
            left: ms.origin.rect.left + dx,
            top: ms.origin.rect.top + dy,
            right: ms.origin.rect.right + dx,
            bottom: ms.origin.rect.bottom + dy,
          };
        }
        break;
      case ToolKind.Arrow:
        if (ms.origin.kind === obj.kind) {
          obj.from = { x: ms.origin.from.x + dx, y: ms.origin.from.y + dy };
          obj.to = { x: ms.origin.to.x + dx, y: ms.origin.to.y + dy };
        }
        break;
      case ToolKind.Stroke:
        if (ms.origin.kind === obj.kind) {
          obj.points = ms.origin.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy }));
        }
        break;
      case ToolKind.Text:
        if (ms.origin.kind === obj.kind) {
          obj.origin = { x: ms.origin.origin.x + dx, y: ms.origin.origin.y + dy };
        }
        break;
      case ToolKind.Number:
        if (ms.origin.kind === obj.kind) {
          obj.origin = { x: ms.origin.origin.x + dx, y: ms.origin.origin.y + dy };
        }
        break;
    }
  }

  /** 结束移动。 */
  endMove(): void {
    this.moveState = null;
  }

  /** 撤销。 */
  undo(): boolean {
    if (this.undoStack.length === 0) return false;
    this.redoStack.push(this.objects.map((o) => ({ ...o })));
    this.objects = this.undoStack.pop()!;
    this.selectedId = null;
    this.editingTextId = null;
    this.inProgress = null;
    return true;
  }

  /** 重做。 */
  redo(): boolean {
    if (this.redoStack.length === 0) return false;
    this.undoStack.push(this.objects.map((o) => ({ ...o })));
    this.objects = this.redoStack.pop()!;
    this.selectedId = null;
    this.editingTextId = null;
    this.inProgress = null;
    return true;
  }
}

const rectFromPoints = (a: Point, b: Point): { left: number; top: number; right: number; bottom: number } => ({
  left: Math.min(a.x, b.x),
  top: Math.min(a.y, b.y),
  right: Math.max(a.x, b.x),
  bottom: Math.max(a.y, b.y),
});

const isValidRect = (r: { left: number; top: number; right: number; bottom: number }): boolean =>
  r.right - r.left > 1 && r.bottom - r.top > 1;

/** 标注对象是否包含点 p（带容差）。 */
function objContains(o: AnnotationObject, p: Point, padding: number): boolean {
  switch (o.kind) {
    case ToolKind.Rect:
    case ToolKind.Mosaic:
    case ToolKind.Blur:
      return (
        p.x >= o.rect.left - padding &&
        p.x <= o.rect.right + padding &&
        p.y >= o.rect.top - padding &&
        p.y <= o.rect.bottom + padding
      );
    case ToolKind.Arrow:
      return pointNearSegment(p, o.from, o.to, padding);
    case ToolKind.Stroke:
      for (let i = 1; i < o.points.length; i++) {
        if (pointNearSegment(p, o.points[i - 1], o.points[i], padding)) return true;
      }
      return o.points.some((pt) => Math.abs(pt.x - p.x) <= padding && Math.abs(pt.y - p.y) <= padding);
    case ToolKind.Text:
    case ToolKind.Number:
      // 文字/序号命中：起点附近一个粗略区域。
      return p.x >= o.origin.x - padding && p.x <= o.origin.x + 160 + padding && p.y >= o.origin.y - padding && p.y <= o.origin.y + 32 + padding;
  }
}

function pointNearSegment(p: Point, a: Point, b: Point, padding: number): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.abs(p.x - a.x) <= padding && Math.abs(p.y - a.y) <= padding;
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY) <= padding;
}
