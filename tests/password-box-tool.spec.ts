import { flushPromises, mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PasswordBoxTool from '@/tools/pwd-box/PasswordBoxTool.vue';

const loadPasswordBoxItemsMock = vi.fn();
const savePasswordBoxItemsMock = vi.fn();
const writeTextMock = vi.fn();

vi.mock('@/tools/pwd-box/password-box-storage', () => ({
  loadPasswordBoxItems: () => loadPasswordBoxItemsMock(),
  savePasswordBoxItems: (items: unknown[]) => savePasswordBoxItemsMock(items),
}));

vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  writeText: (value: string) => writeTextMock(value),
}));

vi.mock('@/lib/ipc/pwdbox', () => ({
  pwdboxAuthenticate: vi.fn().mockResolvedValue(true),
  pwdboxAuthCheck: vi.fn().mockResolvedValue(true),
  pwdboxAuthLock: vi.fn().mockResolvedValue(undefined),
  pwdboxLoad: vi.fn(),
  pwdboxSave: vi.fn(),
}));

describe('密码夹工具', () => {
  beforeEach(() => {
    const pinia = createPinia();
    setActivePinia(pinia);
    loadPasswordBoxItemsMock.mockReset();
    savePasswordBoxItemsMock.mockReset();
    writeTextMock.mockReset();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });

  it('新建并编辑记录后自动保存', async () => {
    loadPasswordBoxItemsMock.mockResolvedValue([]);

    const wrapper = mount(PasswordBoxTool, {
      global: {
        plugins: [createPinia()],
      },
    });

    await flushPromises();
    await wrapper.get('[data-testid="pwd-box-create-button"]').trigger('click');
    await wrapper.get('[data-testid="pwd-box-site-input"]').setValue('github.com');
    await wrapper.get('[data-testid="pwd-box-username-input"]').setValue('alice');
    await wrapper.get('[data-testid="pwd-box-password-input"]').setValue('secret');
    await wrapper.get('[data-testid="pwd-box-note-input"]').setValue('代码托管');
    await flushPromises();

    expect(savePasswordBoxItemsMock).toHaveBeenCalled();
    expect(wrapper.text()).toContain('github.com');
    expect(wrapper.text()).toContain('alice');
  });

  it('按网站和备注过滤列表', async () => {
    loadPasswordBoxItemsMock.mockResolvedValue([
      {
        id: 'a',
        site: 'github.com',
        username: 'alice',
        password: 'secret',
        note: '代码托管',
        createdAt: '2026-04-02T10:00:00.000Z',
        updatedAt: '2026-04-02T10:00:00.000Z',
      },
      {
        id: 'b',
        site: 'aliyun',
        username: 'ops',
        password: 'root',
        note: '生产服务器',
        createdAt: '2026-04-02T11:00:00.000Z',
        updatedAt: '2026-04-02T11:00:00.000Z',
      },
    ]);

    const wrapper = mount(PasswordBoxTool, {
      global: {
        plugins: [createPinia()],
      },
    });

    await flushPromises();
    await wrapper.get('[data-testid="pwd-box-search-input"]').setValue('服务器');
    await flushPromises();

    const items = wrapper.findAll('[data-testid="pwd-box-list-item"]');
    expect(items).toHaveLength(1);
    expect(items[0].text()).toContain('aliyun');
  });

  it('密码默认隐藏，点击后显示并可复制', async () => {
    loadPasswordBoxItemsMock.mockResolvedValue([
      {
        id: 'a',
        site: 'github.com',
        username: 'alice',
        password: 'secret',
        note: '代码托管',
        createdAt: '2026-04-02T10:00:00.000Z',
        updatedAt: '2026-04-02T10:00:00.000Z',
      },
    ]);

    const wrapper = mount(PasswordBoxTool, {
      global: {
        plugins: [createPinia()],
      },
    });

    await flushPromises();
    expect(wrapper.text()).toContain('***');

    await wrapper.get('[data-testid="pwd-box-toggle-visibility"]').trigger('click');
    await flushPromises();
    expect(wrapper.text()).toContain('secret');

    await wrapper.get('[data-testid="pwd-box-copy-password"]').trigger('click');
    expect(writeTextMock).toHaveBeenCalledWith('secret');
  });

  it('删除当前记录后切换到下一条可见记录', async () => {
    loadPasswordBoxItemsMock.mockResolvedValue([
      {
        id: 'a',
        site: 'github.com',
        username: 'alice',
        password: 'secret',
        note: '代码托管',
        createdAt: '2026-04-02T10:00:00.000Z',
        updatedAt: '2026-04-02T10:00:00.000Z',
      },
      {
        id: 'b',
        site: 'aliyun',
        username: 'ops',
        password: 'root',
        note: '生产服务器',
        createdAt: '2026-04-02T11:00:00.000Z',
        updatedAt: '2026-04-02T11:00:00.000Z',
      },
    ]);

    const wrapper = mount(PasswordBoxTool, {
      global: {
        plugins: [createPinia()],
      },
    });

    await flushPromises();
    await wrapper.findAll('[data-testid="pwd-box-delete-button"]')[0].trigger('click');
    await flushPromises();

    expect(wrapper.text()).toContain('github.com');
    expect(wrapper.text()).not.toContain('aliyun');
  });
});
