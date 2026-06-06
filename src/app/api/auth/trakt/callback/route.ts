import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { initDb, get, run } from "@/lib/db";
import { exchangeTraktCode, getTraktUserInfo } from "@/lib/sources/trakt";
import { createSession, setSessionCookie } from "@/lib/session";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const code = searchParams.get("code");
  const state = searchParams.get("state");

  if (!code) return NextResponse.redirect(new URL("/login?error=trakt_failed", req.url));

  try {
    initDb();
    const { userId: existingUserId } = state
      ? JSON.parse(Buffer.from(state, "base64url").toString())
      : { userId: null };

    const tokens = await exchangeTraktCode(code);
    const userInfo = await getTraktUserInfo(tokens.access_token);
    const expiresAt = Math.floor(Date.now() / 1000) + tokens.expires_in;

    // Find or create user identity
    let identity = get<any>(
      "SELECT * FROM user_identities WHERE provider = 'trakt' AND provider_user_id = ?",
      [userInfo.username]
    );

    if (identity) {
      // Update tokens
      run(
        "UPDATE user_identities SET access_token = ?, refresh_token = ?, token_expires_at = ?, display_name = ?, avatar_url = ? WHERE id = ?",
        [tokens.access_token, tokens.refresh_token, expiresAt, userInfo.name ?? userInfo.username, userInfo.images?.avatar?.full ?? null, identity.id]
      );
    } else {
      // Determine which user to attach to
      const userId = existingUserId ?? randomUUID();

      if (!existingUserId) {
        run("INSERT INTO users (id) VALUES (?)", [userId]);
      }

      const identityId = randomUUID();
      run(
        `INSERT INTO user_identities (id, user_id, provider, provider_user_id, display_name, avatar_url, access_token, refresh_token, token_expires_at)
         VALUES (?, ?, 'trakt', ?, ?, ?, ?, ?, ?)`,
        [identityId, userId, userInfo.username, userInfo.name ?? userInfo.username, userInfo.images?.avatar?.full ?? null, tokens.access_token, tokens.refresh_token, expiresAt]
      );

      identity = { id: identityId, user_id: userId, display_name: userInfo.name ?? userInfo.username };
    }

    const token = await createSession({
      userId: identity.user_id,
      identityId: identity.id,
      provider: "trakt",
      displayName: identity.display_name,
    });

    const redirect = existingUserId ? "/settings?connected=trakt" : "/dashboard";
    const res = NextResponse.redirect(new URL(redirect, req.url));
    // Only set session cookie if this is a fresh login (not linking to existing account)
    if (!existingUserId) {
      res.cookies.set(setSessionCookie(token));
    }
    return res;
  } catch (e: any) {
    console.error("[Trakt callback]", e);
    return NextResponse.redirect(new URL(`/login?error=trakt_failed`, req.url));
  }
}
