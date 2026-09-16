import { describe, it, expect } from 'vitest';
import { compareNatural, compareTreeEntries, SortableEntry } from '../naturalSort';

describe('compareNatural & compareTreeEntries', () => {
  it('TC-3.5: directories before files, case-insensitively sorted', () => {
    const entries: SortableEntry[] = [
      { name: 'b.txt', isDir: false },
      { name: 'A', isDir: true },
      { name: 'a.txt', isDir: false },
      { name: 'B', isDir: true },
    ];

    entries.sort(compareTreeEntries);
    expect(entries.map(e => (e.isDir ? `${e.name}/` : e.name))).toEqual([
      'A/',
      'B/',
      'a.txt',
      'b.txt',
    ]);
  });

  it('TC-3.6: natural numeric sorting with leading zeroes ordered before', () => {
    const list = ['file1', 'file01', 'file10', 'file2'];
    list.sort(compareNatural);
    expect(list).toEqual(['file01', 'file1', 'file2', 'file10']);
  });

  it('TC-3.7: sorting with Chinese, emoji, numbers is locale-independent and stable', () => {
    const list1 = ['项目10', '🍎苹果', '项目2', '123数字', '项目01', '🚀火箭'];
    const list2 = [...list1];

    list1.sort(compareNatural);
    list2.sort(compareNatural);

    expect(list1).toEqual(list2);
    // Number chunks within Chinese strings work naturally:
    expect(list1.indexOf('项目01')).toBeLessThan(list1.indexOf('项目10'));
    expect(list1.indexOf('项目2')).toBeLessThan(list1.indexOf('项目10'));
  });

  it('tie-breaks stably when identical except for case', () => {
    const list = ['file.TXT', 'file.txt'];
    const sorted1 = [...list].sort(compareNatural);
    expect(sorted1.length).toBe(2);
  });
});
