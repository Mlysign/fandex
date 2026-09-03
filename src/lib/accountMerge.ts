import { get, getDb, query, run, transaction } from "@/lib/db";
import { userScopedTables } from "@/lib/account";

// Linking a provider that ALREADY belongs to another Fandex account (2026-09-02).
//
// Nils hit this: signed out, signed in with Discord (which minted a NEW account),
// then connected Google expecting to land back on his real account. The callback
// found the existing Google identity, refreshed ITS tokens, and redirected to
// `?connected=google` — so the page said "google connected successfully" while
// Google still showed a Connect button and nothing had been linked.
//
// The rule Nils specified:
//
//   user signs in with X, then connects Y
//     · Y's account has no X yet              → merge, bring everything across
//     · Y's account already has a different X → refuse, and say what to do
//
// ⚠️ WHICH DIRECTION. The current (X) account merges INTO Y's account. Y's is the
// established account — the one the user is trying to get back to — and the X
// account is typically seconds old, created by the sign-in that started this.
//
// ⚠️ CONFLICTS ARE THE USER'S CALL, not ours (2026-09-02, second pass). The first
// version refused outright when both accounts held titles, because
// `user_item_state` is unique on `(user_id, media_item_id, source, relation)` and
// a blind move collides. Nils: *"it should give me a merge form for me to decide
// and then execute the merge right after"*. So the overlap is COUNTED, shown, and
// resolved by an explicit choice — never by a default. `OR IGNORE` would have
// picked a winner silently, which is the thing being avoided.

/** A single user-scoped row count, so "is this account empty" is answerable. */
export interface AccountFootprint {
  itemState: number;
  episodeState: number;
  identities: number;
}

export function accountFootprint(userId: string): AccountFootprint {
  const n = (sql: string) => get<{ n: number }>(sql, [userId])?.n ?? 0;
  return {
    itemState: n("SELECT COUNT(*) n FROM user_item_state WHERE user_id = ?"),
    episodeState: n("SELECT COUNT(*) n FROM user_episode_state WHERE user_id = ?"),
    identities: n("SELECT COUNT(*) n FROM user_identities WHERE user_id = ?"),
  };
}

export function accountHasUserData(userId: string): boolean {
  const f = accountFootprint(userId);
  return f.itemState > 0 || f.episodeState > 0;
}

/** Providers this account can already sign in with. */
export function providersFor(userId: string): string[] {
  return query<{ provider: string }>(
    "SELECT provider FROM user_identities WHERE user_id = ?",
    [userId],
  ).map((r) => r.provider);
}

/**
 * How the two accounts overlap — what the merge form has to show.
 *
 * A "conflict" is a row in `from` whose UNIQUE key already exists in `into`:
 * the same title with the same source and relation, or the same episode. Those
 * are the only rows where moving one over the other loses something. Everything
 * else merges with no decision to make, which is Nils's "merge where possible".
 */
export interface MergeConflicts {
  /** Rows that would collide on `(media_item_id, source, relation)`. */
  itemState: number;
  /** Rows that would collide on `(media_item_id, season, episode)`. */
  episodeState: number;
  /** Rows that move with no decision needed, on both counts combined. */
  cleanRows: number;
  /** A few titles from the overlap, so the form is concrete rather than a number. */
  sampleTitles: string[];
}

const ITEM_CONFLICT_WHERE = `
  f.user_id = ?
  AND EXISTS (
    SELECT 1 FROM user_item_state t
     WHERE t.user_id = ?
       AND t.media_item_id = f.media_item_id
       AND t.source = f.source
       AND t.relation = f.relation
  )`;

const EPISODE_CONFLICT_WHERE = `
  f.user_id = ?
  AND EXISTS (
    SELECT 1 FROM user_episode_state t
     WHERE t.user_id = ?
       AND t.media_item_id = f.media_item_id
       AND t.season_number = f.season_number
       AND t.episode_number = f.episode_number
  )`;

export function mergeConflicts(fromUserId: string, intoUserId: string): MergeConflicts {
  const ids = [fromUserId, intoUserId];
  const itemState =
    get<{ n: number }>(`SELECT COUNT(*) n FROM user_item_state f WHERE ${ITEM_CONFLICT_WHERE}`, ids)?.n ?? 0;
  const episodeState =
    get<{ n: number }>(`SELECT COUNT(*) n FROM user_episode_state f WHERE ${EPISODE_CONFLICT_WHERE}`, ids)?.n ?? 0;

  const f = accountFootprint(fromUserId);
  const sampleTitles = query<{ title: string }>(
    `SELECT DISTINCT mi.title
       FROM user_item_state f
       JOIN media_items mi ON mi.id = f.media_item_id
      WHERE ${ITEM_CONFLICT_WHERE} AND mi.title IS NOT NULL
      ORDER BY mi.title
      LIMIT 5`,
    ids,
  ).map((r) => r.title);

  return {
    itemState,
    episodeState,
    cleanRows: f.itemState + f.episodeState - itemState - episodeState,
    sampleTitles,
  };
}

/**
 * Which side wins where the two accounts disagree.
 *
 * ⚠️ NO DEFAULT, deliberately. This is always an explicit choice made in the
 * form; a default here would be the silent winner-picking the whole design
 * exists to avoid.
 */
export type MergeResolution =
  /** Keep the rows on the account you are signed in as (the one being merged away). */
  | "keep-mine"
  /** Keep the rows on the account that owns the provider you just connected. */
  | "keep-theirs";

/** The only refusal left. Conflicts are resolved, not refused. */
export type MergeRefusal = { ok: false; reason: "provider-taken"; provider: string };

export type MergeResult = { ok: true; movedTables: string[] } | MergeRefusal;

/**
 * Can these two accounts be joined at all?
 *
 * The one hard refusal: the target already signs in with a provider the source
 * also has, so the identity being moved has nowhere unambiguous to land and
 * `user_identities` is unique on `(provider, provider_user_id)`. Nils's
 * instruction for this case is to tell the user to do it from the other side.
 */
export function canMerge(fromUserId: string, intoUserId: string): { ok: true } | MergeRefusal {
  const targetProviders = new Set(providersFor(intoUserId));
  for (const p of providersFor(fromUserId)) {
    if (targetProviders.has(p)) return { ok: false, reason: "provider-taken", provider: p };
  }
  return { ok: true };
}

/**
 * Move everything owned by `fromUserId` to `intoUserId` and delete the empty row.
 *
 * ⚠️ The table list is SCHEMA-DERIVED, via the same `userScopedTables()` that GDPR
 * erasure uses, so a future user-scoped table is covered the moment it exists
 * instead of being stranded on the deleted account.
 *
 * ⚠️ The losing rows are DELETED FIRST, then everything remaining is moved with a
 * plain UPDATE. That ordering is what makes the move collision-free — it is not
 * an optimisation, and an `OR IGNORE` in its place would silently drop whichever
 * side lost the race rather than the side the user chose.
 *
 * One transaction: a half-merged account is worse than either whole one.
 */
export function mergeAccounts(
  fromUserId: string,
  intoUserId: string,
  resolution: MergeResolution,
): MergeResult {
  if (fromUserId === intoUserId) return { ok: true, movedTables: [] };

  const guard = canMerge(fromUserId, intoUserId);
  if (!guard.ok) return guard;

  const tables = userScopedTables();
  const moved: string[] = [];

  transaction(() => {
    // Clear the losing side of every conflict, so the generic move below cannot
    // collide. `keep-mine` means the source account wins, so the TARGET's
    // clashing rows go; `keep-theirs` means the source's do.
    if (resolution === "keep-mine") {
      // Delete the target's clashing rows. The predicate is written from the
      // target's side, so the bind order flips.
      run(
        `DELETE FROM user_item_state WHERE rowid IN (
           SELECT f.rowid FROM user_item_state f WHERE ${ITEM_CONFLICT_WHERE})`,
        [intoUserId, fromUserId],
      );
      run(
        `DELETE FROM user_episode_state WHERE rowid IN (
           SELECT f.rowid FROM user_episode_state f WHERE ${EPISODE_CONFLICT_WHERE})`,
        [intoUserId, fromUserId],
      );
    } else {
      run(
        `DELETE FROM user_item_state WHERE rowid IN (
           SELECT f.rowid FROM user_item_state f WHERE ${ITEM_CONFLICT_WHERE})`,
        [fromUserId, intoUserId],
      );
      run(
        `DELETE FROM user_episode_state WHERE rowid IN (
           SELECT f.rowid FROM user_episode_state f WHERE ${EPISODE_CONFLICT_WHERE})`,
        [fromUserId, intoUserId],
      );
    }

    for (const t of tables) {
      // Table names cannot be bound as parameters. `userScopedTables()` filters
      // against a strict identifier pattern and sources names from sqlite_master,
      // the same belt-and-braces erasure relies on.
      const info = getDb().prepare(`UPDATE "${t}" SET user_id = ? WHERE user_id = ?`)
        .run(intoUserId, fromUserId);
      if (info.changes > 0) moved.push(`${t}:${info.changes}`);
    }

    // The emptied account. Its preferences (country, platforms, media_types) go
    // with it on purpose: the surviving account is the established one and its
    // settings are the ones the person actually chose.
    run("DELETE FROM users WHERE id = ?", [fromUserId]);
  });

  return { ok: true, movedTables: moved };
}
