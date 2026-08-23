import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { normalizeName } from "./normalize";
import { runMigrations } from "./migrations";

// Bump whenever normalizeName()'s rule changes — forces a one-time norm_title
// re-backfill (guarded by SQLite's user_version) so existing rows match the new
// rule. A later migration runner (D4) can adopt this same user_version baseline.
const NORM_VERSION = 1;

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "rr.db");
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let _db: Database.Database | null = null;
let _initialized = false;

export function getDb(): Database.Database {
  if (_db) return _db;
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  // Litestream runs as a SECOND connection on this file in production
  // (docker-entrypoint.sh: `litestream replicate -exec "node server.js"`), so
  // writes can contend with its checkpoints. busy_timeout makes contended lock
  // acquisitions wait instead of throwing SQLITE_BUSY. It matches
  // better-sqlite3's constructor default (5000) — stated here so the policy is
  // visible and greppable. NOTE: the timeout only helps when the write lock is
  // taken up-front; see transaction() below for why that matters.
  db.pragma("busy_timeout = 5000");
  // Standard WAL pairing: commits skip the per-commit fsync of the WAL file
  // (fsync happens at checkpoint). Durability only weakens for an OS/power
  // crash — and Litestream's replica is the recovery story for that.
  db.pragma("synchronous = NORMAL");
  // Only cache a connection whose schema setup SUCCEEDED. This used to assign
  // _db before calling ensureSchema, so a throw in there left a usable but
  // UNMIGRATED connection cached forever: the first request 500s, every request
  // after it returns the cached handle and skips ensureSchema entirely — the app
  // then runs indefinitely against an old schema, failing one write at a time
  // instead of failing to boot. A migration that can't apply must be loud.
  try {
    ensureSchema(db);
  } catch (e) {
    db.close();
    throw e;
  }
  _db = db;
  return _db;
}

export function query<T = any>(sql: string, params: any[] = []): T[] {
  return getDb().prepare(sql).all(...params) as T[];
}

export function run(sql: string, params: any[] = []) {
  return getDb().prepare(sql).run(...params);
}

export function get<T = any>(sql: string, params: any[] = []): T | null {
  return (getDb().prepare(sql).get(...params) as T) ?? null;
}

// BEGIN IMMEDIATE, deliberately. Every caller is a write batch, and the default
// BEGIN DEFERRED starts as a reader: the matcher's lookup SELECTs pin a read
// snapshot, and the first INSERT then tries to upgrade it to a write lock. If
// ANY other connection committed in between — Litestream does, roughly every
// second — SQLite fails the upgrade with SQLITE_BUSY immediately, WITHOUT
// consulting busy_timeout (the snapshot is stale; waiting cannot fix it). That
// was the "database is locked" error wall in production (2026-07-20).
// IMMEDIATE takes the write lock at BEGIN, so contention goes through the 5s
// busy handler instead.
export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn).immediate();
}

// Schema setup runs implicitly the first time getDb() opens the connection, so
// callers never have to remember to call it. Kept idempotent and guarded by
// _initialized; takes the db handle directly to avoid recursing through getDb().
function ensureSchema(db: Database.Database) {
  // Only run schema setup once per process
  if (_initialized) return;

  db.exec(`
    -- Users: identity-less, just a container
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      last_seen_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );

    -- One row per platform identity per user
    CREATE TABLE IF NOT EXISTS user_identities (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,         -- steam | trakt | rawg
      provider_user_id TEXT NOT NULL, -- steam64id, trakt username, etc.
      display_name TEXT,
      avatar_url TEXT,
      access_token TEXT,
      refresh_token TEXT,
      token_expires_at INTEGER,
      metadata TEXT,                  -- JSON: extra provider-specific data
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(provider, provider_user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_identities_user ON user_identities(user_id);

    -- Canonical media items (merged result)
    CREATE TABLE IF NOT EXISTS media_items (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,             -- game | movie | show
      title TEXT NOT NULL,            -- merged title (priority order)
      norm_title TEXT,                -- normalized title for fast matching
      release_date TEXT,              -- merged date (priority order)
      poster_url TEXT,                -- best poster URL
      -- H2b provenance: 0 = library / ingested / synced (the catalog pool),
      -- 1 = only ever seen in a /discover feed. The catalog surfaces and the IDF
      -- weights read the pool only; see migration 8 and discovery.ts.
      browsed INTEGER NOT NULL DEFAULT 0,
      -- The public url's address segment: /{type}/{slug}. Unique per type,
      -- assigned on insert, IMMUTABLE afterwards. Its index is created by
      -- migration 19, never here. See publicUrl.ts for why it's stored.
      slug TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_media_type ON media_items(type);
    CREATE INDEX IF NOT EXISTS idx_media_release ON media_items(release_date);
    -- NOTE: no index on browsed here, deliberately. This block runs BEFORE
    -- runMigrations, so it only ever sees the columns an EXISTING db already has.
    -- browsed is added by migration 8, so indexing it here throws
    -- "no such column: browsed" on every pre-migration-8 database, which aborts
    -- ensureSchema before the very migrations it was about to run. Migration 8
    -- owns that index. Same rule for any future column: CREATE TABLE describes a
    -- FRESH db; the indexes here must also hold for an OLD one.

    -- Raw data per source, linked to canonical item
    CREATE TABLE IF NOT EXISTS media_links (
      id TEXT PRIMARY KEY,
      media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      source TEXT NOT NULL,           -- steam | rawg | tmdb | trakt | igdb
      source_id TEXT NOT NULL,        -- ID in that source system
      title TEXT,                     -- source's own title
      release_date TEXT,              -- source's own date
      raw_data TEXT NOT NULL,         -- full JSON from source
      last_synced INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      UNIQUE(source, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_links_item ON media_links(media_item_id);
    CREATE INDEX IF NOT EXISTS idx_links_source ON media_links(source, source_id);

    -- user_watchlist and user_library are NOT created here. As of migration 16
    -- they are VIEWS over user_item_state (see src/lib/cacheViews.ts), and this
    -- block re-runs on every boot BEFORE migrations, so anything it declared
    -- about those two names would fight the migration that owns them:
    --   * CREATE TABLE IF NOT EXISTS over a view is a silent no-op — harmless,
    --     but it would leave a stale table definition here shadowing nothing.
    --   * CREATE INDEX IF NOT EXISTS over a view THROWS 'views may not be
    --     indexed', which would break getDb() on the first boot AFTER the
    --     migration applied — i.e. a green deploy followed by an app that
    --     cannot start. Do not add one back.
    -- Migration 3 still creates them as real tables, because it backfills
    -- user_item_state from them on a fresh database; migration 16 then drops
    -- them and installs the views.

    -- Sync log
    CREATE TABLE IF NOT EXISTS sync_log (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      synced_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      item_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'ok',
      error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sync_log_user ON sync_log(user_id, provider);

    -- Persisted L2 for the public facet payload cache (2026-08-13).
    -- Why it is here and not in migrations.ts: a BRAND-NEW table is additive and
    -- idempotent, so it is valid against an old pre-migration schema, which is
    -- exactly what this block must stay. The rule it must not break is the other
    -- one: a column added by a migration needs its index in that same migration.
    -- A new table carrying its own index here is the documented-safe pattern.
    --
    -- Not user-scoped on purpose: buildPublicFacetDetail never takes a userId,
    -- so nothing personal can land here. Note the corollary for GDPR erasure --
    -- deleteAccount() finds personal tables by a column literally named
    -- user_id, and this table deliberately has none, so it is correctly skipped.
    CREATE TABLE IF NOT EXISTS facet_page_cache (
      key TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_facet_page_cache_created ON facet_page_cache(created_at);

    -- ── Franchise membership (2026-08-23) ─────────────────────────────────
    -- What a franchise ACTUALLY contains, per provider, whether or not we hold
    -- the title. The item page's "More from …" rail could only ever list
    -- catalog rows before this, and the catalog is thin where franchises are
    -- concerned: measured that day, 167 of our 249 distinct TMDB collections
    -- held exactly ONE title, so two thirds of films with a franchise showed no
    -- rail at all while TMDB knew the full list.
    --
    -- ⚠️ THIS IS WHY IT IS A SEPARATE TABLE AND NOT media_items ROWS. Two
    -- reasons, either one sufficient:
    --   1. COST. IGDB franchises average 78 games and the largest we touch
    --      holds 394, against 4.8 for a TMDB collection. Ingesting every member
    --      would take the catalog from 2,569 to ~16,500 items — a 6.4x resident
    --      discovery pool (discovery.ts holds a DiscoveryVector per item) and a
    --      6.4x crawl surface. Railway bills RAM at ~$10/GB-month against a $5
    --      Hobby credit, so that is the line item that hurts; volume storage is
    --      $0.155/GB-month and never was the problem. These rows are ~200 bytes,
    --      so the whole membership set is a few MB.
    --   2. IT WOULD NOT SURVIVE. A pre-ingested member is browsed = 1, and
    --      dbPrune deletes browsed-only rows on every boot, so the franchise
    --      would empty itself on the next deploy.
    --
    -- ⚠️ ip_key IS THE RAW ipKey(), NOT the canonical one. Aliases and bundles
    -- are runtime-editable (ipAlias.ts), so a canonical key persisted here would
    -- go stale the moment somebody edits a bundle, and re-canonicalising a
    -- stored key is the trap AGENTS.md flags for tagKey. Callers resolve
    -- aliases at READ time instead, exactly like facets do.
    --
    -- No user_id, deliberately: this is catalog data, so GDPR erasure correctly
    -- skips it (deleteAccount finds personal tables by that column name). It
    -- also does not reference media_items, so it is not a dbPrune PRUNABLE_WHERE
    -- concern -- nothing here cascades off an item row.
    CREATE TABLE IF NOT EXISTS franchise_members (
      ip_key TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      release_date TEXT,
      poster_url TEXT,
      popularity REAL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (ip_key, source, source_id)
    );
    CREATE INDEX IF NOT EXISTS idx_franchise_members_key ON franchise_members(ip_key);
    CREATE INDEX IF NOT EXISTS idx_franchise_members_fetched ON franchise_members(fetched_at);
  `);

  // ── Lightweight migrations for existing databases ──────────────
  // The composite index on norm_title is created HERE (not in the schema block
  // above) because an existing media_items table won't have the norm_title
  // column until the ALTER below runs. Creating the index in the schema block
  // would fail with "no such column: norm_title" on older databases.
  const cols = db.prepare("PRAGMA table_info(media_items)").all() as { name: string }[];
  if (!cols.some((c) => c.name === "norm_title")) {
    db.exec("ALTER TABLE media_items ADD COLUMN norm_title TEXT");
  }
  // Safe to run every time – IF NOT EXISTS guards it, and the column now exists.
  db.exec("CREATE INDEX IF NOT EXISTS idx_media_type_norm ON media_items(type, norm_title)");

  // norm_title is derived from title via normalizeName() (the single source of
  // truth in normalize.ts). When that rule changes — or a row is missing it — every
  // row must be recomputed, or the matcher's indexed lookup (WHERE type = ? AND
  // norm_title = ?) misses pre-existing rows and creates duplicate canonical items.
  // Guarded by user_version so this full re-backfill runs once per rule version.
  const normVersion = db.pragma("user_version", { simple: true }) as number;
  if (normVersion < NORM_VERSION) {
    const rows = db.prepare("SELECT id, title FROM media_items").all() as { id: string; title: string }[];
    const upd = db.prepare("UPDATE media_items SET norm_title = ? WHERE id = ?");
    const tx = db.transaction((rs: { id: string; title: string }[]) => {
      for (const r of rs) upd.run(normalizeName(r.title ?? ""), r.id);
    });
    tx(rows);
    db.pragma(`user_version = ${NORM_VERSION}`);
  }

  // ── Versioned migrations (D4) ───────────────────────────────────
  // Everything beyond the norm_title baseline (user_version >= 2) is applied by
  // the ordered runner in migrations.ts. Runs in-process here; the same list can
  // be applied standalone to the live DB via scripts/migrate.mjs.
  const applied = runMigrations(db);

  // H2a: reclaim the freed pages. A migration that rewrites raw_data (the
  // projection backfill) frees a LOT — measured 29,116 pages / ~117MB — but
  // SQLite keeps them on the freelist and the FILE never shrinks (159.5MB after
  // the backfill vs 42.4MB once vacuumed). Only worth the cost when a migration
  // actually ran, and it MUST be outside the runner: VACUUM cannot execute
  // inside a transaction, and runMigrations wraps each migration in one.
  //
  // Measured at 0.4s for a 160MB DB. Note for the live volume: VACUUM rewrites
  // the whole file, so Litestream will re-replicate it once.
  if (applied.length) {
    try {
      db.exec("VACUUM");
    } catch {
      // Non-fatal: the data is already correct and the freelist gets reused by
      // later writes, so a failed VACUUM only means the file stays large.
    }
    // ── And truncate the WAL the VACUUM just inflated (2026-08-23) ─────────
    //
    // A VACUUM rewrites the ENTIRE database through the write-ahead log, so the
    // WAL file takes the database's size as its high-water mark. SQLite then
    // reuses that file from the start rather than shrinking it, so the size
    // persists indefinitely while the contents recycle. Measured on prod after
    // migration 19: **DB 81.3 MB, WAL 340.8 MB** — four times the database, for
    // nothing, on a Railway volume.
    //
    // ⚠️ THIS IS THE BENIGN CASE AND IT LOOKS EXACTLY LIKE THE BAD ONE. A WAL
    // that will not truncate is otherwise a real symptom: in 2026-08-17
    // Litestream could not parse the schema, so it could not advance its read
    // position, so SQLite could not checkpoint past it, and backups silently
    // stopped for two days. The discriminator is `dbFilesMb.shadowWalMb` in
    // /api/health — if it moves across a restart, Litestream is replicating and
    // the WAL is just a high-water mark. Do not skip that check.
    //
    // TRUNCATE (not PASSIVE) is the mode that actually returns the space; it is
    // also the one that can answer `busy: 1` when another connection holds a
    // read lock, which in production is Litestream. That is fine and expected:
    // this runs at BOOT, before the app has served anything, and a busy answer
    // is a no-op that leaves the file exactly as it was.
    try {
      db.pragma("wal_checkpoint(TRUNCATE)");
    } catch {
      // Non-fatal for the same reason as the VACUUM above: worst case the file
      // stays large, which is a cost rather than a correctness problem.
    }
  }

  _initialized = true;
}

/**
 * @deprecated Schema setup is now implicit in getDb(); this is a no-op-safe
 * alias kept only for standalone scripts/tests that import it directly.
 */
export function initDb() {
  getDb();
}
