import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { get, run } from "@/lib/db";
import { createSession, setSessionCookie } from "@/lib/session";
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

  if (!code) return NextResponse.redirect(new URL(opts.errorRedirect, req.url));

  try {
    const { userId: existingUserId } = state
      ? JSON.parse(Buffer.from(state, "base64url").toString())
      : { userId: null };

    const profile = await opts.resolve(code);

    let identity = get<any>(
      "SELECT * FROM user_identities WHERE provider = ? AND provider_user_id = ?",
      [opts.provider, profile.providerUserId]
    );

    if (identity) {
      run(
        "UPDATE user_identities SET access_token = ?, refresh_token = ?, token_expires_at = ?, display_name = ?, avatar_url = ? WHERE id = ?",
        [profile.accessToken, profile.refreshToken, profile.tokenExpiresAt, profile.displayName, profile.avatarUrl, identity.id]
      );
    } else {
      const userId = existingUserId ?? randomUUID();
      if (!existingUserId) run("INSERT INTO users (id) VALUES (?)", [userId]);

      const identityId = randomUUID();
      run(
        `INSERT INTO user_identities (id, user_id, provider, provider_user_id, display_name, avatar_url, access_token, refresh_token, token_expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [identityId, userId, opts.provider, profile.providerUserId, profile.displayName, profile.avatarUrl, profile.accessToken, profile.refreshToken, profile.tokenExpiresAt]
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
    const res = NextResponse.redirect(new URL(redirect, req.url));
    // Only set the session cookie for a fresh login, not when linking to an
    // already-authenticated account.
    if (!existingUserId) res.cookies.set(setSessionCookie(token));
    return res;
  } catch (e: any) {
    console.error(`[${opts.provider} callback]`, e);
    return NextResponse.redirect(new URL(opts.errorRedirect, req.url));
  }
}
