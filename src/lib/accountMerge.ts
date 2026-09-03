import { get, getDb, query, run, transaction } from "@/lib/db";
import { userScopedTables } from "@/lib/account";

// Linking a provider that ALREADY belongs to another Fandex account (2026-09-02).
//
// Nils hit this: signed out, signed in with Discord (which minted a NEW empty
// account), then connected Google expecting to land back on his real account.
// The callback found the existing Google identity, refreshed ITS tokens, and
// redirected to `?connected=google` — so the page said "google connected
// successfully" while Google still showed a Connect button and nothing had been
// linked. It also wrote to the OTHER account's row from this account's session.
//
// The rule Nils specified:
//
//   user signs in with X, then connects Y
//     · Y's account has no X yet          → success, bring everything across
//     · Y's account already has a different X → refuse, and say what to do
//
// ⚠️ WHICH DIRECTION. The current (X) account merges INTO Y's account, not the
// other way round. Y's account is the established one — it is the account the
// user is trying to get back to — and the X account is typically seconds old,
// created by the sign-in that started this. Merging the other way would make the
// fresh account the survivor and silently retire the real one.

/** A single user-scoped row count, so "is this account empty" is answerable. */
export interface AccountFootprint {
  /** Library / wishlist / rating rows. */
  itemState: number;
  /** Per-episode ticks. */
  episodeState: number;
  /** Identities, which always includes at least the one that just signed in. */
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

/**
 * Does this account hold anything a merge could destroy?
 *
 * Identities are excluded deliberately: they MOVE cleanly (the unique key is
 * `(provider, provider_user_id)`, which is global, so a move can never collide)
 * and the account being merged always has at least one. What cannot be moved
 * blindly is per-item state, because `user_item_state` is unique on
 * `(user_id, media_item_id, source, relation)` and `user_episode_state` is keyed
 * the same way — the same film rated in both accounts is a genuine conflict with
 * no correct automatic answer.
 */
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

export type MergeRefusal =
  /** The target account already signs in with this provider. Nils's second rule. */
  | { ok: false; reason: "provider-taken"; provider: string }
  /** Both accounts hold real state; merging would have to discard one side. */
  | { ok: false; reason: "both-have-data" };

export type MergeResult = { ok: true; movedTables: string[] } | MergeRefusal;

/**
 * Can `fromUserId` be folded into `intoUserId` without inventing an answer?
 *
 * Split from the merge itself so the callback can decide what to SAY before
 * anything is written, and so the rules are testable without a merge.
 */
export function canMerge(fromUserId: string, intoUserId: string): { ok: true } | MergeRefusal {
  // Rule 2. The target already has a way to sign in with this provider, so the
  // identity being moved has nowhere to land that is not ambiguous. Nils's
  // instruction for this case is to tell the user to do it from the other side.
  const targetProviders = new Set(providersFor(intoUserId));
  for (const p of providersFor(fromUserId)) {
    if (targetProviders.has(p)) return { ok: false, reason: "provider-taken", provider: p };
  }

  // ⚠️ NOT in Nils's spec, and it is here on purpose. His two rules assume the
  // account you signed in with is the throwaway one, which is true for the case
  // he hit (it was seconds old). If BOTH accounts hold library rows, a merge has
  // to pick a winner for every clash, and silently discarding somebody's ratings
  // is worse than refusing. Refuse and let them choose.
  if (accountHasUserData(fromUserId) && accountHasUserData(intoUserId)) {
    return { ok: false, reason: "both-have-data" };
  }

  return { ok: true };
}

/**
 * Move everything owned by `fromUserId` to `intoUserId` and delete the empty row.
 *
 * ⚠️ The table list is SCHEMA-DERIVED, via the same `userScopedTables()` that
 * GDPR erasure uses. A future user-scoped table is then covered the moment it
 * exists, instead of being silently left behind on the deleted account — which
 * is the same failure erasure guards against, in the same place.
 *
 * ⚠️ `INSERT OR IGNORE`-shaped conflict handling is deliberately NOT used here.
 * `canMerge` has already established that at most one side holds per-item state,
 * so a plain UPDATE cannot collide. If that guard is ever relaxed, this function
 * needs a real conflict rule first — do not just add `OR IGNORE` and call it
 * merged, because that silently drops the losing side.
 *
 * One transaction: a half-merged account is worse than either whole one.
 */
export function mergeAccounts(fromUserId: string, intoUserId: string): MergeResult {
  if (fromUserId === intoUserId) return { ok: true, movedTables: [] };

  const guard = canMerge(fromUserId, intoUserId);
  if (!guard.ok) return guard;

  const tables = userScopedTables();
  const moved: string[] = [];

  transaction(() => {
    for (const t of tables) {
      // Table names cannot be bound as parameters. `userScopedTables()` already
      // filters against a strict identifier pattern and sources names from
      // sqlite_master, which is the same belt-and-braces erasure relies on.
      const info = getDb().prepare(`UPDATE "${t}" SET user_id = ? WHERE user_id = ?`)
        .run(intoUserId, fromUserId);
      if (info.changes > 0) moved.push(`${t}:${info.changes}`);
    }

    // The emptied account. Its preferences (country, platforms, media_types) go
    // with it on purpose: the surviving account is the established one and its
    // settings are the ones the person actually chose. Carrying a fresh
    // account's defaults across would overwrite them with nothing.
    run("DELETE FROM users WHERE id = ?", [fromUserId]);
  });

  return { ok: true, movedTables: moved };
}
