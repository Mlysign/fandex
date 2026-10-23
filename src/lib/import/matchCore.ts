import { normalizeName } from "@/lib/normalize";
import type { ImportRow } from "./parseText";

// PL4: how an imported row is matched to a catalog title, with the catalog
// handed in. match.ts reads it from the server's database; the app reads it
// from its own catalog copy (mobile/src/lib/listImport.ts). Pure, so both run
// the same three passes.

export interface MatchedRow extends ImportRow {
  /** media_items.id when resolved locally, else null. */
  mediaItemId: string | null;
  /** Resolved at TMDB when the local catalog had nothing. Persisted at apply time. */
  tmdbId?: number | null;
  how: "imdb-id" | "title-year" | "title-only" | "provider" | "unmatched";
}

export interface MatchSummary {
  rows: MatchedRow[];
  matchedLocally: number;
  /** Resolved at TMDB after the catalog came up empty. Zero until the fallback runs. */
  matchedAtProvider?: number;
  unmatched: number;
  /** Rows we did not even attempt a provider lookup for, because the budget ran out. */
  overBudget: number;
}

/**
 * The three passes, most reliable first:
 *   1. IMDb id, when the export carries one.
 *   2. Normalized title + year within ±1, which is how matcher.ts already
 *      resolves a title and therefore agrees with the rest of the app.
 *   3. Normalized title alone, but ONLY when it is unambiguous in the catalog.
 *      A title with two rows (Dracula, Nosferatu, The Lion King) is left
 *      unmatched rather than guessed at: sending a rating to the wrong Dracula
 *      is worse than reporting one unmatched row.
 *
 * `byTitle` is keyed by `normalizeName(title)`.
 *
 * ⚠️ Never on an EMPTY key. `normalizeName` keeps a to z only, so every title
 * in another script ("七人の侍", "Сталкер") normalises to "", and they all
 * matched each other: an import could rate the wrong film, a real Trakt write.
 * A row with no key goes to the provider lookup, which searches the raw title.
 */
export function matchAgainst(
  rows: ImportRow[],
  byImdb: Map<string, string>,
  byTitle: Map<string, { id: string; year: number | null }[]>,
): MatchSummary {
  const out: MatchedRow[] = [];
  let matchedLocally = 0;
  for (const row of rows) {
    let id: string | null = null;
    let how: MatchedRow["how"] = "unmatched";

    if (row.imdbId) {
      const hit = byImdb.get(row.imdbId);
      if (hit) { id = hit; how = "imdb-id"; }
    }

    const key = normalizeName(row.title);
    if (!id && key) {
      const candidates = byTitle.get(key) ?? [];
      if (row.year != null) {
        const near = candidates.filter((c) => c.year != null && Math.abs(c.year - row.year!) <= 1);
        if (near.length === 1) { id = near[0].id; how = "title-year"; }
      }
      // Unambiguous title with no year to check, or a year the catalog lacks.
      if (!id && candidates.length === 1 && row.year == null) {
        id = candidates[0].id; how = "title-only";
      }
    }

    if (id) matchedLocally++;
    out.push({ ...row, mediaItemId: id, how });
  }

  return {
    rows: out,
    matchedLocally,
    unmatched: out.length - matchedLocally,
    overBudget: 0,
  };
}

/**
 * How many provider lookups an import is allowed, total.
 *
 * A ceiling on the IMPORT, not on the row. Per-row is how you turn one upload
 * into thousands of provider calls; per-import is what makes the worst case
 * knowable before it happens. 400 at TMDB's rate is on the order of a minute.
 */
export const PROVIDER_LOOKUP_BUDGET = 400;

/** Rows worth spending a provider lookup on, in the order worth spending it. */
export function lookupQueue(summary: MatchSummary, budget = PROVIDER_LOOKUP_BUDGET): MatchedRow[] {
  const unmatched = summary.rows.filter((r) => r.mediaItemId == null && r.tmdbId == null);
  // Rated titles first: a rating is the higher-value signal (it feeds the taste
  // profile) and the person is more likely to notice one missing.
  unmatched.sort((a, b) => {
    if ((a.rating != null) !== (b.rating != null)) return a.rating != null ? -1 : 1;
    return (b.year ?? 0) - (a.year ?? 0);   // then newest, which people check first
  });
  return unmatched.slice(0, budget);
}

