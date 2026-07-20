// H2b — discover persists at enrich time.
//
// Every item /api/discover returns gets a `media_items` row here, BEFORE it is
// serialized to the client, so it has a uuid by the time anyone can click it.
// That uuid is the item's only address: it's what lets `/{type}/{id}/{slug}` be
// uuid-only and what deleted P13's source-id url machinery (`parseItemId`, the
// live-resolution branch, create-on-view). See TASKS.md H2b.
//
// ── Why this is safe to do for anonymous callers ─────────────────────────────
// It's a write driven by a GET, which is the thing create-on-view got wrong: an
// inbound url named an arbitrary provider id and we stored whatever came back,
// so a crawler could walk TMDB's id space and grow the DB without bound. Here
// the write is driven by a payload a provider ALREADY returned to one of our own
// outbound queries. A caller can influence *which* real titles get stored (by
// searching for them); it cannot make us store something that isn't a real title
// on a real provider list, and it cannot pick the ids. The row cap is therefore
// the providers' catalogs, not the caller's imagination. Rate limiting the
// endpoint bounds the rate; H2a bounds the size (~1KB/thin row).
//
// ── What gets written ────────────────────────────────────────────────────────
// ONE link per item, from the provider LIST payload we already hold — no network
// call. It is written `thin` (see matcher's SourceItem.thin), which means:
//   · stamped projection_version = 0, so the first detail read refetches the
//     real payload and heals the row (enrich.ts storeRefreshed);
//   · insert-only, so it can never degrade a link that already holds a full blob.
// The item's other source ids are NOT fetched — enrichMissingSources fills them
// in at detail time, which is the same path a library item takes.

import { upsertMediaItem } from "@/lib/matcher";
import { log, errorFields } from "@/lib/logger";
import { transaction, query } from "@/lib/db";
import { RawPayload } from "@/lib/discoverFeed";
import { MediaType } from "@/types";

export interface PersistableItem {
  id: string;
  type: MediaType | string;
  title: string;
  releaseDate: string | null;
  raw?: RawPayload | null;
}

// Read-only fast-path: resolve the uuids of items whose (source, source_id)
// link ALREADY exists. For those, upsertMediaItem's thin path would return the
// existing id without writing anything (matcher.ts, the `item.thin` early
// return) — so persisting them buys nothing but a write-lock acquisition. Under
// crawler traffic (2026-07-20) nearly every facet/discover slice is
// already-known items, so this turns the hot path into a plain SELECT and
// leaves the write transaction for genuine first-sightings only.
function lookupExistingUuids(items: PersistableItem[]): Map<string, string> {
  const out = new Map<string, string>();
  const bySource = new Map<string, PersistableItem[]>();
  for (const it of items) {
    if (!it.raw || !it.title) continue;
    const group = bySource.get(it.raw.source) ?? [];
    group.push(it);
    bySource.set(it.raw.source, group);
  }
  for (const [source, group] of bySource) {
    const rows = query<{ source_id: string; media_item_id: string }>(
      `SELECT source_id, media_item_id FROM media_links
        WHERE source = ? AND source_id IN (${group.map(() => "?").join(",")})`,
      [source, ...group.map((it) => String(it.raw!.sourceId))]
    );
    const byId = new Map(rows.map((r) => [r.source_id, r.media_item_id]));
    for (const it of group) {
      const uuid = byId.get(String(it.raw!.sourceId));
      if (uuid) out.set(it.id, uuid);
    }
  }
  return out;
}

// Upsert a row per item and return the discover id → uuid map. Items we can't
// honestly store (no payload, or no title) are simply absent from the map; the
// caller leaves those live-only rather than inventing a row.
export function persistDiscoverItems(items: PersistableItem[]): Map<string, string> {
  let out = new Map<string, string>();
  if (items.length === 0) return out;

  try {
    out = lookupExistingUuids(items);
  } catch (e) {
    log.error("discover_persist_lookup_failed", { count: items.length, ...errorFields(e) });
  }
  const misses = items.filter((it) => !out.has(it.id));
  if (misses.length === 0) return out;

  try {
    // One transaction for the whole batch: a browse response is ~54 items and
    // upsertMediaItem opens its own transaction per call, which nests fine but
    // would otherwise mean ~54 separate commits (fsyncs) on the request path.
    transaction(() => {
      for (const it of misses) {
        const raw = it.raw;
        // A link with no title can't be stored: remergeItem recomputes the
        // canonical title from the merged payloads and falls back to "Unknown",
        // which would both mislabel the row and mis-match it against real items
        // via norm_title. Better live-only than a poisoned catalog.
        if (!raw || !it.title) continue;
        try {
          const mediaItemId = upsertMediaItem({
            source: raw.source,
            sourceId: raw.sourceId,
            type: it.type as MediaType,
            title: it.title,
            releaseDate: it.releaseDate,
            rawData: raw.data,
            thin: true,
          });
          out.set(it.id, mediaItemId);
        } catch (e) {
          // One bad item must never fail the feed — discover still renders it
          // live, it just won't have a uuid this time round.
          log.error("discover_persist_item_failed", { source: raw.source, sourceId: raw.sourceId, ...errorFields(e) });
        }
      }
    });
  } catch (e) {
    log.error("discover_persist_failed", { count: misses.length, ...errorFields(e) });
  }

  return out;
}
