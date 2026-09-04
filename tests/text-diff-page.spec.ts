import { mount } from '@vue/test-utils';
import { describe, expect, it } from 'vitest';
import TextDiff from '@/tools/text-diff/TextDiff.vue';

describe('文本对比页面增强覆盖', () => {
  it('新增行会标记为 added', async () => {
    const wrapper = mount(TextDiff);
    const [left, right] = wrapper.findAll('textarea');
    await left.setValue('alpha');
    await right.setValue('alpha\nbeta');

    const rows = wrapper.findAll('[data-testid="diff-line-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[1].attributes('data-line-type')).toBe('add');
  });

  it('删除行会标记为 removed', async () => {
    const wrapper = mount(TextDiff);
    const [left, right] = wrapper.findAll('textarea');
    await left.setValue('alpha\nbeta');
    await right.setValue('alpha');

    const rows = wrapper.findAll('[data-testid="diff-line-row"]');
    expect(rows).toHaveLength(2);
    expect(rows[1].attributes('data-line-type')).toBe('remove');
  });

  it('完全相同时会展示 equal 行', async () => {
    const wrapper = mount(TextDiff);
    const [left, right] = wrapper.findAll('textarea');
    await left.setValue('same');
    await right.setValue('same');

    const rows = wrapper.findAll('[data-testid="diff-line-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].attributes('data-line-type')).toBe('equal');
  });

  it('点击清空按钮后会回到空状态', async () => {
    const wrapper = mount(TextDiff);
    const [left, right] = wrapper.findAll('textarea');
    await left.setValue('a');
    await right.setValue('b');

    await wrapper.findAll('button').find((item) => item.text().includes('tools.text_diff.clear'))!.trigger('click');
    const [nextLeft, nextRight] = wrapper.findAll('textarea');

    expect((nextLeft.element as HTMLTextAreaElement).value).toBe('');
    expect((nextRight.element as HTMLTextAreaElement).value).toBe('');
    expect(wrapper.text()).toContain('tools.text_diff.empty_state');
  });

  it('忽略大小写后大小写差异不再生成 modify 行', async () => {
    const wrapper = mount(TextDiff);
    const [left, right] = wrapper.findAll('textarea');
    await left.setValue('HELLO');
    await right.setValue('hello');

    await wrapper.findAll('input[type="checkbox"]')[1].setValue(true);

    const rows = wrapper.findAll('[data-testid="diff-line-row"]');
    expect(rows).toHaveLength(1);
    expect(rows[0].attributes('data-line-type')).toBe('equal');
  });
});
