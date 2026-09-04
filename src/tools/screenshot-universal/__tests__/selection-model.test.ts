import { describe, expect, it } from 'vitest';
import { SelectionModel, Handle, hitTest, rectFromPoints, applyResize, applyMove, pointInRect } from '../selection-model';

describe('SelectionModel', () => {
  it('创建选区：拖拽生成矩形', () => {
    const model = new SelectionModel();
    model.pointerDown({ x: 10, y: 10 });
    expect(model.selection).toEqual({ left: 10, top: 10, right: 10, bottom: 10 });
    model.pointerMove({ x: 100, y: 60 });
    expect(model.selection).toEqual({ left: 10, top: 10, right: 100, bottom: 60 });
    model.pointerUp();
    expect(model.dragMode.kind).toBe('idle');
  });

  it('反向拖拽（右下 → 左上）生成规范矩形', () => {
    const model = new SelectionModel();
    model.pointerDown({ x: 100, y: 60 });
    model.pointerMove({ x: 10, y: 10 });
    expect(model.selection).toEqual({ left: 10, top: 10, right: 100, bottom: 60 });
    model.pointerUp();
  });

  it('过小选区在松开后丢弃', () => {
    const model = new SelectionModel();
    model.pointerDown({ x: 50, y: 50 });
    model.pointerMove({ x: 51, y: 51 });
    model.pointerUp();
    expect(model.selection).toBeNull();
  });

  it('在选区内按下进入 move 模式', () => {
    const model = new SelectionModel();
    model.setRect({ left: 10, top: 10, right: 100, bottom: 60 });
    model.pointerDown({ x: 50, y: 30 });
    expect(model.dragMode.kind).toBe('move');
    model.pointerMove({ x: 60, y: 40 });
    expect(model.selection).toEqual({ left: 20, top: 20, right: 110, bottom: 70 });
    model.pointerUp();
  });

  it('在手柄上按下进入 resize 模式', () => {
    const model = new SelectionModel();
    model.setRect({ left: 10, top: 10, right: 100, bottom: 60 });
    model.pointerDown({ x: 100, y: 10 }); // TopRight 手柄
    expect(model.dragMode.kind).toBe('resize');
    if (model.dragMode.kind === 'resize') {
      expect(model.dragMode.handle).toBe(Handle.TopRight);
    }
    model.pointerMove({ x: 150, y: 5 });
    expect(model.selection).toEqual({ left: 10, top: 5, right: 150, bottom: 60 });
  });

  it('clear 清空选区与模式', () => {
    const model = new SelectionModel();
    model.pointerDown({ x: 0, y: 0 });
    model.clear();
    expect(model.selection).toBeNull();
    expect(model.dragMode.kind).toBe('idle');
  });
});

describe('geometry helpers', () => {
  it('rectFromPoints 规范化', () => {
    expect(rectFromPoints({ x: 50, y: 10 }, { x: 10, y: 50 })).toEqual({ left: 10, top: 10, right: 50, bottom: 50 });
  });

  it('pointInRect half-open', () => {
    const rect = { left: 0, top: 0, right: 100, bottom: 50 };
    expect(pointInRect({ x: 0, y: 0 }, rect)).toBe(true);
    expect(pointInRect({ x: 99, y: 49 }, rect)).toBe(true);
    expect(pointInRect({ x: 100, y: 0 }, rect)).toBe(false);
    expect(pointInRect({ x: 0, y: 50 }, rect)).toBe(false);
  });

  it('hitTest 区分手柄与内部', () => {
    const rect = { left: 0, top: 0, right: 100, bottom: 50 };
    expect(hitTest({ x: 0, y: 0 }, rect)).toBe(Handle.TopLeft);
    expect(hitTest({ x: 100, y: 50 }, rect)).toBe(Handle.BottomRight);
    expect(hitTest({ x: 50, y: 0 }, rect)).toBe(Handle.Top);
    expect(hitTest({ x: 0, y: 25 }, rect)).toBe(Handle.Left);
    expect(hitTest({ x: 50, y: 25 }, rect)).toBe('inside');
    expect(hitTest({ x: 200, y: 200 }, rect)).toBeNull();
  });

  it('applyResize 保持最小尺寸', () => {
    const origin = { left: 10, top: 10, right: 100, bottom: 60 };
    const result = applyResize(Handle.TopLeft, origin, { x: 200, y: 200 });
    expect(result.left).toBeLessThanOrEqual(result.right - 2);
    expect(result.top).toBeLessThanOrEqual(result.bottom - 2);
  });

  it('applyMove 平移', () => {
    const origin = { left: 10, top: 10, right: 100, bottom: 60 };
    expect(applyMove(origin, { x: 0, y: 0 }, { x: 5, y: -3 })).toEqual({ left: 15, top: 7, right: 105, bottom: 57 });
  });
});
