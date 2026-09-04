import { describe, it, expect } from 'vitest';
import type { Tool } from '@/tools/interface';
import { filterTools, recommendTools } from '@/lib/tool-search';

const makeTool = (id: string, keywords: string[], matchResult: { toolId: string; score: number } | null = null): Tool => ({
  metadata: { id, name: id, description: id, icon: {} as any, keywords },
  component: () => Promise.resolve({} as any),
  match: () => matchResult,
});

const TOOLS = [
  makeTool('json-viewer', ['json', 'viewer'], null),
  makeTool('calculator', ['calc', '计算'], null),
  makeTool('timestamp', ['时间戳'], { toolId: 'timestamp', score: 80 }),
];

describe('recommendTools', () => {
  it('空输入返回空数组', () => {
    expect(recommendTools(TOOLS, '')).toEqual([]);
    expect(recommendTools(TOOLS, '   ')).toEqual([]);
  });

  it('内容识别命中用工具自定义分值', () => {
    const results = recommendTools(TOOLS, 'anything');
    expect(results).toContainEqual({ toolId: 'timestamp', score: 80 });
  });

  it('关键词精确命中返回 TOOL_NAME_MATCH_SCORE(55)', () => {
    const results = recommendTools(TOOLS, 'calculator');
    expect(results).toContainEqual({ toolId: 'calculator', score: 55 });
  });

  it('id 匹配不区分大小写', () => {
    const results = recommendTools(TOOLS, 'JSON-Viewer');
    expect(results).toContainEqual({ toolId: 'json-viewer', score: 55 });
  });

  it('中文别名匹配', () => {
    const results = recommendTools(TOOLS, '计算');
    expect(results).toContainEqual({ toolId: 'calculator', score: 55 });
  });

  it('结果按分数降序排序', () => {
    const results = recommendTools(TOOLS, 'x');
    const scores = results.map((r) => r.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });
});

describe('filterTools', () => {
  it('空查询返回全部工具', () => {
    expect(filterTools(TOOLS, '')).toHaveLength(3);
  });

  it('按 id 子串过滤', () => {
    const results = filterTools(TOOLS, 'json');
    expect(results.map((t) => t.metadata.id)).toEqual(['json-viewer']);
  });

  it('按关键词子串过滤', () => {
    const results = filterTools(TOOLS, 'viewer');
    expect(results.map((t) => t.metadata.id)).toEqual(['json-viewer']);
  });

  it('不区分大小写', () => {
    const results = filterTools(TOOLS, 'JSON');
    expect(results.map((t) => t.metadata.id)).toEqual(['json-viewer']);
  });
});
