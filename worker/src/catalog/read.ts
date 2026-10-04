// Catalog reads. The rule for every function here: the JSON a client receives
// was serialised when the row was WRITTEN, and a read splices those strings into
// the response without parsing them. A request has 10 ms of CPU; JSON.parse of a
// page of item docs would spend it, and string concatenation does not.

import { DEFAULT_COUNTRY, normalizeCountry } from "@/lib/countries";
import { mergeLinks } from "@/lib/merge";
import type { MediaLink, MediaType, Source } from "@/types";
import { all, first, nowSeconds } from "../d1";

// ── One item ─────────────────────────────────────────────────────────────────

interface ItemDocRow {
  id: string;
  type: string;
  slug: string | null;
  browsed: number;
  updated_at: number;
  vector: string | null;
  facets: string | null;
  merged: string | null;
}

const ITEM_DOC_SELECT = `
  SELECT mi.id, mi.type, mi.slug, mi.browsed, mi.updated_at, d.vector, d.facets, d.merged
    FROM media_items mi LEFT JOIN item_doc d ON d.media_item_id = mi.id`;

/**
 * The detail payload for one item, as a JSON string, or null.
 *
 * `region` only changes two things in the merge (the regional release date and
 * the streaming providers), so the stored doc IS the answer for the default
 * region and for any item with no TMDB link. Another region re-merges from the
 * item's stored blobs: one more query and a few hundred microseconds, on the
 * one read path where that is affordable because it is one item.
 */
export async function itemDetailJson(
  db: D1Database,
  where: { id: string } | { type: string; slug: string },
  regionRaw?: string | null,
): Promise<string | null> {
  const row = "id" in where
    ? await first<ItemDocRow>(db, `${ITEM_DOC_SELECT} WHERE mi.id = ?`, [where.id])
    : await first<ItemDocRow>(db, `${ITEM_DOC_SELECT} WHERE mi.type = ? AND mi.slug = ?`, [where.type, where.slug]);
  if (!row || !row.vector || !row.merged || !row.facets) return null;

  const region = normalizeCountry(regionRaw) ?? DEFAULT_COUNTRY;
  let merged = row.merged;
  if (region !== DEFAULT_COUNTRY) {
    const regional = await mergedForRegion(db, row.id, row.type as MediaType, region);
    if (regional) merged = regional;
  }

  return (
    `{"id":${JSON.stringify(row.id)},"type":${JSON.stringify(row.type)},"slug":${JSON.stringify(row.slug)},` +
    `"inPool":${row.browsed === 0},"updatedAt":${row.updated_at},"region":${JSON.stringify(region)},` +
    `"vector":${row.vector},"facets":${row.facets},"merged":${merged}}`
  );
}

async function mergedForRegion(db: D1Database, id: string, type: MediaType, region: string): Promise<string | null> {
  const rows = await all<{ source: string; source_id: string; release_date: string | null; last_synced: number; raw_data: string }>(
    db,
    "SELECT source, source_id, release_date, last_synced, raw_data FROM media_links WHERE media_item_id = ?",
    [id],
  );
  // Only TMDB carries per-region data. Without it the default doc is already right.
  if (!rows.some((r) => r.source === "tmdb")) return null;
  const links: MediaLink[] = rows.map((r) => {
    let data: any = {};
    try { data = JSON.parse(r.raw_data); } catch { /* derives as empty */ }
    return {
      id: "", mediaItemId: id, source: r.source as Source, sourceId: r.source_id,
      title: null, releaseDate: r.release_date, rawData: data, lastSynced: r.last_synced,
    };
  });
  const full = mergeLinks(links, type, region);
  return JSON.stringify({ ...full, sources: full.sources.map((s) => ({ source: s.source, sourceId: s.sourceId })) });
}

// ── The pool, as a delta ─────────────────────────────────────────────────────

export interface DeltaCursor {
  since: number;
  after: string;
}

/**
 * Rows per page, sized from a measurement and not from taste. On the live
 * Worker (2026-10-04, free plan, 10 ms CPU limit): 50 to 150 rows cost 3 ms,
 * 200 rows 5 to 8 ms, 300 rows 9 ms. A row is ~2.5 KB of vector + facets, so
 * the default page is ~370 KB and the whole pool is about thirty requests.
 */
export const DELTA_PAGE_DEFAULT = 150;
export const DELTA_PAGE_MAX = 200;
/**
 * How far behind "now" a cursor must be before it is trusted to be final.
 * `updated_at` has one-second resolution, so a row written in the same second a
 * page was read can be missed by a strictly-after cursor. A page that reaches
 * the present hands back a cursor a few seconds in the past instead, and the
 * next sync re-reads those seconds. Receiving a row twice is harmless.
 */
const CURSOR_SETTLE_SECONDS = 3;

export function parseCursor(sinceRaw: string | null, afterRaw: string | null): DeltaCursor {
  const since = Number(sinceRaw ?? 0);
  return {
    since: Number.isFinite(since) && since > 0 ? Math.floor(since) : 0,
    after: typeof afterRaw === "string" ? afterRaw.slice(0, 64) : "",
  };
}

/**
 * One page of pool items changed since the cursor, oldest change first, as a
 * JSON string.
 *
 * The pool is `browsed = 0`: the titles somebody acted on. Every device scores
 * against the same pool, which is what keeps a Fandex Score the same number on
 * a phone and in a browser.
 */
export async function catalogDeltaJson(
  db: D1Database,
  cursor: DeltaCursor,
  limitRaw?: number,
  withCount = false,
): Promise<string> {
  const limit = Math.max(1, Math.min(DELTA_PAGE_MAX, Math.floor(limitRaw || DELTA_PAGE_DEFAULT)));
  // A ROW-VALUE comparison, not `a > ? OR (a = ? AND b > ?)`. Both say the same
  // thing, but only this form is a range the partial index can seek to. The OR
  // form walks the index from its start and discards everything before the
  // cursor, and D1 bills each discarded row as a row read: a caught-up client
  // would pay for the whole pool on every sync.
  const rows = await all<{ id: string; updated_at: number; vector: string; facets: string }>(
    db,
    `SELECT mi.id, mi.updated_at, d.vector, d.facets
       FROM media_items mi JOIN item_doc d ON d.media_item_id = mi.id
      WHERE mi.browsed = 0 AND (mi.updated_at, mi.id) > (?1, ?2)
      ORDER BY mi.updated_at, mi.id
      LIMIT ?3`,
    [cursor.since, cursor.after, limit],
  );

  const now = nowSeconds();
  const done = rows.length < limit;
  let next: DeltaCursor = cursor;
  if (rows.length) {
    const last = rows[rows.length - 1];
    next = { since: last.updated_at, after: last.id };
  }
  // The final page: settle the cursor, never past where the caller already was.
  if (done && next.since > now - CURSOR_SETTLE_SECONDS) {
    next = { since: Math.max(cursor.since, now - CURSOR_SETTLE_SECONDS), after: "" };
  }

  let poolCount: number | null = null;
  if (done && withCount) {
    // Lets a client notice a deletion, which a delta cannot express: if its own
    // row count is higher than this once it is caught up, it resyncs from zero.
    // Opt-in, because the count reads every pool row's index entry.
    poolCount = (await first<{ n: number }>(db, "SELECT COUNT(*) n FROM media_items WHERE browsed = 0"))?.n ?? null;
  }

  const items = rows.map((r) => `{"updatedAt":${r.updated_at},"vector":${r.vector},"facets":${r.facets}}`).join(",");
  return (
    `{"items":[${items}],"next":${JSON.stringify(next)},"done":${done},` +
    `"poolCount":${poolCount === null ? "null" : poolCount},"serverTime":${now}}`
  );
}

// ── Taxonomy ─────────────────────────────────────────────────────────────────

/**
 * Everything the device needs to turn raw facets into scored ones: the tag
 * categories and overrides, both alias tables, the per-item franchise overrides,
 * the chosen display names and the scoring config. Aggregated in SQL so the
 * Worker handles six strings, not three thousand rows.
 */
export async function taxonomyJson(db: D1Database): Promise<{ body: string; etag: string }> {
  const agg = (sql: string) => db.prepare(sql);
  const [cats, overrides, tagAliases, ipAliases, ipOverrides, labels, config] = await db.batch<{ j: string | null }>([
    agg(`SELECT json_group_array(json_object('id', id, 'label', label, 'color', color, 'weight', weight,
                'ignored', ignored, 'sortOrder', sort_order)) j
           FROM (SELECT * FROM tag_category ORDER BY sort_order, id)`),
    agg(`SELECT json_group_array(json_array(tag_key, category_id)) j FROM (SELECT * FROM tag_category_override ORDER BY tag_key)`),
    agg(`SELECT json_group_array(json_array(alias_key, canonical_key)) j FROM (SELECT * FROM tag_alias ORDER BY alias_key)`),
    agg(`SELECT json_group_array(json_array(alias_key, canonical_key)) j FROM (SELECT * FROM ip_alias ORDER BY alias_key)`),
    agg(`SELECT json_group_array(json_object('mediaItemId', media_item_id, 'ipKey', ip_key, 'label', label,
                'mode', mode, 'source', source)) j
           FROM (SELECT * FROM item_ip_override ORDER BY media_item_id, ip_key)`),
    agg(`SELECT json_group_array(json_array(kind, key, label)) j FROM (SELECT * FROM facet_label_override ORDER BY kind, key)`),
    agg(`SELECT json_object('config', json(config), 'version', version) j FROM scoring_config WHERE id = 1`),
  ]);
  const pick = (r: D1Result<{ j: string | null }>, fallback: string) => r.results?.[0]?.j ?? fallback;

  const body =
    `{"tagCategories":${pick(cats, "[]")},"tagCategoryOverrides":${pick(overrides, "[]")},` +
    `"tagAliases":${pick(tagAliases, "[]")},"ipAliases":${pick(ipAliases, "[]")},` +
    `"itemIpOverrides":${pick(ipOverrides, "[]")},"facetLabels":${pick(labels, "[]")},` +
    `"scoring":${pick(config, "null")}}`;
  return { body, etag: await weakEtag(body) };
}

export async function weakEtag(body: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  const hex = [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `W/"${hex}"`;
}

// ── Episodes ─────────────────────────────────────────────────────────────────

/** The stored seasons and episodes of a show, as a JSON string. Null for an unknown item. */
export async function showEpisodesJson(db: D1Database, mediaItemId: string): Promise<string | null> {
  const [item, seasons, episodes] = await db.batch<{ j: string | null }>([
    db.prepare("SELECT json_object('id', id, 'type', type) j FROM media_items WHERE id = ?").bind(mediaItemId),
    db.prepare(
      `SELECT json_group_array(json_object('season', season_number, 'name', name, 'episodeCount', episode_count,
              'airDate', air_date, 'posterUrl', poster_url)) j
         FROM (SELECT * FROM show_seasons WHERE media_item_id = ? ORDER BY season_number)`,
    ).bind(mediaItemId),
    db.prepare(
      `SELECT json_group_array(json_object('season', season_number, 'episode', episode_number, 'title', title,
              'airDate', air_date, 'runtimeMinutes', runtime_minutes, 'stillUrl', still_url)) j
         FROM (SELECT * FROM show_episodes WHERE media_item_id = ? ORDER BY season_number, episode_number)`,
    ).bind(mediaItemId),
  ]);
  if (!item.results?.[0]?.j) return null;
  return `{"item":${item.results[0].j},"seasons":${seasons.results?.[0]?.j ?? "[]"},"episodes":${episodes.results?.[0]?.j ?? "[]"}}`;
}
