// What happens once a provider has vouched for somebody: which account is that?
//
// A port of the middle of src/lib/oauthConnect.ts. The rule it exists for, in
// AGENTS.md's words: an identity that already exists has an OWNER, and who that
// owner is decides everything. Three outcomes, not one:
//
//   no session                    → sign in as the owner
//   the owner is this session     → nothing to link; refresh the display name
//   the owner is someone ELSE     → the two accounts are one person's. Merge the
//                                   signed-in account INTO the owner's, or
//                                   refuse and say why. Never silently no-op.
//
// And for an identity nobody has seen: link it to the signed-in account, or
// create an account for it.
//
// The link target always comes from the SESSION, never from anything the client
// sends in the body. Trusting a client-supplied user id is how an identity gets
// attached to somebody else's account.

import { canMerge, mergeAccounts, mergeConflicts, type MergeConflicts, type MergeResolution } from "../account";
import { first, isConstraintError, run } from "../d1";
import type { Env } from "../env";
import { createSession, signPendingMerge, verifyPendingMerge, type SessionUser } from "./session";
import type { VerifiedIdentity } from "./verify";

export type SignInOutcome =
  | { kind: "signed-in" | "created" | "linked" | "merged"; token: string; user: SessionUser }
  /** Both accounts already sign in with `conflict`. The person has to pick one side by hand. */
  | { kind: "provider-taken"; provider: string; conflict: string }
  /** The accounts overlap. `mergeToken` carries the proof to POST /v1/auth/merge. */
  | { kind: "merge-required"; mergeToken: string; conflicts: MergeConflicts };

interface IdentityRow {
  user_id: string;
  display_name: string | null;
}

export async function signIn(env: Env, identity: VerifiedIdentity, current: SessionUser | null): Promise<SignInOutcome> {
  const db = env.DB;
  const lookup = () =>
    first<IdentityRow>(
      db,
      "SELECT user_id, display_name FROM user_identities WHERE provider = ? AND provider_user_id = ?",
      [identity.provider, identity.providerUserId],
    );

  let existing = await lookup();

  if (!existing) {
    // An identity nobody has seen. The session's account takes it, or a new one does.
    const userId = current?.userId ?? crypto.randomUUID();
    try {
      await db.batch([
        // OR IGNORE: for a signed-in caller the row is already there.
        db.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").bind(userId),
        db.prepare(
          `INSERT INTO user_identities (provider, provider_user_id, user_id, display_name, avatar_url)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(identity.provider, identity.providerUserId, userId, identity.displayName, identity.avatarUrl),
      ]);
      const user: SessionUser = { userId, provider: identity.provider, displayName: identity.displayName };
      return { kind: current ? "linked" : "created", token: await createSession(env, user), user };
    } catch (e) {
      // Two sign-ins for the same new identity raced and the other one won. Its
      // row is the identity now; fall through and treat it as existing. The
      // batch rolled back, so no orphan users row was left behind.
      if (!isConstraintError(e)) throw e;
      existing = await lookup();
      if (!existing) throw e;
    }
  }

  // ── The identity exists, and who owns it decides everything ──────────────
  if (current && existing.user_id !== current.userId) {
    // Fold the signed-in account INTO the one that owns this identity: that is
    // the established account the person is trying to get back to, and the
    // signed-in one is typically minutes old.
    const guard = await canMerge(db, current.userId, existing.user_id);
    if (!guard.ok) return { kind: "provider-taken", provider: identity.provider, conflict: guard.provider };

    const conflicts = await mergeConflicts(db, current.userId, existing.user_id);
    if (conflicts.itemState > 0 || conflicts.episodeState > 0) {
      // Overlapping titles are the person's call. Nothing is written here.
      const mergeToken = await signPendingMerge(env, {
        from: current.userId, into: existing.user_id, provider: identity.provider,
      });
      return { kind: "merge-required", mergeToken, conflicts };
    }

    // No overlap, so there is no decision to make and the resolution is moot.
    const outcome = await mergeAccounts(db, current.userId, existing.user_id, "keep-theirs");
    if (!outcome.ok) return { kind: "provider-taken", provider: identity.provider, conflict: outcome.provider };
    console.log("accounts_merged", { provider: identity.provider, movedTables: outcome.movedTables });
    return finish(env, identity, existing, "merged");
  }

  return finish(env, identity, existing, "signed-in");
}

/** Refresh what the provider says about the person, then mint the session for the OWNER. */
async function finish(
  env: Env,
  identity: VerifiedIdentity,
  owner: IdentityRow,
  kind: "signed-in" | "merged",
): Promise<SignInOutcome> {
  const displayName = identity.displayName ?? owner.display_name;
  // Skipped when nothing changed: a sign-in should not cost a row write.
  if (identity.displayName && identity.displayName !== owner.display_name) {
    await run(
      env.DB,
      "UPDATE user_identities SET display_name = ?, avatar_url = COALESCE(?, avatar_url) WHERE provider = ? AND provider_user_id = ?",
      [identity.displayName, identity.avatarUrl, identity.provider, identity.providerUserId],
    );
  }
  // After a merge the session is for the SURVIVING account, which is not the
  // one that started the request. The caller must replace its token with this one.
  const user: SessionUser = { userId: owner.user_id, provider: identity.provider, displayName };
  return { kind, token: await createSession(env, user), user };
}

/**
 * Carry out a merge the person has decided on.
 *
 * The merge token is the proof, minted by signIn() above, that the caller
 * controlled both accounts a few minutes ago. The session must still be the
 * `from` account: a token lifted from one person is useless to another.
 */
export async function completeMerge(
  env: Env,
  current: SessionUser,
  mergeToken: string,
  resolution: MergeResolution,
): Promise<
  | { kind: "merged"; token: string; user: SessionUser }
  | { kind: "invalid" }
  | { kind: "provider-taken"; provider: string; conflict: string }
> {
  const pending = await verifyPendingMerge(env, mergeToken);
  if (!pending || pending.from !== current.userId) return { kind: "invalid" };

  const outcome = await mergeAccounts(env.DB, pending.from, pending.into, resolution);
  if (!outcome.ok) return { kind: "provider-taken", provider: pending.provider, conflict: outcome.provider };
  console.log("accounts_merged", { provider: pending.provider, movedTables: outcome.movedTables, resolution });

  const owner = await first<{ display_name: string | null }>(
    env.DB,
    "SELECT display_name FROM user_identities WHERE user_id = ? AND provider = ?",
    [pending.into, pending.provider],
  );
  const user: SessionUser = { userId: pending.into, provider: pending.provider, displayName: owner?.display_name ?? null };
  return { kind: "merged", token: await createSession(env, user), user };
}
