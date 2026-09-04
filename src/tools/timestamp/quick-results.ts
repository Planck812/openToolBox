import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(customParseFormat);

const DATE_FORMATS = {
  hyphen: 'YYYY-MM-DD',
  compact: 'YYYYMMDD',
} as const;

const parseTimestampInput = (value: string): dayjs.Dayjs | null => {
  if (/^\d{10}$/.test(value)) {
    return dayjs.unix(Number(value));
  }

  if (/^\d{13}$/.test(value)) {
    return dayjs(Number(value));
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return dayjs(value, DATE_FORMATS.hyphen, true).startOf('day');
  }

  if (/^\d{8}$/.test(value)) {
    return dayjs(value, DATE_FORMATS.compact, true).startOf('day');
  }

  return null;
};

export const getTimestampQuickResults = (input: string): string[] => {
  const trimmed = input.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = parseTimestampInput(trimmed);
  if (!parsed || !parsed.isValid()) {
    return [];
  }

  return [
    parsed.unix().toString(),
    parsed.valueOf().toString(),
    parsed.format(DATE_FORMATS.hyphen),
    parsed.format(DATE_FORMATS.compact),
  ];
};

export const getDefaultTimestampQuickResultIndex = (input: string, results: string[]): number => {
  const normalizedInput = input.trim();
  if (results.length === 0) {
    return 0;
  }

  for (let index = 0; index < results.length; index += 1) {
    if (results[index] !== normalizedInput) {
      return index;
    }
  }
  return 0;
};
