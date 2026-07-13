import { NextRequest, NextResponse } from "next/server";
import { log, errorFields } from "@/lib/logger";
import { randomUUID } from "crypto";
import { get, run } from "@/lib/db";
import { createSession, getSession, setSessionCookie } from "@/lib/session";
import { verifyOAuthState, clearOAuthState } from "@/lib/oauthState";
import { encryptSecret, encryptNullable } from "@/lib/crypto";
import { Source } from "@/types";

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
  provider: Source;
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

  // Every exit clears the single-use CSRF cookie so a nonce is never replayable.
  const fail = (path: string) => {
    const res = NextResponse.redirect(new URL(path, base));
    clearOAuthState(res);
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

    const redirect = existingUserId ? `/settings?connected=${opts.connectedLabel ?? opts.provider}` : "/dashboard";
    const res = NextResponse.redirect(new URL(redirect, base));
    clearOAuthState(res);
    // Only set the session cookie for a fresh login, not when linking to an
    // already-authenticated account.
    if (!existingUserId) res.cookies.set(setSessionCookie(token));
    return res;
  } catch (e: any) {
    log.error("oauth_callback_failed", { provider: opts.provider, ...errorFields(e) });
    return fail(opts.errorRedirect);
  }
}
