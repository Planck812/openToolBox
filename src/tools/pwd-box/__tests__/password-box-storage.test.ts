import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as pwdboxIpc from '@/lib/ipc/pwdbox';
import { loadPasswordBoxItems, savePasswordBoxItems } from '../password-box-storage';

vi.mock('@/lib/ipc/pwdbox', () => ({
  pwdboxLoad: vi.fn(),
  pwdboxSave: vi.fn(),
}));

const makeItem = (id: string, password: string) => ({
  id,
  site: 'example.com',
  username: 'alice',
  password,
  note: '',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('password-box-storage 文档版本兼容', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(pwdboxIpc.pwdboxSave).mockResolvedValue();
  });

  it('读取 v2 文档（当前格式，password 为密文）', async () => {
    vi.mocked(pwdboxIpc.pwdboxLoad).mockResolvedValue(
      JSON.stringify({ version: 2, items: [makeItem('a', 'v1:ciphertext')] }),
    );

    const items = await loadPasswordBoxItems();

    expect(items).toHaveLength(1);
    // 密文原样返回，明文需另经 pwdboxDecryptField 换取。
    expect(items[0].password).toBe('v1:ciphertext');
  });

  /**
   * 回归防护：曾因校验写死 `version !== 1` 而在升级到 v2 后把既有数据判为
   * 「密码夹文件解析失败」，功能整体不可用。版本演进不得让旧文档读不出来。
   */
  it('仍接受 v1 文档，不因版本号变化而拒绝读取', async () => {
    vi.mocked(pwdboxIpc.pwdboxLoad).mockResolvedValue(
      JSON.stringify({ version: 1, items: [makeItem('a', 'plain')] }),
    );

    await expect(loadPasswordBoxItems()).resolves.toHaveLength(1);
  });

  it('文件不存在时返回空列表', async () => {
    vi.mocked(pwdboxIpc.pwdboxLoad).mockResolvedValue(null);
    await expect(loadPasswordBoxItems()).resolves.toEqual([]);
  });

  it('版本号非法时报解析失败', async () => {
    vi.mocked(pwdboxIpc.pwdboxLoad).mockResolvedValue(
      JSON.stringify({ version: 99, items: [] }),
    );
    await expect(loadPasswordBoxItems()).rejects.toThrow();
  });

  it('保存时写入当前版本号（v2）', async () => {
    await savePasswordBoxItems([makeItem('a', 'v1:ciphertext')]);

    const written = vi.mocked(pwdboxIpc.pwdboxSave).mock.calls[0][0];
    expect(JSON.parse(written).version).toBe(2);
  });
});
