import { query } from "@/lib/db";
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
  const rows = query<Row>(
    `SELECT id, type, title, release_date, poster_url
       FROM media_items
      WHERE type = ?
        AND release_date IS NOT NULL
        AND release_date >= ?
        AND release_date <= ?
      ORDER BY release_date ${direction === "past" ? "DESC" : "ASC"}, title ASC
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
    voteCount: 0,
    voteAverage: null,
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
