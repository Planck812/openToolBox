import { describe, expect, it } from 'vitest';
import { AnnotationModel, ToolKind } from '../annotation-model';

describe('AnnotationModel', () => {
  it('绘制矩形并提交', () => {
    const model = new AnnotationModel();
    model.beginDraw(ToolKind.Rect, { x: 0, y: 0 });
    model.updateDraw({ x: 100, y: 50 });
    model.endDraw();
    expect(model.items).toHaveLength(1);
    expect(model.items[0].kind).toBe(ToolKind.Rect);
    expect(model.items[0].rect).toEqual({ left: 0, top: 0, right: 100, bottom: 50 });
  });

  it('过小矩形不提交', () => {
    const model = new AnnotationModel();
    model.beginDraw(ToolKind.Rect, { x: 10, y: 10 });
    model.updateDraw({ x: 11, y: 11 });
    model.endDraw();
    expect(model.items).toHaveLength(0);
  });

  it('箭头与画笔', () => {
    const model = new AnnotationModel();
    model.beginDraw(ToolKind.Arrow, { x: 0, y: 0 });
    model.updateDraw({ x: 50, y: 50 });
    model.endDraw();
    expect(model.items[0].kind).toBe(ToolKind.Arrow);

    model.beginDraw(ToolKind.Stroke, { x: 0, y: 0 });
    model.updateDraw({ x: 10, y: 10 });
    model.updateDraw({ x: 20, y: 20 });
    model.endDraw();
    expect(model.items[1].kind).toBe(ToolKind.Stroke);
    expect(model.items[1].points).toHaveLength(3);
  });

  it('文字编辑与提交', () => {
    const model = new AnnotationModel();
    model.beginDraw(ToolKind.Text, { x: 10, y: 10 });
    model.endDraw();
    expect(model.editingText).not.toBeNull();
    model.commitText('你好');
    const textObj = model.items.find((o) => o.kind === ToolKind.Text);
    expect(textObj?.text).toBe('你好');
    expect(model.editingText).toBeNull();
  });

  it('取消文字编辑移除对象', () => {
    const model = new AnnotationModel();
    model.beginDraw(ToolKind.Text, { x: 10, y: 10 });
    model.endDraw();
    model.cancelTextEdit();
    expect(model.items).toHaveLength(0);
  });

  it('撤销/重做', () => {
    const model = new AnnotationModel();
    model.beginDraw(ToolKind.Rect, { x: 0, y: 0 });
    model.updateDraw({ x: 100, y: 100 });
    model.endDraw();
    expect(model.items).toHaveLength(1);

    expect(model.undo()).toBe(true);
    expect(model.items).toHaveLength(0);
    expect(model.redo()).toBe(true);
    expect(model.items).toHaveLength(1);
    expect(model.undo()).toBe(true);
    expect(model.undo()).toBe(false); // 无可撤销
  });

  it('删除选中', () => {
    const model = new AnnotationModel();
    model.beginDraw(ToolKind.Rect, { x: 0, y: 0 });
    model.updateDraw({ x: 100, y: 100 });
    model.endDraw();
    model.select(model.items[0].id);
    expect(model.deleteSelected()).toBe(true);
    expect(model.items).toHaveLength(0);
  });

  it('命中测试', () => {
    const model = new AnnotationModel();
    model.beginDraw(ToolKind.Rect, { x: 0, y: 0 });
    model.updateDraw({ x: 100, y: 50 });
    model.endDraw();
    const hit = model.hitTest({ x: 50, y: 25 });
    expect(hit?.kind).toBe(ToolKind.Rect);
    expect(model.hitTest({ x: 500, y: 500 })).toBeNull();
  });

  it('绘制过程不进入历史（结束才提交）', () => {
    const model = new AnnotationModel();
    model.beginDraw(ToolKind.Arrow, { x: 0, y: 0 });
    model.updateDraw({ x: 10, y: 10 });
    expect(model.items).toHaveLength(0);
    model.endDraw();
    expect(model.items).toHaveLength(1);
  });

  it('beginDraw 传入的样式写入新标注', () => {
    const model = new AnnotationModel();
    model.beginDraw(ToolKind.Rect, { x: 0, y: 0 }, { color: '#3b82f6', strokeWidth: 5 });
    model.updateDraw({ x: 100, y: 50 });
    model.endDraw();
    expect(model.items[0].style?.color).toBe('#3b82f6');
    expect(model.items[0].style?.strokeWidth).toBe(5);
  });

  it('不同样式绘制各自独立（不互相影响）', () => {
    const model = new AnnotationModel();
    model.beginDraw(ToolKind.Rect, { x: 0, y: 0 }, { color: '#ff4757' });
    model.updateDraw({ x: 50, y: 50 });
    model.endDraw();
    model.beginDraw(ToolKind.Rect, { x: 10, y: 10 }, { color: '#22c55e' });
    model.updateDraw({ x: 60, y: 60 });
    model.endDraw();
    expect(model.items[0].style?.color).toBe('#ff4757');
    expect(model.items[1].style?.color).toBe('#22c55e');
  });
});
