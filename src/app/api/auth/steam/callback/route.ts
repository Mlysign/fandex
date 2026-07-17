import { NextRequest, NextResponse } from "next/server";
import { log, errorFields } from "@/lib/logger";
import { randomUUID } from "crypto";
import { get, run } from "@/lib/db";
import { verifySteamOpenId, extractSteamId, getSteamPlayerSummary } from "@/lib/sources/steam";
import { createSession, getSession, setSessionCookie } from "@/lib/session";
import { verifyOAuthState, clearOAuthState, readOAuthReturn, clearOAuthReturn } from "@/lib/oauthState";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  // Public origin, not req.url (which is the internal 0.0.0.0:8080 behind Railway's proxy).
  const base = process.env.NEXT_PUBLIC_BASE_URL || req.url;

  const fail = (path: string) => {
    const res = NextResponse.redirect(new URL(path, base));
    clearOAuthState(res);
    clearOAuthReturn(res);
    return res;
  };

  // CSRF (S1): the return must carry the nonce we planted in THIS browser.
  if (!verifyOAuthState(req, searchParams.get("state"))) {
    return fail("/login?error=steam_failed");
  }

  try {
    // Verify with Steam
    const valid = await verifySteamOpenId(searchParams);
    if (!valid) return fail("/login?error=steam_failed");

    const steamId = extractSteamId(searchParams);
    if (!steamId) return fail("/login?error=steam_no_id");

    // Link target from the SESSION, never a client-supplied id.
    const session = await getSession();
    const existingUserId = session?.userId ?? null;
    const profile = await getSteamPlayerSummary(steamId);

    let identity = get<any>(
      "SELECT * FROM user_identities WHERE provider = 'steam' AND provider_user_id = ?",
      [steamId]
    );

    if (identity) {
      run(
        "UPDATE user_identities SET display_name = ?, avatar_url = ? WHERE id = ?",
        [profile?.personaname ?? steamId, profile?.avatarfull ?? null, identity.id]
      );
    } else {
      const userId = existingUserId ?? randomUUID();
      if (!existingUserId) {
        run("INSERT INTO users (id) VALUES (?)", [userId]);
      }

      const identityId = randomUUID();
      run(
        `INSERT INTO user_identities (id, user_id, provider, provider_user_id, display_name, avatar_url)
         VALUES (?, ?, 'steam', ?, ?, ?)`,
        [identityId, userId, steamId, profile?.personaname ?? steamId, profile?.avatarfull ?? null]
      );
      identity = { id: identityId, user_id: userId, display_name: profile?.personaname ?? steamId };
    }

    run("UPDATE users SET last_seen_at = strftime('%s','now') WHERE id = ?", [identity.user_id]);

    const token = await createSession({
      userId: identity.user_id,
      identityId: identity.id,
      provider: "steam",
      displayName: identity.display_name,
    });

    // Fresh login → the H2c return path (login-with-intent), else /dashboard.
    const redirect = existingUserId ? "/settings?connected=steam" : (readOAuthReturn(req) ?? "/dashboard");
    const res = NextResponse.redirect(new URL(redirect, base));
    clearOAuthState(res);
    clearOAuthReturn(res);
    // Only set session cookie if this is a fresh login (not linking to existing account)
    if (!existingUserId) {
      res.cookies.set(setSessionCookie(token));
    }
    return res;
  } catch (e: any) {
    log.error("steam_callback_error", { ...errorFields(e) });
    return fail("/login?error=steam_failed");
  }
}
