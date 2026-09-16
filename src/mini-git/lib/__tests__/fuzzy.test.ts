import { describe, it, expect } from 'vitest';
import { fuzzyMatch } from '../fuzzy';

describe('fuzzyMatch', () => {
  it('TC-1.4: matches subsequence and returns correct indices for open-toolbox', () => {
    const res = fuzzyMatch('otb', 'open-toolbox');
    expect(res).not.toBeNull();
    expect(res?.matched).toBe(true);
    expect(res?.matchedField).toBe('name');
    // 'o' at 0, 't' at 5, 'b' at 9
    expect(res?.indices).toEqual([0, 5, 9]);
  });

  it('TC-1.5: matches path when name does not match', () => {
    const res = fuzzyMatch('dcb', 'blog', 'D:\\code\\blog');
    expect(res).not.toBeNull();
    expect(res?.matched).toBe(true);
    expect(res?.matchedField).toBe('path');
    // D at 0, c at 3, b at 8
    expect(res?.indices).toEqual([0, 3, 8]);
  });

  it('TC-1.6: name match scores strictly higher than path match', () => {
    // Both match 'proj'
    const nameMatch = fuzzyMatch('proj', 'my-project', 'C:\\workspace\\my-project');
    const pathMatch = fuzzyMatch('proj', 'other-repo', 'C:\\projects\\other-repo');

    expect(nameMatch).not.toBeNull();
    expect(pathMatch).not.toBeNull();
    expect(nameMatch!.score).toBeGreaterThan(pathMatch!.score);
  });

  it('TC-1.7: consecutive match scores higher than scattered match', () => {
    // 'tool' is consecutive in 'open-toolbox', scattered in 'total-out-of-line'
    const consecutive = fuzzyMatch('tool', 'open-toolbox');
    const scattered = fuzzyMatch('tool', 'total-out-of-line');

    expect(consecutive).not.toBeNull();
    expect(scattered).not.toBeNull();
    expect(consecutive!.score).toBeGreaterThan(scattered!.score);
  });

  it('TC-1.8: picks left-most group of indices when multiple matches exist', () => {
    // In 'banana', matching 'an' can match indices [1, 2] or [3, 4]. Left-most is [1, 2].
    const res = fuzzyMatch('an', 'banana');
    expect(res).not.toBeNull();
    expect(res?.indices).toEqual([1, 2]);
  });

  it('TC-1.9: case-insensitive produces identical scores and indices', () => {
    const lower = fuzzyMatch('otb', 'open-toolbox');
    const upper = fuzzyMatch('OTB', 'open-toolbox');

    expect(lower).not.toBeNull();
    expect(upper).not.toBeNull();
    expect(lower?.indices).toEqual(upper?.indices);
    expect(lower?.score).toBe(upper?.score);
  });

  it('returns null for empty or non-matching query', () => {
    expect(fuzzyMatch('', 'open-toolbox')).toBeNull();
    expect(fuzzyMatch('xyz', 'open-toolbox')).toBeNull();
  });
});
