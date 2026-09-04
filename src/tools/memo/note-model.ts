export interface MemoNote {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MemoMonthOption = {
  key: string;
  count: number;
};

export const createNote = (timestamp: string, id: string): MemoNote => ({
  id,
  title: '',
  content: '',
  pinned: false,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const updateNote = (
  note: MemoNote,
  patch: Partial<Pick<MemoNote, 'title' | 'content'>>,
  timestamp: string,
): MemoNote => ({
  ...note,
  ...patch,
  updatedAt: timestamp,
});

export const toggleNotePinned = (note: MemoNote, timestamp: string): MemoNote => ({
  ...note,
  pinned: !note.pinned,
  updatedAt: timestamp,
});

export const deleteNoteById = (notes: MemoNote[], noteId: string): MemoNote[] =>
  notes.filter((note) => note.id !== noteId);

export const sortNotes = (notes: MemoNote[]): MemoNote[] =>
  [...notes].sort((left, right) => {
    if (left.pinned !== right.pinned) {
      return Number(right.pinned) - Number(left.pinned);
    }

    return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  });

export const searchNotes = (notes: MemoNote[], keyword: string): MemoNote[] => {
  const normalized = keyword.trim().toLowerCase();
  if (!normalized) {
    return notes;
  }

  return notes.filter((note) => `${note.title}\n${note.content}`.toLowerCase().includes(normalized));
};

export const getNoteDisplayTitle = (
  note: Pick<MemoNote, 'title'>,
  fallbackTitle: string,
): string => note.title.trim() || fallbackTitle;

export const getNoteMonthKey = (value: string): string => value.slice(0, 7);

export const buildMonthOptions = (notes: MemoNote[]): MemoMonthOption[] => {
  const counts = new Map<string, number>();

  notes.forEach((note) => {
    const monthKey = getNoteMonthKey(note.updatedAt);
    counts.set(monthKey, (counts.get(monthKey) ?? 0) + 1);
  });

  const monthOptions = [...counts.entries()]
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([key, count]) => ({ key, count }));

  return [{ key: 'all', count: notes.length }, ...monthOptions];
};

export const filterNotesByMonth = (notes: MemoNote[], selectedMonth: string): MemoNote[] => {
  if (selectedMonth === 'all') {
    return notes;
  }

  return notes.filter((note) => getNoteMonthKey(note.updatedAt) === selectedMonth);
};

export const paginateNotes = (notes: MemoNote[], page: number, pageSize: number): MemoNote[] => {
  const safePage = Math.max(1, page);
  const start = (safePage - 1) * pageSize;
  return notes.slice(start, start + pageSize);
};

export const clampPage = (page: number, totalPages: number): number => {
  if (totalPages <= 0) {
    return 1;
  }

  return Math.min(Math.max(1, page), totalPages);
};
