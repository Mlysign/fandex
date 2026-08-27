import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { query, get } from "@/lib/db";
import { getStoredCountry } from "@/lib/userCountry";
import { getUserPlatforms, getUserMediaTypes } from "@/lib/userPlatforms";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ user: null });

    const identities = query(
      "SELECT provider, provider_user_id, display_name, avatar_url, created_at FROM user_identities WHERE user_id = ?",
      [session.userId]
    );

    const syncLogs = query(
      `SELECT provider, MAX(synced_at) as last_sync, item_count, status
       FROM sync_log WHERE user_id = ? GROUP BY provider`,
      [session.userId]
    );

    const itemCount = get<{ count: number }>(
      "SELECT COUNT(*) as count FROM user_watchlist WHERE user_id = ?",
      [session.userId]
    );

    return NextResponse.json({
      user: {
        userId: session.userId,
        displayName: session.displayName,
        provider: session.provider,
        country: getStoredCountry(session.userId), // null = not set → client auto-detects
        platforms: getUserPlatforms(session.userId), // [] = not configured → the filter offers everything
        mediaTypes: getUserMediaTypes(session.userId), // [] = not configured → every type is on
      },
      identities,
      syncLogs,
      itemCount: itemCount?.count ?? 0,
    });
  } catch {
    return NextResponse.json({ user: null });
  }
}
