// Search that forgives one slip per word, for when the exact match finds
// almost nothing: "witchr" found Witchright Hall and "cyberpnk" put Cyberpunk
// 2077 behind its own art books (2026-10-23 review, RV9). Both sides are
// `searchKey`s (lib/normalize), so accents and punctuation are already gone.

/** Below this many exact matches, Search also looks one slip away. */
export const FUZZY_BELOW = 5;
/** Words shorter than this must match exactly: one slip in "war" is another word. */
const MIN_FUZZY_WORD = 4;

/** Whether two words are at most one insertion, deletion, substitution or swap of neighbours apart. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    // A substitution, or two neighbours swapped.
    if (a.slice(i + 1) === b.slice(i + 1)) return true;
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2);
  }
  // One extra letter in the longer word.
  return la > lb ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1);
}

/**
 * Whether every word of the query is in the title, exactly or one slip away.
 * A query word may also be the start of a title word ("cyberpn" for
 * "cyberpunk"), with the slip anywhere in that start, so half-typed words count.
 */
export function fuzzyMatches(titleKey: string, queryKey: string): boolean {
  const words = titleKey.split(' ').filter(Boolean);
  const query = queryKey.split(' ').filter(Boolean);
  if (!query.length || !words.length) return false;
  return query.every((q) => {
    if (titleKey.includes(q)) return true;
    if (q.length < MIN_FUZZY_WORD) return false;
    return words.some((w) => withinOneEdit(q, w)
      || (w.length > q.length && (withinOneEdit(q, w.slice(0, q.length)) || withinOneEdit(q, w.slice(0, q.length + 1)))));
  });
}
