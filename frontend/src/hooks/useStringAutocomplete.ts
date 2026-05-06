/**
 * Generic autocomplete hook for plain string arrays.
 * Returns up to 5 candidates whose lowercased value starts with the lowercased query.
 * Returns an empty array when query is empty.
 */
export function useStringAutocomplete(candidates: string[], query: string): string[] {
  if (query === '') return [];
  const lower = query.toLowerCase();
  const results: string[] = [];
  for (const c of candidates) {
    if (c.toLowerCase().startsWith(lower)) {
      results.push(c);
      if (results.length === 5) break;
    }
  }
  return results;
}
