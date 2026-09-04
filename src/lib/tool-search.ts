import type { Tool } from '@/tools/interface';

/** 关键词精确命中（id / 别名）时的推荐分。 */
const TOOL_NAME_MATCH_SCORE = 55;

export type ToolRecommendation = { toolId: string; score: number };

/**
 * 基于一段输入文本计算工具推荐（内容识别 + 关键词 fallback，按分降序）。
 * 纯函数，供首页搜索框与快速唤起浮层共用同一推荐口径。
 * @param tools 工具注册表
 * @param input 输入文本（如剪贴板内容、工具名/别名）
 */
export const recommendTools = (tools: Tool[], input: string): ToolRecommendation[] => {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const query = trimmed.toLowerCase();
  const results: ToolRecommendation[] = [];

  tools.forEach(tool => {
    // 1) 内容识别：输入像什么数据/语法，命中即用其自定义分值
    const match = tool.match(trimmed);
    if (match) {
      results.push(match);
      return;
    }

    // 2) fallback：输入恰为工具 id 或别名关键词（如 "mermaid"、"流程图"）
    if (
      tool.metadata.id.toLowerCase() === query ||
      tool.metadata.keywords.some((k) => k.toLowerCase() === query)
    ) {
      results.push({ toolId: tool.metadata.id, score: TOOL_NAME_MATCH_SCORE });
    }
  });

  return results.sort((a, b) => b.score - a.score);
};

/**
 * 基于关键词过滤工具列表（id / 关键词子串匹配，不区分大小写）。
 * 供首页列表检索与键盘导航消费。
 * @param tools 工具注册表
 * @param query 检索词；空串返回全部工具
 */
export const filterTools = (tools: Tool[], query: string): Tool[] => {
  if (!query) return tools;
  const q = query.toLowerCase();
  return tools.filter(tool => {
    return (
      tool.metadata.id.includes(q) ||
      tool.metadata.keywords.some((k) => k.includes(q))
    );
  });
};
