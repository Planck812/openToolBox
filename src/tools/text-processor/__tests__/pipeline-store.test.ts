import { beforeEach, describe, expect, it } from 'vitest';
import { deletePipeline, loadPipelines, savePipeline } from '../pipeline-store';
import type { PipelineStep, StepOp, StepScope } from '../steps';

const makeStep = (op: StepOp, scope: StepScope = 'whole'): PipelineStep => ({
  id: `s-${op}`,
  op,
  scope,
  params: {},
});

describe('pipeline-store', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads default builtin pipelines on fresh storage', () => {
    const pipelines = loadPipelines();
    expect(pipelines).toHaveLength(2);
    expect(pipelines.map((p) => p.name)).toEqual(['快速合并', '引号合并']);
    expect(pipelines[0].steps.map((s) => s.op)).toEqual(['line_dedup', 'line_join']);
    expect(pipelines[1].steps.map((s) => s.op)).toEqual(['line_dedup', 'line_join']);
  });

  it('saves and loads a custom pipeline alongside default pipelines', () => {
    const result = savePipeline('my pipeline', [makeStep('upper')]);
    expect(result.ok).toBe(true);

    const pipelines = loadPipelines();
    expect(pipelines).toHaveLength(3);
    const custom = pipelines.find((p) => p.name === 'my pipeline');
    expect(custom).toBeDefined();
    expect(custom?.steps[0].op).toBe('upper');
    expect(typeof custom?.updatedAt).toBe('number');
  });

  it('overwrites a pipeline with the same name', () => {
    savePipeline('p', [makeStep('upper')]);
    savePipeline('p', [makeStep('lower')]);

    const pipelines = loadPipelines();
    expect(pipelines.filter((p) => p.name === 'p')).toHaveLength(1);
    const entry = pipelines.find((p) => p.name === 'p');
    expect(entry?.steps[0].op).toBe('lower');
  });

  it('rejects an empty name', () => {
    const result = savePipeline('   ', [makeStep('upper')]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('NAME_REQUIRED');
  });

  it('rejects saving more than 20 pipelines', () => {
    // 2 default pipelines already present, add 18 to hit limit 20
    for (let i = 0; i < 18; i += 1) {
      savePipeline(`p${i}`, [makeStep('upper')]);
    }
    const result = savePipeline('overflow', [makeStep('upper')]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('LIMIT_REACHED');
  });

  it('deletes a builtin pipeline and does not restore it on reload', () => {
    deletePipeline('快速合并');
    const remaining = loadPipelines();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].name).toBe('引号合并');

    deletePipeline('引号合并');
    expect(loadPipelines()).toHaveLength(0);
  });

  it('deletes a custom pipeline', () => {
    savePipeline('p', [makeStep('upper')]);
    deletePipeline('p');
    const pipelines = loadPipelines();
    expect(pipelines.find((p) => p.name === 'p')).toBeUndefined();
  });
});
