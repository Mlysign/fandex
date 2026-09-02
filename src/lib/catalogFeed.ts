import { query, get } from "@/lib/db";
import type { Direction, FeedCandidate } from "@/lib/discoverFeed";
import { dateWindow } from "@/lib/discoverFeed";
import type { MediaType } from "@/types";

// Discover, served from our own catalog — the first slice of
// docs/catalog-growth.md phase 2, and the answer to an outage we lived through.
//
// ── What it is for ──────────────────────────────────────────────────────────
// Measured on prod 2026-08-27: RAWG latched on its quota 401 and IGDB answered
// 9 of 9 requests with network errors, so both games providers were
// circuit-open at once and `GET /api/discover` returned 20 movies + 20 shows
// and NO GAMES. The whole category vanished from the page with nothing saying
// why. We hold thousands of games; none of them were reachable, because the
// browse feed only ever asks a provider.
//
// This is the fallback: when a section comes back empty, serve stored catalog
// rows for that type and window instead. Slightly stale beats absent.
//
// ⚠️ It is NOT the phase-2 design, only its first brick. Serving anon Discover
// from the DB by default is a bigger change (ranking, pagination semantics,
// what a crawler sees), and it wants the shelf/pool split of phase 3 first.
//
// ── Why ordered by date and not by popularity ───────────────────────────────
// `media_items` holds id, type, title, release_date, poster_url, slug and
// nothing about how popular anything is — votes live inside `media_links`'
// projections, and reading those is the merge path this file exists to avoid
// (41 MB of JSON for the real library, measured). Discover IS a timeline, so
// date order inside the window is both the cheapest answer and an honest one.
// Ranking by taste still happens: these candidates go through the same
// decorate/score path as provider ones.

const PAGE_SIZE = 20;

interface Row {
  id: string;
  type: MediaType;
  title: string;
  release_date: string | null;
  poster_url: string | null;
  // Migration 27. NULL means "not computed yet", which is different from 0
  // ("computed, nobody has voted") and is why the ORDER BY below has to say
  // where NULLs go rather than leaving it to SQLite. → lib/itemStats.ts
  vote_count: number | null;
  vote_average: number | null;
}

/**
 * One page of stored titles of this type inside the direction's date window,
 * shaped as feed candidates so the rest of the pipeline cannot tell them apart.
 *
 * ⚠️ Pool membership (`browsed = 0 OR acted-on`) is deliberately NOT applied
 * here. The pool is a SCORING candidate set; this is "what do we have to show",
 * and a browsed row we already hold is a perfectly good thing to show during an
 * outage. It carries a real slug and a real uuid, so it links like any other.
 *
 * ⚠️ `raw` is null on purpose: these rows already exist, so there is nothing to
 * persist, and `persistDiscoverBatch` will resolve their uuids as a plain read.
 */
export function catalogSectionPage(
  type: MediaType,
  direction: Direction,
  page = 1,
  pageSize = PAGE_SIZE
): FeedCandidate[] {
  const { gte, lte } = dateWindow(direction);
  const offset = Math.max(0, (page - 1) * pageSize);
  // 2026-09-02 — ordered by CROWD SIZE first, then by date.
  //
  // It was date-only until migration 27, because the row held nothing else to
  // sort on. That made page 1 of a local section an arbitrary slice of the
  // window rather than its notable titles, which is not what the provider path
  // it stands in for does: TMDB is asked with `sort_by=popularity.desc` and RAWG
  // with `ordering=-added`. Paging by date meant "the next 40 by date", so a
  // visitor scrolling a local section met obscure titles first.
  //
  // ⚠️ `vote_count IS NULL` FIRST in the ORDER BY, not a bare `vote_count DESC`.
  // SQLite sorts NULL lowest, so on a fresh database (nothing computed yet) a
  // bare DESC would put every uncomputed row LAST and quietly page the window
  // backwards. This says explicitly: computed rows first, biggest crowd first,
  // uncomputed rows after them in date order.
  //
  // `title ASC` stays as the final tiebreak so the order is total and a page
  // boundary cannot duplicate or drop a row between requests.
  const rows = query<Row>(
    `SELECT id, type, title, release_date, poster_url, vote_count, vote_average
       FROM media_items
      WHERE type = ?
        AND release_date IS NOT NULL
        AND release_date >= ?
        AND release_date <= ?
      ORDER BY vote_count IS NULL, vote_count DESC,
               release_date ${direction === "past" ? "DESC" : "ASC"}, title ASC
      LIMIT ? OFFSET ?`,
    [type, gte, lte, pageSize, offset]
  );
  if (!rows.length) return [];

  // The provider ids, so annotateUserState can resolve library/wishlist state
  // the same way it does for a live candidate. One query for the whole page.
  const ids = rows.map((r) => r.id);
  const links = query<{ media_item_id: string; source: string; source_id: string }>(
    `SELECT media_item_id, source, source_id
       FROM media_links
      WHERE media_item_id IN (${ids.map(() => "?").join(",")})`,
    ids
  );
  const bySource = new Map<string, Record<string, number>>();
  for (const l of links) {
    const n = Number(l.source_id);
    if (!Number.isFinite(n)) continue; // letterboxd/imdb ids are not numeric
    const rec = bySource.get(l.media_item_id) ?? {};
    rec[l.source] = n;
    bySource.set(l.media_item_id, rec);
  }

  return rows.map((r): FeedCandidate => ({
    id: r.id,
    rawId: 0,
    source: "catalog",
    type: r.type,
    title: r.title,
    releaseDate: r.release_date,
    posterUrl: r.poster_url,
    ids: bySource.get(r.id) ?? {},
    raw: null,
    genreNames: [],
    originalLanguage: null,
    // Migration 27. These were hardcoded 0 / null, which `decorateSection`
    // turns into `communityVotes: 0` for every row — and the client's
    // Popularity sort is `votesOf(i) = i.communityVotes ?? 0`. Every catalog
    // card tied at zero, and a stable sort then shows ARRIVAL order under a
    // control labelled "Popularity". That is the 2026-08-29 search bug, which
    // is why these are real numbers now. → lib/itemStats.ts
    voteCount: r.vote_count ?? 0,
    voteAverage: r.vote_average,
    // Still null: the provider trending metric is a DIFFERENT quantity on four
    // incomparable scales, and this app's own definition of "popularity" is the
    // vote count above (discovery.ts's SortKey comparator). Nothing reads this
    // field on the catalog path.
    popularity: null,
  }));
}

/**
 * Provider result, or the catalog when the provider gave us nothing.
 *
 * ⚠️ Empty is the ONLY trigger. A short page is a real answer (the window
 * genuinely holds few releases) and must not be topped up from the DB, or the
 * feed silently becomes two sources with one order.
 */
export function withCatalogFallback(
  live: FeedCandidate[],
  type: MediaType,
  direction: Direction,
  page = 1
): { items: FeedCandidate[]; fellBack: boolean } {
  if (live.length > 0) return { items: live, fellBack: false };
  const stored = catalogSectionPage(type, direction, page);
  return { items: stored, fellBack: stored.length > 0 };
}

// ── Serving browse from the catalog BY DEFAULT (phase 2's second half) ───────
//
// The fallback above is the outage case. This is the goal: an anonymous browse
// answered from our own database, costing zero provider calls, which is what
// makes crawler traffic free and a provider outage boring.
//
// ⚠️ IT IS GATED ON BREADTH, and that gate is the whole design. Measured
// 2026-08-28, before the backfill: the future window held 59 games, 52 movies
// and 42 shows, and 128 of those 153 were rows the provider feed itself wrote
// while somebody scrolled past. Serving that as the default would have been a
// circular feed, thinner and one step staler than the TMDB list it replaced.
// So the switch is not a preference, it is a MEASUREMENT: serve from the
// catalog only once the catalog can actually answer, per type and per window.
//
// The threshold is per (type, direction) rather than global, because the lanes
// fill at different rates — games run through two providers, shows through one
// — and a global switch would flip a type that is still thin.
//
// ⚠️ `CATALOG_BROWSE_MIN` is the number of stored rows in that window before we
// stop asking the provider. It defaults to ten pages' worth: enough that a
// visitor can scroll a while without hitting the end, which is the failure the
// gate exists to prevent. Below it, nothing changes and the provider answers.
// Read at CALL time. Every safety gate in this codebase that was written as a
// module-load `const` had to be moved here first: the backfill's ceiling, the
// housekeeping threshold, and this one. A gate you cannot exercise without
// reloading the module is a gate nothing tests, and all three shipped with the
// test silently asserting the default instead of the behaviour.
export function catalogBrowseMin(): number {
  const raw = process.env.CATALOG_BROWSE_MIN;
  return raw === undefined || raw === "" ? 200 : Number(raw);
}

/** Unset = OFF. Serving the DB by default is switched on deliberately. */
export function catalogBrowseEnabled(): boolean {
  const v = (process.env.CATALOG_BROWSE ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/** How many stored rows this type has inside this window. */
export function catalogWindowCount(type: MediaType, direction: Direction): number {
  const { gte, lte } = dateWindow(direction);
  return get<{ n: number }>(
    `SELECT COUNT(*) n FROM media_items
      WHERE type = ? AND release_date IS NOT NULL AND release_date >= ? AND release_date <= ?`,
    [type, gte, lte]
  )?.n ?? 0;
}

/**
 * True when this (type, window) can be served from the catalog instead of a
 * provider. Reported rather than assumed, so `/api/health` can show why browse
 * is or is not local yet.
 */
export function catalogBrowseReady(type: MediaType, direction: Direction): boolean {
  return catalogBrowseEnabled() && catalogWindowCount(type, direction) >= catalogBrowseMin();
}

