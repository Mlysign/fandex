// Title normalization — the single source of truth for the key the matcher uses
// to find candidate canonical items (media_items.norm_title). Kept dependency-free
// so the lowest layer (db.ts) can import it without pulling in merge.ts.
//
// Rule: lowercase → drop apostrophes (so possessives like "Marvel's" stay one word)
// → turn every other run of non-alphanumerics into a single space → trim. This
// means punctuation variants normalize equal: "Spider-Man" == "Spider Man" ==
// "spider man". Bump NORM_VERSION in db.ts whenever this rule changes (forces a
// norm_title re-backfill).
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['‘’]/g, "") // apostrophes (straight + curly) → removed, no space
    .replace(/[^a-z0-9]+/g, " ")      // any other punctuation/symbol run → single space
    .trim();
}
