import { get, query } from "@/lib/db";
import { mergeLinks } from "@/lib/merge";
import { MediaType, MediaLink } from "@/types";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import { upsertMediaItem, linkSourceToItem } from "@/lib/matcher";
import { ParsedItemId } from "@/lib/publicUrl";
import {
  PublicEnrichedItem, SourceIds, loadLinks, buildLiveLinks, ensureTmdbDetail,
  ensureGameDetail, enrichMissingSources, applyOmdbScores,
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

// ── Resolving the url's id segment ───────────────────────────────────────────

export interface ResolvedPublic {
  item: PublicEnrichedItem;
  /** The DB uuid, when the item has a row. null = live-only (not persisted). */
  canonicalId: string | null;
}

/** media_links lookup by any source — including igdb, which isn't a SourceIds key. */
function findBySourceId(source: string, sourceId: string): string | null {
  const row = get<{ media_item_id: string }>(
    "SELECT media_item_id FROM media_links WHERE source = ? AND source_id = ?",
    [source, sourceId]
  );
  return row?.media_item_id ?? null;
}

// Enrich a set of links into the public item (shared by both paths below).
async function enrichToPublic(
  id: string, type: MediaType, title: string, links: MediaLink[], region: string
): Promise<PublicEnrichedItem> {
  await ensureTmdbDetail(links, type);
  await ensureGameDetail(links, type);
  await enrichMissingSources(type, title, id, links, new Set(links.map((l) => l.source)));
  const enriched: PublicEnrichedItem = { id, type, ...mergeLinks(links, type, region) };
  await applyOmdbScores(enriched);
  return enriched;
}

// Persist a live item so it gains a uuid (and thus a canonical url). ONLY ever
// called for a LOGGED-IN viewer: this is a write triggered by a GET, so leaving
// it open to anonymous requests would let any visitor or bot walk a provider's
// id space and grow the DB without bound (~92KB/item). /discover is authed, so
// gating it costs nothing.
function persistLive(type: MediaType, links: MediaLink[]): string | null {
  if (links.length === 0) return null;
  const [primary, ...rest] = links;
  // A link with no title can't be stored: upsertMediaItem recomputes norm_title
  // from it, and a null would collapse the row to "Unknown" and mis-match it
  // against real items. Better to stay live-only than to poison the catalog.
  if (!primary.title) return null;
  const mediaItemId = upsertMediaItem({
    source: primary.source,
    sourceId: primary.sourceId,
    type,
    title: primary.title,
    releaseDate: primary.releaseDate,
    rawData: primary.rawData,
  });
  for (const l of rest) {
    if (!l.title) continue;
    linkSourceToItem(mediaItemId, {
      source: l.source, sourceId: l.sourceId, type,
      title: l.title, releaseDate: l.releaseDate, rawData: l.rawData,
    });
  }
  return mediaItemId;
}

/**
 * Resolve the url's id segment to a public item.
 *
 *  - uuid            → the stored item
 *  - {source}-{id}   → the stored item if that source id is linked, else built
 *                      LIVE from the providers (a /discover result with no row)
 *
 * `canonicalId` is the uuid when one exists; the page 308s to the uuid url so an
 * item has exactly one canonical address. `persist` (authed only) creates the
 * row for a live item so it gets one.
 */
export async function resolvePublicDetail(
  parsed: ParsedItemId,
  type: MediaType,
  region: string = DEFAULT_COUNTRY,
  opts: { persist?: boolean } = {}
): Promise<ResolvedPublic | null> {
  // Already in the DB (either addressed by uuid, or by a linked source id).
  const storedId = parsed.kind === "uuid" ? parsed.id : findBySourceId(parsed.source, parsed.sourceId);
  if (storedId) {
    const row = loadPublicItemRow(storedId);
    if (!row || row.type !== type) return null;
    const links = loadLinks(storedId);
    if (links.length === 0) return null;
    return { item: await enrichToPublic(storedId, row.type, row.title, links, region), canonicalId: storedId };
  }

  // A uuid that isn't in the DB is just a dead url — never a live lookup.
  if (parsed.kind === "uuid") return null;

  // Live: build from the one id we were given, then title-search the rest.
  const ids = { [parsed.source]: parsed.sourceId } as unknown as SourceIds;
  const links = await buildLiveLinks(parsed.sourceId, type, null, ids);
  if (links.length === 0) return null;

  // Only used to seed the title-search for the remaining providers.
  const title = links[0].title ?? "";
  if (opts.persist) {
    const newId = persistLive(type, links);
    if (newId) {
      // Re-read through the stored path so the persisted row is the source of
      // truth (and the caller redirects to its canonical uuid url).
      const stored = loadLinks(newId);
      return { item: await enrichToPublic(newId, type, title, stored, region), canonicalId: newId };
    }
  }
  return { item: await enrichToPublic(parsed.sourceId, type, title, links, region), canonicalId: null };
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
