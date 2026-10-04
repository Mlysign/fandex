-- Fandex on D1: the shared catalog and the user tables (docs/app-plan.md, phase 1).
--
-- Derived from the Railway schema at user_version 32, and deliberately NOT a copy.
-- Three rules shaped every table here:
--
-- 1. A row write is the scarce resource. D1 Free stops ALL queries for the rest
--    of the UTC day past 100,000 row writes, and every index a write touches is
--    one more. So a natural key is the PRIMARY KEY of a WITHOUT ROWID table
--    (one b-tree, one write) instead of a uuid plus a UNIQUE index (three), and
--    an index exists only where a query on the request path needs it.
-- 2. A user_id column is what makes a table personal. Erasure and account merge
--    find their tables by that literal column name (src/account.ts), so a
--    catalog table must never have one and a personal table must.
-- 3. No provider token is stored. Trakt and TMDB tokens live on the device
--    (decided 2026-10-04), so user_identities has no token columns at all.
--
-- Comments are plain prose on purpose: this file is passed to D1 as-is.

-- ── Catalog ─────────────────────────────────────────────────────────────────

CREATE TABLE media_items (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,              -- game | movie | show
  title        TEXT NOT NULL,
  norm_title   TEXT,                       -- normalizeName(title), the matcher's key
  release_date TEXT,
  poster_url   TEXT,
  slug         TEXT,                       -- immutable once assigned, unique per type
  browsed      INTEGER NOT NULL DEFAULT 0, -- 1 = resolved on demand, nobody acted on it yet
  vote_count   INTEGER,
  vote_average REAL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
) WITHOUT ROWID;

CREATE UNIQUE INDEX idx_media_items_type_slug ON media_items(type, slug);
CREATE INDEX idx_media_type_norm ON media_items(type, norm_title);
-- The delta sync's cursor. Partial: only pool rows are ever downloaded, so a
-- browsed row costs no write here.
CREATE INDEX idx_media_pool_updated ON media_items(updated_at, id) WHERE browsed = 0;

-- What a client is served for an item, derived once at write time so a read is
-- one row and no JSON work. Same two shapes media_item_projection held:
-- facets is Facet[], merged is the region-default EnrichedItem without blobs.
-- vector is the DiscoveryVector the on-device scoring pool is built from.
CREATE TABLE item_doc (
  media_item_id  TEXT PRIMARY KEY REFERENCES media_items(id) ON DELETE CASCADE,
  vector         TEXT NOT NULL,
  facets         TEXT NOT NULL,
  merged         TEXT NOT NULL,
  derive_version INTEGER NOT NULL,
  derived_at     INTEGER NOT NULL DEFAULT (unixepoch())
) WITHOUT ROWID;

-- A provider id is unique only within a media type (trakt 386 is a film AND a
-- show), so the key carries the type. raw_data is last so a scan that does not
-- select it never follows its overflow pages.
CREATE TABLE media_links (
  source             TEXT NOT NULL,
  source_id          TEXT NOT NULL,
  media_type         TEXT NOT NULL,
  media_item_id      TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  title              TEXT,
  release_date       TEXT,
  last_synced        INTEGER NOT NULL DEFAULT (unixepoch()),
  projection_version INTEGER NOT NULL DEFAULT 0,
  raw_data           TEXT NOT NULL,
  PRIMARY KEY (source, source_id, media_type)
) WITHOUT ROWID;

CREATE INDEX idx_links_item ON media_links(media_item_id);

CREATE TABLE media_external_ids (
  source        TEXT NOT NULL,
  external_id   TEXT NOT NULL,
  media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  PRIMARY KEY (source, external_id, media_item_id)
) WITHOUT ROWID;

CREATE INDEX idx_ext_item ON media_external_ids(media_item_id);

CREATE TABLE show_seasons (
  media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  season_number INTEGER NOT NULL,
  name          TEXT,
  episode_count INTEGER NOT NULL DEFAULT 0,
  air_date      TEXT,
  poster_url    TEXT,
  overview      TEXT,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (media_item_id, season_number)
) WITHOUT ROWID;

CREATE TABLE show_episodes (
  media_item_id   TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  season_number   INTEGER NOT NULL,
  episode_number  INTEGER NOT NULL,
  title           TEXT,
  air_date        TEXT,
  runtime_minutes INTEGER,
  overview        TEXT,
  still_url       TEXT,
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (media_item_id, season_number, episode_number)
) WITHOUT ROWID;

-- What a franchise actually contains, as thin rows, whether or not we hold the
-- title. Not a catalog table: no media_item_id, so nothing cascades into it.
CREATE TABLE franchise_members (
  ip_key       TEXT NOT NULL,
  source       TEXT NOT NULL,
  source_id    TEXT NOT NULL,
  type         TEXT NOT NULL,
  title        TEXT NOT NULL,
  release_date TEXT,
  poster_url   TEXT,
  popularity   REAL,
  fetched_at   INTEGER NOT NULL,
  PRIMARY KEY (ip_key, source, source_id)
) WITHOUT ROWID;

-- One calendar month for one region, fetched from the providers on the first
-- request and served from here afterwards.
CREATE TABLE calendar_month (
  region   TEXT NOT NULL,
  month    TEXT NOT NULL,                  -- YYYY-MM
  built_at INTEGER NOT NULL,
  payload  TEXT NOT NULL,
  PRIMARY KEY (region, month)
) WITHOUT ROWID;

-- ── Taxonomy (edited by hand on the old site; read-only here for now) ───────

CREATE TABLE tag_category (
  id         TEXT PRIMARY KEY,
  label      TEXT NOT NULL,
  color      TEXT NOT NULL,
  weight     REAL NOT NULL DEFAULT 1,
  ignored    INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
) WITHOUT ROWID;

CREATE TABLE tag_category_override (
  tag_key     TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES tag_category(id) ON DELETE CASCADE,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
) WITHOUT ROWID;

CREATE TABLE tag_alias (
  alias_key     TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
) WITHOUT ROWID;

CREATE TABLE ip_alias (
  alias_key     TEXT PRIMARY KEY,
  canonical_key TEXT NOT NULL,
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
) WITHOUT ROWID;

CREATE TABLE item_ip_override (
  media_item_id TEXT NOT NULL,
  ip_key        TEXT NOT NULL,
  label         TEXT NOT NULL,
  mode          TEXT NOT NULL,             -- add | remove
  source        TEXT NOT NULL DEFAULT 'manual',
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (media_item_id, ip_key)
) WITHOUT ROWID;

CREATE TABLE facet_label_override (
  kind       TEXT NOT NULL,
  key        TEXT NOT NULL,
  label      TEXT NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (kind, key)
) WITHOUT ROWID;

CREATE TABLE scoring_config (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  config     TEXT NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- ── Accounts ────────────────────────────────────────────────────────────────

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  last_seen_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  country       TEXT,
  session_epoch INTEGER NOT NULL DEFAULT 0,
  platforms     TEXT,                      -- JSON string array, NULL = not configured
  media_types   TEXT                       -- JSON string array, NULL = not configured
) WITHOUT ROWID;

-- A way to prove it is you. No token columns: nothing here can call a provider.
CREATE TABLE user_identities (
  provider         TEXT NOT NULL,          -- google | trakt | steam
  provider_user_id TEXT NOT NULL,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  display_name     TEXT,
  avatar_url       TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (provider, provider_user_id)
) WITHOUT ROWID;

CREATE INDEX idx_identities_user ON user_identities(user_id);

CREATE TABLE user_item_state (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  source        TEXT NOT NULL,             -- trakt | tmdb | steam | rawg | igdb | local
  relation      TEXT NOT NULL,             -- wishlist | library | ignored
  status        TEXT,
  rating        REAL,
  review        TEXT,
  reviewed_at   INTEGER,
  added_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, media_item_id, source, relation)
) WITHOUT ROWID;

CREATE TABLE user_episode_state (
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_item_id  TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  season_number  INTEGER NOT NULL,
  episode_number INTEGER NOT NULL,
  watched_at     INTEGER,
  sources        TEXT NOT NULL DEFAULT '["local"]',
  updated_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, media_item_id, season_number, episode_number)
) WITHOUT ROWID;

CREATE TABLE user_hidden_items (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
  hidden_at     INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (user_id, media_item_id)
) WITHOUT ROWID;

-- ── Operations ──────────────────────────────────────────────────────────────

-- Small shared values with an expiry: the Twitch app token, cron cursors.
CREATE TABLE kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  expires_at INTEGER                       -- unix seconds, NULL = never
) WITHOUT ROWID;

-- Per-UTC-day counters that gate spending: provider fetches and the like.
CREATE TABLE daily_budget (
  day  TEXT NOT NULL,                      -- YYYY-MM-DD, UTC
  kind TEXT NOT NULL,
  n    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, kind)
) WITHOUT ROWID;

-- Telemetry. Counters, not events, and no user_id, on purpose.
CREATE TABLE page_view_daily (
  day      TEXT NOT NULL,
  path_key TEXT NOT NULL,
  authed   INTEGER NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path_key, authed)
) WITHOUT ROWID;

CREATE TABLE referrer_daily (
  day       TEXT NOT NULL,
  ref_class TEXT NOT NULL,
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, ref_class)
) WITHOUT ROWID;

CREATE TABLE crawler_view_daily (
  day   TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;
