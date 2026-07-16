import { get, query } from "@/lib/db";
import { mergeLinks } from "@/lib/merge";
import { MediaType } from "@/types";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import {
  PublicEnrichedItem, loadLinks, ensureTmdbDetail, ensureGameDetail,
  enrichMissingSources, applyOmdbScores,
} from "./enrich";

// P13 — the PUBLIC read path for an item, behind `/{type}/{uuid}/{slug}`.
//
// This runs the SAME enrichment pipeline as /api/detail (lib/detail/enrich.ts):
// refresh stale stored blobs, live-search the metadata providers that aren't
// linked yet, merge, then attach OMDB scores. An earlier version read stored
// data only — it rendered a fraction of the page (no cast, trailers,
// where-to-watch, RT/IMDb) even though every one of those is public data. The
// public page and the authed page now differ ONLY in the per-user overlay.
//
// THE BOUNDARY: this returns PublicEnrichedItem, which omits rating / ratings /
// review / reviewedAt / libraryStatus / platformSources. Nothing here reads
// user_library / user_watchlist / user_item_state, and the type makes a leak a
// compile error rather than a thing we must remember not to do. The per-user
// overlay belongs in /api/detail; it must never move down into here.
//
// Region: anonymous visitors have no users.country, so the merge runs at
// DEFAULT_COUNTRY. Region-aware dates/streaming (T22) stay a logged-in feature.

export interface PublicItemRow {
  id: string;
  type: MediaType;
  title: string;
}

// The item's stored row, or null. The caller checks `type` against the URL's
// type segment so /movie/<a-game-uuid>/x 404s instead of rendering.
export function loadPublicItemRow(id: string): PublicItemRow | null {
  const row = get<{ id: string; type: string; title: string }>(
    "SELECT id, type, title FROM media_items WHERE id = ?",
    [id]
  );
  return row ? { id: row.id, type: row.type as MediaType, title: row.title } : null;
}

// Full public detail for a stored item. Returns null when the item doesn't
// exist or has no links to merge (nothing to show → the page 404s).
export async function loadPublicDetail(
  id: string,
  region: string = DEFAULT_COUNTRY
): Promise<PublicEnrichedItem | null> {
  const row = loadPublicItemRow(id);
  if (!row) return null;

  const links = loadLinks(id);
  if (links.length === 0) return null;

  // Same steps as /api/detail: refresh stale blobs, then fill in the providers
  // this item isn't linked to yet (IGDB/Metacritic/Steam…).
  await ensureTmdbDetail(links, row.type);
  await ensureGameDetail(links, row.type);
  const hasSources = new Set(links.map((l) => l.source));
  await enrichMissingSources(row.type, row.title, id, links, hasSources);

  const enriched: PublicEnrichedItem = {
    id: row.id,
    type: row.type,
    ...mergeLinks(links, row.type, region),
  };
  await applyOmdbScores(enriched);

  return enriched;
}

// Every item eligible for a public page — drives sitemap.xml.
export function listPublicItems(): { id: string; type: MediaType; title: string; updatedAt: number | null }[] {
  return query<any>(
    `SELECT mi.id, mi.type, mi.title, MAX(ml.last_synced) AS updated_at
       FROM media_items mi
       JOIN media_links ml ON ml.media_item_id = mi.id
      GROUP BY mi.id
      ORDER BY mi.id`
  ).map((r: any) => ({ id: r.id, type: r.type as MediaType, title: r.title, updatedAt: r.updated_at ?? null }));
}
