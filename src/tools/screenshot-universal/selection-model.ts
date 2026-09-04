/**
 * 全平台截图：选区交互状态机（纯逻辑，可单测）。
 *
 * 坐标约定：全部使用「物理像素」的虚拟桌面坐标（与后端 capture 层一致）。
 * 单个覆盖层窗口负责其显示器矩形内的渲染与输入；跨屏选区由共享 store
 * 协调（本模块只处理单窗口内坐标）。
 */

/** 物理像素点。 */
export type Point = { x: number; y: number };

/** 物理像素矩形（half-open：right/bottom 为开区间）。 */
export type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** 8 向调整手柄。 */
export enum Handle {
  TopLeft,
  Top,
  TopRight,
  Left,
  Right,
  BottomLeft,
  Bottom,
  BottomRight,
}

/** 选区当前交互模式。 */
export type DragMode =
  | { kind: 'idle' }
  | { kind: 'create'; start: Point }
  | { kind: 'move'; start: Point; origin: Rect }
  | { kind: 'resize'; handle: Handle; origin: Rect };

export const rectFromPoints = (a: Point, b: Point): Rect => {
  const left = Math.min(a.x, b.x);
  const top = Math.min(a.y, b.y);
  const right = Math.max(a.x, b.x);
  const bottom = Math.max(a.y, b.y);
  return { left, top, right, bottom };
};

export const rectSize = (r: Rect): { width: number; height: number } => ({
  width: Math.max(0, r.right - r.left),
  height: Math.max(0, r.bottom - r.top),
});

export const pointInRect = (p: Point, r: Rect): boolean =>
  p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom;

/** 手柄绘制半径（物理像素）。 */
export const HANDLE_SIZE = 8;

/** 命中测试：返回光标所在的手柄，或 Inside（在选区内），或 null（选区外）。 */
export const hitTest = (p: Point, rect: Rect): Handle | 'inside' | null => {
  const s = HANDLE_SIZE;
  const nearLeft = Math.abs(p.x - rect.left) <= s;
  const nearRight = Math.abs(p.x - rect.right) <= s;
  const nearTop = Math.abs(p.y - rect.top) <= s;
  const nearBottom = Math.abs(p.y - rect.bottom) <= s;

  if (nearLeft && nearTop) return Handle.TopLeft;
  if (nearRight && nearTop) return Handle.TopRight;
  if (nearLeft && nearBottom) return Handle.BottomLeft;
  if (nearRight && nearBottom) return Handle.BottomRight;
  if (nearTop) return Handle.Top;
  if (nearBottom) return Handle.Bottom;
  if (nearLeft) return Handle.Left;
  if (nearRight) return Handle.Right;
  if (pointInRect(p, rect)) return 'inside';
  return null;
};

/** 应用 resize 后的新矩形（保持合法最小尺寸 2×2）。 */
export const applyResize = (handle: Handle, origin: Rect, p: Point, minSize = 2): Rect => {
  const x0 = origin.left;
  const y0 = origin.top;
  const x1 = origin.right;
  const y1 = origin.bottom;

  let left = x0;
  let top = y0;
  let right = x1;
  let bottom = y1;

  switch (handle) {
    case Handle.TopLeft:
      left = Math.min(p.x, x1 - minSize);
      top = Math.min(p.y, y1 - minSize);
      break;
    case Handle.Top:
      top = Math.min(p.y, y1 - minSize);
      break;
    case Handle.TopRight:
      right = Math.max(p.x, x0 + minSize);
      top = Math.min(p.y, y1 - minSize);
      break;
    case Handle.Left:
      left = Math.min(p.x, x1 - minSize);
      break;
    case Handle.Right:
      right = Math.max(p.x, x0 + minSize);
      break;
    case Handle.BottomLeft:
      left = Math.min(p.x, x1 - minSize);
      bottom = Math.max(p.y, y0 + minSize);
      break;
    case Handle.Bottom:
      bottom = Math.max(p.y, y0 + minSize);
      break;
    case Handle.BottomRight:
      right = Math.max(p.x, x0 + minSize);
      bottom = Math.max(p.y, y0 + minSize);
      break;
  }

  return { left, top, right, bottom };
};

/** 应用 move 后的新矩形。 */
export const applyMove = (origin: Rect, start: Point, p: Point): Rect => {
  const dx = p.x - start.x;
  const dy = p.y - start.y;
  return {
    left: origin.left + dx,
    top: origin.top + dy,
    right: origin.right + dx,
    bottom: origin.bottom + dy,
  };
};

/** 选区是否合法（宽高 > 1，即最小 2×2，与 applyResize 的 minSize 一致）。 */
export const isValidRect = (r: Rect): boolean =>
  r.right - r.left > 1 && r.bottom - r.top > 1;

/** 选区状态机。 */
export class SelectionModel {
  private rect: Rect | null = null;
  private mode: DragMode = { kind: 'idle' };

  /** 当前选区（若无选区为 null）。 */
  get selection(): Rect | null {
    return this.rect;
  }

  /** 当前交互模式。 */
  get dragMode(): DragMode {
    return this.mode;
  }

  /** 鼠标按下：优先命中手柄/选区内部，否则开始新选区。 */
  pointerDown(p: Point): void {
    if (this.rect && isValidRect(this.rect)) {
      const hit = hitTest(p, this.rect);
      if (hit === 'inside') {
        this.mode = { kind: 'move', start: p, origin: this.rect };
        return;
      }
      if (hit !== null) {
        this.mode = { kind: 'resize', handle: hit, origin: this.rect };
        return;
      }
    }
    // 新建选区。
    this.rect = { left: p.x, top: p.y, right: p.x, bottom: p.y };
    this.mode = { kind: 'create', start: p };
  }

  /** 鼠标移动：按当前模式更新选区。 */
  pointerMove(p: Point): void {
    switch (this.mode.kind) {
      case 'idle':
        break;
      case 'create':
        this.rect = rectFromPoints(this.mode.start, p);
        break;
      case 'move':
        this.rect = applyMove(this.mode.origin, this.mode.start, p);
        break;
      case 'resize':
        this.rect = applyResize(this.mode.handle, this.mode.origin, p);
        break;
    }
  }

  /** 鼠标松开：完成交互。新建的选区若太小则丢弃。 */
  pointerUp(): void {
    if (this.mode.kind === 'create' && this.rect && !isValidRect(this.rect)) {
      this.rect = null;
    }
    this.mode = { kind: 'idle' };
  }

  /** 清空选区。 */
  clear(): void {
    this.rect = null;
    this.mode = { kind: 'idle' };
  }

  /** 设置选区（供外部恢复/初始化）。 */
  setRect(r: Rect): void {
    this.rect = r;
  }
}
