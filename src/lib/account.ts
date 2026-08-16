import { get, getDb, query, run, transaction } from "@/lib/db";
import { log } from "@/lib/logger";

// H4.6 / H4.7 — GDPR Art. 17 (erasure) and Art. 20 (portability).
//
// Both operations are defined here as plain DB functions so they can be tested
// directly; the routes (`/api/account`, `/api/account/export`) stay thin. This
// mirrors dbPrune.ts, the repo's other destructive module.
//
// Scope note: neither operation touches `media_items` / `media_links`. Those are
// the SHARED catalog — the same rows back every other user's library and the
// public pages — so a title staying in the catalog after an account is deleted
// is correct, not a leftover. What makes catalog rows personal is the `user_*`
// row pointing at them, and every one of those is deleted.

// ── Which tables hold this user's data ──────────────────────────────────────
//
// Derived from the live schema rather than hard-coded. A hard-coded list is a
// silent GDPR bug waiting for the next migration: add a table with a `user_id`
// and erasure quietly stops being complete, with nothing failing. Reading
// sqlite_master means a new user-scoped table is covered the moment it exists.
//
// Table names are interpolated into SQL (they can't be bound as parameters), so
// they're matched against a strict identifier pattern first — belt-and-braces,
// since the only source here is sqlite_master itself.
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function userScopedTables(): string[] {
  const tables = query<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const out: string[] = [];
  for (const t of tables) {
    if (t.name === "users" || !IDENTIFIER.test(t.name)) continue;
    const cols = getDb().prepare(`PRAGMA table_info("${t.name}")`).all() as { name: string }[];
    if (cols.some((c) => c.name === "user_id")) out.push(t.name);
  }
  return out;
}

function countFor(table: string, userId: string): number {
  return (
    get<{ n: number }>(`SELECT COUNT(*) n FROM "${table}" WHERE user_id = ?`, [userId])?.n ?? 0
  );
}

export type AccountFootprint = {
  exists: boolean;
  /** Every user-scoped table with this user's row count — drives the UI's warning. */
  perTable: Record<string, number>;
  total: number;
};

/** What deleting this account would remove. Read-only. */
export function accountFootprint(userId: string): AccountFootprint {
  const exists = !!get<{ id: string }>("SELECT id FROM users WHERE id = ?", [userId]);
  const perTable: Record<string, number> = {};
  let total = 0;
  for (const t of userScopedTables()) {
    const n = countFor(t, userId);
    perTable[t] = n;
    total += n;
  }
  return { exists, perTable, total };
}

export type AccountDeletionResult = {
  /** Rows removed per user-scoped table, plus the `users` row itself. */
  perTable: Record<string, number>;
  total: number;
  userRowDeleted: boolean;
};

/**
 * Erase an account and everything attached to it.
 *
 * Deletes children explicitly and THEN the `users` row, rather than relying on
 * `ON DELETE CASCADE`. Every user table does cascade today and `getDb()` sets
 * `foreign_keys = ON` — but the cascade is a silent no-op if that pragma is ever
 * off on the connection doing the delete (a standalone script wouldn't set it;
 * see [[migrate-mjs-two-apply-paths]]), and "silently left the user's ratings
 * behind while reporting success" is the exact failure an erasure route must not
 * have. Explicit deletes make the outcome independent of that pragma; the
 * cascade stays as the backstop.
 *
 * The completeness check runs INSIDE the transaction, so a table the delete list
 * missed rolls the whole thing back instead of committing a half-erased account.
 */
export function deleteAccount(userId: string): AccountDeletionResult {
  const tables = userScopedTables();

  const result = transaction<AccountDeletionResult>(() => {
    const perTable: Record<string, number> = {};
    let total = 0;
    for (const t of tables) {
      const changes = run(`DELETE FROM "${t}" WHERE user_id = ?`, [userId]).changes;
      perTable[t] = changes;
      total += changes;
    }
    const userRowDeleted = run("DELETE FROM users WHERE id = ?", [userId]).changes > 0;

    // Re-read the schema: if a user-scoped table appeared between the list above
    // and now, or a delete silently matched nothing it should have, this catches
    // it while the rollback is still available.
    const leftovers = userScopedTables()
      .map((t) => ({ table: t, n: countFor(t, userId) }))
      .filter((r) => r.n > 0);
    if (leftovers.length > 0) {
      log.error("account_delete_incomplete", { userId, leftovers });
      throw new Error(
        `Account deletion incomplete — rows remain in: ${leftovers.map((l) => `${l.table}(${l.n})`).join(", ")}`,
      );
    }

    return { perTable, total, userRowDeleted };
  });

  log.info("account_deleted", { userId, total: result.total, userRowDeleted: result.userRowDeleted });
  return result;
}

// ── Export (Art. 20) ────────────────────────────────────────────────────────
//
// LEAK BOUNDARY: every query below names its columns explicitly. No `SELECT *`
// anywhere in this section — that is what keeps `access_token` / `refresh_token`
// out of a file the user downloads and may hand to someone else. A column added
// to `user_identities` later is invisible to the export until someone adds it
// here on purpose. `accountExport.test.ts` pins this by scanning the serialized
// output for planted secrets.

// v2 (2026-08-16, MB14): adds `episodes` — per-episode watched state.
export const ACCOUNT_EXPORT_SCHEMA_VERSION = 2;

/** Keys never worth putting in a downloadable file, whatever a provider called them. */
const SECRET_KEY = /token|secret|password|session[_-]?id|credential/i;

/**
 * `user_identities.metadata` is provider-shaped JSON (TMDB account id, RAWG
 * slug) — the user's own data, so it belongs in the export. It is scrubbed
 * key-wise anyway: nothing today puts a secret in there, and this makes sure a
 * future provider adapter that does can't leak it through this route.
 */
function scrubMetadata(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (SECRET_KEY.test(k)) continue;
    out[k] = v;
  }
  return out;
}

export type AccountExport = {
  schemaVersion: number;
  service: "fandex";
  exportedAt: string;
  /** Plain-language notes so the file makes sense without this codebase. */
  readme: string[];
  user: { id: string; createdAt: number | null; lastSeenAt: number | null; country: string | null };
  identities: Array<{
    provider: string;
    providerUserId: string;
    displayName: string | null;
    avatarUrl: string | null;
    createdAt: number | null;
    metadata: Record<string, unknown> | null;
  }>;
  library: Array<{
    mediaItemId: string;
    title: string | null;
    type: string | null;
    releaseDate: string | null;
    status: string | null;
    rating: number | null;
    review: string | null;
    reviewedAt: number | null;
    platformSources: string;
    addedAt: number | null;
  }>;
  watchlist: Array<{
    mediaItemId: string;
    title: string | null;
    type: string | null;
    releaseDate: string | null;
    platformSources: string;
    notes: string | null;
    addedAt: number | null;
  }>;
  itemState: Array<{
    mediaItemId: string;
    title: string | null;
    source: string;
    relation: string;
    status: string | null;
    rating: number | null;
    review: string | null;
    reviewedAt: number | null;
    addedAt: number | null;
  }>;
  episodes: Array<{
    mediaItemId: string;
    title: string | null;
    season: number;
    episode: number;
    watchedAt: number | null;
    sources: string;
  }>;
  syncLog: Array<{
    provider: string;
    syncedAt: number | null;
    itemCount: number | null;
    status: string | null;
    error: string | null;
  }>;
};

/** Everything held about one user, as a portable JSON object (GDPR Art. 20). */
export function buildAccountExport(userId: string, now = new Date()): AccountExport {
  const user = get<{
    id: string;
    created_at: number | null;
    last_seen_at: number | null;
    country: string | null;
  }>("SELECT id, created_at, last_seen_at, country FROM users WHERE id = ?", [userId]);
  if (!user) throw new Error("No such user");

  const identities = query<{
    provider: string;
    provider_user_id: string;
    display_name: string | null;
    avatar_url: string | null;
    created_at: number | null;
    metadata: string | null;
  }>(
    `SELECT provider, provider_user_id, display_name, avatar_url, created_at, metadata
       FROM user_identities WHERE user_id = ? ORDER BY created_at`,
    [userId],
  );

  const library = query<{
    media_item_id: string;
    title: string | null;
    type: string | null;
    release_date: string | null;
    status: string | null;
    rating: number | null;
    review: string | null;
    reviewed_at: number | null;
    platform_sources: string;
    added_at: number | null;
  }>(
    `SELECT l.media_item_id, m.title, m.type, m.release_date,
            l.status, l.rating, l.review, l.reviewed_at, l.platform_sources, l.added_at
       FROM user_library l LEFT JOIN media_items m ON m.id = l.media_item_id
      WHERE l.user_id = ? ORDER BY l.added_at`,
    [userId],
  );

  const watchlist = query<{
    media_item_id: string;
    title: string | null;
    type: string | null;
    release_date: string | null;
    platform_sources: string;
    notes: string | null;
    added_at: number | null;
  }>(
    `SELECT w.media_item_id, m.title, m.type, m.release_date, w.platform_sources, w.notes, w.added_at
       FROM user_watchlist w LEFT JOIN media_items m ON m.id = w.media_item_id
      WHERE w.user_id = ? ORDER BY w.added_at`,
    [userId],
  );

  const itemState = query<{
    media_item_id: string;
    title: string | null;
    source: string;
    relation: string;
    status: string | null;
    rating: number | null;
    review: string | null;
    reviewed_at: number | null;
    added_at: number | null;
  }>(
    `SELECT s.media_item_id, m.title, s.source, s.relation, s.status, s.rating,
            s.review, s.reviewed_at, s.added_at
       FROM user_item_state s LEFT JOIN media_items m ON m.id = s.media_item_id
      WHERE s.user_id = ? ORDER BY s.added_at`,
    [userId],
  );

  // MB14. Explicit column list, never SELECT * — same rule as every query above:
  // it is what keeps a column added later from drifting into a file the user
  // downloads without someone deciding it belongs there.
  const episodes = query<{
    media_item_id: string;
    title: string | null;
    season_number: number;
    episode_number: number;
    watched_at: number | null;
    sources: string;
  }>(
    `SELECT e.media_item_id, m.title, e.season_number, e.episode_number, e.watched_at, e.sources
       FROM user_episode_state e LEFT JOIN media_items m ON m.id = e.media_item_id
      WHERE e.user_id = ? ORDER BY m.title, e.season_number, e.episode_number`,
    [userId],
  );

  const syncLog = query<{
    provider: string;
    synced_at: number | null;
    item_count: number | null;
    status: string | null;
    error: string | null;
  }>(
    `SELECT provider, synced_at, item_count, status, error
       FROM sync_log WHERE user_id = ? ORDER BY synced_at`,
    [userId],
  );

  return {
    schemaVersion: ACCOUNT_EXPORT_SCHEMA_VERSION,
    service: "fandex",
    exportedAt: now.toISOString(),
    readme: [
      "This file contains everything Fandex stores about your account.",
      "Timestamps are Unix seconds (UTC) unless they end in 'Z'.",
      "'library' and 'watchlist' are the merged per-item view; 'itemState' is the same data split per connected provider.",
      "'episodes' lists the individual show episodes you have marked as watched.",
      "Access tokens for connected accounts are deliberately excluded — they are credentials, not your data.",
      "Titles are shown for convenience; the catalog itself is shared and is not part of your personal data.",
    ],
    user: {
      id: user.id,
      createdAt: user.created_at,
      lastSeenAt: user.last_seen_at,
      country: user.country,
    },
    identities: identities.map((i) => ({
      provider: i.provider,
      providerUserId: i.provider_user_id,
      displayName: i.display_name,
      avatarUrl: i.avatar_url,
      createdAt: i.created_at,
      metadata: scrubMetadata(i.metadata),
    })),
    library: library.map((l) => ({
      mediaItemId: l.media_item_id,
      title: l.title,
      type: l.type,
      releaseDate: l.release_date,
      status: l.status,
      rating: l.rating,
      review: l.review,
      reviewedAt: l.reviewed_at,
      platformSources: l.platform_sources,
      addedAt: l.added_at,
    })),
    watchlist: watchlist.map((w) => ({
      mediaItemId: w.media_item_id,
      title: w.title,
      type: w.type,
      releaseDate: w.release_date,
      platformSources: w.platform_sources,
      notes: w.notes,
      addedAt: w.added_at,
    })),
    itemState: itemState.map((s) => ({
      mediaItemId: s.media_item_id,
      title: s.title,
      source: s.source,
      relation: s.relation,
      status: s.status,
      rating: s.rating,
      review: s.review,
      reviewedAt: s.reviewed_at,
      addedAt: s.added_at,
    })),
    episodes: episodes.map((e) => ({
      mediaItemId: e.media_item_id,
      title: e.title,
      season: e.season_number,
      episode: e.episode_number,
      watchedAt: e.watched_at,
      sources: e.sources,
    })),
    syncLog: syncLog.map((s) => ({
      provider: s.provider,
      syncedAt: s.synced_at,
      itemCount: s.item_count,
      status: s.status,
      error: s.error,
    })),
  };
}
