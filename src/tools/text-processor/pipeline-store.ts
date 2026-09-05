/**
 * 管线持久化（纯模块 + localStorage，不引入 Pinia，与 home shortcuts 的
 * localStorage 惯例一致）。key 为 `open-toolbox:text-processor:pipelines`，
 * 上限 20 条；同名覆盖；超出上限拒绝保存。
 */
import type { PipelineStep } from './steps';

export interface SavedPipeline {
  name: string;
  steps: PipelineStep[];
  updatedAt: number;
}

export interface SavePipelineResult {
  ok: boolean;
  error?: 'NAME_REQUIRED' | 'INVALID_STEPS' | 'LIMIT_REACHED' | 'STORAGE_UNAVAILABLE';
}

const STORAGE_KEY = 'open-toolbox:text-processor:pipelines';
const INITIALIZED_KEY = 'open-toolbox:text-processor:pipelines-initialized';
const MAX_PIPELINES = 20;

export const DEFAULT_BUILTIN_PIPELINES: SavedPipeline[] = [
  {
    name: '快速合并',
    steps: [
      {
        id: 'builtin-step-quick-merge-dedup',
        op: 'line_dedup',
        scope: 'whole',
        params: { trimLine: true, removeEmpty: true, keepOrder: true },
      },
      {
        id: 'builtin-step-quick-merge-join',
        op: 'line_join',
        scope: 'whole',
        params: { delimiter: ',', trimLine: true, removeEmpty: true, quote: false },
      },
    ],
    updatedAt: 0,
  },
  {
    name: '引号合并',
    steps: [
      {
        id: 'builtin-step-quote-merge-dedup',
        op: 'line_dedup',
        scope: 'whole',
        params: { trimLine: true, removeEmpty: true, keepOrder: true },
      },
      {
        id: 'builtin-step-quote-merge-join',
        op: 'line_join',
        scope: 'whole',
        params: { delimiter: ',', trimLine: true, removeEmpty: true, quote: true, quoteChar: "'" },
      },
    ],
    updatedAt: 0,
  },
];

const cloneDefaultPipelines = (): SavedPipeline[] =>
  DEFAULT_BUILTIN_PIPELINES.map((p) => ({
    ...p,
    steps: p.steps.map((s) => ({ ...s, params: { ...s.params } })),
  }));

const isSavedPipeline = (value: unknown): value is SavedPipeline => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.name === 'string' &&
    Array.isArray(record.steps) &&
    typeof record.updatedAt === 'number'
  );
};

export const loadPipelines = (): SavedPipeline[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const initialized = localStorage.getItem(INITIALIZED_KEY);

    if (raw === null && !initialized) {
      const defaults = cloneDefaultPipelines();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(defaults));
      localStorage.setItem(INITIALIZED_KEY, 'true');
      return defaults;
    }

    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(isSavedPipeline);
  } catch {
    return [];
  }
};

export const savePipeline = (name: string, steps: PipelineStep[]): SavePipelineResult => {
  const trimmed = name.trim();
  if (!trimmed) {
    return { ok: false, error: 'NAME_REQUIRED' };
  }
  if (!Array.isArray(steps)) {
    return { ok: false, error: 'INVALID_STEPS' };
  }

  const pipelines = loadPipelines();
  const existingIndex = pipelines.findIndex((p) => p.name === trimmed);
  const entry: SavedPipeline = { name: trimmed, steps, updatedAt: Date.now() };

  if (existingIndex >= 0) {
    pipelines[existingIndex] = entry;
  } else if (pipelines.length >= MAX_PIPELINES) {
    return { ok: false, error: 'LIMIT_REACHED' };
  } else {
    pipelines.push(entry);
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pipelines));
    localStorage.setItem(INITIALIZED_KEY, 'true');
    return { ok: true };
  } catch {
    return { ok: false, error: 'STORAGE_UNAVAILABLE' };
  }
};

export const deletePipeline = (name: string): void => {
  const pipelines = loadPipelines();
  const next = pipelines.filter((p) => p.name !== name);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    localStorage.setItem(INITIALIZED_KEY, 'true');
  } catch {
    // 删除失败静默：下次加载仍可重试。
  }
};
