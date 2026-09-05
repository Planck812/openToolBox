import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PasswordBoxTool from '../PasswordBoxTool.vue';
import * as pwdboxIpc from '@/lib/ipc/pwdbox';
import * as clipboard from '@/lib/clipboard';
import * as storage from '../password-box-storage';
import { useAppStore } from '@/store/app';

vi.mock('@/lib/ipc/pwdbox', () => ({
  pwdboxAuthenticate: vi.fn(),
  pwdboxAuthCheck: vi.fn(),
  pwdboxAuthLock: vi.fn(),
  pwdboxLoad: vi.fn(),
  pwdboxSave: vi.fn(),
}));

vi.mock('@/lib/clipboard', () => ({
  copyText: vi.fn(),
}));

describe('PasswordBoxTool Authentication', () => {
  let pinia: ReturnType<typeof createPinia>;
  const testItems = [
    {
      id: 'pwd-1',
      site: 'github.com',
      username: 'alice',
      password: 'SuperSecretPassword123!',
      note: 'My GitHub account',
      updatedAt: '2026-09-04T10:00:00.000Z',
    },
  ];

  beforeEach(() => {
    pinia = createPinia();
    setActivePinia(pinia);
    vi.clearAllMocks();

    const appStore = useAppStore();
    vi.spyOn(appStore, 'showToast').mockImplementation(() => {});

    vi.spyOn(storage, 'loadPasswordBoxItems').mockResolvedValue(testItems);
    vi.mocked(pwdboxIpc.pwdboxAuthCheck).mockResolvedValue(false);
    vi.mocked(pwdboxIpc.pwdboxAuthLock).mockResolvedValue();
    vi.mocked(clipboard.copyText).mockResolvedValue(true);
  });

  it('初始状态下密码为掩码，不显示锁定按钮', async () => {
    const wrapper = mount(PasswordBoxTool, {
      global: { plugins: [pinia] },
    });

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="pwd-box-password-display"]').exists()).toBe(true);
    });

    const display = wrapper.get('[data-testid="pwd-box-password-display"]');
    expect(display.text()).not.toContain('SuperSecretPassword123!');
    expect(display.text()).toBe('***');
    expect(wrapper.find('[data-testid="pwd-box-lock-button"]').exists()).toBe(false);
  });

  it('查看密码：取消验证时不展示明文', async () => {
    vi.mocked(pwdboxIpc.pwdboxAuthenticate).mockResolvedValue(false);

    const wrapper = mount(PasswordBoxTool, {
      global: { plugins: [pinia] },
    });

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="pwd-box-toggle-visibility"]').exists()).toBe(true);
    });

    await wrapper.get('[data-testid="pwd-box-toggle-visibility"]').trigger('click');

    expect(pwdboxIpc.pwdboxAuthenticate).toHaveBeenCalledWith('tools.pwd_box.auth_prompt_view');

    const display = wrapper.get('[data-testid="pwd-box-password-display"]');
    expect(display.text()).not.toContain('SuperSecretPassword123!');
    expect(wrapper.find('[data-testid="pwd-box-lock-button"]').exists()).toBe(false);

    const appStore = useAppStore();
    expect(appStore.showToast).toHaveBeenCalledWith('tools.pwd_box.auth_canceled', {
      type: 'info',
    });
  });

  it('查看密码：验证成功后显示明文并激活锁定按钮', async () => {
    vi.mocked(pwdboxIpc.pwdboxAuthenticate).mockResolvedValue(true);

    const wrapper = mount(PasswordBoxTool, {
      global: { plugins: [pinia] },
    });

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="pwd-box-toggle-visibility"]').exists()).toBe(true);
    });

    await wrapper.get('[data-testid="pwd-box-toggle-visibility"]').trigger('click');

    expect(pwdboxIpc.pwdboxAuthenticate).toHaveBeenCalledWith('tools.pwd_box.auth_prompt_view');

    const display = wrapper.get('[data-testid="pwd-box-password-display"]');
    expect(display.text()).toBe('SuperSecretPassword123!');
    expect(wrapper.find('[data-testid="pwd-box-lock-button"]').exists()).toBe(true);
  });

  it('复制密码：鉴权取消时不写入剪贴板', async () => {
    vi.mocked(pwdboxIpc.pwdboxAuthenticate).mockResolvedValue(false);

    const wrapper = mount(PasswordBoxTool, {
      global: { plugins: [pinia] },
    });

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="pwd-box-copy-password"]').exists()).toBe(true);
    });

    await wrapper.get('[data-testid="pwd-box-copy-password"]').trigger('click');

    expect(pwdboxIpc.pwdboxAuthenticate).toHaveBeenCalledWith('tools.pwd_box.auth_prompt_copy');
    expect(clipboard.copyText).not.toHaveBeenCalled();
  });

  it('复制密码：鉴权成功后写入剪贴板并提示成功', async () => {
    vi.mocked(pwdboxIpc.pwdboxAuthenticate).mockResolvedValue(true);

    const wrapper = mount(PasswordBoxTool, {
      global: { plugins: [pinia] },
    });

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="pwd-box-copy-password"]').exists()).toBe(true);
    });

    await wrapper.get('[data-testid="pwd-box-copy-password"]').trigger('click');

    expect(pwdboxIpc.pwdboxAuthenticate).toHaveBeenCalledWith('tools.pwd_box.auth_prompt_copy');
    expect(clipboard.copyText).toHaveBeenCalledWith('SuperSecretPassword123!');

    const appStore = useAppStore();
    expect(appStore.showToast).toHaveBeenCalledWith('tools.pwd_box.copy_success', {
      type: 'success',
    });
  });

  it('主动锁定：清除明文显示与会话', async () => {
    vi.mocked(pwdboxIpc.pwdboxAuthenticate).mockResolvedValue(true);

    const wrapper = mount(PasswordBoxTool, {
      global: { plugins: [pinia] },
    });

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="pwd-box-toggle-visibility"]').exists()).toBe(true);
    });

    // 先验证解锁查看明文
    await wrapper.get('[data-testid="pwd-box-toggle-visibility"]').trigger('click');
    expect(wrapper.get('[data-testid="pwd-box-password-display"]').text()).toBe(
      'SuperSecretPassword123!',
    );
    expect(wrapper.find('[data-testid="pwd-box-lock-button"]').exists()).toBe(true);

    // 点击锁定
    await wrapper.get('[data-testid="pwd-box-lock-button"]').trigger('click');

    expect(pwdboxIpc.pwdboxAuthLock).toHaveBeenCalled();
    expect(wrapper.get('[data-testid="pwd-box-password-display"]').text()).toBe('***');
    expect(wrapper.find('[data-testid="pwd-box-lock-button"]').exists()).toBe(false);

    const appStore = useAppStore();
    expect(appStore.showToast).toHaveBeenCalledWith('tools.pwd_box.locked', { type: 'info' });
  });

  it('修改已有密码时提示确认：确认后更新密码', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const saveSpy = vi.spyOn(storage, 'savePasswordBoxItems').mockResolvedValue();

    const wrapper = mount(PasswordBoxTool, {
      global: { plugins: [pinia] },
    });

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="pwd-box-password-input"]').exists()).toBe(true);
    });

    const input = wrapper.get('[data-testid="pwd-box-password-input"]');
    (input.element as HTMLInputElement).value = 'NewChangedPassword456!';
    await input.trigger('change');

    expect(confirmSpy).toHaveBeenCalledWith('tools.pwd_box.modify_password_confirm');
    expect(saveSpy).toHaveBeenCalled();
  });

  it('修改已有密码时提示确认：取消则还原输入并不保存', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const saveSpy = vi.spyOn(storage, 'savePasswordBoxItems').mockResolvedValue();

    const wrapper = mount(PasswordBoxTool, {
      global: { plugins: [pinia] },
    });

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="pwd-box-password-input"]').exists()).toBe(true);
    });

    const input = wrapper.get('[data-testid="pwd-box-password-input"]');
    (input.element as HTMLInputElement).value = 'NewChangedPassword456!';
    await input.trigger('change');

    expect(confirmSpy).toHaveBeenCalledWith('tools.pwd_box.modify_password_confirm');
    expect(saveSpy).not.toHaveBeenCalled();
    expect((input.element as HTMLInputElement).value).toBe('SuperSecretPassword123!');
  });

  it('密码原为空时修改不弹出确认提示', async () => {
    vi.spyOn(storage, 'loadPasswordBoxItems').mockResolvedValue([
      {
        id: 'pwd-empty',
        site: 'test.com',
        username: 'bob',
        password: '',
        note: '',
        updatedAt: '2026-09-04T10:00:00.000Z',
      },
    ]);
    const confirmSpy = vi.spyOn(window, 'confirm');
    const saveSpy = vi.spyOn(storage, 'savePasswordBoxItems').mockResolvedValue();

    const wrapper = mount(PasswordBoxTool, {
      global: { plugins: [pinia] },
    });

    await vi.waitFor(() => {
      expect(wrapper.find('[data-testid="pwd-box-password-input"]').exists()).toBe(true);
    });

    const input = wrapper.get('[data-testid="pwd-box-password-input"]');
    (input.element as HTMLInputElement).value = 'FirstTimePassword!';
    await input.trigger('change');

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(saveSpy).toHaveBeenCalled();
  });
});
