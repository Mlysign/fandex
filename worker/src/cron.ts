// The scheduled half of the Worker. One trigger, every ten minutes, doing a
// small bounded slice each time.
//
// "A daily job" is not a shape that exists here: a cron run gets the same 10 ms
// of CPU and the same 50 queries a request does. So each job is a state machine
// with its cursor in the kv table, and a run does a few steps and stops. 144
// runs a day at a couple of steps each is where the throughput comes from.
//
// Four jobs. The calendar's is in calendar.ts; the other three are here:
//
//   1. THE NIGHTLY EXPORT. D1 is the only copy of the user tables and of the
//      hand-made taxonomy, so once per UTC day every table that cannot be
//      rebuilt from a provider is written to R2 as JSON. Time Travel covers
//      seven days; this covers "the database is gone".
//   2. THE TMDB REFRESH. TMDB's terms cap how long a stored copy may go
//      unrefreshed at six months, so the oldest TMDB links are refetched well
//      inside that. IGDB is deliberately NOT refreshed on a timer: its licence
//      question is open and picking a number would be answering it.
//   3. TITLES THAT ARE NOT OUT YET. Their dates move, so the pool's upcoming
//      TMDB titles are refetched daily when near and weekly when far, with
//      whatever the refresh above leaves of a run.

import { getIgdbCollections, igdbConfigured } from "@/lib/sources/igdb";
import { bookDate, getOpenLibraryWork } from "@/lib/sources/openlibrary";
import { getTmdbMovie, getTmdbShow } from "@/lib/sources/tmdb";
import { kvGet, kvSet } from "./budget";
import { runCalendarStep } from "./calendar";
import { all, nowSeconds, utcDay } from "./d1";
import type { Env } from "./env";
import { upsertMediaItem } from "./catalog/ingest";
import { useSharedIgdbToken } from "./catalog/resolve";

// ── 1. The export ───────────────────────────────────────────────────────────

/**
 * Tables NOT exported, because a provider or a cron can rebuild them, or
 * because they are not data. Everything else is exported, so a table added
 * later is backed up by default rather than by somebody remembering.
 *
 * ⚠️ `kv` holds the Twitch app token. It must never be written to a bucket.
 */
const EXPORT_SKIP_TABLES = new Set([
  "item_doc", "franchise_members", "calendar_month", "show_seasons", "show_episodes",
  "kv", "daily_budget", "d1_migrations",
]);
/**
 * Columns left out of an exported table: the provider blobs, which are
 * refetchable and 90% of the bytes, and a user's kept state counts. The export
 * pages across runs ten minutes apart, so a kept count could be written out
 * before the rows it counts and restored as a count of something else. Left
 * out, it restores as NULL, which means "count again".
 */
const EXPORT_SKIP_COLUMNS: Record<string, Set<string>> = {
  media_links: new Set(["raw_data"]),
  users: new Set(["counted_items", "counted_episodes", "counted_hidden"]),
};

const EXPORT_CURSOR_KEY = "export_cursor";
const EXPORT_CHUNK_ROWS = 1000;
/** Chunks per run. Each is one query and one R2 write. */
const EXPORT_CHUNKS_PER_RUN = 6;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface ExportCursor {
  day: string;
  tables: string[];
  table: number;
  /** Rows of this table written so far. It names the next part, and the restore walks the parts by it. */
  offset: number;
  /** The last key written, so the next chunk starts after it. Null at a table's start. */
  after?: KeyValue[] | null;
  done: boolean;
  rows: number;
}

type KeyValue = string | number;

/**
 * The columns a table is paged by: its primary key for a WITHOUT ROWID table
 * (NOT NULL by construction there), its rowid otherwise.
 *
 * A chunk starts AFTER the last key written, never at an OFFSET. An offset is
 * read past, not jumped to, so chunk k of a table cost k chunks of rows and the
 * whole table cost the square of its size: 109,000 rows read on 2026-10-15 to
 * export 12,000 episode rows, and D1 Free stops every query past 5 million a day.
 */
async function exportKey(db: D1Database, table: string, info: { name: string; pk: number }[]): Promise<string[]> {
  const row = await db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").bind(table).first<{ sql: string }>();
  if (!/WITHOUT\s+ROWID/i.test(row?.sql ?? "")) return ["rowid"];
  return info.filter((c) => c.pk > 0).sort((a, b) => a.pk - b.pk).map((c) => c.name);
}

export async function exportTables(db: D1Database): Promise<string[]> {
  const rows = await all<{ name: string }>(
    db,
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
      ORDER BY name`,
  );
  return rows.map((r) => r.name).filter((n) => IDENTIFIER.test(n) && !EXPORT_SKIP_TABLES.has(n));
}

/** One step of the export. Returns what it did, for the log and the tests. */
export async function runExportStep(env: Env, now = Date.now()): Promise<{ wrote: number; done: boolean; day: string; rowsRead: number }> {
  const day = utcDay(now);
  const raw = await kvGet(env.DB, EXPORT_CURSOR_KEY);
  let cursor: ExportCursor | null = null;
  try { cursor = raw ? (JSON.parse(raw) as ExportCursor) : null; } catch { cursor = null; }

  if (!cursor || cursor.day !== day) {
    cursor = { day, tables: await exportTables(env.DB), table: 0, offset: 0, done: false, rows: 0 };
  }
  if (cursor.done) return { wrote: 0, done: true, day, rowsRead: 0 };
  // A cursor saved by the offset version, part-way into a table: start that
  // table again. Its parts are overwritten under the same names.
  if (cursor.offset > 0 && !cursor.after) cursor.offset = 0;

  let wrote = 0;
  let rowsRead = 0;
  const next = (c: ExportCursor) => { c.table++; c.offset = 0; c.after = null; };
  for (let i = 0; i < EXPORT_CHUNKS_PER_RUN && cursor.table < cursor.tables.length; i++) {
    const table = cursor.tables[cursor.table];
    const info = await all<{ name: string; pk: number }>(env.DB, `PRAGMA table_info("${table}")`);
    const cols = info
      .map((c) => c.name)
      .filter((c) => IDENTIFIER.test(c) && !EXPORT_SKIP_COLUMNS[table]?.has(c));
    const key = cols.length ? await exportKey(env.DB, table, info) : [];
    if (!cols.length || !key.length || !key.every((k) => IDENTIFIER.test(k))) { next(cursor); continue; }

    const fields = cols.map((c) => `'${c}', "${c}"`).join(", ");
    const keyCols = key.map((k) => `"${k}"`).join(", ");
    const keyOut = key.map((k, j) => `"${k}" AS _rr_k${j}`).join(", ");
    const after = cursor.after?.length === key.length ? cursor.after : null;
    const where = after
      ? key.length === 1 ? `WHERE ${keyCols} > ?2` : `WHERE (${keyCols}) > (${key.map((_, j) => `?${j + 2}`).join(", ")})`
      : "";
    // `k` is the chunk's last key: the subquery hands rows over in key order
    // and the aggregate keeps them in that order. Measured on D1 (2026-10-15),
    // a chunk of 1,000 reads 1,001 rows this way. Numbering the rows with a
    // window read 3,002, and an ORDER BY inside the aggregate 2,001: D1 counts
    // every row that passes through a temporary table.
    const sql =
      `SELECT json_group_array(json_object(${fields})) j, COUNT(*) n,
              json_group_array(json_array(${key.map((_, j) => `_rr_k${j}`).join(", ")})) ->> '$[#-1]' k
         FROM (SELECT *, ${keyOut} FROM "${table}" ${where} ORDER BY ${keyCols} LIMIT ?1)`;
    // A chunk is ONE aggregated string and D1 caps a value at 2 MB. A table of
    // short rows fits a thousand; one holding long reviews may not, and a chunk
    // that cannot be read would stall the export on the same key forever. So
    // a failed read is retried smaller rather than skipped.
    let chunk: Record<string, unknown> | null = null;
    let size = EXPORT_CHUNK_ROWS;
    for (;;) {
      try {
        const res = await env.DB.prepare(sql).bind(size, ...(after ?? [])).all<Record<string, unknown>>();
        rowsRead += res.meta.rows_read ?? 0;
        chunk = res.results[0] ?? null;
        break;
      } catch (e) {
        if (size <= 1) throw e;
        size = Math.max(1, Math.floor(size / 10));
      }
    }
    const n = Number(chunk?.n ?? 0);

    if (n > 0 || cursor.offset === 0) {
      const part = String(cursor.offset).padStart(8, "0");
      await env.BACKUPS.put(`d1/${day}/${table}-${part}.json`, typeof chunk?.j === "string" ? chunk.j : "[]", {
        httpMetadata: { contentType: "application/json" },
      });
      wrote++;
      cursor.rows += n;
    }
    if (n < size) next(cursor);
    else {
      cursor.offset += n;
      cursor.after = JSON.parse(String(chunk!.k)) as KeyValue[];
    }
  }

  if (cursor.table >= cursor.tables.length) {
    cursor.done = true;
    // The manifest is written LAST, so its presence means the day is complete.
    // A restore that finds no manifest knows it is looking at half an export.
    await env.BACKUPS.put(
      `d1/${day}/manifest.json`,
      JSON.stringify({ day, completedAt: new Date(now).toISOString(), tables: cursor.tables, rows: cursor.rows }),
      { httpMetadata: { contentType: "application/json" } },
    );
    wrote++;
  }
  await kvSet(env.DB, EXPORT_CURSOR_KEY, JSON.stringify(cursor));
  return { wrote, done: cursor.done, day, rowsRead };
}

// ── 2. The TMDB refresh ─────────────────────────────────────────────────────

/** Refetch a TMDB link once it is this old. Six months is the cap; this leaves a month of slack. */
export const TMDB_REFRESH_AFTER_DAYS = 150;
/** Links per run. One provider call and one parse-merge-derive each, which is most of a run's CPU. */
const REFRESH_PER_RUN = 2;

/** A link whose refresh failed becomes due again after this long. */
const REFRESH_RETRY_SECONDS = 7 * 86_400;
const REFRESH_IDLE_KEY = "tmdb_refresh_idle";
/** How long to stop looking after a scan finds nothing due. */
const REFRESH_IDLE_SECONDS = 6 * 3600;

interface DueLink { source_id: string; media_type: string }

/** Fetch one TMDB title again and store it. Throws when TMDB has nothing usable, with the stored row untouched. */
async function refetchTmdbLink(env: Env, link: DueLink): Promise<void> {
  const d = link.media_type === "movie"
    ? await getTmdbMovie(Number(link.source_id))
    : await getTmdbShow(Number(link.source_id));
  const title = link.media_type === "movie" ? d?.title : d?.name;
  if (!d?.id || !title) throw new Error("empty payload");
  await upsertMediaItem(env.DB, {
    source: "tmdb", sourceId: String(d.id), type: link.media_type as "movie" | "show", title,
    releaseDate: (link.media_type === "movie" ? d.release_date : d.first_air_date) || null, rawData: d,
  });
}

export async function runTmdbRefreshStep(env: Env, now = nowSeconds()): Promise<{ refreshed: number; failed: number }> {
  // The scan below reads every TMDB link to find the oldest, and D1 bills each
  // one as a row read. Running it 144 times a day to learn "nothing is due" 144
  // times would be most of the Worker's read traffic, so an empty scan parks
  // the job for a few hours. One row read per run instead of a few thousand.
  if (await kvGet(env.DB, REFRESH_IDLE_KEY)) return { refreshed: 0, failed: 0 };

  const cutoff = now - TMDB_REFRESH_AFTER_DAYS * 86_400;
  const stale = await all<{ source_id: string; media_type: string }>(
    env.DB,
    `SELECT source_id, media_type FROM media_links
      WHERE source = 'tmdb' AND last_synced < ? AND media_type IN ('movie', 'show')
      ORDER BY last_synced LIMIT ?`,
    [cutoff, REFRESH_PER_RUN],
  );
  if (!stale.length) {
    await kvSet(env.DB, REFRESH_IDLE_KEY, "1", REFRESH_IDLE_SECONDS);
    return { refreshed: 0, failed: 0 };
  }

  let refreshed = 0;
  let failed = 0;
  for (const link of stale) {
    try {
      await refetchTmdbLink(env, link);
      refreshed++;
    } catch (e) {
      // A failed refresh must never overwrite a stored blob with nothing, so the
      // row keeps its data. It is pushed a week back in the queue, though:
      // the scan takes the OLDEST links, and a title TMDB has deleted would
      // otherwise sit at the front and block every run behind it forever.
      failed++;
      await env.DB.prepare(
        "UPDATE media_links SET last_synced = ? WHERE source = 'tmdb' AND source_id = ? AND media_type = ?",
      ).bind(cutoff + REFRESH_RETRY_SECONDS, link.source_id, link.media_type).run();
      console.warn("tmdb_refresh_failed", {
        id: link.source_id, type: link.media_type, error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return { refreshed, failed };
}

// ── 3. Titles that are not out yet ──────────────────────────────────────────

/** A title counts as near from this many days after its date… */
export const UPCOMING_RECENT_DAYS = 30;
/** …to this many days before it. */
export const UPCOMING_NEAR_DAYS = 90;
/** A near title is refetched once its copy is this old. The calendar's months are rebuilt daily too. */
export const UPCOMING_NEAR_REFRESH_DAYS = 1;
/** A title further out, or with no date yet, once its copy is this old. */
export const UPCOMING_FAR_REFRESH_DAYS = 7;

const UPCOMING_IDLE_KEY = "tmdb_upcoming_idle";
/** How long to stop looking after a scan finds nothing due, or after a fetch fails. */
const UPCOMING_IDLE_SECONDS = 3600;
const UPCOMING_SKIP_KEY = "tmdb_upcoming_skip";
/** A title whose fetch failed is left alone for this long. */
const UPCOMING_SKIP_SECONDS = 3 * 86_400;
const UPCOMING_SKIP_MAX = 40;

const isoDay = (seconds: number): string => new Date(seconds * 1000).toISOString().slice(0, 10);

/**
 * Refetch pool titles that are not out yet, or only just. A date TMDB moves is
 * otherwise wrong on every list for up to 150 days: Jumanji: Open World read
 * 2 December for weeks after TMDB had it on the 23rd.
 *
 * `slots` is what the retention refresh above left of the run. That one is a
 * condition of TMDB's terms and this one is freshness, so this never takes a
 * slot from it.
 *
 * Only the pool. A row somebody merely opened is fetched when it is opened,
 * and refreshing those would let anybody browsing the calendar set the size
 * of this job. Only TMDB: IGDB is not refreshed on a timer (see the header).
 *
 * ⚠️ A failed fetch does NOT move `last_synced`, unlike the retention refresh.
 * That column is the age of the stored copy and the six-month cap is counted
 * from it; stamping a 50-day-old copy as fresh to get it out of the way would
 * hide it from the job that keeps the cap. The title goes on a short list in
 * kv instead, and the job stands down for an hour, which is also what stops a
 * TMDB outage from being retried every ten minutes.
 */
export async function runUpcomingRefreshStep(
  env: Env,
  slots: number,
  now = nowSeconds(),
): Promise<{ refreshed: number; failed: number }> {
  if (slots <= 0 || (await kvGet(env.DB, UPCOMING_IDLE_KEY))) return { refreshed: 0, failed: 0 };

  let skip: Record<string, number> = {};
  try { skip = JSON.parse((await kvGet(env.DB, UPCOMING_SKIP_KEY)) ?? "{}") ?? {}; } catch { skip = {}; }
  for (const [key, until] of Object.entries(skip)) if (!(until > now)) delete skip[key];
  const skipped = Object.keys(skip).length;

  // One pass over the TMDB links (about 1,700 rows read on 2026-10-10), which
  // is why an empty answer parks the job. Oldest copy first.
  const due = (await all<DueLink>(
    env.DB,
    `SELECT l.source_id, l.media_type
       FROM media_links l JOIN media_items mi ON mi.id = l.media_item_id
      WHERE l.source = 'tmdb' AND l.media_type IN ('movie', 'show') AND mi.browsed = 0
        AND (l.release_date IS NULL OR l.release_date = '' OR l.release_date >= ?1)
        AND l.last_synced < CASE WHEN l.release_date BETWEEN ?1 AND ?2 THEN ?3 ELSE ?4 END
      ORDER BY l.last_synced LIMIT ?5`,
    [
      isoDay(now - UPCOMING_RECENT_DAYS * 86_400), isoDay(now + UPCOMING_NEAR_DAYS * 86_400),
      now - UPCOMING_NEAR_REFRESH_DAYS * 86_400, now - UPCOMING_FAR_REFRESH_DAYS * 86_400,
      slots + skipped,
    ],
  )).filter((l) => !skip[`${l.media_type}:${l.source_id}`]).slice(0, slots);

  if (!due.length) {
    await kvSet(env.DB, UPCOMING_IDLE_KEY, "1", UPCOMING_IDLE_SECONDS);
    return { refreshed: 0, failed: 0 };
  }

  let refreshed = 0;
  let failed = 0;
  for (const link of due) {
    try {
      await refetchTmdbLink(env, link);
      refreshed++;
    } catch (e) {
      failed++;
      skip[`${link.media_type}:${link.source_id}`] = now + UPCOMING_SKIP_SECONDS;
      console.warn("tmdb_upcoming_refresh_failed", {
        id: link.source_id, type: link.media_type, error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  if (failed) {
    // Keep the entries that expire last if the list is full: the others are nearly due again anyway.
    const kept = Object.entries(skip).sort((a, b) => b[1] - a[1]).slice(0, UPCOMING_SKIP_MAX);
    await kvSet(env.DB, UPCOMING_SKIP_KEY, JSON.stringify(Object.fromEntries(kept)));
    await kvSet(env.DB, UPCOMING_IDLE_KEY, "1", UPCOMING_IDLE_SECONDS);
  }
  return { refreshed, failed };
}

// ── 2b. Books stored before their series was read ───────────────────────────
//
// A book's series is read off its Open Library editions since 2026-10-17
// (src/lib/sources/openlibrary.ts), and only when the book is fetched. The 181
// books fetched before that carry no series, so their pages show none and the
// score has no franchise for them (Nils, same day: "i still dont see the
// franchise on the books pages"). Every Open Library link last synced before
// the fix is fetched again once, a couple per run, sharing the run's fetch
// slots. Self-terminating: a refetch moves the link past the cutoff.

/** The moment the series fix was deployed. A link synced after it already carries what this gives. */
export const OPENLIBRARY_REFETCH_BEFORE = 1792241100;
const OL_REFETCH_IDLE_KEY = "ol_refetch_idle";

/** Fetch one book again and store it. Throws when Open Library has nothing usable, with the stored row untouched. */
async function refetchOpenLibraryLink(db: Env["DB"], sourceId: string, now: number): Promise<void> {
  const w = await getOpenLibraryWork(sourceId);
  if (!w?.title) throw new Error("empty payload");
  await upsertMediaItem(db, { source: "openlibrary", sourceId: w.id, type: "book", title: w.title, releaseDate: bookDate(w), rawData: w });
  // A work Open Library merged into another answers under the new id, and the
  // upsert stored that one. The old link must still move past the cutoff, or
  // it is due again every run.
  if (w.id !== sourceId) {
    await db.prepare("UPDATE media_links SET last_synced = ? WHERE source = 'openlibrary' AND source_id = ?").bind(now, sourceId).run();
  }
}

export async function runOpenLibraryRefetchStep(env: Env, slots: number, now = nowSeconds()): Promise<{ refreshed: number; failed: number }> {
  if (slots <= 0) return { refreshed: 0, failed: 0 };
  if (await kvGet(env.DB, OL_REFETCH_IDLE_KEY)) return { refreshed: 0, failed: 0 };

  // A book whose search row already named its series (54 of 235 on 2026-10-17) has nothing to gain.
  const due = await all<{ source_id: string }>(
    env.DB,
    `SELECT source_id FROM media_links
      WHERE source = 'openlibrary' AND last_synced < ? AND raw_data NOT LIKE '%"series_name":[%'
      ORDER BY last_synced LIMIT ?`,
    [OPENLIBRARY_REFETCH_BEFORE, slots],
  );
  if (!due.length) {
    await kvSet(env.DB, OL_REFETCH_IDLE_KEY, "1", REFRESH_IDLE_SECONDS);
    return { refreshed: 0, failed: 0 };
  }

  let refreshed = 0;
  let failed = 0;
  for (const link of due) {
    try {
      await refetchOpenLibraryLink(env.DB, link.source_id, now);
      refreshed++;
    } catch (e) {
      // The stored row keeps its data (the TMDB step's rule), and the link is
      // moved past the cutoff so a book Open Library deleted cannot block the
      // ones behind it. Its series stays unknown, as it was.
      failed++;
      await env.DB.prepare("UPDATE media_links SET last_synced = ? WHERE source = 'openlibrary' AND source_id = ?")
        .bind(OPENLIBRARY_REFETCH_BEFORE, link.source_id).run();
      console.warn("ol_refetch_failed", { id: link.source_id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { refreshed, failed };
}

// ── 2c. Games stored before their IGDB collections were asked for ────────────
//
// A game's IGDB franchise is broad: the 2001 film tie-ins and Hogwarts Legacy
// are both "Harry Potter". Its collections are the series inside it, asked for
// since 2026-10-18 (src/lib/sources/igdb.ts) and carried on the franchise
// facet as `series` (src/lib/facets.ts). The 2,788 games stored before that
// carry none. This walks them once in source-id order, a batch per run: one
// IGDB call for the batch, then each game stored again with its collections
// merged in, which re-derives its facets and moves it in the delta sync.
// Self-terminating: past the last id it parks for good.

/** Games a run stores again. A re-derive is the CPU; one IGDB call answers them all. */
export const IGDB_COLLECTIONS_PER_RUN = 12;
const IGDB_COLLECTIONS_CURSOR_KEY = "igdb_collections_cursor";
const IGDB_COLLECTIONS_DONE = "done";

export async function runIgdbCollectionsStep(env: Env, batch = IGDB_COLLECTIONS_PER_RUN): Promise<{ refreshed: number; missing: number }> {
  const cursor = await kvGet(env.DB, IGDB_COLLECTIONS_CURSOR_KEY);
  if (cursor === IGDB_COLLECTIONS_DONE) return { refreshed: 0, missing: 0 };
  // Switched off or without credentials, nothing moves: the walk waits for IGDB.
  if (!igdbConfigured()) return { refreshed: 0, missing: 0 };

  // The primary key is (source, source_id, media_type), so this reads from the cursor on.
  const due = await all<{ source_id: string; title: string; release_date: string | null }>(
    env.DB,
    `SELECT source_id, title, release_date FROM media_links
      WHERE source = 'igdb' AND source_id > ? AND media_type = 'game' AND raw_data NOT LIKE '%"collections":%'
      ORDER BY source_id LIMIT ?`,
    [cursor ?? "", batch],
  );
  if (!due.length) {
    await kvSet(env.DB, IGDB_COLLECTIONS_CURSOR_KEY, IGDB_COLLECTIONS_DONE);
    return { refreshed: 0, missing: 0 };
  }

  useSharedIgdbToken(env);
  // A throw here leaves the cursor where it was: the batch is asked again next run.
  const found = new Map((await getIgdbCollections(due.map((d) => Number(d.source_id)))).map((g) => [String(g.id), g.collections]));
  let refreshed = 0;
  let missing = 0;
  for (const link of due) {
    const collections = found.get(link.source_id);
    // A game IGDB no longer has keeps what it had; its series stays unknown.
    if (!collections) { missing++; continue; }
    await upsertMediaItem(env.DB, {
      source: "igdb", sourceId: link.source_id, type: "game", title: link.title, releaseDate: link.release_date,
      // Merged over the stored payload (mergeRawData): only `collections` is new.
      rawData: { id: Number(link.source_id), collections },
    });
    refreshed++;
  }
  await kvSet(env.DB, IGDB_COLLECTIONS_CURSOR_KEY, due[due.length - 1].source_id);
  return { refreshed, missing };
}

// ── The trigger ─────────────────────────────────────────────────────────────

export async function runScheduled(env: Env): Promise<void> {
  // Independent: a failure in one must not starve the other.
  try {
    const ex = await runExportStep(env);
    if (ex.wrote) console.log("export_step", ex);
  } catch (e) {
    console.error("export_step_failed", { error: e instanceof Error ? e.message : String(e) });
  }
  // The two refreshes share the run's fetches, the retention one first.
  let slots = REFRESH_PER_RUN;
  try {
    const rf = await runTmdbRefreshStep(env);
    slots -= rf.refreshed + rf.failed;
    if (rf.refreshed || rf.failed) console.log("tmdb_refresh_step", rf);
  } catch (e) {
    slots = 0;
    console.error("tmdb_refresh_step_failed", { error: e instanceof Error ? e.message : String(e) });
  }
  // The books stored before their series was read, until none are left; then
  // this costs one kv read a run.
  try {
    const ol = await runOpenLibraryRefetchStep(env, slots);
    slots -= ol.refreshed + ol.failed;
    if (ol.refreshed || ol.failed) console.log("ol_refetch_step", ol);
  } catch (e) {
    console.error("ol_refetch_step_failed", { error: e instanceof Error ? e.message : String(e) });
  }
  try {
    const up = await runUpcomingRefreshStep(env, slots);
    if (up.refreshed || up.failed) console.log("tmdb_upcoming_step", up);
  } catch (e) {
    console.error("tmdb_upcoming_step_failed", { error: e instanceof Error ? e.message : String(e) });
  }
  // Last, because it is the heaviest: three provider pages to parse and rank.
  // If a run is going to hit its CPU ceiling, it should be after the backup.
  try {
    const cal = await runCalendarStep(env);
    if (cal.built) console.log("calendar_step", cal);
  } catch (e) {
    console.error("calendar_step_failed", { error: e instanceof Error ? e.message : String(e) });
  }
  // The games stored before their collections were asked for, until none are
  // left. After everything else: a run of it measured 59 and 113 ms of CPU on
  // 2026-10-18, past the free plan's 10, so if a run is ever cut short it is
  // this one. A cut batch is safe to repeat: a stored game leaves the query.
  try {
    const ic = await runIgdbCollectionsStep(env);
    if (ic.refreshed || ic.missing) console.log("igdb_collections_step", ic);
  } catch (e) {
    console.error("igdb_collections_step_failed", { error: e instanceof Error ? e.message : String(e) });
  }
}
