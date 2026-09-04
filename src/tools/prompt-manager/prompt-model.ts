export interface PromptItem {
  id: string;
  title: string;
  content: string;
  tags: string[];
  sourceUrl: string;
  pinned: boolean;
  /** 内置经典提示词（源码级预置），内容只读、不可编辑 */
  preset: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PromptDraft {
  title: string;
  content: string;
  tags: string[];
  sourceUrl: string;
}

export const createPrompt = (draft: PromptDraft, timestamp: string, id: string): PromptItem => ({
  id,
  title: draft.title,
  content: draft.content,
  tags: draft.tags,
  sourceUrl: draft.sourceUrl,
  pinned: false,
  preset: false,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const updatePrompt = (
  prompt: PromptItem,
  patch: Partial<Pick<PromptItem, 'title' | 'content' | 'tags' | 'sourceUrl'>>,
  timestamp: string,
): PromptItem => ({
  ...prompt,
  ...patch,
  updatedAt: timestamp,
});

export const togglePromptPinned = (prompt: PromptItem, timestamp: string): PromptItem => ({
  ...prompt,
  pinned: !prompt.pinned,
  updatedAt: timestamp,
});

export const removePromptById = (prompts: PromptItem[], promptId: string): PromptItem[] =>
  prompts.filter((prompt) => prompt.id !== promptId);

export const sortPrompts = (prompts: PromptItem[]): PromptItem[] =>
  [...prompts].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return Number(right.pinned) - Number(left.pinned);
    }

    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });

export const searchPrompts = (prompts: PromptItem[], keyword: string): PromptItem[] => {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) {
    return prompts;
  }

  return prompts.filter((prompt) =>
    `${prompt.title}\n${prompt.content}\n${prompt.tags.join('\n')}`.toLowerCase().includes(normalized),
  );
};

export const collectTags = (prompts: PromptItem[]): string[] => {
  const tags = new Set<string>();
  prompts.forEach((prompt) => {
    prompt.tags.forEach((tag) => tags.add(tag));
  });
  return [...tags].sort((left, right) => left.localeCompare(right, 'zh-CN'));
};

export const filterPromptsByTag = (prompts: PromptItem[], tag: string): PromptItem[] => {
  if (tag === 'all') {
    return prompts;
  }

  return prompts.filter((prompt) => prompt.tags.includes(tag));
};

/**
 * 把用户输入的标签文本拆成去重后的标签数组，支持中英文逗号、顿号与空白分隔。
 */
export const parseTagsInput = (input: string): string[] => {
  const seen = new Set<string>();
  input
    .split(/[,，、\s]+/)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .forEach((tag) => seen.add(tag));
  return [...seen];
};

export const getPromptDisplayTitle = (prompt: Pick<PromptItem, 'title'>, fallbackTitle: string): string =>
  prompt.title.trim() || fallbackTitle;

export const getPromptPreview = (prompt: Pick<PromptItem, 'content'>, fallback: string): string =>
  prompt.content.trim() || fallback;
