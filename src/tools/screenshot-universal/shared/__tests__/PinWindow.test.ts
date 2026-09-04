import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PinWindow from '../PinWindow.vue';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  getCurrentWindow: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: mocks.getCurrentWindow,
}));

const pinState = {
  pinId: 'e12bb2a6-bab4-4906-bacb-2ae66c7d8641',
  label: 'pin-e12bb2a6-bab4-4906-bacb-2ae66c7d8641',
  imageToken: 'a788ebc6-5c87-48fc-a901-e4fb3aa04d9d',
  width: 4,
  height: 3,
  zoomPercent: 100,
  opacityPercent: 100,
  clickThrough: false,
  accountedBytes: 64,
};

const mountPinWindow = () => mount(PinWindow, { attachTo: document.body });

describe('PinWindow lifecycle', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.getCurrentWindow.mockReturnValue({ label: pinState.label, show: vi.fn().mockResolvedValue(undefined) });
    window.history.replaceState({}, '', '/');
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:pin-image'),
      revokeObjectURL: vi.fn(),
    });
  });

  it('exposes stable controls after the image is loaded', async () => {
    mocks.invoke.mockResolvedValueOnce(pinState);
    const wrapper = mountPinWindow();
    await flushPromises();

    expect(wrapper.get('[data-testid="pin-reset"]').exists()).toBe(true);
    expect(wrapper.get('.pin-image').attributes('src')).toBe(`http://pin-image.localhost/${pinState.pinId}/${pinState.imageToken}`);
    expect(wrapper.get('[data-testid="pin-click-through"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('shows the error state and retries a failed load', async () => {
    mocks.invoke
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(pinState);
    const wrapper = mountPinWindow();
    await flushPromises();

    expect(wrapper.get('[data-testid="pin-load-error"]').text()).toContain('unavailable');
    await wrapper.get('[data-testid="pin-load-retry"]').trigger('click');
    await flushPromises();

    expect(wrapper.find('[data-testid="pin-toolbar"]').exists()).toBe(true);
    wrapper.unmount();
  });

  it('does not require query parameters to resolve a pin window identity', async () => {
    mocks.invoke.mockResolvedValueOnce(pinState);
    const wrapper = mountPinWindow();
    await flushPromises();

    expect(wrapper.get('.pin-image').attributes('src')).toBe(`http://pin-image.localhost/${pinState.pinId}/${pinState.imageToken}`);
    expect(mocks.invoke).toHaveBeenCalledWith('pin_get_state', { pinId: pinState.pinId });
    wrapper.unmount();
  });

  it('loads the image via the pin-image protocol instead of invoke bytes', async () => {
    mocks.invoke.mockResolvedValueOnce(pinState);
    const wrapper = mountPinWindow();
    await flushPromises();

    // 协议直传：不再调用 pin_read_image，也不创建 Blob URL。
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalledWith('pin_read_image', expect.anything());
    expect(wrapper.get('.pin-image').attributes('src')).toBe(`http://pin-image.localhost/${pinState.pinId}/${pinState.imageToken}`);
    wrapper.unmount();
  });
});
