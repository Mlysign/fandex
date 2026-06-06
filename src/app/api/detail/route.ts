import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { initDb, query } from "@/lib/db";
import { mergeLinks } from "@/lib/merge";
import { MediaLink, EnrichedItem, Source } from "@/types";
import { searchSteamByName, getSteamTagMap, resolveTagNames } from "@/lib/sources/steam";
import { searchRawg, getRawgGame } from "@/lib/sources/rawg";
import { normalizeName } from "@/lib/merge";

export async function GET(req: NextRequest) {
  try {
    initDb();
    const session = await requireSession();
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    // Get the media item
    const item = query<any>(
      "SELECT mi.*, uw.platform_sources FROM media_items mi JOIN user_watchlist uw ON uw.media_item_id = mi.id WHERE mi.id = ? AND uw.user_id = ?",
      [id, session.userId]
    )[0];
    if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // Get all existing links
    const linkRows = query<any>(
      "SELECT * FROM media_links WHERE media_item_id = ?",
      [id]
    );
    const links: MediaLink[] = linkRows.map((r: any) => ({
      id: r.id,
      mediaItemId: r.media_item_id,
      source: r.source as Source,
      sourceId: r.source_id,
      title: r.title,
      releaseDate: r.release_date,
      rawData: JSON.parse(r.raw_data),
      lastSynced: r.last_synced,
    }));

    const hasSources = new Set(links.map((l) => l.source));

    // For games: try to enrich with missing sources
    if (item.type === "game") {
      const title = item.title;

      // Fetch Steam if not present
      if (!hasSources.has("steam")) {
        try {
          const found = await searchSteamByName(title);
          if (found) {
            const tagMap = await getSteamTagMap();
            if (found.data.tagids) found.data.resolvedTags = resolveTagNames(found.data.tagids, tagMap);
            links.push({
              id: "live-steam",
              mediaItemId: id,
              source: "steam",
              sourceId: String(found.appid),
              title: found.data.name ?? title,
              releaseDate: null,
              rawData: { ...found.data, appid: found.appid },
              lastSynced: 0,
            });
          }
        } catch { /* continue */ }
      }

      // Fetch RAWG if not present
      if (!hasSources.has("rawg")) {
        try {
          const results = await searchRawg(title);
          const norm = normalizeName(title);
          const exact = results.results?.find(
            (r: any) => normalizeName(r.name) === norm
          );
          if (exact) {
            const full = await getRawgGame(exact.id);
            links.push({
              id: "live-rawg",
              mediaItemId: id,
              source: "rawg",
              sourceId: String(exact.id),
              title: full.name,
              releaseDate: full.released ?? null,
              rawData: full,
              lastSynced: 0,
            });
          }
        } catch { /* continue */ }
      }
    }

    const merged = mergeLinks(links, item.type);
    const enriched: EnrichedItem = {
      id: item.id,
      type: item.type,
      platformSources: JSON.parse(item.platform_sources ?? "[]"),
      ...merged,
    };

    return NextResponse.json({ item: enriched });
  } catch (e: any) {
    if (e.message === "Unauthorized") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    console.error(e);
    return NextResponse.json({ error: "Server error" }, { status: 500 });
  }
}
