import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { get, run } from "@/lib/db";
import { verifySteamOpenId, extractSteamId, getSteamPlayerSummary } from "@/lib/sources/steam";
import { createSession, setSessionCookie } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  try {
    // Verify with Steam
    const valid = await verifySteamOpenId(searchParams);
    if (!valid) return NextResponse.redirect(new URL("/login?error=steam_failed", req.url));

    const steamId = extractSteamId(searchParams);
    if (!steamId) return NextResponse.redirect(new URL("/login?error=steam_no_id", req.url));

    const existingUserId = searchParams.get("link") ?? null;
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

    const redirect = existingUserId ? "/settings?connected=steam" : "/dashboard";
    const res = NextResponse.redirect(new URL(redirect, req.url));
    // Only set session cookie if this is a fresh login (not linking to existing account)
    if (!existingUserId) {
      res.cookies.set(setSessionCookie(token));
    }
    return res;
  } catch (e: any) {
    console.error("[Steam callback]", e);
    return NextResponse.redirect(new URL("/login?error=steam_failed", req.url));
  }
}
