import { beforeEach, describe, expect, it, vi } from 'vitest';

const pwdboxLoadMock = vi.fn();
const pwdboxSaveMock = vi.fn();

vi.mock('@/lib/ipc/pwdbox', () => ({
  pwdboxLoad: (...args: unknown[]) => pwdboxLoadMock(...args),
  pwdboxSave: (...args: unknown[]) => pwdboxSaveMock(...args),
}));

import {
  loadPasswordBoxItems,
  savePasswordBoxItems,
} from '@/tools/pwd-box/password-box-storage';

const item = {
  id: 'a',
  site: 'github.com',
  username: 'alice',
  password: 'secret',
  note: '代码托管',
  createdAt: '2026-04-02T10:00:00.000Z',
  updatedAt: '2026-04-02T10:00:00.000Z',
};

describe('password box storage', () => {
  beforeEach(() => {
    pwdboxLoadMock.mockReset();
    pwdboxSaveMock.mockReset();
  });

  it('文件不存在时返回空列表', async () => {
    pwdboxLoadMock.mockResolvedValue(null);

    await expect(loadPasswordBoxItems()).resolves.toEqual([]);
    expect(pwdboxLoadMock).toHaveBeenCalledTimes(1);
  });

  it('返回 JSON 字符串时读取 items 数组', async () => {
    pwdboxLoadMock.mockResolvedValue(JSON.stringify({
      version: 1,
      items: [item],
    }));

    await expect(loadPasswordBoxItems()).resolves.toHaveLength(1);
  });

  it('非法 JSON 时抛出解析错误', async () => {
    pwdboxLoadMock.mockResolvedValue('{broken-json');

    await expect(loadPasswordBoxItems()).rejects.toThrow('tools.pwd_box.error_file_parse_failed');
  });

  it('凭据库不可用时抛出加密存储不可用错误', async () => {
    pwdboxLoadMock.mockRejectedValue(new Error('pwdbox: encrypted storage unavailable: no store'));

    await expect(loadPasswordBoxItems()).rejects.toThrow('tools.pwd_box.error_unsupported_storage');
  });

  it('savePasswordBoxItems 序列化后调用加密保存命令', async () => {
    await savePasswordBoxItems([item]);

    expect(pwdboxSaveMock).toHaveBeenCalledWith(expect.stringContaining('"version": 1'));
    expect(pwdboxSaveMock).toHaveBeenCalledWith(expect.stringContaining('"password": "secret"'));
  });

  it('连续保存时按调用顺序串行写入，避免旧内容覆盖新内容', async () => {
    const resolvers: Array<() => void> = [];
    pwdboxSaveMock.mockImplementation(() => new Promise<void>((resolve) => {
      resolvers.push(resolve);
    }));

    const firstSave = savePasswordBoxItems([{ ...item, note: 'first' }]);
    const secondSave = savePasswordBoxItems([{ ...item, note: 'second' }]);

    await vi.waitFor(() => {
      expect(pwdboxSaveMock).toHaveBeenCalledTimes(1);
    });

    resolvers[0]?.();

    await vi.waitFor(() => {
      expect(pwdboxSaveMock).toHaveBeenCalledTimes(2);
    });
    expect(pwdboxSaveMock.mock.calls[1]?.[0]).toContain('"note": "second"');

    resolvers[1]?.();
    await Promise.all([firstSave, secondSave]);
  });
});
