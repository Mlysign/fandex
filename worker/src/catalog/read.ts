// Catalog reads. The rule for every function here: the JSON a client receives
// was serialised when the row was WRITTEN, and a read splices those strings into
// the response without parsing them. A request has 10 ms of CPU; JSON.parse of a
// page of item docs would spend it, and string concatenation does not.

import { DEFAULT_COUNTRY, normalizeCountry } from "@/lib/countries";
import { mergeLinks, regionalReleaseDate } from "@/lib/merge";
import { pickRegionalReleaseDate } from "@/lib/sources/normalize";
import type { MediaLink, MediaType, Source } from "@/types";
import { kvGet, kvSet } from "../budget";
import { all, first, nowSeconds } from "../d1";
import { poolSize } from "../keptCounts";
import { DERIVE_VERSION } from "./derive";

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
  derive_version: number | null;
}

const ITEM_DOC_SELECT = `
  SELECT mi.id, mi.type, mi.slug, mi.browsed, mi.updated_at, d.vector, d.facets, d.merged, d.derive_version
    FROM media_items mi LEFT JOIN item_doc d ON d.media_item_id = mi.id`;

/**
 * The detail payload for one item, as a JSON string, or null.
 *
 * `region` only changes two things in the merge (the regional release date and
 * the streaming providers), so the stored doc IS the answer for the default
 * region and for any item with no TMDB link. Another region re-merges from the
 * item's stored blobs: one more query and a few hundred microseconds, on the
 * one read path where that is affordable because it is one item.
 *
 * A doc written under an older merge rule takes the same path whatever the
 * region, so a rule change is true on the next read and not in five months,
 * when the refresh next writes the row.
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
  if (region !== DEFAULT_COUNTRY || (row.derive_version ?? 0) < DERIVE_VERSION) {
    const regional = await mergedForRegion(db, row.id, row.type as MediaType, region);
    if (regional) merged = regional;
  }

  return (
    `{"id":${JSON.stringify(row.id)},"type":${JSON.stringify(row.type)},"slug":${JSON.stringify(row.slug)},` +
    `"inPool":${row.browsed === 0},"updatedAt":${row.updated_at},"deriveVersion":${DERIVE_VERSION},"region":${JSON.stringify(region)},` +
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

// ── Release dates for a country, for a handful of films ──────────────────────

/** Films per request. Each costs four rows read (measured), so a full request is about 800. */
export const RELEASE_DATES_MAX = 200;

const ITEM_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * ⚠️ The join ORDER is written out (CROSS JOIN, and the index by name) because
 * the planner's own choice took the API down on 2026-10-10. Written as plain
 * joins, SQLite started from `media_links` by its primary key (`source =
 * 'tmdb'`) and read every TMDB link in the catalog for each call, whatever the
 * number of ids: 110,000 rows a call, 3.9 million in 35 calls, which is the
 * free plan's whole day of reads. From the id list inward it is four rows a
 * film. A test holds both the plan and the row count.
 */
export const RELEASE_DATES_SQL = `
  SELECT mi.id, mi.release_date primary_date,
         (SELECT e.value ->> 'release_dates'
            FROM json_each(l.raw_data, '$.release_dates.results') e
           WHERE e.value ->> 'iso_3166_1' = ?2 LIMIT 1) dates
    FROM json_each(?1) j
   CROSS JOIN media_items mi ON mi.id = j.value
   CROSS JOIN media_links l INDEXED BY idx_links_item ON l.media_item_id = mi.id
   WHERE +mi.type = 'movie' AND l.source = 'tmdb' AND l.media_type = 'movie'`;

/** `{ids: [uuid, …]}` as a list of ids, or null if it is not that. */
export function parseItemIds(body: unknown): string[] | null {
  const ids = (body as { ids?: unknown } | null)?.ids;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > RELEASE_DATES_MAX) return null;
  const out = new Set<string>();
  for (const id of ids) {
    if (typeof id !== "string" || !ITEM_ID.test(id.toLowerCase())) return null;
    out.add(id.toLowerCase());
  }
  return [...out];
}

/**
 * The release date in one country for the films asked about, as a JSON string:
 * `{"region":"DE","dates":{"<item id>":"2026-10-01",…}}`. Only a film whose
 * date there DIFFERS from the catalog's one date is listed, so an id that is
 * missing means "the date you hold is right", and so does a show or a game.
 *
 * A device holds one date per title. This is what lets the calendar put your
 * own films on the day they open where you live, the day the popular feed
 * already uses.
 *
 * SQLite hands back only the asked country's entries out of each blob, a few
 * hundred bytes a film, and the pick is made here by the item page's own two
 * functions. Doing the pick in SQL would be a second copy of the rule, and the
 * two drifting apart is how a film ends up on two days.
 */
export async function regionalReleaseDatesJson(db: D1Database, ids: string[], regionRaw?: string | null): Promise<string> {
  const region = normalizeCountry(regionRaw) ?? DEFAULT_COUNTRY;
  const rows = await all<{ id: string; primary_date: string | null; dates: string | null }>(
    db, RELEASE_DATES_SQL, [JSON.stringify(ids), region],
  );
  const dates: Record<string, string> = {};
  for (const r of rows) {
    if (!r.dates) continue;
    let listed: { release_date?: string | null; type?: number }[] = [];
    try { listed = JSON.parse(r.dates); } catch { continue; }
    if (!Array.isArray(listed)) continue;
    const date = regionalReleaseDate(r.primary_date, pickRegionalReleaseDate(listed));
    if (date && date !== r.primary_date) dates[r.id] = date;
  }
  return `{"region":${JSON.stringify(region)},"dates":${JSON.stringify(dates)}}`;
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

  // Lets a client notice a deletion, which a delta cannot express: if its own
  // row count is higher than this once it is caught up, it resyncs from zero.
  // Only the LAST page carries it. For a device that is up to date the first
  // page is the last, so every sync there is asks, and the answer is a kept one
  // (keptCounts.ts): counting read every pool row's index entry each time.
  const poolCount = done && withCount ? await poolSize(db) : null;

  const items = rows.map((r) => `{"updatedAt":${r.updated_at},"vector":${r.vector},"facets":${r.facets}}`).join(",");
  return (
    `{"items":[${items}],"next":${JSON.stringify(next)},"done":${done},` +
    // deriveVersion: the rule every item read is answered under. A change of rule
    // moves no row's updated_at, so the website's build compares this instead.
    `"poolCount":${poolCount === null ? "null" : poolCount},"serverTime":${now},"deriveVersion":${DERIVE_VERSION}}`
  );
}

// ── Where every pool title can be played or watched ─────────────────────────

/** A day. Streaming line-ups move slowly, and a build reads every TMDB blob in the pool. */
const PLATFORMS_TTL_SECONDS = 86_400;

/**
 * Game platforms and streaming services for the whole pool, as names: what the
 * app's "Available on" filter and its platform picker are built from. One
 * answer for everybody in a country, so it is built once a day per country and
 * kept in `kv`; a request after that is two row reads and no JSON work.
 *
 * Streaming is the country's own line-up, else the US one, else the UK one.
 * ⚠️ The item page falls back one step further, to whichever country TMDB lists
 * first. That step is left out on purpose: reaching it needs `json_each` over
 * every country of every title, which D1 counts as 179,000 rows read per build
 * (measured 2026-10-10) against 5,000 for this. A film nobody in Germany, the
 * US or the UK can stream is not "available on" a German account's services.
 *
 * `mayBuild` is asked before a country's line-up is computed, never before it
 * is read back: a stranger cycling through countries is the only way this costs
 * anything.
 */
export async function catalogPlatformsJson(
  db: D1Database,
  regionRaw: string | null | undefined,
  mayBuild: () => Promise<boolean> = async () => true,
): Promise<string | null> {
  const region = normalizeCountry(regionRaw) ?? DEFAULT_COUNTRY;
  let games = await kvGet(db, "platforms:games");
  let streaming = await kvGet(db, `platforms:streaming:${region}`);
  if (games === null || streaming === null) {
    if (!(await mayBuild())) return null;
    if (games === null) {
      games = (await first<{ j: string | null }>(
        db,
        `SELECT json_group_object(d.media_item_id, json(json_extract(d.merged, '$.platforms'))) j
           FROM item_doc d JOIN media_items m ON m.id = d.media_item_id
          WHERE m.browsed = 0 AND m.type = 'game' AND json_array_length(d.merged, '$.platforms') > 0`,
      ))?.j ?? "{}";
      await kvSet(db, "platforms:games", games, PLATFORMS_TTL_SECONDS);
    }
    if (streaming === null) {
      // The region is one of the thirty-one codes normalizeCountry lets through,
      // so it is safe inside a JSON path. A path cannot be a bound parameter's
      // value AND keep the query plan simple, so it is spelled in.
      const at = (code: string) => `json_extract(l.raw_data, '$."watch/providers".results.${code}')`;
      streaming = (await first<{ j: string | null }>(
        db,
        `SELECT json_group_object(id, json(names)) j FROM (
           SELECT t.id, json_group_array(json_extract(o.value, '$.provider_name')) names
             FROM (SELECT l.media_item_id id, COALESCE(${at(region)}, ${at("US")}, ${at("GB")}) blob
                     FROM media_links l JOIN media_items m ON m.id = l.media_item_id
                    WHERE l.source = 'tmdb' AND m.browsed = 0 AND json_valid(l.raw_data)) t,
                  json_each(t.blob, '$.' || json_extract(t.blob, '$.offerType')) o
            WHERE json_extract(t.blob, '$.offerType') IS NOT NULL
              AND json_extract(o.value, '$.provider_name') IS NOT NULL
            GROUP BY t.id)`,
      ))?.j ?? "{}";
      await kvSet(db, `platforms:streaming:${region}`, streaming, PLATFORMS_TTL_SECONDS);
    }
  }
  return `{"region":${JSON.stringify(region)},"games":${games},"streaming":${streaming}}`;
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
