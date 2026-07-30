import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { query } from "@/lib/db";
import { getDerivedForItem, type RawLink } from "@/lib/facetCache";
import { getUserCountry } from "@/lib/userCountry";
import { getUserStateMap } from "@/lib/userState";
import { buildProfile, computeFandexScore } from "@/lib/discovery";
import type { EnrichedItem, MediaLink, MediaType, Source } from "@/types";

export const GET = withUser(async (req: NextRequest, session) => {
    const { searchParams } = req.nextUrl;
    const typeFilter = searchParams.get("type") as MediaType | null;
    const sourceFilter = searchParams.get("source") as Source | null;

    // Fetch user's watchlist with all linked source data
    let sql = `
      SELECT
        mi.id, mi.type, mi.title, mi.release_date, mi.poster_url,
        uw.platform_sources, uw.added_at,
        ml.source, ml.source_id, ml.raw_data, ml.release_date as link_release_date, ml.last_synced
      FROM user_watchlist uw
      JOIN media_items mi ON mi.id = uw.media_item_id
      LEFT JOIN media_links ml ON ml.media_item_id = mi.id
      WHERE uw.user_id = ?
    `;
    const params: any[] = [session.userId];

    if (typeFilter) { sql += " AND mi.type = ?"; params.push(typeFilter); }

    const rows = query<any>(sql, params);

    // Group rows by media_item id. `raw_data` stays UNPARSED (2026-07-31 perf
    // audit) — see /api/library and lib/facetCache.ts for the same fix.
    const itemMap = new Map<string, { item: any; rawLinks: RawLink[] }>();
    for (const row of rows) {
      if (!itemMap.has(row.id)) {
        itemMap.set(row.id, {
          item: {
            id: row.id,
            type: row.type,
            title: row.title,
            releaseDate: row.release_date,
            posterUrl: row.poster_url,
            platformSources: JSON.parse(row.platform_sources ?? "[]"),
            addedAt: row.added_at,
          },
          rawLinks: [],
        });
      }
      if (row.source) {
        itemMap.get(row.id)!.rawLinks.push({
          source: row.source as MediaLink["source"], sourceId: row.source_id,
          releaseDate: row.link_release_date, rawData: row.raw_data, lastSynced: row.last_synced ?? 0,
        });
      }
    }

    // Build enriched items (region-aware release date + streaming, T22)
    const country = getUserCountry(session.userId);
    const profile = buildProfile(session.userId);
    const enriched: EnrichedItem[] = [];
    for (const [id, { item, rawLinks }] of itemMap.entries()) {
      // Source filter
      if (sourceFilter && !item.platformSources.includes(sourceFilter)) continue;

      const { facets, merged } = getDerivedForItem(id, rawLinks, item.type, country);
      const fx = computeFandexScore(facets, profile);
      // List projection, same as /api/library (2026-07-30 perf audit): drop
      // `sources[].data`, the raw provider blob per link, which no card or
      // calendar cell reads. Keep the identity pair for buildItemHref.
      const { sources, ...rest } = merged;
      enriched.push({
        id: item.id,
        type: item.type,
        platformSources: item.platformSources,
        ...rest,
        sources: (sources ?? []).map((s) => ({ source: s.source, sourceId: s.sourceId, data: {} })),
        fandexScore: fx?.score ?? null,
        fandexCenter: fx?.center ?? null,
      });
    }

    // Canonical user-state: these are wishlist items, but also surface the
    // library state (watched/played + rating) so the same item looks identical
    // here and on the Library page.
    const stateMap = getUserStateMap(session.userId, enriched.map((e) => e.id));
    for (const e of enriched) {
      const st = stateMap.get(e.id);
      if (st) { e.libraryStatus = st.libraryStatus; e.rating = st.rating; e.reviewedAt = st.reviewedAt; }
    }

    // Sort by release date, TBA last
    enriched.sort((a, b) => {
      if (!a.releaseDate && !b.releaseDate) return 0;
      if (!a.releaseDate) return 1;
      if (!b.releaseDate) return -1;
      return a.releaseDate.localeCompare(b.releaseDate);
    });

    return NextResponse.json({ items: enriched });
});
