// user_library / user_watchlist as DERIVED VIEWS over user_item_state.
//
// Migration 3 (D1+D2) normalized per-source user state into user_item_state and
// left the two older tables in place as CACHES rebuilt on every write, promising
// a later contract step. Migration 16 is that step: the caches become views, so
// the drift they were audited for every boot is no longer merely absent, it is
// structurally impossible. `dbSize.ts`'s libRowsWithoutState / wishRowsWithoutState
// counters read 0 by definition now rather than by luck.
//
// ── Why views instead of rewriting the read sites ────────────────────────────
// Eighteen production read sites select from these two tables. Rewriting each by
// hand would put the correctness of a user's ratings, statuses and review text in
// eighteen places; a view puts it in two, and — decisively — lets the whole thing
// be proven by diffing view output against the real stored rows
// (`scripts/verify-cache-views.mjs`, byte-exact on 2,017 rows of the live DB).
// It is also cheaply reversible: user_item_state still holds everything, so a
// mistake is one CREATE VIEW away from a fix, never a restore.
//
// ── The ordering asymmetry is deliberate ─────────────────────────────────────
// The wishlist view orders its JSON by SOURCE and the library view by ROWID.
// That is not a slip. rebuildCaches ran two different queries and never named an
// order, so SQLite chose one per query: the wishlist's `SELECT source` is covered
// by UNIQUE(user_id, media_item_id, source, relation) and came back alphabetically,
// while the library's five-column select is not covered, came from
// idx_uis_user_item, and arrived in rowid order. Both orders are baked into years
// of stored JSON. Measured against the live DB, not inferred from the schema.
//
// The order is cosmetic to every consumer (both columns are JSON.parse'd and read
// by key), so reproducing it is about making the verification diff meaningful --
// a clean diff is the entire proof that the swap is lossless.
//
// ── ⚠️ HOW THE SORT IS EXPRESSED IS LOAD-BEARING (2026-08-19) ────────────────
// It is written as ORDER BY in a SUBQUERY, never as `ORDER BY` inside an
// aggregate's argument list. `json_group_array(source ORDER BY source)` is
// SQLite **3.44.0+** syntax (2023-11-01), and this file shipped it on 2026-08-17.
//
// **That took production backups down for two days and nothing said so.** SQLite
// parses the ENTIRE schema before preparing ANY statement, so an unparseable view
// makes every query fail with `malformed database schema (user_watchlist) - near
// "ORDER": syntax error` — including Litestream's. Litestream v0.3.13 (pinned in
// the Dockerfile) embeds SQLite ~3.40, so from the moment migration 16 landed it
// logged that error once a second and replicated NOTHING. The app was fine
// throughout: better-sqlite3 ships 3.53, tests passed, `/api/health` said `db: up`.
// Railway volume backups are Pro-plan only, so Litestream was the only copy.
// It also explains the WAL that would not truncate — Litestream could not advance
// its read position, so SQLite could not checkpoint past it.
//
// The subquery form produces byte-identical output (verified on the live DB) and
// parses on 3.40, checked with a real 3.40 CLI rather than by reading a changelog.
// SQLite deliberately will not flatten a subquery that has ORDER BY into an outer
// AGGREGATE query, which is exactly what preserves the order here.
//
// Rule for anything added to these views: it must parse on the SQLite version
// Litestream embeds, not the one better-sqlite3 ships. When in doubt, open a copy
// of the DB with an old sqlite3 CLI — the failure is total and silent otherwise.

import type DatabaseT from "better-sqlite3";

// ⚠️ NEVER write `ORDER BY` inside an aggregate's argument list here. See the
// "how the sort is expressed" note above createCacheViews — it cost two days of
// production backups.
export const WATCHLIST_VIEW_BODY = `
SELECT
  user_id || ':' || media_item_id                 AS id,
  user_id,
  media_item_id,
  json_group_array(source)                        AS platform_sources,
  MIN(added_at)                                   AS added_at,
  NULL                                            AS notes
FROM (
  SELECT user_id, media_item_id, source, added_at
  FROM user_item_state
  WHERE relation = 'wishlist'
  ORDER BY user_id, media_item_id, source
)
GROUP BY user_id, media_item_id`;

// Mirrors rebuildCaches' derivation exactly:
//   rating      = average of per-source ratings > 0, rounded to 1dp, null if none
//   reviewed_at = max, but 0 collapses to null (JS did `Math.max(0, …) || null`)
//   status      = most-recently-reviewed source's status, else the first TRUTHY
//                 status, else null. Note the asymmetry that has to survive:
//                 `??` is null-based but the fallback `find(s => s)` is truthy-
//                 based, so '' is skipped by the fallback yet kept if the recent
//                 row carries it.
//   ties        = JS used a stable sort, i.e. original query order = rowid here.
export const LIBRARY_VIEW_BODY = `
WITH lib AS (
  SELECT rowid AS rid, * FROM user_item_state WHERE relation = 'library'
),
agg AS (
  SELECT
    user_id, media_item_id,
    json_group_array(source)                                         AS platform_sources,
    ROUND(AVG(CASE WHEN rating > 0 THEN rating END), 1)              AS rating,
    NULLIF(MAX(COALESCE(reviewed_at, 0)), 0)                         AS reviewed_at,
    MIN(added_at)                                                    AS added_at,
    MIN(CASE WHEN status IS NOT NULL AND status <> '' THEN rid END)  AS fallback_status_rid,
    MIN(CASE WHEN review IS NOT NULL AND review <> '' THEN rid END)  AS fallback_review_rid
  FROM (SELECT * FROM lib ORDER BY rid) GROUP BY user_id, media_item_id
),
meta AS (
  SELECT user_id, media_item_id,
    json_group_object(source, json_object(
      'status', status, 'rating', rating, 'review', review, 'reviewedAt', reviewed_at
    )) AS metadata
  FROM (SELECT * FROM lib ORDER BY rid) GROUP BY user_id, media_item_id
),
recent AS (
  SELECT user_id, media_item_id, status, review,
    ROW_NUMBER() OVER (
      PARTITION BY user_id, media_item_id
      ORDER BY COALESCE(reviewed_at, 0) DESC, rid ASC
    ) AS rn
  FROM lib
)
SELECT
  a.user_id || ':' || a.media_item_id AS id,
  a.user_id,
  a.media_item_id,
  a.platform_sources,
  COALESCE(r.status, (SELECT status FROM lib WHERE rid = a.fallback_status_rid)) AS status,
  a.rating,
  COALESCE(r.review, (SELECT review FROM lib WHERE rid = a.fallback_review_rid)) AS review,
  a.reviewed_at,
  m.metadata,
  a.added_at
FROM agg a
JOIN meta m   ON m.user_id = a.user_id AND m.media_item_id = a.media_item_id
JOIN recent r ON r.user_id = a.user_id AND r.media_item_id = a.media_item_id AND r.rn = 1`;

/**
 * Replace the two cache TABLES with the equivalent VIEWS.
 *
 * ⚠️ Callers must not add `CREATE INDEX … ON user_library(…)` anywhere that runs
 * afterwards. `CREATE TABLE IF NOT EXISTS` over a view is a harmless no-op, but
 * `CREATE INDEX IF NOT EXISTS` over one throws `views may not be indexed` — and
 * db.ts's schema block runs on EVERY boot, before migrations, so leaving those
 * two index statements in place would have let this migration succeed and then
 * made the app fail to start on the next restart. They were removed from db.ts
 * in the same commit; the CREATE TABLEs moved into migration 3, which is the
 * only thing that still needs them (it backfills user_item_state FROM them on a
 * fresh database).
 */
export function createCacheViews(db: DatabaseT.Database): void {
  // DROP has to match the object's actual type. `DROP TABLE IF EXISTS x` does
  // NOT quietly skip a view of that name — SQLite answers "use DROP VIEW to
  // delete view x" — and the reverse is equally fatal, so neither statement is
  // safe to fire blind. Reading sqlite_master first is what makes this
  // re-runnable, which the migration runner's idempotency tests demand.
  for (const name of ["user_watchlist", "user_library"]) {
    const existing = db
      .prepare("SELECT type FROM sqlite_master WHERE name = ?")
      .get(name) as { type?: string } | undefined;
    if (existing?.type === "view") db.exec(`DROP VIEW "${name}"`);
    else if (existing?.type === "table") db.exec(`DROP TABLE "${name}"`);
  }
  db.exec(`
    CREATE VIEW user_watchlist AS ${WATCHLIST_VIEW_BODY};
    CREATE VIEW user_library   AS ${LIBRARY_VIEW_BODY};
  `);
}
