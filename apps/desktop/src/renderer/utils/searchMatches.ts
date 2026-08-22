// Case-insensitive literal search, shared by the YAML editor and the log
// viewer so that "3/17" means the same thing in both, and so that stepping
// through matches behaves the same wherever a Find box appears.
export interface SearchMatch {
  from: number;
  to: number;
}

// Matches never overlap: the scan continues past the end of the one it just
// found, which is how the counter and the highlighted ranges stay in step.
export function matchRanges(text: string, query: string): SearchMatch[] {
  const needle = query.toLowerCase();
  if (!needle || !text) return [];
  const haystack = text.toLowerCase();
  const ranges: SearchMatch[] = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    ranges.push({ from: at, to: at + needle.length });
    at = haystack.indexOf(needle, at + needle.length);
  }
  return ranges;
}

// Stepping wraps around. From nothing selected, forwards lands on the first
// match and backwards on the last one - counting backwards from -1 used to
// skip the last match.
export function nextMatchIndex(current: number, direction: 1 | -1, count: number): number {
  if (count <= 0) return -1;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}
