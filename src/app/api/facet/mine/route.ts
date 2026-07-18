import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { buildFacetDetail } from "@/lib/facetDetail";
import { FacetKind, FacetRole } from "@/lib/facets";
import { buildProfile, computeFandexScore, itemsWithFacet } from "@/lib/discovery";

// P17 — the PERSONAL overlay for a public facet page. The page itself is public
// and provider-sourced (publicFacetDetail.ts, no user data); this authed endpoint
// supplies ONLY the logged-in viewer's half: their you-vs-crowd stats and, per
// media id, their rating/library state. The client island fetches it and paints
// those onto the public items it already rendered (matched by media uuid).
//
// It reuses the existing authed builder and simply DROPS its item list + crowd
// fields, so there is one source of truth for "your average vs the crowd".
export const GET = withUser(async (req: NextRequest, session) => {
  const { searchParams } = req.nextUrl;
  const kind = searchParams.get("kind");
  const key = searchParams.get("key");
  if (!kind || !key) return NextResponse.json({ error: "kind and key are required" }, { status: 400 });

  // No role → the combined view (buildFacetDetail matches all roles for the key),
  // matching the public page which is always role-combined.
  const payload = await buildFacetDetail(session.userId, { kind, role: undefined as FacetRole | undefined, key, label: key });

  const states: Record<string, { rating: number | null; libraryStatus: string | null; onWatchlist: boolean }> = {};
  for (const i of payload.items) {
    if (i.rating != null || i.libraryStatus || i.onWatchlist) {
      states[i.id] = { rating: i.rating, libraryStatus: i.libraryStatus, onWatchlist: i.onWatchlist };
    }
  }

  // H5.6 — per-id Fandex Score for the client-side "Fandex Score" sort. Only the
  // viewer's own catalog items carrying this facet get a score (via the discovery
  // cache's facets); public pool items not in their library have none and sort
  // last. Combined view (no role), matching the public page.
  const profile = buildProfile(session.userId);
  const fandexById: Record<string, number> = {};
  for (const v of itemsWithFacet({ kind: kind as FacetKind, role: undefined, key })) {
    const sc = computeFandexScore(v.facets, profile)?.score;
    if (sc != null) fandexById[v.id] = sc;
  }

  return NextResponse.json({
    stats: {
      userAvg: payload.stats.userAvg,
      userCount: payload.stats.userCount,
      communityAvg: payload.stats.communityAvg,
      delta: payload.stats.delta,
      baseline: payload.stats.baseline,
    },
    states,
    fandexById,
  });
});
