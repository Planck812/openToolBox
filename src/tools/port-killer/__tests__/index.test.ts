import { describe, expect, it } from 'vitest';
import { portKillerTool } from '../index';

describe('portKillerTool matcher', () => {
  it('合法端口返回固定分数并携带端口数字', () => {
    const result = portKillerTool.match('3000');

    expect(result).toEqual({ toolId: 'port-killer', score: 80, matchedData: 3000 });
  });

  it('边界端口 1 与 65535 可匹配', () => {
    expect(portKillerTool.match('1')?.matchedData).toBe(1);
    expect(portKillerTool.match('65535')?.matchedData).toBe(65535);
  });

  it('输入带首尾空白时先去除再匹配', () => {
    expect(portKillerTool.match('  8080  ')?.matchedData).toBe(8080);
  });

  it('端口越界不匹配', () => {
    expect(portKillerTool.match('0')).toBeNull();
    expect(portKillerTool.match('-1')).toBeNull();
    expect(portKillerTool.match('65536')).toBeNull();
    expect(portKillerTool.match('70000')).toBeNull();
  });

  it('非数字或非整数不匹配', () => {
    expect(portKillerTool.match('abc')).toBeNull();
    expect(portKillerTool.match('3000.5')).toBeNull();
    expect(portKillerTool.match('12a')).toBeNull();
  });

  it('空输入不匹配', () => {
    expect(portKillerTool.match('')).toBeNull();
    expect(portKillerTool.match('   ')).toBeNull();
  });
});
