// The Progress tab's list: every "up next" episode, each carrying the facts its
// toolbar filters and sorts on. See lib/progressFilter.ts for what reads them.
//
// ── Why the WHOLE list, and no paging ───────────────────────────────────────
// This replaced `buildUpNextPage` (2026-08-28). Paging was the right shape while
// the tab had no filters; it is the wrong one now, because every filter in this
// app runs client-side and **a filter over one page of a paged list is a lie** —
// search would have found only what you had already scrolled past.
//
// It is also cheaper, not more expensive. `buildUpNext` re-derives the entire
// list on every call and slices, so serving page 4 cost exactly what serving all
// of it costs; paging just paid that price once per scroll. Measured on the real
// account (2026-08-28): 84 entries, 40 ms to build, 31 ms to enrich, **110 KB**
// on the wire against `/api/library`'s 8.9 MB for the tabs beside it. The tab
// now pages its RENDER, not its fetch.
//
// ⚠️ The bound is "shows you are part-way through", not the catalog — it cannot
// grow with the catalog the way a discovery pool does. If it ever approaches
// SQLite's 32,766-variable limit, `getUserStateMap`'s WHOLE_USER_ABOVE switch is
// the pattern to copy; `loadEpisodeIndex` in upNext.ts names ids the same way
// off the same bound.

import { query } from "@/lib/db";
import { buildUpNext } from "@/lib/upNext";
import { getDerivedForItem, type RawLink } from "@/lib/facetCache";
import { facetId } from "@/lib/facets";
import { getUserCountry } from "@/lib/userCountry";
import { getUserStateMap } from "@/lib/userState";
import { buildProfile, computeFandexScore, scoringContext } from "@/lib/discovery";
import { parseRatings, averageRating } from "@/lib/ratings";
import type { ProgressEntry } from "@/lib/progressFilter";
import type { MediaLink } from "@/types";

export async function buildFilterableUpNext(
  userId: string,
  opts: { now?: number; maxHealShows?: number; healBudgetMs?: number } = {},
): Promise<{ entries: ProgressEntry[]; total: number }> {
  // ⚠️ includeHidden, and ONLY here. Nils, 2026-09-03: "i cannot find it on
  // progress when typing it into the searchbox (wrong)." Hidden means stop
  // volunteering it, not pretend it does not exist, and this tab has a search
  // box — so it is handed the hidden shows FLAGGED and drops them client-side
  // unless somebody is searching. Home's rail keeps the default and never sees
  // them. Every filter in this app is client-side, so the list has to be fetched
  // whole or the search finds only what you had already scrolled past.
  const base = await buildUpNext(userId, { ...opts, limit: Infinity, includeHidden: true });
  if (!base.length) return { entries: [], total: 0 };

  const ids = base.map((e) => e.mediaItemId);
  const ph = ids.map(() => "?").join(",");

  // `raw_data` stays an UNPARSED string here, exactly as /api/library does it:
  // getDerivedForItem only JSON.parses on an actual cache miss, so a revisit to
  // an unchanged library skips the parse + mergeLinks + extractFacets entirely.
  const linkRows = query<{
    media_item_id: string;
    source: string;
    source_id: string;
    raw_data: string;
    release_date: string | null;
    last_synced: number | null;
  }>(
    `SELECT media_item_id, source, source_id, raw_data, release_date, last_synced
       FROM media_links WHERE media_item_id IN (${ph})`,
    ids,
  );
  const linksByItem = new Map<string, RawLink[]>();
  for (const r of linkRows) {
    const list = linksByItem.get(r.media_item_id) ?? [];
    list.push({
      source: r.source as MediaLink["source"],
      sourceId: r.source_id,
      releaseDate: r.release_date,
      rawData: r.raw_data,
      lastSynced: r.last_synced ?? 0,
    });
    linksByItem.set(r.media_item_id, list);
  }

  // `added_at` is the one field UserState doesn't carry, and the "Recently
  // added" sort is the whole reason it's here.
  const addedRows = query<{ media_item_id: string; added_at: number | null; metadata: string | null; rating: number | null }>(
    `SELECT media_item_id, added_at, metadata, rating FROM user_library
      WHERE user_id = ? AND media_item_id IN (${ph})`,
    [userId, ...ids],
  );
  const libByItem = new Map(addedRows.map((r) => [r.media_item_id, r]));

  const stateMap = getUserStateMap(userId, ids);
  const country = getUserCountry(userId);
  const profile = buildProfile(userId);
  // One context for the whole pass, never one per item — three cached config
  // reads that `computeFandexScore` would otherwise re-validate 84 times over.
  const ctx = scoringContext();

  const entries: ProgressEntry[] = base.map((e) => {
    const { facets, merged } = getDerivedForItem(e.mediaItemId, linksByItem.get(e.mediaItemId) ?? [], "show", country);
    const fx = computeFandexScore(facets, profile, undefined, { mediaItemId: e.mediaItemId, ctx });
    const state = stateMap.get(e.mediaItemId);
    const lib = libByItem.get(e.mediaItemId);
    // The canonical per-user score is the average across the platforms it was
    // pushed to, falling back to the stored column — /api/library's derivation,
    // so "Rated only" means the same thing on both tabs.
    const rating = averageRating(parseRatings(lib?.metadata ?? null)) ?? lib?.rating ?? state?.rating ?? null;

    return {
      mediaItemId: e.mediaItemId,
      showTitle: e.showTitle,
      posterUrl: e.posterUrl,
      season: e.season,
      episode: e.episode,
      episodeTitle: e.episodeTitle,
      airDate: e.airDate,
      href: e.href,
      eventAt: e.eventAt,
      hidden: !!e.hidden,

      type: "show",
      facetIds: facets.map((f) => facetId(f)),
      releaseDate: merged.releaseDate ?? null,
      platforms: merged.platforms ?? [],
      // Trimmed to the one field `availableOnKeys` reads. The full provider
      // objects carry logos and display order nothing on this tab renders.
      streamingProviders: (merged.streamingProviders ?? []).map((s) => ({ name: s.name })),
      communityRatings: merged.communityRatings ?? [],
      fandexScore: fx?.score ?? null,
      libraryStatus: state?.libraryStatus ?? null,
      rating,
      platformSources: state?.platformSources ?? [],
      addedAt: lib?.added_at ?? null,
    };
  });

  // `total` counts the VISIBLE set. A hidden show is in the payload only so
  // the search box can reach it; counting it would make the tab announce a
  // number the list never shows.
  return { entries, total: entries.filter((e) => !e.hidden).length };
}
