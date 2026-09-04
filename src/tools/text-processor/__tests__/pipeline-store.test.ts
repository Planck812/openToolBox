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

  it('saves and loads a pipeline', () => {
    const result = savePipeline('my pipeline', [makeStep('upper')]);
    expect(result.ok).toBe(true);

    const pipelines = loadPipelines();
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0].name).toBe('my pipeline');
    expect(pipelines[0].steps[0].op).toBe('upper');
    expect(typeof pipelines[0].updatedAt).toBe('number');
  });

  it('overwrites a pipeline with the same name', () => {
    savePipeline('p', [makeStep('upper')]);
    savePipeline('p', [makeStep('lower')]);

    const pipelines = loadPipelines();
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0].steps[0].op).toBe('lower');
  });

  it('rejects an empty name', () => {
    const result = savePipeline('   ', [makeStep('upper')]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('NAME_REQUIRED');
  });

  it('rejects saving more than 20 pipelines', () => {
    for (let i = 0; i < 20; i += 1) {
      savePipeline(`p${i}`, [makeStep('upper')]);
    }
    const result = savePipeline('overflow', [makeStep('upper')]);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('LIMIT_REACHED');
  });

  it('deletes a pipeline', () => {
    savePipeline('p', [makeStep('upper')]);
    deletePipeline('p');
    expect(loadPipelines()).toHaveLength(0);
  });
});
