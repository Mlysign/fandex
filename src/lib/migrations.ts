// ── D4: versioned migration runner ──────────────────────────────────────────
// Single source of truth for incremental schema changes, keyed on SQLite's
// PRAGMA user_version. Each migration runs once, in order, inside a transaction;
// after it succeeds user_version is bumped to its version number.
//
// Baseline: user_version 1 is the "norm_title backfill" baseline established by
// db.ts's inline NORM_VERSION step (it uses normalizeName(), app-only logic, so
// it stays inline). Every migration here is >= 2, and the SAME list is applied
// either in-process (via getDb()) or standalone against the live data/rr.db by
// scripts/migrate.mjs — no app-logic duplication.
//
// Rules:
//  - Prefer pure SQL. This file was originally "pure SQL only, no app imports" so
//    that plain `node` could load it; migration 7 (H2a) broke that rule to reuse
//    projectRawData(), and the standalone runner silently died on the `@/` alias
//    until scripts/alias-hooks.mjs taught Node to resolve it.
//    The rule is now: an app import is allowed ONLY when the alternative is
//    duplicating real app logic into a migration (projectRawData is ~200 lines
//    that must track normalize.ts; a frozen copy here would drift and re-project
//    the live catalog wrongly). Reaching for one means BOTH paths must still run,
//    so re-verify with `node scripts/migrate.mjs <copy-of-db>` — the in-process
//    path passing proves nothing about the standalone one. Keep imports leaf-like
//    and side-effect-free: pulling in a module that opens a DB or reads env at
//    import time will deadlock or crash the standalone runner.
//  - Idempotent where practical (IF NOT EXISTS / INSERT OR IGNORE) so a partial
//    apply can be safely retried.
//  - Expand-then-contract: add + backfill + switch reads → verify → (later) drop.
//    Never drop a column/table in the same migration that adds its replacement.

import type DatabaseT from "better-sqlite3";
import { projectRawData, PROJECTION_VERSION } from "@/lib/sources/project";
import { DEFAULT_SCORING_CONFIG, DEFAULT_TAG_CATEGORIES } from "@/lib/scoringDefaults";
import { createCacheViews } from "@/lib/cacheViews";
import { pickSlug } from "@/lib/publicUrl";
import type { Source } from "@/types";
type DB = DatabaseT.Database;

export interface Migration {
  version: number;
  name: string;
  up: (db: DB) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 2,
    name: "media_external_ids (D5)",
    up: (db) => {
      // Indexed cross-id table so the matcher does an indexed lookup instead of
      // JSON.parse-ing every candidate link's raw_data on the hot sync path.
      // `source` is the id NAMESPACE (a single link can contribute several, e.g.
      // a Trakt link carries both its trakt id and a tmdb id).
      db.exec(`
        CREATE TABLE IF NOT EXISTS media_external_ids (
          media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
          source TEXT NOT NULL,        -- trakt | tmdb | rawg | steam | igdb | letterboxd
          external_id TEXT NOT NULL,
          UNIQUE(media_item_id, source, external_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ext_lookup ON media_external_ids(source, external_id);
        CREATE INDEX IF NOT EXISTS idx_ext_item ON media_external_ids(media_item_id);
      `);

      // Backfill from existing links via json_extract. Mirrors extractCrossIds()
      // in matcher.ts (which remains the write-time source of truth). CAST to TEXT
      // so numeric ids compare equal to the String()-ified ids written at runtime.
      const insertNamespace = (linkSource: string, namespace: string, jsonPath: string) => {
        db.prepare(
          `INSERT OR IGNORE INTO media_external_ids (media_item_id, source, external_id)
           SELECT media_item_id, ?, CAST(json_extract(raw_data, ?) AS TEXT)
           FROM media_links
           WHERE source = ? AND json_extract(raw_data, ?) IS NOT NULL`
        ).run(namespace, jsonPath, linkSource, jsonPath);
      };
      insertNamespace("trakt", "trakt", "$.ids.trakt");
      insertNamespace("trakt", "tmdb", "$.ids.tmdb");
      insertNamespace("tmdb", "tmdb", "$.id");
      insertNamespace("rawg", "rawg", "$.id");
      insertNamespace("steam", "steam", "$.appid");
      insertNamespace("igdb", "igdb", "$.id");
      insertNamespace("letterboxd", "letterboxd", "$.id");
      // Letterboxd's embedded tmdb id lives in a links[] array; rare (provider
      // usually unconfigured) and captured at write time by extractCrossIds, so
      // it's intentionally not backfilled in pure SQL here.
    },
  },
  {
    version: 3,
    name: "user_item_state (D1 + D2)",
    up: (db) => {
      // Normalized, queryable per-source user state — one row per
      // (user, item, source, relation). Replaces JSON-in-a-column: wishlist
      // providers were a JSON array in user_watchlist.platform_sources, and
      // library per-source detail was a JSON blob in user_library.metadata.
      // This single table unifies wishlist + library (D2) and makes per-source
      // ratings/status SQL-queryable (D1). The user_watchlist / user_library
      // rows become caches REBUILT from this table on every write (matcher.ts),
      // so the canonical rating can no longer drift and "clear a rating"
      // propagates. Expand-then-contract: the cache tables are kept (reads still
      // hit them). Migration 16 is the contract step — they become VIEWS.
      //
      // These two CREATE TABLEs used to live in db.ts's schema block and moved
      // here with migration 16 (2026-08-17). This migration is the only thing
      // that still needs them as real tables: on a FRESH database it backfills
      // user_item_state FROM them, so they must exist before the two INSERTs
      // below. They cannot stay in db.ts, because that block re-runs on every
      // boot and would then be creating tables that shadow migration 16's views.
      // IF NOT EXISTS keeps this a no-op on every database that predates the move.
      db.exec(`
        CREATE TABLE IF NOT EXISTS user_watchlist (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
          platform_sources TEXT NOT NULL DEFAULT '[]',
          added_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          notes TEXT,
          UNIQUE(user_id, media_item_id)
        );
        CREATE INDEX IF NOT EXISTS idx_watchlist_user ON user_watchlist(user_id);

        CREATE TABLE IF NOT EXISTS user_library (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
          platform_sources TEXT NOT NULL DEFAULT '[]',
          status TEXT,
          rating REAL,
          review TEXT,
          reviewed_at INTEGER,
          metadata TEXT,
          added_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          UNIQUE(user_id, media_item_id)
        );
        CREATE INDEX IF NOT EXISTS idx_library_user ON user_library(user_id);
      `);

      db.exec(`
        CREATE TABLE IF NOT EXISTS user_item_state (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
          source TEXT NOT NULL,            -- trakt | tmdb | steam | rawg | ... | local
          relation TEXT NOT NULL,          -- wishlist | library
          status TEXT,                     -- library: watched | played | owned
          rating REAL,                     -- library: per-source 0-10 score
          review TEXT,
          reviewed_at INTEGER,
          added_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          UNIQUE(user_id, media_item_id, source, relation)
        );
        CREATE INDEX IF NOT EXISTS idx_uis_user_item ON user_item_state(user_id, media_item_id);
        CREATE INDEX IF NOT EXISTS idx_uis_user_rel ON user_item_state(user_id, relation);
        CREATE INDEX IF NOT EXISTS idx_uis_item ON user_item_state(media_item_id);
      `);

      // Backfill wishlist rows by expanding the platform_sources JSON array.
      db.prepare(`
        INSERT OR IGNORE INTO user_item_state (id, user_id, media_item_id, source, relation, added_at)
        SELECT lower(hex(randomblob(16))), w.user_id, w.media_item_id, je.value, 'wishlist', w.added_at
        FROM user_watchlist w, json_each(w.platform_sources) je
        WHERE w.platform_sources IS NOT NULL AND json_valid(w.platform_sources)
      `).run();

      // Backfill library rows by expanding the metadata JSON object (key = source).
      db.prepare(`
        INSERT OR IGNORE INTO user_item_state
          (id, user_id, media_item_id, source, relation, status, rating, review, reviewed_at, added_at)
        SELECT lower(hex(randomblob(16))), l.user_id, l.media_item_id, je.key, 'library',
               json_extract(je.value, '$.status'),
               json_extract(je.value, '$.rating'),
               json_extract(je.value, '$.review'),
               json_extract(je.value, '$.reviewedAt'),
               l.added_at
        FROM user_library l, json_each(l.metadata) je
        WHERE l.metadata IS NOT NULL AND json_valid(l.metadata)
      `).run();
    },
  },
  {
    version: 4,
    name: "child-FK indexes (D7)",
    up: (db) => {
      // Index the media_item_id FK on the user cache tables so reverse lookups +
      // ON DELETE CASCADE from media_items don't scan the whole table.
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_library_media ON user_library(media_item_id);
        CREATE INDEX IF NOT EXISTS idx_watchlist_media ON user_watchlist(media_item_id);
      `);
    },
  },
  {
    version: 5,
    name: "users.country (T22)",
    up: (db) => {
      // Profile country (ISO 3166-1 alpha-2) driving region-aware release dates +
      // streaming availability. NULL = not set → app falls back to US (the client
      // auto-detects from the browser and persists on first visit). SQLite has no
      // ADD COLUMN IF NOT EXISTS, so guard on the current columns for idempotency.
      const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "country")) {
        db.exec("ALTER TABLE users ADD COLUMN country TEXT");
      }
    },
  },
  {
    version: 6,
    name: "users.session_epoch (S4 session revocation)",
    up: (db) => {
      // Monotonic per-user token generation. Every JWT is minted carrying the
      // epoch current at sign time; getSession() rejects a token whose epoch is
      // behind the user's. Bumping it (logout / disconnect) instantly revokes
      // every outstanding token for that user. DEFAULT 0 = legacy tokens (which
      // carry no epoch, read as 0) stay valid until the first bump → non-breaking.
      const cols = db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "session_epoch")) {
        db.exec("ALTER TABLE users ADD COLUMN session_epoch INTEGER NOT NULL DEFAULT 0");
      }
    },
  },
  {
    version: 7,
    name: "media_links.projection_version + backfill (H2a)",
    up: (db) => {
      // H2a: raw_data stored the ENTIRE provider payload (~92KB/TMDB link,
      // ~94% of the DB) while the app reads a small fixed subset.
      // projectRawData() now trims at write time; this adds the version stamp
      // and re-projects what's already stored.
      //
      // 0 = "written before the projection existed" (a fat, unstamped blob).
      const cols = db.prepare("PRAGMA table_info(media_links)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "projection_version")) {
        db.exec("ALTER TABLE media_links ADD COLUMN projection_version INTEGER NOT NULL DEFAULT 0");
      }

      // Backfill by projecting the STORED blob in place — NO network. The fat
      // rows already contain everything the projection keeps, so this is a pure
      // local transform. That's what makes the migration safe to run against the
      // live volume: no provider calls, no rate limits, no partial-fetch risk.
      const rows = db
        .prepare(
          `SELECT ml.id, ml.source, ml.raw_data
             FROM media_links ml
            WHERE ml.projection_version < ?`
        )
        .all(PROJECTION_VERSION) as { id: string; source: string; raw_data: string }[];

      const upd = db.prepare(
        "UPDATE media_links SET raw_data = ?, projection_version = ? WHERE id = ?"
      );
      for (const r of rows) {
        let raw: unknown;
        try {
          raw = JSON.parse(r.raw_data);
        } catch {
          // Unparseable blob: stamp it so it isn't retried forever, but leave
          // the bytes alone rather than destroying data we can't read.
          upd.run(r.raw_data, PROJECTION_VERSION, r.id);
          continue;
        }
        const projected = JSON.stringify(projectRawData(r.source as Source, raw));
        upd.run(projected, PROJECTION_VERSION, r.id);
      }
    },
  },
  {
    version: 8,
    name: "media_items.browsed (H2b discover-persists provenance)",
    up: (db) => {
      // H2b — /discover now writes a media_items row for every item it returns,
      // so media_items stops being "the library" and becomes "library + ingested
      // pool + everything anyone browsed".
      //
      // The catalog surfaces (find / Best-match, Insights, searchTitles) and the
      // IDF weights read media_items and MUST NOT see the browsed tail: they'd
      // list titles the user never added and dilute facet rarity with whatever
      // happened to be popular this week.
      //
      // Membership (user_item_state) is the obvious filter and it is WRONG:
      // recommendIngest deliberately persists unowned titles "so the recommender
      // has a real pool to rank — not just the watchlist". Filtering on
      // membership would silently empty that pool. So the discriminator is
      // provenance — how the row got here — not who owns it.
      //
      // 0 = library / ingested / synced (the catalog pool). 1 = browsed only.
      // Every row that exists NOW predates discover-persist, so the DEFAULT 0
      // backfills them correctly with no data pass.
      const cols = db.prepare("PRAGMA table_info(media_items)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "browsed")) {
        db.exec("ALTER TABLE media_items ADD COLUMN browsed INTEGER NOT NULL DEFAULT 0");
      }
      // The pool query filters on this on every cache rebuild.
      db.exec("CREATE INDEX IF NOT EXISTS idx_media_items_browsed ON media_items(browsed)");
    },
  },
  {
    version: 9,
    name: "scoring_config + tag_category + tag_category_override (H5.1)",
    up: (db) => {
      // Fandex Score config core (docs/fandex-score.md §6). All three tables
      // are brand new, so — unlike migrations 5-8 — there is no pre-existing
      // column to guard: CREATE TABLE + its indexes can live together here,
      // same as migration 2 (media_external_ids).
      db.exec(`
        CREATE TABLE IF NOT EXISTS scoring_config (
          id INTEGER PRIMARY KEY CHECK (id = 1),  -- single-row config blob
          config TEXT NOT NULL,                   -- JSON: ScoringConfigValues
          version INTEGER NOT NULL DEFAULT 1,
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        CREATE TABLE IF NOT EXISTS tag_category (
          id TEXT PRIMARY KEY,           -- e.g. genre, setting, or a custom slug
          label TEXT NOT NULL,
          color TEXT NOT NULL,
          weight REAL NOT NULL DEFAULT 1,
          ignored INTEGER NOT NULL DEFAULT 0,      -- excluded from the score entirely
          sort_order INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );

        -- tag_key → category_id: backend reassignment wins over the code
        -- heuristic (categorizeTag() in tags.ts). D6: one shared taxonomy,
        -- used by both scoring and Insights.
        CREATE TABLE IF NOT EXISTS tag_category_override (
          tag_key TEXT PRIMARY KEY,
          category_id TEXT NOT NULL REFERENCES tag_category(id) ON DELETE CASCADE,
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tag_override_category ON tag_category_override(category_id);
      `);

      // Seed scoring_config with the values that mirror current live behavior
      // (discovery.ts's ROLE_WEIGHT + K_SHRINK) — this migration changes no
      // scoring output, only makes the numbers backend-editable later (H5.2+).
      db.prepare(
        `INSERT OR IGNORE INTO scoring_config (id, config, version) VALUES (1, ?, 1)`
      ).run(JSON.stringify(DEFAULT_SCORING_CONFIG));

      // Seed tag_category from tags.ts's CATEGORIES so the backend starts as a
      // faithful mirror of the hardcoded taxonomy — nothing regresses.
      const insertCat = db.prepare(
        `INSERT OR IGNORE INTO tag_category (id, label, color, weight, ignored, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const c of DEFAULT_TAG_CATEGORIES) {
        insertCat.run(c.id, c.label, c.color, c.weight, c.ignored ? 1 : 0, c.sortOrder);
      }
      // tag_category_override starts empty: no reassignments yet, so
      // categorizeTag()'s existing heuristics are the only source until the
      // taxonomy editor (H5.4) writes overrides here.
    },
  },
  {
    version: 10,
    name: "tag_alias: bundle synonym/misspelled tag spellings (H5.6)",
    up: (db) => {
      // Tag bundling: map member spellings (scifi, science fiction) → one
      // canonical key (sci fi) so scoring, Insights, the facet page and the
      // catalog vocab treat them as one tag with a combined average. Brand-new
      // table (like migration 9) — table + index together, no column guard.
      // Starts empty: canonicalTagKey() falls through to the raw key until the
      // taxonomy editor writes aliases here. Chains are flattened on write, so
      // canonical resolution is always a single lookup.
      db.exec(`
        CREATE TABLE IF NOT EXISTS tag_alias (
          alias_key     TEXT PRIMARY KEY,        -- member spelling, e.g. "scifi"
          canonical_key TEXT NOT NULL,           -- bundle canonical, e.g. "sci fi"
          updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tag_alias_canonical ON tag_alias(canonical_key);
      `);
    },
  },
  {
    version: 11,
    name: "tag_category.color: collapse the 9-hue palette onto the 4 facet-class colours",
    up: (db) => {
      // 2026-07-30: facets render in four gold-family colours chosen by facet
      // CLASS (src/lib/facetPalette.ts), so a per-category hex no longer drives
      // anything. Nothing READS this column for display any more — this exists
      // purely so an upgraded DB stores the same values a fresh one seeds from
      // tags.ts's CATEGORIES. Without it, `data/rr.db`'s nine rows would keep
      // the old green/amber/sky/teal/rose/violet/yellow/grey hexes forever and
      // the two DBs would disagree on a column an admin panel can still show.
      //
      // Pure SQL, no schema change, one small table. Any category an admin
      // created since H5.4 is covered by the same two rules (genre, or not).
      //
      // The hexes are written out rather than imported: facetPalette.ts is a
      // client-ish module (it exists to be imported by components) and the
      // standalone `node scripts/migrate.mjs` path must stay able to load this
      // file — see the app-import rule at the top. Keep in sync with
      // FACET_HEX.genre / FACET_HEX.tag.
      db.prepare(`UPDATE tag_category SET color = ?, updated_at = strftime('%s','now') WHERE id = 'genre'`).run("#C8A24B");
      db.prepare(`UPDATE tag_category SET color = ?, updated_at = strftime('%s','now') WHERE id <> 'genre'`).run("#AC9A72");
    },
  },
  {
    version: 12,
    name: "media_links.projection_version: pre-stamp non-TMDB rows to v3 (P18)",
    up: (db) => {
      // PROJECTION_VERSION went 2 → 3 (project.ts, P18): watch/providers now
      // keeps the per-region JustWatch `link` + which bucket won (`offerType`).
      // Only projectTmdb() changed — projectRawg/projectTrakt/projectIgdb/
      // projectSteam are untouched by v3.
      //
      // Deliberately NOT migration 7's shape. That one re-projects STORED
      // raw_data in place (JSON.parse + projectRawData + JSON.stringify per
      // row) because the v0→v2 jump changed what every source's projection
      // keeps. This jump only changed TMDB's, so re-running the same heavy
      // per-row transform on RAWG/IGDB/Steam/Trakt rows would cost real time
      // and WAL growth for a version bump those rows don't need — a smaller,
      // cheaper op is genuinely available here, migration 7 didn't have one.
      //
      // Instead: advance every non-TMDB row that is CURRENTLY AT v2 straight
      // to v3. Plain integer column, no JSON touched, no blob rewritten, no
      // network call. Rows at v2 have their source's full current projection
      // already stored (v3 didn't change their shape), so stamping them v3
      // is just "this row's projection is not behind" — the honest reading of
      // an explicit version stamp per H2a's design.
      //
      // Rows below v2 (0 or 1) are left untouched: they are genuinely stale
      // for an EARLIER reason and must keep refetching on next detail read.
      // TMDB rows at v2 are also left untouched: their v3 detail (the JustWatch
      // link + offerType) is not in the stored blob to recover locally — that's
      // exactly why ensureTmdbDetail's existing lazy, network-backed refetch
      // path is what heals them, one detail view at a time, not this migration.
      db.prepare(
        `UPDATE media_links SET projection_version = 3 WHERE source != 'tmdb' AND projection_version = 2`
      ).run();
    },
  },
  {
    version: 13,
    name: "ip_alias + item_ip_override: franchise bundling and per-item corrections",
    up: (db) => {
      // 2026-08-14. Two brand-new tables (like migrations 9 and 10) — table +
      // its own index together in this same migration, never split across two,
      // per the db.ts schema-block invariant.
      //
      // ip_alias mirrors tag_alias exactly, for the same reason: providers name
      // one franchise several ways ("metal gear solid" and "metal gear" arrive
      // as two facets with 5 rated titles each). Chains are flattened on write
      // so canonicalIpKey() is a single lookup.
      //
      // item_ip_override fixes the DATA, not the naming: TMDB has no collection
      // concept for shows and IGDB covers only games, so nothing links Andor to
      // Star Wars. An 'add' row attaches an item to a franchise; a 'remove' row
      // detaches a wrong one. Deliberately GLOBAL, not user-scoped — it corrects
      // catalog metadata, exactly like tag_category_override.
      //
      // ⚠️ It must NOT gain a `user_id` column. That column name is what
      // account erasure keys on (src/lib/account.ts reads sqlite_master for it),
      // so naming one here would make GDPR deletion drop everyone's franchise
      // corrections. Nothing personal belongs in this table.
      db.exec(`
        CREATE TABLE IF NOT EXISTS ip_alias (
          alias_key     TEXT PRIMARY KEY,        -- member spelling, e.g. "metal gear solid"
          canonical_key TEXT NOT NULL,           -- bundle canonical, e.g. "metal gear"
          updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
        CREATE INDEX IF NOT EXISTS idx_ip_alias_canonical ON ip_alias(canonical_key);

        CREATE TABLE IF NOT EXISTS item_ip_override (
          media_item_id TEXT NOT NULL,
          ip_key        TEXT NOT NULL,           -- normalized via ipKey()
          label         TEXT NOT NULL,           -- display label for an 'add'
          mode          TEXT NOT NULL,           -- 'add' | 'remove'
          updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          PRIMARY KEY (media_item_id, ip_key)
        );
        CREATE INDEX IF NOT EXISTS idx_item_ip_override_item ON item_ip_override(media_item_id);
        CREATE INDEX IF NOT EXISTS idx_item_ip_override_key ON item_ip_override(ip_key);
      `);
    },
  },
  {
    version: 14,
    name: "item_ip_override.source + media_item.wikidata sweep cursor",
    up: (db) => {
      // 2026-08-14. Wikidata can now attach a franchise automatically, which
      // makes provenance load-bearing: a hand-made attachment must survive a
      // re-sweep, and a machine one must be refreshable without asking. Rows
      // written before this column existed are by definition hand-made, which
      // is exactly what the DEFAULT encodes.
      //
      // Column-added-by-migration → its index belongs in THIS migration, never
      // in db.ts's schema block, which must stay valid against the old schema.
      const cols = db.prepare(`PRAGMA table_info(item_ip_override)`).all() as { name: string }[];
      if (!cols.some((c) => c.name === "source")) {
        db.exec(`ALTER TABLE item_ip_override ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS idx_item_ip_override_source ON item_ip_override(source)`);

      // Which items the Wikidata sweep has already asked about, so a resumable
      // pass never re-asks. A row here means ASKED, not FOUND — the distinction
      // is the whole reason this table exists rather than driving the sweep off
      // "what's still missing a franchise", which never terminates because the
      // items Wikidata doesn't know stay missing forever. Same trap SM48's
      // cross-link backfill hit.
      db.exec(`
        CREATE TABLE IF NOT EXISTS wikidata_ip_checked (
          media_item_id TEXT PRIMARY KEY,
          found         INTEGER NOT NULL DEFAULT 0,
          checked_at    INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
      `);
    },
  },
  {
    version: 15,
    name: "show_seasons + show_episodes + user_episode_state (MB14 episode tracking)",
    up: (db) => {
      // 2026-08-16, MB14. Three brand-new tables — each with its own indexes in
      // THIS migration, never in db.ts's schema block, which runs first and must
      // stay valid against a pre-migration schema.
      //
      // Two of them are CATALOG (shared, viewer-independent, filled lazily from
      // TMDB on a detail view — P18's precedent, never a full-catalog op) and
      // one is PERSONAL.
      //
      // ⚠️ The personal table's owning column is literally named `user_id`, and
      // that spelling is load-bearing: deleteAccount() finds its targets by
      // reading sqlite_master for that exact column name, so `owner_id` would
      // make GDPR erasure silently skip every user's watch history with the
      // whole test suite still green → [[account-erasure-and-export]]. The
      // mirror-image rule holds for the two catalog tables: they must NOT gain
      // a `user_id`, or erasure would delete shared catalog rows.
      db.exec(`
        CREATE TABLE IF NOT EXISTS show_seasons (
          media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
          season_number INTEGER NOT NULL,
          name          TEXT,
          episode_count INTEGER NOT NULL DEFAULT 0,
          air_date      TEXT,
          poster_url    TEXT,
          overview      TEXT,
          updated_at    INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          PRIMARY KEY (media_item_id, season_number)
        );
        CREATE INDEX IF NOT EXISTS idx_show_seasons_item ON show_seasons(media_item_id);

        CREATE TABLE IF NOT EXISTS show_episodes (
          media_item_id   TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
          season_number   INTEGER NOT NULL,
          episode_number  INTEGER NOT NULL,
          title           TEXT,
          air_date        TEXT,
          runtime_minutes INTEGER,
          overview        TEXT,
          still_url       TEXT,
          updated_at      INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          PRIMARY KEY (media_item_id, season_number, episode_number)
        );
        CREATE INDEX IF NOT EXISTS idx_show_episodes_season
          ON show_episodes(media_item_id, season_number);

        -- One row per episode the user has watched. ABSENCE is "not watched" —
        -- there is deliberately no watched=0 row, so the table stays proportional
        -- to what someone actually watched rather than to the catalog.
        --
        -- The sources column mirrors user_library.platform_sources: the JSON
        -- array of providers holding this state. It lets the Trakt pull prune
        -- ONLY the rows Trakt is responsible for and leave a purely local mark
        -- alone (see syncProvider's reconcile).
        CREATE TABLE IF NOT EXISTS user_episode_state (
          user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          media_item_id  TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
          season_number  INTEGER NOT NULL,
          episode_number INTEGER NOT NULL,
          watched_at     INTEGER,
          sources        TEXT NOT NULL DEFAULT '["local"]',
          updated_at     INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          PRIMARY KEY (user_id, media_item_id, season_number, episode_number)
        );
        CREATE INDEX IF NOT EXISTS idx_user_episode_state_user
          ON user_episode_state(user_id);
        CREATE INDEX IF NOT EXISTS idx_user_episode_state_item
          ON user_episode_state(user_id, media_item_id);
      `);
    },
  },
  {
    version: 16,
    name: "user_library + user_watchlist become views (D2 expand-then-CONTRACT)",
    up: (db) => {
      // 2026-08-17. Migration 3 normalized per-source user state into
      // user_item_state and promised a contract step it never took: for a year
      // the two older tables carried a DUPLICATE of that state, rebuilt on every
      // write by matcher.ts's rebuildCaches, audited for drift on every boot by
      // dbSize.ts. This is that step. Both become views derived from
      // user_item_state, so the drift they were watched for stops being absent
      // and starts being impossible. rebuildCaches is deleted in the same commit.
      //
      // Every read site keeps working untouched — that is the point of doing it
      // as views rather than rewriting eighteen queries. Proof it is lossless:
      // `node scripts/verify-cache-views.mjs data/rr.db` diffs view output against
      // the real stored rows column by column. It was byte-exact on all 2,017
      // rows of the live database, added_at included, at zero tolerance.
      //
      // ⚠️ TWO THINGS A FUTURE SESSION NEEDS TO KNOW
      //
      // 1. A CODE-ONLY ROLLBACK DOES NOT WORK. Reverting the app to a commit
      //    that still calls rebuildCaches leaves it issuing INSERT/UPDATE/DELETE
      //    against a view — SQLite answers "cannot modify user_library because it
      //    is a view" and every library write fails. To roll back you must also
      //    turn the views back into tables, which is lossless and quick:
      //      CREATE TABLE ul_new AS SELECT * FROM user_library;   -- view -> rows
      //      DROP VIEW user_library; ALTER TABLE ul_new RENAME TO user_library;
      //    (plus the UNIQUE/index rebuild, and the same for user_watchlist).
      //    Forward is normally the cheaper fix: user_item_state still holds
      //    everything, so a wrong view is one CREATE VIEW away from correct.
      //
      // 2. NEVER INDEX THESE NAMES AGAIN. `CREATE TABLE IF NOT EXISTS` over a
      //    view is a silent no-op, but `CREATE INDEX IF NOT EXISTS` over one
      //    throws `views may not be indexed`. db.ts's schema block re-runs on
      //    EVERY boot before migrations, so the two index statements it used to
      //    carry would have let this migration succeed and then stopped the app
      //    from starting on the next restart — a green deploy followed by a dead
      //    one. They were removed from db.ts and the CREATE TABLEs moved into
      //    migration 3, which is the only thing that still needs real tables.
      createCacheViews(db);
    },
  },
  {
    version: 17,
    name: "page_view_daily + referrer_daily (self-hosted traffic telemetry)",
    up: (db) => {
      // 2026-08-19. The H3.8 thresholds (10,000 pageviews/mo for ads, 3,500
      // sustained WAU for freemium) were set in July against a schema that
      // could measure neither. This is the meter for the first one; the second
      // is already derivable from users.last_seen_at + the write tables, so it
      // needs no storage of its own.
      //
      // ── PRE-AGGREGATED, NEVER RAW EVENTS ────────────────────────────────
      //
      // The obvious shape is one row per pageview. That is exactly the shape
      // that took prod down on 2026-07-22: unbounded row growth against a
      // synchronous single-file SQLite, 2,487 MB before anyone noticed. So
      // these are COUNTERS: one row per (day, dimension), incremented by an
      // UPSERT. Cardinality is bounded by the dimension sets, not by traffic:
      // ~40 templated path keys x 2 auth states x 365 days is under 30k rows a
      // year at any traffic level, and a viral week costs the same bytes as a
      // dead one.
      //
      // `path_key` is a TEMPLATE ("/tag/[slug]"), never a raw path. Raw paths
      // would make cardinality unbounded (one row per tag slug per day) and
      // would turn an aggregate counter into something closer to a visit log.
      // normalizePathKey() in src/lib/telemetry.ts is the only writer.
      //
      // ── DELIBERATELY NOT PERSONAL DATA ──────────────────────────────────
      //
      // No user_id, no IP, no session id, no timestamp finer than a UTC day.
      // Three consequences, all of them wanted:
      //   * account erasure (src/lib/account.ts) finds its targets by looking
      //     for a column literally named `user_id`, so these tables are
      //     correctly invisible to it. There is nothing personal in them to
      //     erase, and a deleted account must not retroactively rewrite last
      //     month's traffic total;
      //   * /api/account/export needs no new block for the same reason;
      //   * neither table references media_items, so dbPrune.ts's
      //     PRUNABLE_WHERE does not need extending (that list is about rows
      //     that cascade off a catalog row; these don't).
      // The `authed` flag is a 0/1 count dimension, not an identity.
      //
      // Both PKs lead with `day`, which is also the only range any read filters
      // on, so the implicit PK index serves every query the dashboard makes and
      // no secondary index is needed.
      db.exec(`
        CREATE TABLE IF NOT EXISTS page_view_daily (
          day      TEXT    NOT NULL,             -- 'YYYY-MM-DD', UTC
          path_key TEXT    NOT NULL,             -- templated route, see above
          authed   INTEGER NOT NULL,             -- 0 = anonymous, 1 = signed in
          count    INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (day, path_key, authed)
        );
        CREATE TABLE IF NOT EXISTS referrer_daily (
          day       TEXT    NOT NULL,            -- 'YYYY-MM-DD', UTC
          ref_class TEXT    NOT NULL,            -- search|social|internal|direct|other
          count     INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (day, ref_class)
        );
      `);
    },
  },
  {
    version: 18,
    name: "recreate the cache views without aggregate ORDER BY (unbreaks Litestream)",
    up: (db) => {
      // 2026-08-19, and this one is a production incident, not a feature.
      //
      // Migration 16 wrote `json_group_array(source ORDER BY source)` into the
      // user_watchlist view. ORDER BY inside an aggregate's argument list is
      // SQLite **3.44.0+** syntax (released 2023-11-01). better-sqlite3 ships
      // 3.53, so the app never noticed. **Litestream v0.3.13 embeds ~3.40.**
      //
      // SQLite parses the WHOLE schema before preparing ANY statement, so from
      // the moment migration 16 landed on prod (2026-08-17) every Litestream
      // call failed with `malformed database schema (user_watchlist) - near
      // "ORDER": syntax error`, once a second, and NOTHING replicated for two
      // days. Railway volume backups are Pro-plan only, so that was the only
      // copy of the database. It is also why the 340 MB WAL would not truncate:
      // Litestream could not advance its read position, so SQLite could not
      // checkpoint past it, which had been misread as a benign high-water mark.
      //
      // The app stayed green throughout — 820 tests, `db: up` on /api/health,
      // every read site working — because the only process that could not parse
      // the schema was the backup daemon, and it reports into a log nobody
      // watches.
      //
      // This migration exists at all because migration 16 has ALREADY RUN on
      // prod (user_version is past it), so fixing cacheViews.ts alone changes
      // nothing there. The view bodies live in one module, so this just replays
      // createCacheViews over the existing views; it is idempotent by
      // construction and drops-by-actual-type, so re-running is safe.
      //
      // Verified before shipping, not after: byte-identical output on all 2,023
      // rows of the live DB (96 wishlist + 1,927 library), and a real SQLite
      // 3.40 CLI reads the resulting file, both views, `PRAGMA integrity_check`
      // and `PRAGMA wal_checkpoint` — where the same CLI could not so much as
      // count `users` against the old schema.
      createCacheViews(db);
    },
  },
  {
    version: 19,
    name: "media_items.slug: the public url address segment",
    up: (db) => {
      // 2026-08-21. The public item url was `/{type}/{uuid}/{cosmetic-slug}`,
      // and the uuid is a ROW id: the boot prune deletes browsed-only rows on
      // every deploy, so re-opening such a title minted a new row, a new uuid
      // and a new url, leaving the old one a hard 404. Nils hit it twice in one
      // afternoon on the same film. A stored, title-derived slug is stable
      // across that delete-and-recreate, because it names the work rather than
      // our storage — see publicUrl.ts.
      //
      // Column guarded (db.ts's schema block declares it too, for a fresh DB),
      // index created HERE and only here.
      const cols = db.prepare("PRAGMA table_info(media_items)").all() as { name: string }[];
      if (!cols.some((c) => c.name === "slug")) {
        db.exec("ALTER TABLE media_items ADD COLUMN slug TEXT");
      }

      // Backfill. Order is load-bearing twice over: `browsed ASC` gives the bare
      // slug to a real catalog item rather than to a title someone scrolled
      // past (both Draculas want `dracula`; the pooled one should win it), and
      // created_at/id make the whole assignment deterministic, so a re-run on a
      // copy of the database produces byte-identical slugs.
      //
      // `taken` is built once in memory instead of querying per row: 2,570 rows
      // on the live catalog, and the unique index doesn't exist yet to make
      // those lookups cheap.
      const taken = new Set(
        (db.prepare("SELECT type, slug FROM media_items WHERE slug IS NOT NULL").all() as { type: string; slug: string }[])
          .map((r) => r.type + "/" + r.slug)
      );
      // The COALESCE mirrors ensureItemSlug exactly, and it has to: the year is
      // the collision tie-break, and a thin first write leaves media_items.
      // release_date null while the LINK row has the date. If the two paths
      // disagreed, a row backfilled here as `nosferatu-1` would come back as
      // `nosferatu-2024` the next time it was pruned and re-created, which is
      // the exact url churn this migration exists to end.
      const rows = db.prepare(
        `SELECT mi.id, mi.type, mi.title,
                COALESCE(mi.release_date, (SELECT MIN(ml.release_date) FROM media_links ml
                                            WHERE ml.media_item_id = mi.id AND ml.release_date IS NOT NULL)) AS release_date
           FROM media_items mi
          WHERE mi.slug IS NULL
          ORDER BY mi.browsed ASC, mi.created_at ASC, mi.id ASC`
      ).all() as { id: string; type: string; title: string; release_date: string | null }[];
      const upd = db.prepare("UPDATE media_items SET slug = ? WHERE id = ?");
      for (const r of rows) {
        const slug = pickSlug(r.title, r.release_date, (c) => taken.has(r.type + "/" + c));
        taken.add(r.type + "/" + slug);
        upd.run(slug, r.id);
      }

      // Unique per TYPE, not globally: a movie and a game can both be
      // `spider-man` because the type is a separate url segment. Created after
      // the backfill — before it the column is all NULLs, which a unique index
      // permits any number of, so the order only matters for speed.
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_media_items_type_slug ON media_items(type, slug)");
    },
  },
  {
    version: 20,
    name: "import staging + imdb pseudo-source links (PL4)",
    up: (db) => {
      // PL4, 2026-08-23. Two tables' worth of groundwork for the list import.
      //
      // 1. IMDB AS A PSEUDO-SOURCE.
      //
      // An IMDb CSV carries a tconst, which is the only hard id either import
      // format gives us, and imdbId already lives inside the tmdb/trakt rows'
      // raw_data rather than anywhere indexed. Rather than adding a column and
      // an index, an `imdb` row in media_links fits the EXISTING
      // UNIQUE(source, source_id) and idx_links_source, so the lookup is one
      // indexed query with no new schema at all.
      //
      // Backfilled here from what we already hold. json_extract over two shapes:
      // TMDB nests it under external_ids, Trakt under ids.
      //
      // ⚠️ ORDER BY stays out of any aggregate argument list in this file
      // FOREVER (migration 18's incident). Nothing here aggregates, but the rule
      // is why this uses plain INSERT ... SELECT.
      db.exec(`
        INSERT OR IGNORE INTO media_links (id, media_item_id, source, source_id, title, release_date, raw_data)
        SELECT
          lower(hex(randomblob(16))),
          l.media_item_id,
          'imdb',
          imdb_id,
          NULL, NULL, '{}'
        FROM (
          SELECT
            media_item_id,
            COALESCE(
              json_extract(raw_data, '$.external_ids.imdb_id'),
              json_extract(raw_data, '$.imdb_id'),
              json_extract(raw_data, '$.ids.imdb')
            ) AS imdb_id
          FROM media_links
          WHERE source IN ('tmdb','trakt')
        ) AS l
        WHERE l.imdb_id IS NOT NULL AND l.imdb_id LIKE 'tt%'
      `);

      // 2. THE PRE-SIGNUP STAGING TABLE.
      //
      // Nils approved importing BEFORE an account exists (2026-08-23): drop the
      // archive, see the matched films, then sign up to keep them. So the parsed
      // result has to live somewhere between those two moments, and that
      // somewhere is written on a request path by anonymous strangers.
      //
      // ⚠️ That is precisely the shape that grew facet_page_cache to 222 MB, so
      // this table is bounded three ways from the start rather than after an
      // incident: a byte ceiling per row (enforced in the route), a row ceiling
      // and an interval sweep (both in importStaging.ts, NOT boot-only, because
      // prod runs for days), and eviction by WRITE time.
      //
      // ⚠️ It deliberately has NO user_id. It holds data for somebody who has no
      // account yet, so account erasure cannot cover it by construction
      // (deleteAccount finds tables by a literal user_id column). The TTL is the
      // only thing protecting these rows, which makes the sweep a correctness
      // requirement rather than housekeeping. It is also why nothing here is a
      // catalog write: staging stores the PARSE, not media_items rows.
      db.exec(`
        CREATE TABLE IF NOT EXISTS import_staging (
          token       TEXT PRIMARY KEY,
          source      TEXT NOT NULL,
          payload     TEXT NOT NULL,
          row_count   INTEGER NOT NULL DEFAULT 0,
          byte_size   INTEGER NOT NULL DEFAULT 0,
          created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        )
      `);
      // Evicting by write time is the whole point, so this is the index the
      // sweep uses. Tracking READ time would turn every hit into a write, which
      // is the shape that caused the facet_page_cache growth.
      db.exec("CREATE INDEX IF NOT EXISTS idx_import_staging_created ON import_staging(created_at)");
    },
  },
  {
    version: 21,
    name: "home_snapshot: the daily, crawler-safe home page (SEO)",
    up: (db) => {
      // 2026-08-26. Home's public rails were a client island fetching
      // `/api/home`, and `/api/` is under the robots Disallow. Googlebot's
      // renderer honours robots.txt for subresources, so it is not that those
      // links were *probably* missed. The renderer was blocked from fetching
      // the data that would produce them. Every poster on `/` was invisible to
      // search by construction, on the highest-authority url on the domain.
      //
      // The fix is Nils's design: build the whole public home page ONCE A DAY on
      // the server, store it, and serve every visitor (and every crawler) out of
      // the table. One provider fan-out per day instead of one per cold cache
      // entry, and a crawler causes none at all.
      //
      // ⚠️ ONE ROW PER REGION, replaced in place. This table is written off a
      // schedule and read on the busiest page in the app, which is the exact
      // pair of properties that grew `facet_page_cache` to 222.8 MB, so it is
      // bounded by its PRIMARY KEY rather than by a sweep. `INSERT OR REPLACE`
      // cannot add a row for a region that already has one, so there is no
      // growth curve to get wrong and no timer to forget. Today exactly one
      // region is ever written (DEFAULT_COUNTRY); the column exists so adding a
      // second needs no migration.
      db.exec(`
        CREATE TABLE IF NOT EXISTS home_snapshot (
          region     TEXT PRIMARY KEY,
          day        TEXT NOT NULL,
          built_at   INTEGER NOT NULL,
          payload    TEXT NOT NULL
        )
      `);

      // ⚠️ THE PRUNE INVARIANT, in its "new table referencing media_items" form.
      //
      // The snapshot links to catalog rows, and the titles it links are exactly
      // the ones the boot prune deletes: provider trending/upcoming arrive as
      // thin `browsed = 1` writes that nobody has acted on. Without this the
      // next deploy would cascade away the rows `/` points at and leave the
      // homepage serving 404s to the crawler we built it for.
      //
      // The ids live here as real rows rather than inside the payload JSON so
      // `PRUNABLE_WHERE` can name this table in the same plain `id NOT IN
      // (SELECT ...)` shape as the other three, instead of reaching into a blob.
      // Rewritten with each snapshot, so it holds ~30 rows and pins nothing once
      // a title drops off the page.
      db.exec(`
        CREATE TABLE IF NOT EXISTS home_snapshot_item (
          media_item_id TEXT PRIMARY KEY
        )
      `);
    },
  },
  {
    version: 22,
    name: "calendar_snapshot: the daily month cache (SEO + provider cost)",
    up: (db) => {
      // 2026-08-26, the same treatment migration 21 gave the home page, applied
      // to the calendar (Nils: "can we apply the same logic to the calendar
      // page?").
      //
      // What it replaces: `popularForMonth` fanned out to TMDB, RAWG and IGDB
      // per month, per region, behind a 6 h IN-MEMORY cache. Three problems with
      // that, and only the first is the one you notice.
      //
      //   1. Paging the calendar waits on a provider fan-out. Measured cold:
      //      1.24 s for one month.
      //   2. The cache dies on every deploy, and prod deploys often, so "cached"
      //      overstates it (docs/scalability.md 3.6).
      //   3. `/calendar/{YYYY-MM}` is PUBLIC, crawlable and in the sitemap, and
      //      it persists with a null user by design, so any title we do not
      //      already hold renders with no href at all. Measured on 2026-09:
      //      8 of 15 items linkable. The other 7 were dead text on an indexed
      //      page.
      //
      // ONE ROW PER MONTH, not one row for the whole window, and that is an
      // access-pattern decision rather than a stylistic one: every consumer wants
      // exactly one month, and a single blob would mean parsing ~1.2 MB to serve
      // 103 KB of it.
      //
      // The in-memory cache stays IN FRONT of this table. The table is what
      // removes the provider call and survives a deploy; the cache is what
      // avoids re-parsing a 103 KB payload on every request. Neither replaces
      // the other.
      db.exec(`
        CREATE TABLE IF NOT EXISTS calendar_snapshot (
          region     TEXT NOT NULL,
          month      TEXT NOT NULL,
          built_at   INTEGER NOT NULL,
          payload    TEXT NOT NULL,
          PRIMARY KEY (region, month)
        )
      `);

      // WHY THIS ONE NEEDS A SWEEP AND home_snapshot DOES NOT.
      //
      // `home_snapshot` is keyed by region alone, so INSERT OR REPLACE makes
      // growth structurally impossible. This one is keyed by region AND month,
      // and the window SLIDES: every month that passes retires one key and mints
      // another, so without an explicit delete the table gains a row a month
      // forever. That is a slow version of exactly the shape that grew
      // facet_page_cache to 222.8 MB. `buildCalendarSnapshot` deletes everything
      // outside its window on every run, and a test asserts it.
      db.exec("CREATE INDEX IF NOT EXISTS idx_calendar_snapshot_month ON calendar_snapshot(month)");

      // The prune pin, same role as home_snapshot_item and for the same reason:
      // the month pages link provider titles that arrive `browsed = 1` with
      // nobody acting on them, which is precisely what the boot prune deletes.
      // A separate table rather than a shared one so `PRUNABLE_WHERE` keeps
      // naming its protections one by one instead of reasoning about which
      // surface a row came from.
      db.exec(`
        CREATE TABLE IF NOT EXISTS calendar_snapshot_item (
          media_item_id TEXT PRIMARY KEY
        )
      `);
    },
  },
  {
    version: 23,
    name: "media_links.media_type: a provider id is only unique WITHIN a media type (SM50)",
    up: (db) => {
      // WHAT WAS WRONG. `media_links` was UNIQUE(source, source_id), which reads
      // as "a provider id names one work". For Trakt and TMDB it does not: both
      // number movies and shows in SEPARATE sequences, so trakt movie 386
      // (Being John Malkovich) and trakt show 386 (SpongeBob SquarePants) are
      // two different works with the same (source, source_id).
      //
      // matcher.ts's first step is "if this exact source link already exists,
      // update it", looked up on that pair alone. So the SpongeBob pull found
      // the film's link row, took its media_item_id, and overwrote the row's
      // payload — which merged the show's genres, certification and official
      // site into the FILM's projection, and filed 182 episode-watch rows
      // against a movie. Two more pairs did the same (House of Cards →
      // Ratatouille, Legion → The Raid 2). The show rows exist and are correct;
      // they simply have no Trakt link, because the movie is holding it.
      //
      // Nothing caught it. findMatchingItem() type-filters properly, the UI's
      // type guard held (the movie page renders no episode UI despite the rows),
      // tsc and 1,049 tests passed, and the only visible symptom was an
      // "Official site" link to spongebob.nick.com on a public movie page.
      //
      // THE FIX is to say what is actually true in the key: uniqueness is per
      // (source, source_id, media_type). SQLite cannot alter a table-level
      // UNIQUE in place, so this is the standard 12-step rebuild. Cheap: 6,912
      // rows, and nothing in sqlite_master references media_links but its own
      // two indexes (checked before writing this).
      //
      // The bad rows are NOT repaired here. A migration must not decide which of
      // two real works a user's watch history belongs to — that is a data call,
      // and it lives in scripts/repair-cross-type-links.mjs where it can be run
      // against a copy first and print what it would do.
      const cols = db.pragma("table_info(media_links)") as { name: string }[];
      if (cols.some((c) => c.name === "media_type")) return; // fresh DB: db.ts already built the new shape

      // ⚠️ legacy_alter_table, and why it is not optional here. Since SQLite
      // 3.25 an `ALTER TABLE … RENAME TO` re-parses EVERY view and trigger in
      // the schema so it can rewrite references to the old name. If any view is
      // unresolvable at that moment the rename throws — and this schema carries
      // `user_watchlist` / `user_library`, which are VIEWS over `user_item_state`
      // (migration 16). That table is created by db.ts's boot block, not by a
      // migration, so on any path that runs migrations WITHOUT that block (the
      // upgrade test, and anything standalone that grows one) the rename dies on
      // "error in view user_watchlist: no such table: user_item_state" — a
      // failure with nothing to do with media_links. This pragma is SQLite's own
      // escape hatch for the 12-step rebuild: rename the table only, touch no
      // view. Nothing references media_links by name anyway.
      const legacy = db.pragma("legacy_alter_table", { simple: true });
      db.pragma("legacy_alter_table = ON");
      try {
      db.exec(`
        CREATE TABLE media_links_v23 (
          id TEXT PRIMARY KEY,
          media_item_id TEXT NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
          source TEXT NOT NULL,
          source_id TEXT NOT NULL,
          media_type TEXT NOT NULL,
          title TEXT,
          release_date TEXT,
          raw_data TEXT NOT NULL,
          last_synced INTEGER NOT NULL DEFAULT (strftime('%s','now')),
          projection_version INTEGER NOT NULL DEFAULT 0,
          UNIQUE(source, source_id, media_type)
        );

        INSERT INTO media_links_v23
          (id, media_item_id, source, source_id, media_type, title, release_date, raw_data, last_synced, projection_version)
        SELECT l.id, l.media_item_id, l.source, l.source_id, m.type,
               l.title, l.release_date, l.raw_data, l.last_synced, l.projection_version
          FROM media_links l JOIN media_items m ON m.id = l.media_item_id;

        DROP TABLE media_links;
        ALTER TABLE media_links_v23 RENAME TO media_links;

        CREATE INDEX IF NOT EXISTS idx_links_item ON media_links(media_item_id);
        CREATE INDEX IF NOT EXISTS idx_links_source ON media_links(source, source_id);
      `);
      } finally {
        db.pragma(`legacy_alter_table = ${legacy ? "ON" : "OFF"}`);
      }
      // The JOIN above drops any link whose media_item is already gone. That can
      // only be a row the ON DELETE CASCADE failed to take (an old pre-FK write);
      // keeping it would break the NOT NULL media_type with nothing to fill it.
    },
  },
];


// Apply all pending migrations (version > current user_version), each in its own
// transaction, bumping user_version as it goes. Returns the versions applied.
export function runMigrations(db: DB): number[] {
  const current = db.pragma("user_version", { simple: true }) as number;
  const applied: number[] = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    const tx = db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    });
    tx();
    applied.push(m.version);
  }
  return applied;
}
