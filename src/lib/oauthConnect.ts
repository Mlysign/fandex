import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { log, errorFields } from "@/lib/logger";
import { randomUUID } from "crypto";
import { get, run } from "@/lib/db";
import { createSession, getSession, setSessionCookie } from "@/lib/session";
import { verifyOAuthState, clearOAuthState, readOAuthReturn, clearOAuthReturn } from "@/lib/oauthState";
import { encryptSecret, encryptNullable } from "@/lib/crypto";
import { mergeAccounts, canMerge, mergeConflicts } from "@/lib/accountMerge";
import { signPendingMerge, setPendingMergeCookie } from "@/lib/pendingMerge";
import type { AuthProvider } from "@/types";

// Normalized profile every OAuth provider resolves to after exchanging its code.
export interface OAuthProfile {
  providerUserId: string;          // unique id within the provider
  displayName: string | null;
  avatarUrl: string | null;
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: number | null;   // unix seconds, or null when the provider has none
}

interface OAuthCallbackOptions {
  // AuthProvider, not Source: an identity-only provider (Google) can mint a
  // session but is not a place media comes from. → src/types/index.ts
  provider: AuthProvider;
  resolve: (code: string) => Promise<OAuthProfile>; // exchange code + fetch profile
  errorRedirect: string;            // where to send the user on failure
  connectedLabel?: string;          // ?connected=<label> on success (defaults to provider)
}

// Shared OAuth callback flow used by every OAuth provider. Exchanges the code,
// upserts the user_identity — linking to the already-logged-in user when `state`
// carries one, otherwise creating a fresh user — starts a session, and redirects.
// Provider-specific work is confined to `resolve()`.
export async function handleOAuthCallback(
  req: NextRequest,
  opts: OAuthCallbackOptions
): Promise<NextResponse> {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  // Build redirects from the configured public origin, NOT req.url: behind a
  // proxy (Railway) req.url resolves to the internal bind host (0.0.0.0:8080),
  // which would bounce the user to a dead address after login.
  const base = process.env.NEXT_PUBLIC_BASE_URL || req.url;

  // Every exit clears the single-use CSRF + return cookies so neither is replayable.
  const fail = (path: string) => {
    const res = NextResponse.redirect(new URL(path, base));
    clearOAuthState(res);
    clearOAuthReturn(res);
    return res;
  };

  if (!code) return fail(opts.errorRedirect);
  // CSRF (S1): the redirect must carry the nonce we planted in THIS browser at
  // the start of the flow. Blocks an attacker forcing a link/login via a forged
  // callback URL.
  if (!verifyOAuthState(req, state)) return fail(opts.errorRedirect);

  try {
    // Link target is derived from the SESSION, never from client-supplied state:
    // trusting `state.userId` let anyone attach their provider identity to (or
    // hijack) an arbitrary account by crafting the state blob.
    const session = await getSession();
    const existingUserId = session?.userId ?? null;

    const profile = await opts.resolve(code);

    let identity = get<any>(
      "SELECT * FROM user_identities WHERE provider = ? AND provider_user_id = ?",
      [opts.provider, profile.providerUserId]
    );

    // ── The identity already exists, and WHO OWNS IT decides everything ──────
    //
    // This branch used to be one unconditional UPDATE. When the owner was a
    // DIFFERENT account from the session's, it refreshed that other account's
    // tokens, linked nothing, and still redirected to `?connected=<provider>` —
    // so the page said "connected successfully" while the provider still showed
    // a Connect button. Nils hit exactly that signing in with Discord and then
    // connecting Google (2026-09-02). It also wrote to another account's row
    // from this session, which is not an escalation (you must control that
    // provider account to get here) but is not ours to do either.
    let mergedFrom: string | null = null;
    if (identity && existingUserId && identity.user_id !== existingUserId) {
      // Nils's rule: fold the signed-in account INTO the one that owns this
      // identity, because that is the established account the user is trying to
      // get back to. `canMerge` refuses rather than inventing an answer when the
      // target already signs in with one of our providers, or when both sides
      // hold real library state.
      const guard = canMerge(existingUserId, identity.user_id);
      if (!guard.ok) {
        log.info("oauth_link_refused", { provider: opts.provider, conflicting: guard.provider });
        // BOTH provider names, because the message names two different roles:
        // `provider` is the one being connected, `conflict` is the one already
        // taken on the other account. A single name made the copy read "log in
        // with discord, disconnect discord", which is nonsense.
        return fail(
          `/settings?linkError=provider-taken&provider=${opts.provider}&conflict=${guard.provider}`,
        );
      }

      // ⚠️ OVERLAPPING TITLES ARE THE USER'S CALL. Nils: "it should give me a
      // merge form for me to decide and then execute the merge right after."
      // So this parks a signed proof that both accounts were just demonstrated
      // to be the same person's, and hands the decision to /settings. Nothing is
      // written here — a merge that picked a winner on its own is exactly what
      // the form exists to prevent.
      const conflicts = mergeConflicts(existingUserId, identity.user_id);
      if (conflicts.itemState > 0 || conflicts.episodeState > 0) {
        const pending = await signPendingMerge({
          from: existingUserId, into: identity.user_id, provider: opts.provider,
        });
        log.info("oauth_merge_needs_resolution", {
          provider: opts.provider,
          itemState: conflicts.itemState, episodeState: conflicts.episodeState,
        });
        const res = NextResponse.redirect(new URL("/settings?mergePending=1", base));
        clearOAuthState(res);
        clearOAuthReturn(res);
        setPendingMergeCookie(res, pending);
        return res;
      }

      // No overlap: "merge where possible" needs no decision, so it just happens.
      // The resolution is irrelevant here by construction and passed only to
      // satisfy the signature.
      const outcome = mergeAccounts(existingUserId, identity.user_id, "keep-theirs");
      if (!outcome.ok) {
        log.info("oauth_link_refused", { provider: opts.provider, conflicting: outcome.provider });
        return fail(
          `/settings?linkError=provider-taken&provider=${opts.provider}&conflict=${outcome.provider}`,
        );
      }
      mergedFrom = existingUserId;
      log.info("oauth_accounts_merged", {
        provider: opts.provider, movedTables: outcome.movedTables,
      });
    }

    if (identity) {
      run(
        "UPDATE user_identities SET access_token = ?, refresh_token = ?, token_expires_at = ?, display_name = ?, avatar_url = ? WHERE id = ?",
        [encryptSecret(profile.accessToken), encryptNullable(profile.refreshToken), profile.tokenExpiresAt, profile.displayName, profile.avatarUrl, identity.id]
      );
    } else {
      const userId = existingUserId ?? randomUUID();
      if (!existingUserId) run("INSERT INTO users (id) VALUES (?)", [userId]);

      const identityId = randomUUID();
      run(
        `INSERT INTO user_identities (id, user_id, provider, provider_user_id, display_name, avatar_url, access_token, refresh_token, token_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [identityId, userId, opts.provider, profile.providerUserId, profile.displayName, profile.avatarUrl, encryptSecret(profile.accessToken), encryptNullable(profile.refreshToken), profile.tokenExpiresAt]
      );
      identity = { id: identityId, user_id: userId, display_name: profile.displayName };
    }

    const token = await createSession({
      userId: identity.user_id,
      identityId: identity.id,
      provider: opts.provider,
      displayName: identity.display_name,
    });

    // Fresh login → the return path from the connect route (login-with-intent,
    // H2c), falling back to /wishlist. Linking an extra provider to an existing
    // account keeps returning to settings.
    const label = opts.connectedLabel ?? opts.provider;
    const redirect = mergedFrom
      // The accounts became one and the SURVIVOR is the other account, so this
      // is a different outcome from both "logged in" and "linked a provider".
      // Saying so matters: the person is now signed in as a different user id
      // than the one they started the request with.
      ? `/settings?merged=${label}`
      : existingUserId
        ? `/settings?connected=${label}`
        : (readOAuthReturn(req) ?? "/wishlist");
    const res = NextResponse.redirect(new URL(redirect, base));
    clearOAuthState(res);
    clearOAuthReturn(res);
    // A fresh login needs the cookie, and so does a MERGE — the session was
    // minted for `identity.user_id`, which after a merge is the surviving
    // account, not the one that started this request. Without this the browser
    // would keep a cookie for a `users` row the merge just deleted.
    if (!existingUserId || mergedFrom) res.cookies.set(setSessionCookie(token));
    return res;
  } catch (e: any) {
    log.error("oauth_callback_failed", { provider: opts.provider, ...errorFields(e) });
    return fail(opts.errorRedirect);
  }
}
