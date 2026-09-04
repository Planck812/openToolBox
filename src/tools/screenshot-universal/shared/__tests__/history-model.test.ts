import { describe, expect, it } from 'vitest';
import {
  filterHistoryRecords,
  getHistorySourceKinds,
  groupHistoryRecords,
  type HistoryRecordSummary,
} from '../history-model';

const records: HistoryRecordSummary[] = [
  {
    recordId: 'capture-record',
    createdAt: Date.UTC(2026, 6, 26, 8),
    width: 100,
    height: 100,
    totalBytes: 100,
    artifactDigest: 'digest-a',
    source: { kind: 'capture' },
  },
  {
    recordId: 'copy-record',
    createdAt: Date.UTC(2026, 6, 25, 8),
    width: 100,
    height: 100,
    totalBytes: 100,
    artifactDigest: 'digest-b',
    source: { kind: 'editable_copy', recordId: 'capture-record', variant: 'final' },
  },
];

describe('screenshot history model', () => {
  it('derives stable source kinds and filters by source', () => {
    expect(getHistorySourceKinds(records)).toEqual(['capture', 'editable_copy']);
    expect(filterHistoryRecords(records, { sourceKind: 'editable_copy', search: '' }))
      .toEqual([records[1]]);
  });

  it('searches record metadata and date text without duplicating history state', () => {
    expect(filterHistoryRecords(records, { sourceKind: null, search: 'capture-record' }))
      .toEqual([records[0], records[1]]);
    expect(filterHistoryRecords(records, { sourceKind: null, search: '2026-07-26' }))
      .toEqual([records[0]]);
    expect(filterHistoryRecords(records, { sourceKind: null, search: 'no match' }))
      .toEqual([]);
  });

  it('groups filtered records by their localized calendar day', () => {
    expect(groupHistoryRecords([records[0]], 'en-CA', 'Unknown')).toEqual([
      { label: 'Jul 26, 2026', records: [records[0]] },
    ]);
  });
});
