import { ref } from 'vue';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TimestampConverter from '@/tools/timestamp/TimestampConverter.vue';

const { copyMock } = vi.hoisted(() => ({
  copyMock: vi.fn(),
}));

vi.mock('@vueuse/core', () => ({
  useClipboard: () => ({
    copy: copyMock,
    copied: ref(false),
  }),
}));

describe('时间戳转换页面', () => {
  beforeEach(() => {
    copyMock.mockReset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('默认会用当前毫秒时间初始化输入框', async () => {
    const wrapper = mount(TimestampConverter);
    const input = wrapper.get('input');
    await flushPromises();

    expect((input.element as HTMLInputElement).value).toBe('1775044800000');
    expect(wrapper.text()).toContain('2026-04-01 20:00:00');
  });

  it('支持 10 位秒级时间戳转换', async () => {
    const wrapper = mount(TimestampConverter);
    const input = wrapper.get('input');

    await input.setValue('1704067200');

    expect(wrapper.text()).toContain('2024-01-01 08:00:00');
    expect(wrapper.text()).toContain('1704067200000');
  });

  it('支持日期字符串转毫秒时间戳', async () => {
    const wrapper = mount(TimestampConverter);
    const input = wrapper.get('input');

    await input.setValue('2024-05-20 08:30:15');

    expect(wrapper.text()).toContain('2024-05-20 08:30:15');
    expect(wrapper.text()).toContain('1716165015000');
  });

  it('非法输入会显示无效提示', async () => {
    const wrapper = mount(TimestampConverter);
    const input = wrapper.get('input');

    await input.setValue('not-a-date');

    expect(wrapper.text()).toContain('tools.timestamp.invalid');
  });

  it('点击当前时间按钮会刷新输入值，结果区复制按钮可正常复制', async () => {
    const wrapper = mount(TimestampConverter);
    const input = wrapper.get('input');

    await input.setValue('1704067200');
    await wrapper.get('button').trigger('click');

    expect((input.element as HTMLInputElement).value).toBe('1775044800000');

    const buttons = wrapper.findAll('button');
    await buttons[1].trigger('click');
    expect(copyMock).toHaveBeenCalledWith('2026-04-01 20:00:00');
  });
});
