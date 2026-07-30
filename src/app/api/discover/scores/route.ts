import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { extractFacets } from "@/lib/facets";
import { buildProfile, computeFandexScore, invalidateDiscoveryCache } from "@/lib/discovery";
import { loadLinks, ensureTmdbDetail, ensureGameDetail } from "@/lib/detail/enrich";
import { mergeLinks } from "@/lib/merge";
import { get } from "@/lib/db";
import type { MediaType } from "@/types";

// 2026-07-29 — the second half of the facet-source fix (see liveDiscover.ts's
// `catalogFacets`). A live feed marks an item `fandexPending` when its local row
// is too thin to score honestly — genre tags only, no credits/keywords — rather
// than rendering a number we already know is depressed. This route is what the
// client calls to turn those into real scores.
//
// It is the SAME heal-then-score loop /api/detail and /api/facet/mine already
// run (SM23): the two healers no-op instantly for anything already fresh
// (checked via projectionVersion) and only hit a provider for a genuinely stale
// link, persisting the result — so an item heals ONCE, ever, and every later
// read of it (any surface, any user) is a cache hit. A third of the catalog is
// thin today, so this is a backfill that drains as people browse, not a
// recurring per-view cost.
//
// Cost guards, in the shadow of PR13-PR16 (an unbounded per-render provider
// fan-out is what cost a Railway outage):
//   - authed only (withUser) — crawlers can't reach it, and an anonymous
//     viewer has no profile and so no score to compute anyway;
//   - MAX_IDS per request, so one call can't fan out unboundedly;
//   - the client only asks for cards it has actually rendered;
//   - deliberately NOT calling /api/detail's enrichMissingSources, which
//     title-searches every other provider for a not-yet-linked source — fine
//     for one item on its own page, multiplicative across a feed. Same line
//     /api/facet/mine drew, for the same reason.
export const dynamic = "force-dynamic";

// One rail's worth. The client batches its visible pending cards; anything
// beyond this is dropped rather than silently truncated into a partial answer
// the caller can't distinguish (the response says which ids were skipped).
const MAX_IDS = 24;

export const POST = withUser(async (req: NextRequest, session) => {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = (body as { ids?: unknown })?.ids;
  if (!Array.isArray(raw)) {
    return NextResponse.json({ error: "ids must be an array" }, { status: 400 });
  }

  const requested = [...new Set(raw.filter((v): v is string => typeof v === "string" && !!v.trim()).map((s) => s.trim()))];
  const ids = requested.slice(0, MAX_IDS);
  const skipped = requested.slice(MAX_IDS);

  const profile = buildProfile(session.userId);
  const scores: Record<string, { score: number; center: number } | null> = {};
  let healed = false;

  for (const id of ids) {
    const links = loadLinks(id);
    if (!links.length) { scores[id] = null; continue; }
    const item = get<{ type: MediaType }>("SELECT type FROM media_items WHERE id = ?", [id]);
    if (!item) { scores[id] = null; continue; }

    // Both no-op unless the row is genuinely stale, and persist when they do.
    const a = await ensureTmdbDetail(links, item.type);
    const b = await ensureGameDetail(links, item.type);
    if (a || b) healed = true;

    const merged = mergeLinks(links, item.type);
    const fx = computeFandexScore(extractFacets(links, item.type, merged), profile);
    // A null here is honest and final: this item has too little metadata to
    // score even after healing (or the profile is cold). The client stops
    // showing a spinner for it rather than retrying forever.
    scores[id] = fx ? { score: fx.score, center: fx.center } : null;
  }

  // A heal rewrote media_links, and the discovery cache's signature only
  // watches media_items — so without this the freshly-enriched facets would
  // stay invisible to every catalog-backed surface until the 5-minute TTL
  // lapsed, and the very next feed render would mark the same item pending
  // again.
  if (healed) invalidateDiscoveryCache();

  return NextResponse.json({ scores, skipped });
});
