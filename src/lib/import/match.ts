import { query } from "@/lib/db";
import { normalizeName } from "@/lib/normalize";
import type { ImportRow } from "./parse";

// PL4 — resolve imported rows against the catalog, LOCAL FIRST.
//
// The cost rule this exists to respect: a 2,000-row CSV matched naively is 2,000
// provider searches. That is the same shape that spent RAWG's monthly quota, and
// it is why the provider budget below is PER IMPORT rather than per row.
//
// Movies are the cheap medium for this. Letterboxd sources all its film data
// from TMDB, so the title and year strings in its export ARE TMDB's, matched
// against a catalog that is 99.6% TMDB-linked; and TMDB has no monthly cap
// (50 req/s, IP-based), so the tail costs minutes rather than quota. Measured on
// the catalog 2026-08-23: 1,112 movies, and exactly ONE norm_title+year
// collision across the whole movie table, so title+year is very close to a
// unique key here rather than a fuzzy guess.

export interface MatchedRow extends ImportRow {
  /** media_items.id when resolved locally, else null. */
  mediaItemId: string | null;
  how: "imdb-id" | "title-year" | "title-only" | "unmatched";
}

export interface MatchSummary {
  rows: MatchedRow[];
  matchedLocally: number;
  unmatched: number;
  /** Rows we did not even attempt a provider lookup for, because the budget ran out. */
  overBudget: number;
}

/**
 * Resolve against the LOCAL catalog only. No provider calls at all.
 *
 * Three passes, most reliable first:
 *   1. IMDb id, when the export carries one, via the `imdb` rows in media_links.
 *   2. Normalized title + year within ±1, which is how matcher.ts already
 *      resolves a title and therefore agrees with the rest of the app.
 *   3. Normalized title alone, but ONLY when it is unambiguous in the catalog.
 *      A title with two rows (Dracula, Nosferatu, The Lion King) is left
 *      unmatched rather than guessed at: sending a rating to the wrong Dracula
 *      is worse than reporting one unmatched row.
 */
export function matchLocally(rows: ImportRow[]): MatchSummary {
  const out: MatchedRow[] = [];

  // One query each rather than one per row. An import is thousands of rows and
  // better-sqlite3 is synchronous, so per-row round trips would block the process.
  const byImdb = new Map<string, string>();
  for (const r of query<{ source_id: string; media_item_id: string }>(
    "SELECT source_id, media_item_id FROM media_links WHERE source = 'imdb'",
  )) byImdb.set(r.source_id.toLowerCase(), r.media_item_id);

  const byTitle = new Map<string, { id: string; year: number | null }[]>();
  for (const r of query<{ id: string; norm_title: string | null; release_date: string | null }>(
    "SELECT id, norm_title, release_date FROM media_items WHERE type IN ('movie','show') AND norm_title IS NOT NULL",
  )) {
    const key = r.norm_title!;
    const year = r.release_date ? parseInt(r.release_date.slice(0, 4), 10) : null;
    const list = byTitle.get(key);
    if (list) list.push({ id: r.id, year: Number.isFinite(year!) ? year : null });
    else byTitle.set(key, [{ id: r.id, year: Number.isFinite(year!) ? year : null }]);
  }

  let matchedLocally = 0;
  for (const row of rows) {
    let id: string | null = null;
    let how: MatchedRow["how"] = "unmatched";

    if (row.imdbId) {
      const hit = byImdb.get(row.imdbId);
      if (hit) { id = hit; how = "imdb-id"; }
    }

    if (!id) {
      const candidates = byTitle.get(normalizeName(row.title)) ?? [];
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
  const unmatched = summary.rows.filter((r) => r.mediaItemId == null);
  // Rated titles first: a rating is the higher-value signal (it feeds the taste
  // profile) and the person is more likely to notice one missing.
  unmatched.sort((a, b) => {
    if ((a.rating != null) !== (b.rating != null)) return a.rating != null ? -1 : 1;
    return (b.year ?? 0) - (a.year ?? 0);   // then newest, which people check first
  });
  return unmatched.slice(0, budget);
}
