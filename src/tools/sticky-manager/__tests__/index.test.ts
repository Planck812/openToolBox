import { describe, expect, it } from 'vitest';
import { stickyManagerTool } from '../index';

describe('stickyManagerTool matcher', () => {
  it('命中关键词返回固定分数', () => {
    for (const keyword of ['便利贴', '便签', 'sticky', '便签纸', '贴纸']) {
      const result = stickyManagerTool.match(keyword);
      expect(result).toEqual({ toolId: 'sticky-manager', score: 90 });
    }
  });

  it('大小写不敏感匹配英文关键词', () => {
    expect(stickyManagerTool.match('STICKY')).toEqual({ toolId: 'sticky-manager', score: 90 });
  });

  it('关键词位于长句中也匹配', () => {
    expect(stickyManagerTool.match('打开便签管理')).toEqual({ toolId: 'sticky-manager', score: 90 });
  });

  it('无关输入与空输入不匹配', () => {
    expect(stickyManagerTool.match('hello world')).toBeNull();
    expect(stickyManagerTool.match('')).toBeNull();
    expect(stickyManagerTool.match('   ')).toBeNull();
  });
});
