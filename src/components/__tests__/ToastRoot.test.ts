import { flushPromises, mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { describe, expect, it, vi } from 'vitest';
import ToastRoot from '@/components/ToastRoot.vue';

const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

const mountToast = async () => {
  const wrapper = mount(ToastRoot);
  await flushPromises();
  return wrapper;
};

describe('ToastRoot', () => {
  it('renders the pending payload fetched via invoke on mount', async () => {
    invokeMock.mockResolvedValue({ message: '「T1」处理完成', isError: false });
    listenMock.mockResolvedValue(() => {});
    const wrapper = await mountToast();

    await nextTick();
    expect(wrapper.text()).toContain('「T1」处理完成');
    expect(wrapper.find('.toast-root').classes()).not.toContain('is-error');
  });

  it('marks error style when isError is true', async () => {
    invokeMock.mockResolvedValue({ message: '管线执行失败：xxx', isError: true });
    listenMock.mockResolvedValue(() => {});
    const wrapper = await mountToast();

    await nextTick();
    expect(wrapper.find('.toast-root').classes()).toContain('is-error');
  });

  it('updates content when the toast_show event arrives', async () => {
    invokeMock.mockResolvedValue(null);
    let handler: ((e: { payload: { message: string; isError: boolean } }) => void) | null = null;
    listenMock.mockImplementation(async (event: string, cb: (e: never) => void) => {
      if (event === 'toast_show') handler = cb as never;
      return () => {};
    });
    const wrapper = await mountToast();

    expect(wrapper.find('.toast-root').exists()).toBe(false);

    handler!({ payload: { message: '管线完成', isError: false } });
    await nextTick();
    expect(wrapper.text()).toContain('管线完成');
  });
});
