import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import { initDb, get, run } from "@/lib/db";
import { rawgLogin } from "@/lib/sources/rawg";
import { createSession, setSessionCookie, getSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  try {
    initDb();
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    // Authenticate with RAWG – returns token + slug
    let token: string;
    let slug: string;
    try {
      ({ token, slug } = await rawgLogin(email, password));
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Invalid RAWG credentials" }, { status: 401 });
    }

    // Encrypt password before storing
    const passwordHash = await bcrypt.hash(password, 12);
    const metadata = JSON.stringify({ passwordHash, slug });

    // Get existing session to link accounts, or create new user
    const existingSession = await getSession();
    const userId = existingSession?.userId ?? randomUUID();

    if (!existingSession) {
      run("INSERT OR IGNORE INTO users (id) VALUES (?)", [userId]);
    }

    const existing = get<any>(
      "SELECT id, user_id FROM user_identities WHERE provider = 'rawg' AND provider_user_id = ?",
      [email.toLowerCase()]
    );

    let identityId: string;
    let finalUserId: string;

    if (existing) {
      identityId = existing.id;
      finalUserId = existing.user_id;
      run(
        "UPDATE user_identities SET access_token = ?, metadata = ?, display_name = ? WHERE id = ?",
        [token, metadata, slug, identityId]
      );
    } else {
      identityId = randomUUID();
      finalUserId = existingSession?.userId ?? userId;
      run(
        `INSERT INTO user_identities (id, user_id, provider, provider_user_id, display_name, access_token, metadata)
         VALUES (?, ?, 'rawg', ?, ?, ?, ?)`,
        [identityId, finalUserId, email.toLowerCase(), slug, token, metadata]
      );
    }

    run("UPDATE users SET last_seen_at = strftime('%s','now') WHERE id = ?", [finalUserId]);

    const sessionToken = await createSession({
      userId: finalUserId,
      identityId,
      provider: "rawg",
      displayName: slug,
    });

    const redirect = existingSession ? "/settings?connected=rawg" : "/dashboard";
    const res = NextResponse.json({ ok: true, redirect });
    // Only set session cookie if this is a fresh login (not linking to existing account)
    if (!existingSession) {
      res.cookies.set(setSessionCookie(sessionToken));
    }
    return res;
  } catch (e: any) {
    console.error("[RAWG auth]", e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
