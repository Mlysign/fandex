import type { MediaType } from "@/types";
import { query } from "@/lib/db";
import { POOL_WHERE } from "@/lib/discovery";
import { sharedCache } from "@/lib/boundedCache";
import { providerGenreKeys } from "@/lib/sources/tagDiscover";
import { canonicalTagKey } from "@/lib/tagAlias";

// SEO (2026-08-20) — the data behind the homepage's server-rendered hub.
//
// `/` was a crawl DEAD END: priority 1.0 in the sitemap, an `sr-only` h1, and
// zero links to any catalog content, because the whole page was `"use client"`
// and fetched `/api/home` — an endpoint under the robots `/api/` disallow. So
// nothing flowed from the highest-authority URL on the domain into 2,022 item
// pages; they were reachable only by the sitemap, and facet pages one hop
// further out again.
//
// Three properties, and the first two are why this reads the LOCAL CATALOG
// rather than reusing Home's provider-fed rails:
//
//   · NO PROVIDER CALL. `/` is the most-hit page on the site. A per-request
//     fan-out here is exactly the shape that made a cold `/api/home` take 2.2
//     minutes during the RAWG outage. This is one SQLite read, cached.
//   · EVERY LINK RESOLVES. Pool rows have uuids by definition, so there is no
//     `linkable: false` case and no thin-write temptation — the hub cannot mint
//     a row even in principle, because it only ever SELECTs.
//   · NO SESSION READ, so the HTML is identical for every viewer and a crawler
//     sees exactly what a person does.

export interface HubItem {
  id: string;
  type: MediaType;
  title: string;
}

// How many catalog titles the hub links. Enough to be a real hub, few enough
// that `/` stays light — it is the page every visitor loads first.
const HUB_ITEM_COUNT = 30;

// A SAFETY BOUND on the genre chips, not a curation. It sits above the ~35 the
// maps currently yield, so today it never bites.
//
// ⚠️ It was 24, and that was a bug caught by a test rather than by reading it.
// The list is sorted by label before slicing, so a cap below the full set cut
// alphabetically — which silently removed puzzle, racing, rpg, shooter,
// simulation, sports and strategy, i.e. EVERY RAWG game genre, from a catalog
// that is a third games. If this ever needs to be a real limit, balance the
// selection across the three maps first; do not just lower the number.
const HUB_GENRE_MAX = 60;

// The catalog barely moves between syncs and this feeds the busiest page, so a
// long TTL is right. One entry — the query takes no parameters.
const _hubCache = sharedCache<string, HubItem[]>("homeHub", { max: 1, ttlMs: 30 * 60 * 1000 });

/**
 * The most recently refreshed catalog titles, newest first.
 *
 * "Recently synced" is doing two jobs: it is the closest honest signal for
 * "new here", and it ROTATES on its own as the catalog syncs, so the set of
 * items linked from `/` changes over time instead of pinning crawl attention
 * to the same 30 rows forever.
 */
export function hubItems(): HubItem[] {
  const hit = _hubCache.get("items");
  if (hit) return hit;

  const rows = query<{ id: string; type: string; title: string }>(
    `SELECT mi.id, mi.type, mi.title, MAX(ml.last_synced) AS last_synced
       FROM media_items mi
       JOIN media_links ml ON ml.media_item_id = mi.id
      WHERE ${POOL_WHERE} AND mi.title IS NOT NULL AND TRIM(mi.title) != ''
      GROUP BY mi.id
      ORDER BY last_synced DESC
      LIMIT ?`,
    [HUB_ITEM_COUNT]
  );

  const items = rows.map((r) => ({ id: r.id, type: r.type as MediaType, title: r.title }));
  _hubCache.set("items", items);
  return items;
}

/**
 * The genre facet pages worth linking from the root, as `{ key, label }`.
 *
 * Derived from the provider genre maps rather than hand-picked, so every entry
 * is guaranteed a real pool — see `providerGenreKeys`. Two filters on top:
 *
 *   · Keys containing "&" are dropped. They are TMDB's composite TV genres
 *     ("action & adventure", "sci fi & fantasy", "war & politics"), whose parts
 *     are already in the list as plain keys, and `keyToSlug` would percent-
 *     encode the ampersand into an ugly, duplicative URL.
 *   · Everything is mapped through `canonicalTagKey` and deduped, so a bundled
 *     spelling links to the bundle's own address instead of a 308 redirect.
 */
export function hubGenres(): { key: string; label: string }[] {
  const seen = new Set<string>();
  const out: { key: string; label: string }[] = [];

  for (const raw of providerGenreKeys()) {
    if (raw.includes("&")) continue;
    const key = canonicalTagKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: titleCase(key) });
  }

  out.sort((a, b) => a.label.localeCompare(b.label));
  return out.slice(0, HUB_GENRE_MAX);
}

// "science fiction" → "Science Fiction". The keys are normalized lowercase, and
// there is no stored display label for a genre that has no catalog row yet.
function titleCase(key: string): string {
  return key.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Test seam — the module-level cache would otherwise leak between cases. */
export function _resetHubCacheForTests(): void {
  _hubCache.clear();
}
