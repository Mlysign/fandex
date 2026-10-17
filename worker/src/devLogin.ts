/**
 * The test accounts, for a Worker running on a developer's machine.
 *
 * The one real account's writes are real: a rating goes to Trakt, a delete is a
 * delete. So nothing destructive could be tested, and "you can no longer rate
 * games" once survived a whole day of checking because nobody rated a game.
 * `POST /v1/dev/login` signs in as an account made for wrecking. It signs in
 * with no provider behind it, so a device signed in as one holds no Trakt
 * token and every rating, wishlist change and hide stays in the local D1.
 *
 * Two gates, and it takes BOTH to answer anything but 404:
 *   1. `DEV_LOGIN` is "1". It is set in `.dev.vars`, which git ignores and
 *      `wrangler deploy` never reads. It is not in wrangler.jsonc and must
 *      never be added there or pushed as a secret.
 *   2. The request reached a loopback host. A deployed Worker is reached at a
 *      workers.dev or fandex.org name and at nothing else.
 * A test holds each gate shut on its own.
 */

import { createSession, type SessionUser } from "./auth/session";
import { signIn, type SignInOutcome } from "./auth/signin";
import type { Env } from "./env";

export interface DevAccount {
  userId: string;
  providerUserId: string;
  displayName: string;
  /** The way in it pretends to be. Two accounts that share one can never be joined, so the third differs. */
  provider: "google" | "discord";
}

/**
 * Fixed ids, so `.dev.vars` can name the first one in ADMIN_USER_IDS and the
 * admin pages can be tested too. The second is nobody special. The third signs
 * in "with Discord", so it can be JOINED to either of the others (2026-10-17):
 * signed in as one, connecting it is a real sign-in finding another account.
 */
export const DEV_ACCOUNTS: Record<string, DevAccount> = {
  smoketest: { userId: "d0d0d0d0-0000-4000-8000-000000000001", providerUserId: "dev:smoketest", displayName: "Smoke Test", provider: "google" },
  plain: { userId: "d0d0d0d0-0000-4000-8000-000000000002", providerUserId: "dev:plain", displayName: "Plain Test", provider: "google" },
  third: { userId: "d0d0d0d0-0000-4000-8000-000000000003", providerUserId: "dev:third", displayName: "Third Test", provider: "discord" },
};

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function devLoginAllowed(env: Env, url: URL): boolean {
  return env.DEV_LOGIN === "1" && LOOPBACK.has(url.hostname);
}

/**
 * Make the account if it is not there, and mint a session for it. Deleting the
 * account from the app and signing in again starts it empty, which is how to
 * reset one.
 *
 * The identity is `google`, which holds no library (IDENTITY_ONLY_PROVIDERS):
 * no sync ever runs for it and nothing is pulled or pruned.
 */
export async function devLogin(env: Env, name: string): Promise<{ token: string; user: SessionUser } | null> {
  const account = DEV_ACCOUNTS[name];
  if (!account) return null;
  await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO users (id) VALUES (?)").bind(account.userId),
    env.DB.prepare(
      `INSERT OR IGNORE INTO user_identities (provider, provider_user_id, user_id, display_name, avatar_url)
       VALUES (?, ?, ?, ?, NULL)`,
    ).bind(account.provider, account.providerUserId, account.userId, account.displayName),
  ]);
  const user: SessionUser = { userId: account.userId, provider: account.provider, displayName: account.displayName };
  return { token: await createSession(env, user), user };
}

/**
 * Add a test account's way in to the SIGNED-IN account, the way connecting
 * Discord in Settings does: through the real signIn(), so a test account that
 * already exists is the "this belongs to another Fandex account" case and
 * answers merge-required or merged exactly as a real provider would.
 */
export async function devConnect(env: Env, name: string, current: SessionUser): Promise<SignInOutcome | null> {
  const account = DEV_ACCOUNTS[name];
  if (!account) return null;
  return signIn(env, { provider: account.provider, providerUserId: account.providerUserId, displayName: account.displayName, avatarUrl: null }, current);
}
