export interface SortableEntry {
  name: string;
  isDir?: boolean;
}

/**
 * Natural sort comparison function.
 * - Directories before files
 * - Case-insensitive primary sort
 * - Numeric comparison for number segments
 * - Leading zeroes: stable comparison (e.g. "file01" before "file1")
 * - Independent of system locale (uses Unicode code point ordering)
 * - Deterministic tie-breaker for identical case-insensitive strings
 */
export function compareNatural(a: string, b: string): number {
  if (a === b) return 0;

  const chunksA = splitChunks(a);
  const chunksB = splitChunks(b);
  const len = Math.min(chunksA.length, chunksB.length);

  for (let i = 0; i < len; i++) {
    const chunkA = chunksA[i];
    const chunkB = chunksB[i];

    if (chunkA.isNum && chunkB.isNum) {
      if (chunkA.numVal !== chunkB.numVal) {
        return chunkA.numVal < chunkB.numVal ? -1 : 1;
      }
      // If numeric values are identical (e.g. "01" vs "1"),
      // compare raw string lexicographically ("01" < "1")
      if (chunkA.raw !== chunkB.raw) {
        return chunkA.raw < chunkB.raw ? -1 : 1;
      }
    } else if (chunkA.isNum !== chunkB.isNum) {
      // In ASCII, numbers ('0'-'9') come before letters
      return chunkA.isNum ? -1 : 1;
    } else {
      // Text chunks: case-insensitive comparison first
      const lowerA = chunkA.raw.toLowerCase();
      const lowerB = chunkB.raw.toLowerCase();

      if (lowerA !== lowerB) {
        return compareCodePoints(lowerA, lowerB);
      }
      // Case difference tie-breaker
      if (chunkA.raw !== chunkB.raw) {
        return compareCodePoints(chunkA.raw, chunkB.raw);
      }
    }
  }

  // If common prefix is identical, shorter string comes first
  if (chunksA.length !== chunksB.length) {
    return chunksA.length < chunksB.length ? -1 : 1;
  }

  return compareCodePoints(a, b);
}

function compareCodePoints(a: string, b: string): number {
  const minLen = Math.min(a.length, b.length);
  for (let i = 0; i < minLen; i++) {
    const codeA = a.charCodeAt(i);
    const codeB = b.charCodeAt(i);
    if (codeA !== codeB) {
      return codeA < codeB ? -1 : 1;
    }
  }
  return a.length < b.length ? -1 : (a.length > b.length ? 1 : 0);
}

interface Chunk {
  raw: string;
  isNum: boolean;
  numVal: bigint;
}

function splitChunks(str: string): Chunk[] {
  const chunks: Chunk[] = [];
  const regex = /(\d+)|(\D+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(str)) !== null) {
    if (match[1] !== undefined) {
      chunks.push({
        raw: match[1],
        isNum: true,
        numVal: BigInt(match[1]),
      });
    } else if (match[2] !== undefined) {
      chunks.push({
        raw: match[2],
        isNum: false,
        numVal: 0n,
      });
    }
  }

  return chunks;
}

/**
 * Compare tree entries: directories first, then files, both sorted naturally.
 */
export function compareTreeEntries(a: SortableEntry, b: SortableEntry): number {
  const aDir = !!a.isDir;
  const bDir = !!b.isDir;

  if (aDir !== bDir) {
    return aDir ? -1 : 1;
  }

  return compareNatural(a.name, b.name);
}
