// Erasure (GDPR Art. 17), export (Art. 20) and account merge, on D1.
//
// A port of src/lib/account.ts and src/lib/accountMerge.ts. The rules that made
// those files what they are carry over unchanged:
//
//   • WHICH TABLES ARE PERSONAL IS READ FROM THE SCHEMA, by the literal column
//     name `user_id`. A hard-coded list is a silent GDPR bug waiting for the
//     next migration: add a table and erasure quietly stops being complete.
//   • THE EXPORT IS WRITTEN BY HAND, with explicit column lists and no
//     `SELECT *`, so a column added later cannot drift into a file the user
//     downloads without someone deciding it belongs there.
//   • A MERGE NEVER PICKS A WINNER ON ITS OWN. Where two accounts disagree the
//     person chooses, the losing rows are deleted first, and only then is
//     everything moved. An `OR IGNORE` in place of that would silently keep
//     whichever side happened to be written first.
//
// Neither erasure nor merge touches media_items or media_links. Those are the
// shared catalog; what makes a catalog row personal is the user_* row pointing
// at it, and every one of those goes.

import { all, first } from "./d1";

// ── Which tables hold this user's data ──────────────────────────────────────

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * True when a CREATE TABLE statement declares a column named exactly `user_id`.
 *
 * Parsed from the statement text because D1 refuses the `pragma_table_info()`
 * table function (SQLITE_AUTH, probed 2026-10-04), and one `PRAGMA table_info`
 * per table would spend half an invocation's query allowance on bookkeeping.
 *
 * A column definition starts right after `(` or `,`. So `provider_user_id` does
 * not match (it is preceded by `provider_`), and neither does `user_id` inside
 * a `PRIMARY KEY (user_id, …)` clause (it is followed by a comma or a bracket,
 * not by a type).
 */
export function declaresUserId(createSql: string): boolean {
  const withoutComments = createSql.replace(/--[^\n]*/g, "");
  return /[(,]\s*["`[]?user_id["`\]]?\s+[A-Za-z]/.test(withoutComments);
}

export async function userScopedTables(db: D1Database): Promise<string[]> {
  const tables = await all<{ name: string; sql: string | null }>(
    db,
    `SELECT name, sql FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name <> 'd1_migrations'
      ORDER BY name`,
  );
  return tables
    .filter((t) => t.name !== "users" && IDENTIFIER.test(t.name) && !!t.sql && declaresUserId(t.sql))
    .map((t) => t.name);
}

export interface AccountFootprint {
  exists: boolean;
  /** Every user-scoped table with this user's row count. */
  perTable: Record<string, number>;
  total: number;
}

async function countsFor(db: D1Database, tables: string[], userId: string): Promise<Record<string, number>> {
  if (!tables.length) return {};
  // Table names cannot be bound. They come from sqlite_master and are matched
  // against a strict identifier pattern in userScopedTables().
  const results = await db.batch<{ n: number }>(
    tables.map((t) => db.prepare(`SELECT COUNT(*) n FROM "${t}" WHERE user_id = ?`).bind(userId)),
  );
  const out: Record<string, number> = {};
  tables.forEach((t, i) => { out[t] = results[i].results?.[0]?.n ?? 0; });
  return out;
}

/** What deleting this account would remove. Read-only. */
export async function accountFootprint(db: D1Database, userId: string): Promise<AccountFootprint> {
  const exists = !!(await first<{ id: string }>(db, "SELECT id FROM users WHERE id = ?", [userId]));
  const perTable = await countsFor(db, await userScopedTables(db), userId);
  return { exists, perTable, total: Object.values(perTable).reduce((a, b) => a + b, 0) };
}

export interface AccountDeletionResult {
  perTable: Record<string, number>;
  total: number;
  userRowDeleted: boolean;
}

/**
 * Erase an account and everything attached to it.
 *
 * Children are deleted explicitly and then the users row, in ONE batch, which
 * D1 runs as a transaction: all of it applies or none of it does. The foreign
 * keys cascade as well, but an erasure whose completeness rests on a cascade is
 * one schema edit away from silently leaving somebody's ratings behind.
 *
 * The completeness check runs after the batch rather than inside it, because a
 * D1 batch cannot branch. It can only fail if a user-scoped table appeared
 * between the list and the delete, and it throws, so the caller answers 500
 * instead of telling the person their data is gone.
 */
export async function deleteAccount(db: D1Database, userId: string): Promise<AccountDeletionResult> {
  const tables = await userScopedTables(db);
  const results = await db.batch([
    ...tables.map((t) => db.prepare(`DELETE FROM "${t}" WHERE user_id = ?`).bind(userId)),
    db.prepare("DELETE FROM users WHERE id = ?").bind(userId),
  ]);

  const perTable: Record<string, number> = {};
  let total = 0;
  tables.forEach((t, i) => {
    const n = results[i].meta.changes ?? 0;
    perTable[t] = n;
    total += n;
  });
  const userRowDeleted = (results[tables.length].meta.changes ?? 0) > 0;

  const after = await countsFor(db, await userScopedTables(db), userId);
  const leftovers = Object.entries(after).filter(([, n]) => n > 0);
  if (leftovers.length) {
    console.error("account_delete_incomplete", { leftovers });
    throw new Error(`Account deletion incomplete. Rows remain in: ${leftovers.map(([t, n]) => `${t}(${n})`).join(", ")}`);
  }

  console.log("account_deleted", { total, userRowDeleted });
  return { perTable, total, userRowDeleted };
}

// ── Export (Art. 20) ────────────────────────────────────────────────────────

// v6 (2026-10-04): the D1 shape. `library` / `watchlist` (derived views of
// itemState) and `syncLog` are gone with the server-side sync that produced
// them; `itemState` is the same data, complete. Identities carry no metadata
// because none is stored.
export const ACCOUNT_EXPORT_SCHEMA_VERSION = 6;

function parseStringList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Everything held about one user, as a JSON string.
 *
 * The three large lists are aggregated to JSON inside SQLite and spliced in as
 * strings: a long-time user has tens of thousands of episode rows, and building
 * those as objects in the Worker would cost more CPU than a request is given.
 */
export async function buildAccountExportJson(db: D1Database, userId: string, now = new Date()): Promise<string | null> {
  const user = await first<{
    id: string; created_at: number | null; last_seen_at: number | null;
    country: string | null; platforms: string | null; media_types: string | null;
  }>(db, "SELECT id, created_at, last_seen_at, country, platforms, media_types FROM users WHERE id = ?", [userId]);
  if (!user) return null;

  const [identities, itemState, episodes, hidden] = await db.batch<{ j: string | null }>([
    db.prepare(
      `SELECT json_group_array(json_object('provider', provider, 'providerUserId', provider_user_id,
              'displayName', display_name, 'avatarUrl', avatar_url, 'createdAt', created_at)) j
         FROM (SELECT provider, provider_user_id, display_name, avatar_url, created_at
                 FROM user_identities WHERE user_id = ? ORDER BY created_at)`,
    ).bind(userId),
    db.prepare(
      `SELECT json_group_array(json_object('mediaItemId', media_item_id, 'title', title, 'type', type,
              'source', source, 'relation', relation, 'status', status, 'rating', rating, 'review', review,
              'reviewedAt', reviewed_at, 'addedAt', added_at)) j
         FROM (SELECT s.media_item_id, m.title, m.type, s.source, s.relation, s.status, s.rating, s.review,
                      s.reviewed_at, s.added_at
                 FROM user_item_state s LEFT JOIN media_items m ON m.id = s.media_item_id
                WHERE s.user_id = ? ORDER BY s.added_at, s.media_item_id)`,
    ).bind(userId),
    db.prepare(
      `SELECT json_group_array(json_object('mediaItemId', media_item_id, 'title', title, 'season', season_number,
              'episode', episode_number, 'watchedAt', watched_at, 'sources', json(sources))) j
         FROM (SELECT e.media_item_id, m.title, e.season_number, e.episode_number, e.watched_at,
                      CASE WHEN json_valid(e.sources) THEN e.sources ELSE '[]' END AS sources
                 FROM user_episode_state e LEFT JOIN media_items m ON m.id = e.media_item_id
                WHERE e.user_id = ? ORDER BY m.title, e.season_number, e.episode_number)`,
    ).bind(userId),
    db.prepare(
      `SELECT json_group_array(json_object('mediaItemId', media_item_id, 'title', title, 'hiddenAt', hidden_at)) j
         FROM (SELECT h.media_item_id, m.title, h.hidden_at
                 FROM user_hidden_items h LEFT JOIN media_items m ON m.id = h.media_item_id
                WHERE h.user_id = ? ORDER BY h.hidden_at DESC)`,
    ).bind(userId),
  ]);
  const list = (r: D1Result<{ j: string | null }>) => r.results?.[0]?.j ?? "[]";

  const head = {
    schemaVersion: ACCOUNT_EXPORT_SCHEMA_VERSION,
    service: "fandex",
    exportedAt: now.toISOString(),
    readme: [
      "This file contains everything Fandex stores about your account.",
      "Timestamps are Unix seconds (UTC) unless they end in 'Z'.",
      "'itemState' is your library and wishlist, one entry per title and connected provider.",
      "'episodes' lists the individual show episodes you have marked as watched.",
      "'hidden' lists titles you asked Fandex to stop suggesting. They stay in the catalog and in your library.",
      "Fandex stores no access tokens for your connected accounts. They stay on your device.",
      "Titles are shown for convenience; the catalog itself is shared and is not part of your personal data.",
    ],
    user: {
      id: user.id,
      createdAt: user.created_at,
      lastSeenAt: user.last_seen_at,
      country: user.country,
      platforms: parseStringList(user.platforms),
      mediaTypes: parseStringList(user.media_types),
    },
  };
  const headJson = JSON.stringify(head);
  return (
    `${headJson.slice(0, -1)},"identities":${list(identities)},"itemState":${list(itemState)},` +
    `"episodes":${list(episodes)},"hidden":${list(hidden)}}`
  );
}

// ── Disconnect ──────────────────────────────────────────────────────────────

export type DisconnectResult =
  | { ok: false; reason: "not-connected" | "only-login" | "budget" }
  | { ok: true; removedRows: number; remaining: { provider: string; displayName: string | null } };

/**
 * Remove one way of signing in, and the wishlist and library rows that came
 * from it. The site's rule, kept: the last identity cannot go, because an
 * account nobody can sign in to is a deleted account with its data still held.
 * Deleting the account is its own route.
 *
 * `charge` is asked before anything is deleted, with the number of rows the
 * delete will write. Episode rows stay, as they did on the site.
 */
export async function disconnectIdentity(
  db: D1Database,
  userId: string,
  provider: string,
  charge: (rows: number) => Promise<boolean> = async () => true,
): Promise<DisconnectResult> {
  const identities = await all<{ provider: string; display_name: string | null }>(
    db, "SELECT provider, display_name FROM user_identities WHERE user_id = ? ORDER BY created_at", [userId],
  );
  if (!identities.some((i) => i.provider === provider)) return { ok: false, reason: "not-connected" };
  const remaining = identities.find((i) => i.provider !== provider);
  if (!remaining) return { ok: false, reason: "only-login" };

  const rows = (await first<{ n: number }>(
    db, "SELECT COUNT(*) n FROM user_item_state WHERE user_id = ? AND source = ?", [userId, provider],
  ))?.n ?? 0;
  if (!(await charge(rows + 1))) return { ok: false, reason: "budget" };

  await db.batch([
    db.prepare("DELETE FROM user_identities WHERE user_id = ? AND provider = ?").bind(userId, provider),
    db.prepare("DELETE FROM user_item_state WHERE user_id = ? AND source = ?").bind(userId, provider),
  ]);
  return { ok: true, removedRows: rows, remaining: { provider: remaining.provider, displayName: remaining.display_name } };
}

// ── Merge ───────────────────────────────────────────────────────────────────

export async function providersFor(db: D1Database, userId: string): Promise<string[]> {
  return (await all<{ provider: string }>(db, "SELECT provider FROM user_identities WHERE user_id = ?", [userId]))
    .map((r) => r.provider);
}

export interface MergeConflicts {
  /** Rows that would collide on (media_item_id, source, relation). */
  itemState: number;
  /** Rows that would collide on (media_item_id, season, episode). */
  episodeState: number;
  /** Rows that move with no decision needed. */
  cleanRows: number;
  /** A few titles from the overlap, so the form is concrete rather than a number. */
  sampleTitles: string[];
}

// `f` is the account being read, `t` the one it is compared against.
const ITEM_CONFLICT = `
  EXISTS (SELECT 1 FROM user_item_state t
           WHERE t.user_id = ?2 AND t.media_item_id = f.media_item_id
             AND t.source = f.source AND t.relation = f.relation)`;
const EPISODE_CONFLICT = `
  EXISTS (SELECT 1 FROM user_episode_state t
           WHERE t.user_id = ?2 AND t.media_item_id = f.media_item_id
             AND t.season_number = f.season_number AND t.episode_number = f.episode_number)`;

export async function mergeConflicts(db: D1Database, fromUserId: string, intoUserId: string): Promise<MergeConflicts> {
  const ids = [fromUserId, intoUserId];
  const [items, episodes, itemTotal, episodeTotal, titles] = await db.batch<Record<string, unknown>>([
    db.prepare(`SELECT COUNT(*) n FROM user_item_state f WHERE f.user_id = ?1 AND ${ITEM_CONFLICT}`).bind(...ids),
    db.prepare(`SELECT COUNT(*) n FROM user_episode_state f WHERE f.user_id = ?1 AND ${EPISODE_CONFLICT}`).bind(...ids),
    db.prepare("SELECT COUNT(*) n FROM user_item_state WHERE user_id = ?").bind(fromUserId),
    db.prepare("SELECT COUNT(*) n FROM user_episode_state WHERE user_id = ?").bind(fromUserId),
    db.prepare(
      `SELECT DISTINCT mi.title title
         FROM user_item_state f JOIN media_items mi ON mi.id = f.media_item_id
        WHERE f.user_id = ?1 AND ${ITEM_CONFLICT} AND mi.title IS NOT NULL
        ORDER BY mi.title LIMIT 5`,
    ).bind(...ids),
  ]);
  const n = (r: D1Result<Record<string, unknown>>) => Number(r.results?.[0]?.n ?? 0);
  const itemState = n(items);
  const episodeState = n(episodes);
  return {
    itemState,
    episodeState,
    cleanRows: n(itemTotal) + n(episodeTotal) - itemState - episodeState,
    sampleTitles: (titles.results ?? []).map((r) => String(r.title)),
  };
}

/** Which side wins where the two accounts disagree. No default, deliberately. */
export type MergeResolution =
  /** Keep the rows on the account you are signed in as (the one being merged away). */
  | "keep-mine"
  /** Keep the rows on the account that owns the provider you just connected. */
  | "keep-theirs";

export type MergeRefusal = { ok: false; reason: "provider-taken"; provider: string };
export type MergeResult = { ok: true; movedTables: string[] } | MergeRefusal;

/**
 * Can these two accounts be joined at all? The one hard refusal: both already
 * sign in with the same provider, so the identity being moved has nowhere
 * unambiguous to land.
 */
export async function canMerge(db: D1Database, fromUserId: string, intoUserId: string): Promise<{ ok: true } | MergeRefusal> {
  const target = new Set(await providersFor(db, intoUserId));
  for (const p of await providersFor(db, fromUserId)) {
    if (target.has(p)) return { ok: false, reason: "provider-taken", provider: p };
  }
  return { ok: true };
}

/**
 * Move everything owned by `fromUserId` to `intoUserId` and delete the emptied
 * account. One batch, so a half-merged account cannot exist.
 *
 * Order inside the batch is the whole design:
 *   1. the LOSING side of each real conflict is deleted, per the resolution;
 *   2. duplicates that carry no decision are dropped from the source (a hidden
 *      title is hidden on both sides or it is not; there is nothing to choose);
 *   3. every user-scoped table is moved with a plain UPDATE, which cannot
 *      collide once 1 and 2 have run. A table this function does not know that
 *      CAN collide fails the batch loudly, which is the right answer for a
 *      conflict nobody has decided how to resolve.
 */
export async function mergeAccounts(
  db: D1Database,
  fromUserId: string,
  intoUserId: string,
  resolution: MergeResolution,
): Promise<MergeResult> {
  if (fromUserId === intoUserId) return { ok: true, movedTables: [] };
  const guard = await canMerge(db, fromUserId, intoUserId);
  if (!guard.ok) return guard;

  const tables = await userScopedTables(db);
  // keep-theirs: the source's clashing rows go. keep-mine: the target's do.
  const [loser, winner] = resolution === "keep-theirs" ? [fromUserId, intoUserId] : [intoUserId, fromUserId];

  const statements: D1PreparedStatement[] = [
    db.prepare(`DELETE FROM user_item_state AS f WHERE f.user_id = ?1 AND ${ITEM_CONFLICT}`).bind(loser, winner),
    db.prepare(`DELETE FROM user_episode_state AS f WHERE f.user_id = ?1 AND ${EPISODE_CONFLICT}`).bind(loser, winner),
    db.prepare(
      `DELETE FROM user_hidden_items AS f WHERE f.user_id = ?1
         AND EXISTS (SELECT 1 FROM user_hidden_items t WHERE t.user_id = ?2 AND t.media_item_id = f.media_item_id)`,
    ).bind(fromUserId, intoUserId),
  ];
  const moveStart = statements.length;
  for (const t of tables) {
    statements.push(db.prepare(`UPDATE "${t}" SET user_id = ?1 WHERE user_id = ?2`).bind(intoUserId, fromUserId));
  }
  // The emptied account. Its preferences go with it on purpose: the surviving
  // account is the established one and its settings are the ones the person chose.
  statements.push(db.prepare("DELETE FROM users WHERE id = ?").bind(fromUserId));

  const results = await db.batch(statements);
  const moved: string[] = [];
  tables.forEach((t, i) => {
    const n = results[moveStart + i].meta.changes ?? 0;
    if (n > 0) moved.push(`${t}:${n}`);
  });
  return { ok: true, movedTables: moved };
}
