import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { runMigrations } from "./migrations";

// Migration 12 (P18): PROJECTION_VERSION 2 -> 3 only changed projectTmdb()
// (watch/providers keeps `link` + `offerType`). This migration pre-stamps
// every non-TMDB row already at v2 straight to v3 with a plain integer
// UPDATE — no JSON touched, no network — so games/steam/trakt detail reads
// don't needlessly refetch for a version bump that doesn't affect their shape.
// TMDB rows at v2 are left alone; they heal lazily via ensureTmdbDetail.

function seedDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE media_items (id TEXT PRIMARY KEY, type TEXT, title TEXT, release_date TEXT, poster_url TEXT, created_at INTEGER, updated_at INTEGER);
    CREATE TABLE media_links (id TEXT PRIMARY KEY, media_item_id TEXT, source TEXT, source_id TEXT, title TEXT, release_date TEXT, raw_data TEXT, last_synced INTEGER);
    CREATE TABLE users (id TEXT PRIMARY KEY);
    CREATE TABLE user_watchlist (id TEXT PRIMARY KEY, user_id TEXT, media_item_id TEXT, platform_sources TEXT, added_at INTEGER, notes TEXT);
    CREATE TABLE user_library (id TEXT PRIMARY KEY, user_id TEXT, media_item_id TEXT, platform_sources TEXT, status TEXT, rating REAL, review TEXT, reviewed_at INTEGER, metadata TEXT, added_at INTEGER);
    INSERT INTO media_items (id, type, title) VALUES ('item-1', 'movie', 'Title');
  `);
  return db;
}

function insertLink(db: Database.Database, id: string, source: string, version: number) {
  db.prepare(
    // One source_id per row. This used to be a shared 'src-1' — the seed table
    // here is hand-written and carried no UNIQUE, so two rawg rows could share
    // it. Migration 23 rebuilds the table with UNIQUE(source, source_id,
    // media_type), which the real schema has had all along, so the seed has to
    // stop leaning on a constraint the app never actually lacked.
    `INSERT INTO media_links (id, media_item_id, source, source_id, media_type, title, release_date, raw_data, last_synced, projection_version)
     VALUES (?, 'item-1', ?, ?, 'movie', 'Title', '2026-01-01', '{}', 0, ?)`
  ).run(id, source, `src-${id}`, version);
}

// Run the full migration set once (builds the schema up through the latest
// version, including projection_version), then roll user_version back to 11
// so a second runMigrations() call applies ONLY migration 12 against
// caller-controlled row state — the only way to isolate one migration, since
// runMigrations always applies every version > current.
function dbAtV11WithRowsFor(rows: { id: string; source: string; version: number }[]): Database.Database {
  const db = seedDb();
  runMigrations(db);
  db.pragma("user_version = 11");
  for (const r of rows) insertLink(db, r.id, r.source, r.version);
  return db;
}

describe("migration 12 — pre-stamp non-TMDB rows at v2 to v3", () => {
  it("advances non-TMDB rows at v2 to v3, leaves TMDB rows at v2 untouched", () => {
    const db = dbAtV11WithRowsFor([
      { id: "rawg-at-2", source: "rawg", version: 2 },
      { id: "igdb-at-2", source: "igdb", version: 2 },
      { id: "steam-at-2", source: "steam", version: 2 },
      { id: "trakt-at-2", source: "trakt", version: 2 },
      { id: "tmdb-at-2", source: "tmdb", version: 2 },
    ]);

    runMigrations(db); // applies only migration 12 from user_version 11

    const versionOf = (id: string) =>
      (db.prepare(`SELECT projection_version v FROM media_links WHERE id = ?`).get(id) as { v: number }).v;

    expect(versionOf("rawg-at-2")).toBe(3);
    expect(versionOf("igdb-at-2")).toBe(3);
    expect(versionOf("steam-at-2")).toBe(3);
    expect(versionOf("trakt-at-2")).toBe(3);
    expect(versionOf("tmdb-at-2")).toBe(2); // untouched — heals via ensureTmdbDetail, not this migration
    db.close();
  });

  it("leaves rows below v2 untouched regardless of source", () => {
    const db = dbAtV11WithRowsFor([
      { id: "rawg-at-0", source: "rawg", version: 0 },
      { id: "rawg-at-1", source: "rawg", version: 1 },
    ]);

    runMigrations(db);

    const rows = db.prepare(`SELECT id, projection_version v FROM media_links ORDER BY id`).all() as { id: string; v: number }[];
    expect(rows.find((r) => r.id === "rawg-at-0")!.v).toBe(0);
    expect(rows.find((r) => r.id === "rawg-at-1")!.v).toBe(1);
    db.close();
  });

  it("lands at user_version >= 12 and is idempotent", () => {
    const db = dbAtV11WithRowsFor([{ id: "rawg-at-2", source: "rawg", version: 2 }]);
    runMigrations(db);

    expect(db.pragma("user_version", { simple: true }) as number).toBeGreaterThanOrEqual(12);
    expect(runMigrations(db)).toEqual([]);

    const v = (db.prepare(`SELECT projection_version v FROM media_links WHERE id = 'rawg-at-2'`).get() as { v: number }).v;
    expect(v).toBe(3);
    db.close();
  });
});
