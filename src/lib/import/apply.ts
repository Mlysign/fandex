import { recordLibraryRating, upsertWatchlistEntry } from "@/lib/matcher";
import { matchLocally } from "./match";
import type { ImportRow } from "./parse";

// PL4 — write a staged import into an account.
//
// ⚠️ THIS IS A WRITE PATH INTO media_items AND user_item_state, so it inherits
// the rules in AGENTS.md rather than inventing its own:
//
//  · It goes through matcher.ts's helpers, never straight SQL against
//    user_library / user_watchlist — those are VIEWS since migration 16 and
//    writing to them breaks at boot.
//  · It NEVER stamps browsed = 1. An imported title is a real library, and
//    browsed = 1 is exactly what the boot prune deletes. This is the difference
//    between an import that survives the next deploy and one that does not.
//  · It only touches items that already resolve to a media_items row. Minting
//    catalog rows for unmatched titles is a separate, provider-backed step; an
//    import must not invent rows to make its own numbers look better.
//
// It re-matches rather than trusting ids staged earlier: the catalog may have
// grown between the upload and the signup, and a staged id may have been pruned.

export interface ApplyResult {
  imported: number;
  ratings: number;
  wishlist: number;
  /** Rows that still resolve to nothing. Reported, never silently dropped. */
  unmatched: number;
  unmatchedTitles: string[];
}

/** The source label written against imported state. */
const IMPORT_SOURCE = "local";

export function applyImport(userId: string, rows: ImportRow[]): ApplyResult {
  const matched = matchLocally(rows);

  let ratings = 0;
  let wishlist = 0;
  const unmatchedTitles: string[] = [];
  // Seconds, matching what recordLibraryRating stores elsewhere.
  const now = Math.floor(Date.now() / 1000);

  for (const row of matched.rows) {
    if (!row.mediaItemId) {
      // Cap what we carry back: a 2,000-row import with a long tail should not
      // return a 2,000-entry array to a browser. The COUNT is always exact.
      if (unmatchedTitles.length < 100) unmatchedTitles.push(row.year ? `${row.title} (${row.year})` : row.title);
      continue;
    }

    if (row.relation === "library") {
      recordLibraryRating(userId, row.mediaItemId, {
        rating: row.rating,
        // An imported rating means "I have seen this", which is the same
        // statement rating something in-app makes.
        status: "watched",
        sources: [IMPORT_SOURCE],
        reviewedAt: row.ratedAt ? Math.floor(new Date(row.ratedAt).getTime() / 1000) || now : now,
      });
      ratings++;
    } else {
      upsertWatchlistEntry(userId, row.mediaItemId, IMPORT_SOURCE as never);
      wishlist++;
    }
  }

  return {
    imported: ratings + wishlist,
    ratings,
    wishlist,
    unmatched: matched.unmatched,
    unmatchedTitles,
  };
}
