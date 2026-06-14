import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { get, run } from "@/lib/db";
import { createTmdbSession, getTmdbAccount } from "@/lib/sources/tmdb";
import { getSession, createSession, setSessionCookie } from "@/lib/session";

// TMDB returns ?request_token=...&approved=true. We exchange it for a session_id,
// fetch the account, and upsert the identity — linking to the logged-in user when
// a session cookie is present, otherwise creating a fresh user.
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const requestToken = searchParams.get("request_token");
  const approved = searchParams.get("approved");

  if (!requestToken || approved !== "true") {
    return NextResponse.redirect(new URL("/settings?error=tmdb_denied", req.url));
  }

  try {
    const existing = await getSession();

    const sessionId = await createTmdbSession(requestToken);
    const account = await getTmdbAccount(sessionId);
    const displayName = account.username ?? account.name ?? "TMDB";
    const metadata = JSON.stringify({ accountId: account.id, username: account.username });

    let identity = get<any>(
      "SELECT * FROM user_identities WHERE provider = 'tmdb' AND provider_user_id = ?",
      [String(account.id)]
    );

    if (identity) {
      run(
        "UPDATE user_identities SET access_token = ?, metadata = ?, display_name = ? WHERE id = ?",
        [sessionId, metadata, displayName, identity.id]
      );
    } else {
      const userId = existing?.userId ?? randomUUID();
      if (!existing) run("INSERT INTO users (id) VALUES (?)", [userId]);
      const identityId = randomUUID();
      run(
        `INSERT INTO user_identities (id, user_id, provider, provider_user_id, display_name, access_token, metadata)
         VALUES (?, ?, 'tmdb', ?, ?, ?, ?)`,
        [identityId, userId, String(account.id), displayName, sessionId, metadata]
      );
      identity = { id: identityId, user_id: userId, display_name: displayName };
    }

    const token = await createSession({
      userId: identity.user_id,
      identityId: identity.id,
      provider: "tmdb",
      displayName: identity.display_name,
    });

    const redirect = existing ? "/settings?connected=TMDB" : "/dashboard";
    const res = NextResponse.redirect(new URL(redirect, req.url));
    if (!existing) res.cookies.set(setSessionCookie(token));
    return res;
  } catch (e: any) {
    console.error("[TMDB callback]", e);
    return NextResponse.redirect(new URL("/settings?error=tmdb_failed", req.url));
  }
}
