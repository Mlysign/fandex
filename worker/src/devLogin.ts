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
import type { Env } from "./env";

export interface DevAccount { userId: string; providerUserId: string; displayName: string }

/**
 * Fixed ids, so `.dev.vars` can name the first one in ADMIN_USER_IDS and the
 * admin pages can be tested too. The second is nobody special.
 */
export const DEV_ACCOUNTS: Record<string, DevAccount> = {
  smoketest: { userId: "d0d0d0d0-0000-4000-8000-000000000001", providerUserId: "dev:smoketest", displayName: "Smoke Test" },
  plain: { userId: "d0d0d0d0-0000-4000-8000-000000000002", providerUserId: "dev:plain", displayName: "Plain Test" },
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
       VALUES ('google', ?, ?, ?, NULL)`,
    ).bind(account.providerUserId, account.userId, account.displayName),
  ]);
  const user: SessionUser = { userId: account.userId, provider: "google", displayName: account.displayName };
  return { token: await createSession(env, user), user };
}
