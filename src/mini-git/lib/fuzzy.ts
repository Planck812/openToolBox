export interface FuzzyMatchResult {
  matched: boolean;
  score: number;
  indices: number[];
  matchedField: 'name' | 'path';
}

function matchSubsequence(q: string, target: string): { indices: number[]; score: number } | null {
  const targetLower = target.toLowerCase();
  const qLen = q.length;
  const tLen = targetLower.length;

  if (qLen === 0) return null;
  if (qLen > tLen) return null;

  // Find left-most matching indices
  const indices: number[] = [];
  let tIdx = 0;

  for (let qIdx = 0; qIdx < qLen; qIdx++) {
    const char = q[qIdx];
    const foundIdx = targetLower.indexOf(char, tIdx);
    if (foundIdx === -1) {
      return null;
    }
    indices.push(foundIdx);
    tIdx = foundIdx + 1;
  }

  // Calculate score:
  // 1. Base score
  let score = 100;

  // 2. Consecutive match bonus
  let consecutiveStreak = 0;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (i > 0 && idx === indices[i - 1] + 1) {
      consecutiveStreak++;
      score += 20 * consecutiveStreak;
    } else {
      consecutiveStreak = 0;
    }

    // Word boundary bonus
    if (idx === 0 || /[-_./\\ ]/.test(target[idx - 1])) {
      score += 15;
    }
  }

  // 3. Compactness bonus (penalize total span)
  const span = indices[indices.length - 1] - indices[0] + 1;
  score -= span;

  return { indices, score };
}

export function fuzzyMatch(query: string, name: string, fullPath?: string): FuzzyMatchResult | null {
  if (!query || !query.trim()) return null;
  const q = query.trim().toLowerCase();

  const nameMatch = matchSubsequence(q, name);
  const pathMatch = fullPath ? matchSubsequence(q, fullPath) : null;

  if (!nameMatch && !pathMatch) {
    return null;
  }

  // Name match is strictly prioritized over path match
  if (nameMatch && pathMatch) {
    return {
      matched: true,
      score: 10000 + nameMatch.score,
      indices: nameMatch.indices,
      matchedField: 'name',
    };
  }

  if (nameMatch) {
    return {
      matched: true,
      score: 10000 + nameMatch.score,
      indices: nameMatch.indices,
      matchedField: 'name',
    };
  }

  return {
    matched: true,
    score: pathMatch!.score,
    indices: pathMatch!.indices,
    matchedField: 'path',
  };
}
