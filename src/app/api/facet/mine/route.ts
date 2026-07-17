import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { buildFacetDetail } from "@/lib/facetDetail";
import { FacetRole } from "@/lib/facets";

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

  return NextResponse.json({
    stats: {
      userAvg: payload.stats.userAvg,
      userCount: payload.stats.userCount,
      communityAvg: payload.stats.communityAvg,
      delta: payload.stats.delta,
      baseline: payload.stats.baseline,
    },
    states,
  });
});
