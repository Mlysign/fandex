import { query } from "@/lib/db";
import { linkSourceToItem } from "@/lib/matcher";
import { METADATA } from "@/lib/metadata/registry";
import { extractYear } from "@/lib/merge";
import { log, errorFields } from "@/lib/logger";
import type { Source } from "@/types";

// ── Game cross-linking (2026-08-13) ──────────────────────────────────────────
//
// A game should carry a link to every game catalog we speak to, because each one
// contributes something the others don't: RAWG has the broadest console
// coverage, IGDB the per-region release dates, and **Steam the tags** — 446 of
// them, including `Deckbuilding` and `Tower Defense`, where RAWG/IGDB stop at
// genre level. `mergeLinks`' TAG_SOURCES already unions all three into an item's
// tags, so a missing link is directly a poorer Fandex Score and a game that a
// tag search can't find.
//
// This replaces two HALF-copies of the same idea: the RAWG adapter cross-linked
// Steam, the Steam adapter cross-linked RAWG, neither touched IGDB, and BOTH
// bailed out on `kind !== "wishlist"` — so nothing anyone actually *played* ever
// got cross-linked. Measured before this landed: 473 of 1,090 catalog games had
// no Steam link at all.
//
// Insert-only by construction: `linkSourceToItem` upserts one link per (source,
// source_id), and a source already present is skipped before any network call —
// so this can never overwrite a richer stored payload, and re-running is free.

export const GAME_SOURCES: readonly Source[] = ["steam", "rawg", "igdb"];

/**
 * A shared allowance for one sync pass, so a catalog that has never been
 * backfilled can't turn a routine sync into hundreds of title searches.
 *
 * Necessary because the search is per item and not cheap: Steam's is an HTML
 * scrape of the store's suggest endpoint (there is no name search on the JSON
 * API — `search_term` is silently ignored there, like `filters.tagids`). Normal
 * operation costs nothing, because an item that already has its links never
 * reaches the network; the allowance only bites on a big first pass, which is
 * what `scripts/backfill-game-crosslinks.ts` is for.
 */
export interface CrossLinkBudget { remaining: number }
export const crossLinkBudget = (searches: number): CrossLinkBudget => ({ remaining: searches });

// Matches the pacing the adapters already used for these searches.
const SEARCH_PACE_MS = 200;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function linkedSources(mediaItemId: string): Set<string> {
  const rows = query<{ source: string }>("SELECT source FROM media_links WHERE media_item_id = ?", [mediaItemId]);
  return new Set(rows.map((r) => r.source));
}

/**
 * Give a game its missing catalog links, by title. Returns the sources added.
 *
 * Best-effort throughout: a provider that errors, finds nothing, or isn't
 * configured simply doesn't contribute. Nothing here throws — it runs inside
 * ingest, and a failed cross-link must never fail the sync that triggered it
 * (which would be read as a failed PULL, and the prune invariant makes that
 * expensive).
 */
export async function crossLinkGame(
  mediaItemId: string,
  title: string,
  opts: { sources?: readonly Source[]; releaseDate?: string | null; budget?: CrossLinkBudget } = {}
): Promise<Source[]> {
  if (!title?.trim()) return [];
  const want = opts.sources ?? GAME_SOURCES;
  const have = linkedSources(mediaItemId);
  const missing = want.filter((s) => !have.has(s));
  if (!missing.length) return [];

  // The earliest known year disambiguates same-titled entries — IGDB in
  // particular ranks ports and remasters alongside the original.
  const year = extractYear(opts.releaseDate ?? null);
  const added: Source[] = [];

  for (const source of missing) {
    if (opts.budget && opts.budget.remaining <= 0) break;
    const provider = METADATA[source];
    if (!provider?.searchByTitle) continue;
    if (provider.configured && !provider.configured()) continue;

    if (opts.budget) opts.budget.remaining--;
    try {
      const link = await provider.searchByTitle(title, "game", { year });
      if (link) {
        // linkSourceToItem returns the item the link is ACTUALLY on. A
        // (source, source_id) pair is unique, so if another catalog row already
        // claims this appid — a duplicate entry, or two different titles that
        // both title-match the same store page — it stays there and OUR item
        // gains nothing. Counting that as success over-reported the first real
        // run by 8 (249 claimed vs 241 link rows created), and would have made
        // the backfill look complete while those games stayed unlinked.
        const attachedTo = linkSourceToItem(mediaItemId, {
          source, sourceId: link.sourceId, type: "game",
          title: link.title, releaseDate: link.releaseDate, rawData: link.rawData,
        });
        if (attachedTo === mediaItemId) added.push(source);
        else log.info("cross_link_claimed_elsewhere", { source, sourceId: link.sourceId, mediaItemId, attachedTo });
      }
    } catch (e) {
      log.warn("cross_link_failed", { source, mediaItemId, ...errorFields(e) });
    }
    await sleep(SEARCH_PACE_MS);
  }
  return added;
}
