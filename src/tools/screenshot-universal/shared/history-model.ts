export type HistorySource = {
  kind: string;
  recordId?: string;
  variant?: string;
};

export type HistoryRecordSummary = {
  recordId: string;
  createdAt: number;
  width: number;
  height: number;
  totalBytes: number;
  artifactDigest: string;
  source: HistorySource;
};

export type HistoryFilters = {
  sourceKind: string | null;
  search: string;
};

export type HistoryGroup = {
  label: string;
  records: HistoryRecordSummary[];
};

export function getHistorySourceKinds(records: HistoryRecordSummary[]): string[] {
  return [...new Set(records
    .map((record) => record.source.kind.trim())
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function searchableDate(createdAt: number, locale: string): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0) return '';
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return '';

  return [
    date.toISOString().slice(0, 10),
    date.toLocaleDateString(locale),
    date.toLocaleString(locale),
  ].join(' ').toLocaleLowerCase();
}

export function filterHistoryRecords(
  records: HistoryRecordSummary[],
  filters: HistoryFilters,
  locale = 'zh-CN',
): HistoryRecordSummary[] {
  const sourceKind = filters.sourceKind?.trim() ?? '';
  const search = filters.search.trim().toLocaleLowerCase();

  return records.filter((record) => {
    if (sourceKind && record.source.kind !== sourceKind) return false;
    if (!search) return true;

    return [
      record.recordId,
      record.source.kind,
      record.source.recordId ?? '',
      record.source.variant ?? '',
      searchableDate(record.createdAt, locale),
    ].some((value) => value.toLocaleLowerCase().includes(search));
  });
}

export function groupHistoryRecords(
  records: HistoryRecordSummary[],
  locale: string,
  unknownDateLabel: string,
): HistoryGroup[] {
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const groups = new Map<string, HistoryRecordSummary[]>();

  for (const record of records) {
    const date = new Date(record.createdAt);
    const label = Number.isNaN(date.getTime())
      ? unknownDateLabel
      : formatter.format(date);
    const group = groups.get(label) ?? [];
    group.push(record);
    groups.set(label, group);
  }

  return Array.from(groups, ([label, groupedRecords]) => ({
    label,
    records: groupedRecords,
  }));
}
