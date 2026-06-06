import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { initDb, query, get } from "@/lib/db";

export async function GET() {
  try {
    initDb();
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
      },
      identities,
      syncLogs,
      itemCount: itemCount?.count ?? 0,
    });
  } catch {
    return NextResponse.json({ user: null });
  }
}
