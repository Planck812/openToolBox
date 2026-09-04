import { describe, expect, it } from 'vitest';
import {
  PASSWORD_MASK,
  createPasswordBoxItem,
  deletePasswordBoxItem,
  maskPassword,
  searchPasswordBoxItems,
  sortPasswordBoxItems,
  updatePasswordBoxItem,
} from '@/tools/pwd-box/password-box-model';
import { getToolById } from '@/tools/registry';

describe('password box model', () => {
  it('createPasswordBoxItem 创建默认字段完整的新记录', () => {
    const now = '2026-04-02T10:00:00.000Z';
    const item = createPasswordBoxItem(now, 'pwd-1');

    expect(item).toEqual({
      id: 'pwd-1',
      site: '',
      username: '',
      password: '',
      note: '',
      createdAt: now,
      updatedAt: now,
    });
  });

  it('updatePasswordBoxItem 更新字段并刷新更新时间', () => {
    const item = createPasswordBoxItem('2026-04-02T10:00:00.000Z', 'pwd-1');

    const updated = updatePasswordBoxItem(item, {
      site: ' github.com ',
      username: ' alice ',
      password: ' secret ',
      note: ' 工作账号 ',
    }, '2026-04-02T11:00:00.000Z');

    expect(updated).toEqual({
      id: 'pwd-1',
      site: 'github.com',
      username: 'alice',
      password: 'secret',
      note: '工作账号',
      createdAt: '2026-04-02T10:00:00.000Z',
      updatedAt: '2026-04-02T11:00:00.000Z',
    });
  });

  it('searchPasswordBoxItems 按网站与备注模糊匹配', () => {
    const items = [
      {
        id: 'a',
        site: 'github.com',
        username: 'alice',
        password: 'one',
        note: '代码托管',
        createdAt: '',
        updatedAt: '2026-04-02T09:00:00.000Z',
      },
      {
        id: 'b',
        site: 'aliyun',
        username: 'bob',
        password: 'two',
        note: '生产服务器',
        createdAt: '',
        updatedAt: '2026-04-02T10:00:00.000Z',
      },
    ];

    expect(searchPasswordBoxItems(items, 'git').map((item) => item.id)).toEqual(['a']);
    expect(searchPasswordBoxItems(items, '服务器').map((item) => item.id)).toEqual(['b']);
  });

  it('sortPasswordBoxItems 按更新时间倒序排列', () => {
    const items = [
      { id: 'a', site: '', username: '', password: '', note: '', createdAt: '', updatedAt: '2026-04-02T09:00:00.000Z' },
      { id: 'b', site: '', username: '', password: '', note: '', createdAt: '', updatedAt: '2026-04-02T11:00:00.000Z' },
      { id: 'c', site: '', username: '', password: '', note: '', createdAt: '', updatedAt: '2026-04-02T10:00:00.000Z' },
    ];

    expect(sortPasswordBoxItems(items).map((item) => item.id)).toEqual(['b', 'c', 'a']);
  });

  it('deletePasswordBoxItem 删除目标记录', () => {
    const items = [
      createPasswordBoxItem('2026-04-02T10:00:00.000Z', 'a'),
      createPasswordBoxItem('2026-04-02T10:00:00.000Z', 'b'),
    ];

    expect(deletePasswordBoxItem(items, 'a').map((item) => item.id)).toEqual(['b']);
  });

  it('maskPassword 对密码统一显示三个星号', () => {
    expect(maskPassword('secret')).toBe(PASSWORD_MASK);
    expect(maskPassword('')).toBe(PASSWORD_MASK);
  });
});

describe('password box registry', () => {
  it('registers pwd-box metadata', () => {
    const tool = getToolById('pwd-box');

    expect(tool?.metadata.name).toBe('tools.pwd_box.name');
    expect(tool?.metadata.description).toBe('tools.pwd_box.description');
  });
});
