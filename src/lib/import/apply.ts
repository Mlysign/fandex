import { recordLibraryRating, upsertWatchlistEntry } from "@/lib/matcher";
import { persistItemFromIds } from "@/lib/persistItem";
import { log, errorFields } from "@/lib/logger";
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
  /** Catalog rows minted from a TMDB id the analyze step resolved (2026-09-03). */
  created: number;
  /** Rows that still resolve to nothing. Reported, never silently dropped. */
  unmatched: number;
  unmatchedTitles: string[];
}

/** The source label written against imported state. */
const IMPORT_SOURCE = "local";

/** Parallel item creations. Each is one TMDB fetch plus a synchronous upsert. */
const CREATE_CONCURRENCY = 4;

export async function applyImport(userId: string, rows: ImportRow[]): Promise<ApplyResult> {
  const matched = matchLocally(rows);

  let ratings = 0;
  let wishlist = 0;
  let created = 0;
  const unmatchedTitles: string[] = [];
  // Seconds, matching what recordLibraryRating stores elsewhere.
  const now = Math.floor(Date.now() / 1000);

  // ── Rows the catalog does not hold, but TMDB does (2026-09-03) ────────────
  //
  // The comment above says "an import must not invent rows to make its own
  // numbers look better", and that still holds: nothing is minted from a TITLE
  // here. What is minted comes from a TMDB ID resolved during the anonymous
  // analyze step, which is a real identity for a real work, not a guess.
  //
  // This is the write half of the fix for "is this looking up our DB or also
  // checking TMDB? its a big deal breaker if half my export would be lost".
  // Before it, a title we did not already hold was simply dropped.
  //
  // Bounded concurrency because each of these is one TMDB detail fetch plus an
  // upsert, and better-sqlite3 is synchronous: a wide fan-out would hold the
  // write lock in bursts for no gain.
  const needCreating = matched.rows.filter((r) => !r.mediaItemId && r.tmdbId != null);
  if (needCreating.length) {
    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(CREATE_CONCURRENCY, needCreating.length) }, async () => {
        for (;;) {
          const row = needCreating[cursor++];
          if (!row) return;
          try {
            const id = await persistItemFromIds({
              type: "movie",
              title: row.title,
              releaseDate: row.year ? `${row.year}-01-01` : null,
              ids: { tmdb: row.tmdbId! },
            });
            if (id) { row.mediaItemId = id; created++; }
          } catch (e) {
            // One provider failure costs one title, never the import. It falls
            // through to unmatchedTitles below and is reported, not swallowed.
            log.warn("import_create_failed", { title: row.title, ...errorFields(e) });
          }
        }
      }),
    );
  }

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
    created,
    // Recomputed rather than reusing matchLocally's count: rows created from a
    // staged TMDB id above are no longer unmatched, and reporting the pre-create
    // number would put the old, alarming figure back on the confirmation.
    unmatched: matched.rows.filter((r) => !r.mediaItemId).length,
    unmatchedTitles,
  };
}
