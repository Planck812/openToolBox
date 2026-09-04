import { describe, expect, it } from 'vitest';
import { timerCenterTool } from '../index';

describe('timerCenterTool matcher', () => {
  it('命中关键词返回固定分数', () => {
    for (const keyword of [
      '计时',
      '闹钟',
      '倒计时',
      '秒表',
      '番茄',
      'timer',
      'alarm',
      'stopwatch',
      'pomodoro',
      '整点',
      '报时',
      '专注',
      '定时',
    ]) {
      const result = timerCenterTool.match(keyword);
      expect(result).toEqual({ toolId: 'timer-center', score: 90 });
    }
  });

  it('大小写不敏感匹配英文关键词', () => {
    expect(timerCenterTool.match('Timer')).toEqual({ toolId: 'timer-center', score: 90 });
    expect(timerCenterTool.match('POMODORO')).toEqual({ toolId: 'timer-center', score: 90 });
  });

  it('关键词位于长句中也匹配', () => {
    expect(timerCenterTool.match('开启一个番茄钟专注学习')).toEqual({ toolId: 'timer-center', score: 90 });
  });

  it('无关输入与空输入不匹配', () => {
    expect(timerCenterTool.match('hello world')).toBeNull();
    expect(timerCenterTool.match('')).toBeNull();
    expect(timerCenterTool.match('   ')).toBeNull();
  });
});
