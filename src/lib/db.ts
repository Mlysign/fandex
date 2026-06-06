import path from "path";
import fs from "fs";
import Database from "better-sqlite3";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "rr.db");
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  _db.pragma("foreign_keys = ON");
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

export function transaction<T>(fn: () => T): T {
  return getDb().transaction(fn)();
}

export function initDb() {
  const db = getDb();

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
      release_date TEXT,              -- merged date (priority order)
      poster_url TEXT,                -- best poster URL
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_media_type ON media_items(type);
    CREATE INDEX IF NOT EXISTS idx_media_release ON media_items(release_date);

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

    -- User watchlist: what the user is tracking
    CREATE TABLE IF NOT EXISTS user_watchlist (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
      platform_sources TEXT NOT NULL DEFAULT '[]', -- JSON: ["steam","rawg"]
      added_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      notes TEXT,
      UNIQUE(user_id, media_item_id)
    );
    CREATE INDEX IF NOT EXISTS idx_watchlist_user ON user_watchlist(user_id);

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
  `);
}
