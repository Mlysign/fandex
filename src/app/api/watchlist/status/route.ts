import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { initDb, get, query } from "@/lib/db";

// Returns which platforms the user has connected (of the right type)
// and whether this item is on each one
export async function GET(req: NextRequest) {
  try {
    initDb();
    const session = await requireSession();
    const mediaItemId = req.nextUrl.searchParams.get("id");
    const type = req.nextUrl.searchParams.get("type"); // game | movie | show

    if (!mediaItemId || !type) {
      return NextResponse.json({ error: "id and type required" }, { status: 400 });
    }

    // Get all connected identities for this user
    const identities = query<any>(
      "SELECT provider, display_name, provider_user_id FROM user_identities WHERE user_id = ?",
      [session.userId]
    );

    // Get current platform_sources for this watchlist item
    const watchlistEntry = get<any>(
      "SELECT platform_sources FROM user_watchlist WHERE user_id = ? AND media_item_id = ?",
      [session.userId, mediaItemId]
    );
    const currentSources: string[] = watchlistEntry
      ? JSON.parse(watchlistEntry.platform_sources)
      : [];

    // Determine which platforms are relevant for this item type
    // and which the user has connected
    const platformConfig: Record<string, { types: string[]; label: string; canWrite: boolean }> = {
      trakt: { types: ["movie", "show"], label: "Trakt.tv", canWrite: true },
      steam: { types: ["game"], label: "Steam", canWrite: false },
      rawg:  { types: ["game"], label: "RAWG", canWrite: true },
    };

    const platforms = identities
      .filter((id: any) => {
        const config = platformConfig[id.provider];
        return config && config.types.includes(type);
      })
      .map((id: any) => ({
        provider: id.provider,
        label: platformConfig[id.provider].label,
        displayName: id.display_name ?? id.provider_user_id,
        canWrite: platformConfig[id.provider].canWrite,
        onList: currentSources.includes(id.provider),
      }));

    // Also include platforms not connected but relevant (to show as "not connected")
    const connectedProviders = new Set(identities.map((i: any) => i.provider));
    const relevantUnconnected = Object.entries(platformConfig)
      .filter(([key, cfg]) => cfg.types.includes(type) && !connectedProviders.has(key))
      .map(([key, cfg]) => ({
        provider: key,
        label: cfg.label,
        displayName: null,
        canWrite: cfg.canWrite,
        onList: false,
        notConnected: true,
      }));

    return NextResponse.json({
      platforms: [...platforms, ...relevantUnconnected],
      onAnyList: currentSources.length > 0,
    });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
