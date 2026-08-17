import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { createCacheViews } from "./cacheViews";

// Migration 16 turned user_library / user_watchlist into views. Two things about
// that are dangerous in a way no ordinary test would catch, so they get their own
// file: the boot-order trap, and the fact that the view SQL is what a year of
// stored ratings is now read through.

function seed(db: Database.Database) {
  db.exec(`
    CREATE TABLE user_item_state (
      id TEXT PRIMARY KEY, user_id TEXT NOT NULL, media_item_id TEXT NOT NULL,
      source TEXT NOT NULL, relation TEXT NOT NULL, status TEXT, rating REAL,
      review TEXT, reviewed_at INTEGER,
      added_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(user_id, media_item_id, source, relation)
    );
  `);
  return db;
}
const fresh = () => {
  const db = new Database(":memory:");
  seed(db);
  createCacheViews(db);
  return db;
};

describe("the boot-order trap", () => {
  // THE regression guard for this migration.
  //
  // db.ts's schema block runs on EVERY boot, BEFORE migrations. Measured
  // behaviour: `CREATE TABLE IF NOT EXISTS <name>` over an existing view is a
  // silent no-op, but `CREATE INDEX IF NOT EXISTS ... ON <view>(col)` throws
  // `views may not be indexed`. db.ts used to carry exactly two such index
  // statements for these names. Left in place, migration 16 would have applied
  // cleanly and then stopped the app from starting on the NEXT restart — a green
  // deploy followed by a dead one, with the cause a file nobody had edited.
  //
  // The source-level assertion is deliberate. The behavioural one below proves
  // SQLite still behaves as measured; only reading db.ts proves nobody has
  // reintroduced the statement, because no test boots the app twice.
  it("db.ts's schema block declares nothing about either name", () => {
    const src = fs.readFileSync(path.join(__dirname, "db.ts"), "utf8");
    const ddl = src.match(/CREATE\s+(?:TABLE|INDEX|UNIQUE INDEX)[^;]*?(?:user_library|user_watchlist)[^;]*;/gi) ?? [];
    expect(ddl).toEqual([]);
  });

  it("CREATE TABLE IF NOT EXISTS over the view is a harmless no-op", () => {
    const db = fresh();
    expect(() =>
      db.exec("CREATE TABLE IF NOT EXISTS user_library (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);"),
    ).not.toThrow();
    expect(
      db.prepare("SELECT type FROM sqlite_master WHERE name = 'user_library'").get(),
    ).toEqual({ type: "view" });
  });

  it("CREATE INDEX over the view throws — the boot failure this guards against", () => {
    const db = fresh();
    expect(() => db.exec("CREATE INDEX IF NOT EXISTS idx_library_user ON user_library(user_id);"))
      .toThrow(/views may not be indexed/);
  });

  it("createCacheViews is re-runnable over both a table and a view of the same name", () => {
    const db = new Database(":memory:");
    seed(db);
    // Standing in for the pre-migration state: real tables under these names.
    db.exec("CREATE TABLE user_library (id TEXT PRIMARY KEY, user_id TEXT);");
    db.exec("CREATE TABLE user_watchlist (id TEXT PRIMARY KEY, user_id TEXT);");
    expect(() => createCacheViews(db)).not.toThrow(); // table -> view
    expect(() => createCacheViews(db)).not.toThrow(); // view  -> view
    expect(db.prepare("SELECT type FROM sqlite_master WHERE name='user_library'").get()).toEqual({ type: "view" });
  });
});

describe("the derivation rebuildCaches used to do in TypeScript", () => {
  const U = "u1", I = "i1";
  const add = (db: Database.Database, id: string, source: string, relation: string,
               status: string | null = null, rating: number | null = null,
               review: string | null = null, reviewedAt: number | null = null) =>
    db.prepare(
      `INSERT INTO user_item_state (id, user_id, media_item_id, source, relation, status, rating, review, reviewed_at, added_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1000)`,
    ).run(id, U, I, source, relation, status, rating, review, reviewedAt);

  const lib = (db: Database.Database) =>
    db.prepare("SELECT * FROM user_library WHERE user_id = ?").get(U) as any;

  it("averages per-source ratings and rounds to one decimal", () => {
    const db = fresh();
    add(db, "a", "trakt", "library", "watched", 7);
    add(db, "b", "tmdb", "library", "watched", 8);
    add(db, "c", "steam", "library", "owned", 8);
    expect(lib(db).rating).toBe(7.7); // 23/3 = 7.666… -> 7.7
  });

  it("ignores a 0 or null rating when averaging, exactly as averageFromMetadata did", () => {
    const db = fresh();
    add(db, "a", "trakt", "library", "watched", 8);
    add(db, "b", "tmdb", "library", "watched", 0);
    add(db, "c", "steam", "library", "watched", null);
    expect(lib(db).rating).toBe(8);
  });

  it("has a null rating, not 0, when no source rated the item", () => {
    const db = fresh();
    add(db, "a", "trakt", "library", "watched", null);
    expect(lib(db).rating).toBeNull();
  });

  it("takes status and review from the most recently reviewed source", () => {
    const db = fresh();
    add(db, "a", "trakt", "library", "owned", 5, "older take", 100);
    add(db, "b", "tmdb", "library", "watched", 9, "newer take", 900);
    const r = lib(db);
    expect(r.status).toBe("watched");
    expect(r.review).toBe("newer take");
    expect(r.reviewed_at).toBe(900);
  });

  it("falls back to the first source carrying a status when the newest has none", () => {
    const db = fresh();
    add(db, "a", "trakt", "library", "owned", null, null, null);
    add(db, "b", "tmdb", "library", null, 9, null, 900);
    expect(lib(db).status).toBe("owned");
  });

  it("collapses an all-null reviewed_at to null rather than 0", () => {
    const db = fresh();
    add(db, "a", "trakt", "library", "watched", 7);
    expect(lib(db).reviewed_at).toBeNull();
  });

  it("keeps wishlist and library apart, and reports each one's sources", () => {
    const db = fresh();
    add(db, "a", "steam", "wishlist");
    add(db, "b", "rawg", "wishlist");
    add(db, "c", "trakt", "library", "watched", 6);
    const w = db.prepare("SELECT * FROM user_watchlist WHERE user_id = ?").get(U) as any;
    expect(JSON.parse(w.platform_sources)).toEqual(["rawg", "steam"]); // wishlist orders by source
    expect(JSON.parse(lib(db).platform_sources)).toEqual(["trakt"]);
  });

  it("exposes per-source detail under metadata, keyed by source", () => {
    const db = fresh();
    add(db, "a", "trakt", "library", "watched", 7, "note", 500);
    const meta = JSON.parse(lib(db).metadata);
    expect(meta.trakt).toEqual({ status: "watched", rating: 7, review: "note", reviewedAt: 500 });
  });

  it("shows nothing for a user with only an 'ignored' marker", () => {
    const db = fresh();
    add(db, "a", "local", "ignored");
    expect(lib(db)).toBeUndefined();
    expect(db.prepare("SELECT * FROM user_watchlist WHERE user_id = ?").get(U)).toBeUndefined();
  });
});
