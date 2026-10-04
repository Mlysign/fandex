// The on-device database. One SQLite file, opened once by <SQLiteProvider> in
// the root layout; everything else reaches it through useSQLiteContext().
//
// What lives here is the device's COPY of two things the Worker owns: the
// scoring pool (so search, browse and the Fandex Score work with no network)
// and, later, the signed-in user's rows. Neither is the source of truth. The
// whole file can be deleted and the next sync rebuilds it.
//
// The Up Next widget will read this same file from Kotlin, which is the reason
// it is SQLite and not a JSON blob in key-value storage.

import type { SQLiteDatabase } from 'expo-sqlite';

export const DATABASE_NAME = 'fandex.db';

/**
 * The newest step below. Bump it IN THE SAME EDIT that adds the step, and never
 * edit a step that has shipped.
 */
const SCHEMA_VERSION = 3;

export async function migrate(db: SQLiteDatabase): Promise<void> {
  // Two connections write this file: the app's, and the one the widget's
  // background tick opens (headless.ts). Without a wait, a write that meets the
  // other's transaction fails at once with "database is locked", and a tick
  // that has already reached Trakt would then report failure. Set on every
  // open, before anything else, because it is per connection.
  await db.execAsync('PRAGMA busy_timeout = 8000');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  if (version >= SCHEMA_VERSION) return;

  if (version < 1) {
    await db.execAsync(`
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS catalog (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        norm_title TEXT NOT NULL,
        slug TEXT,
        poster_url TEXT,
        release_date TEXT,
        year INTEGER,
        community_score INTEGER,
        community_votes INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER NOT NULL,
        vector TEXT NOT NULL,
        facets TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_catalog_type_votes ON catalog(type, community_votes DESC);
      CREATE INDEX IF NOT EXISTS idx_catalog_norm ON catalog(norm_title);

      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `);
    await stamp(db, (version = 1));
  }

  if (version < 2) {
    // The signed-in user's rows, as the Worker holds them. A copy: the Worker is
    // the truth, and stateSync.ts replaces these wholesale when they differ.
    // No user id column. One device holds one account's rows, and signing out
    // empties these tables.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS item_state (
        media_item_id TEXT NOT NULL,
        source TEXT NOT NULL,
        relation TEXT NOT NULL,
        status TEXT,
        rating REAL,
        review TEXT,
        reviewed_at INTEGER,
        added_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (media_item_id, source, relation)
      );
      CREATE INDEX IF NOT EXISTS idx_item_state_relation ON item_state(relation, added_at DESC);

      CREATE TABLE IF NOT EXISTS episode_state (
        media_item_id TEXT NOT NULL,
        season INTEGER NOT NULL,
        episode INTEGER NOT NULL,
        watched_at INTEGER,
        sources TEXT NOT NULL,
        PRIMARY KEY (media_item_id, season, episode)
      );

      CREATE TABLE IF NOT EXISTS hidden_item (
        media_item_id TEXT PRIMARY KEY NOT NULL,
        hidden_at INTEGER NOT NULL
      );
    `);
    await stamp(db, (version = 2));
  }

  if (version < 3) {
    // What Trakt says is next for each show you are part way through. One row
    // per show that has been asked about; a null season means "caught up".
    // `watched_count` is how many of the show's episodes were ticked when Trakt
    // was asked, so a tick since then is what makes the row stale.
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS up_next (
        media_item_id TEXT PRIMARY KEY NOT NULL,
        season INTEGER,
        episode INTEGER,
        title TEXT,
        aired_at INTEGER,
        last_watched_at INTEGER,
        watched_count INTEGER NOT NULL,
        checked_at INTEGER NOT NULL
      );
    `);
    await stamp(db, (version = 3));
  }
}

/**
 * Record that a step has run. Called by the step itself, with its own number.
 *
 * ⚠️ Never stamp SCHEMA_VERSION at the end of migrate(). The first version of
 * this file did, and a build that had the constant bumped but not yet the step
 * (a hot reload between two saves was enough) marked the database as version 2
 * without creating a single table. Every later start then skipped the step and
 * every query on the missing tables failed. A version number has to mean "this
 * step ran", which only the step can know.
 */
async function stamp(db: SQLiteDatabase, version: number): Promise<void> {
  await db.execAsync(`PRAGMA user_version = ${version}`);
}

export async function getMeta(db: SQLiteDatabase, key: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM meta WHERE key = ?', [key]);
  return row?.value ?? null;
}

export async function setMeta(db: SQLiteDatabase, key: string, value: string): Promise<void> {
  await db.runAsync(
    'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

// ── Catalog reads ────────────────────────────────────────────────────────────

export interface CatalogRow {
  id: string;
  type: 'game' | 'movie' | 'show';
  title: string;
  slug: string | null;
  poster_url: string | null;
  release_date: string | null;
  year: number | null;
  community_score: number | null;
  community_votes: number;
}

const CARD_COLUMNS = 'id, type, title, slug, poster_url, release_date, year, community_score, community_votes';

export async function catalogCount(db: SQLiteDatabase): Promise<number> {
  return (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) n FROM catalog'))?.n ?? 0;
}

export async function catalogCounts(db: SQLiteDatabase): Promise<Record<string, number>> {
  const rows = await db.getAllAsync<{ type: string; n: number }>('SELECT type, COUNT(*) n FROM catalog GROUP BY type');
  return Object.fromEntries(rows.map((r) => [r.type, r.n]));
}

/** The pool, most-voted first. "Popularity" in Fandex IS the vote count. */
export async function browseCatalog(
  db: SQLiteDatabase,
  type: string | null,
  limit: number,
  offset: number,
): Promise<CatalogRow[]> {
  return type
    ? db.getAllAsync<CatalogRow>(
        `SELECT ${CARD_COLUMNS} FROM catalog WHERE type = ? ORDER BY community_votes DESC, id LIMIT ? OFFSET ?`,
        [type, limit, offset],
      )
    : db.getAllAsync<CatalogRow>(
        `SELECT ${CARD_COLUMNS} FROM catalog ORDER BY community_votes DESC, id LIMIT ? OFFSET ?`,
        [limit, offset],
      );
}

// ── Your rows ────────────────────────────────────────────────────────────────

export interface ShelfRow extends CatalogRow {
  /** Your score, 0-10: the average across the providers that hold one. Null when unrated. */
  rating: number | null;
  /** Unix seconds: when the title was first added, on any provider. */
  added_at: number;
  /** watched | played | owned, as one of the providers holding the title reports it. */
  status: string | null;
  /** Comma-separated providers that hold this title for you. */
  sources: string;
}

export type ShelfSort = 'added' | 'rating' | 'title';

/**
 * A relation's titles, one row per title however many providers hold it.
 *
 * The same folding the site's `user_library` view did: the rating is the
 * AVERAGE of the per-provider ratings above zero, the added date is the
 * EARLIEST. A title in the state rows that the device's catalog copy does not
 * hold yet is left out rather than shown as a blank row; the next catalog sync
 * brings it in, because writing state for a title puts it in the pool.
 */
export async function shelf(
  db: SQLiteDatabase,
  relation: 'library' | 'wishlist',
  type: string | null,
  sort: ShelfSort,
  limit: number,
  offset: number,
): Promise<ShelfRow[]> {
  const order =
    sort === 'rating' ? 'rating IS NULL, rating DESC, c.community_votes DESC'
    : sort === 'title' ? 'c.norm_title'
    : 'added_at DESC';
  return db.getAllAsync<ShelfRow>(
    `SELECT c.id, c.type, c.title, c.slug, c.poster_url, c.release_date, c.year, c.community_score, c.community_votes,
            ROUND(AVG(CASE WHEN s.rating > 0 THEN s.rating END), 1) AS rating,
            MIN(s.added_at) AS added_at,
            MAX(s.status) AS status,
            GROUP_CONCAT(s.source) AS sources
       FROM item_state s JOIN catalog c ON c.id = s.media_item_id
      WHERE s.relation = ? ${type ? 'AND c.type = ?' : ''}
      GROUP BY c.id
      ORDER BY ${order}, c.id
      LIMIT ? OFFSET ?`,
    type ? [relation, type, limit, offset] : [relation, limit, offset],
  );
}

export async function shelfCounts(db: SQLiteDatabase): Promise<{ library: number; wishlist: number; missing: number }> {
  const rows = await db.getAllAsync<{ relation: string; n: number; held: number }>(
    `SELECT s.relation, COUNT(DISTINCT s.media_item_id) n,
            COUNT(DISTINCT CASE WHEN c.id IS NOT NULL THEN s.media_item_id END) held
       FROM item_state s LEFT JOIN catalog c ON c.id = s.media_item_id
      WHERE s.relation IN ('library', 'wishlist')
      GROUP BY s.relation`,
  );
  const by = Object.fromEntries(rows.map((r) => [r.relation, r]));
  return {
    library: by.library?.held ?? 0,
    wishlist: by.wishlist?.held ?? 0,
    // Titles you hold that the catalog copy has not caught up with.
    missing: rows.reduce((n, r) => n + (r.n - r.held), 0),
  };
}

/** Everything this device knows about your relationship to one title. */
export async function itemStateFor(db: SQLiteDatabase, id: string): Promise<{
  inLibrary: boolean; inWishlist: boolean; rating: number | null; status: string | null;
}> {
  const rows = await db.getAllAsync<{ relation: string; rating: number | null; status: string | null }>(
    'SELECT relation, rating, status FROM item_state WHERE media_item_id = ?',
    [id],
  );
  const rated = rows.filter((r) => r.relation === 'library' && r.rating != null && r.rating > 0).map((r) => r.rating as number);
  return {
    inLibrary: rows.some((r) => r.relation === 'library'),
    inWishlist: rows.some((r) => r.relation === 'wishlist'),
    rating: rated.length ? Math.round((rated.reduce((a, b) => a + b, 0) / rated.length) * 10) / 10 : null,
    status: rows.find((r) => r.relation === 'library' && r.status)?.status ?? null,
  };
}

/**
 * Titles containing the term, on the device, no network. An exact title match
 * comes first whatever its vote count (the site's rule, decided 2026-09-02),
 * then titles that start with the term, then the rest by votes.
 */
export async function searchCatalog(db: SQLiteDatabase, normTerm: string, limit = 20): Promise<CatalogRow[]> {
  if (!normTerm) return [];
  // LIKE wildcards in the user's own text would match everything.
  const escaped = normTerm.replace(/[\\%_]/g, (c) => `\\${c}`);
  return db.getAllAsync<CatalogRow>(
    `SELECT ${CARD_COLUMNS} FROM catalog
      WHERE norm_title LIKE ? ESCAPE '\\'
      ORDER BY (norm_title = ?) DESC, (norm_title LIKE ? ESCAPE '\\') DESC, community_votes DESC, id
      LIMIT ?`,
    [`%${escaped}%`, normTerm, `${escaped}%`, limit],
  );
}
