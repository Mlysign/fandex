import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { extractFacets } from "@/lib/facets";
import { buildProfile, computeFandexScore, scoringContext, invalidateDiscoveryCache } from "@/lib/discovery";
import { loadLinks, healLinks, createHealBudget } from "@/lib/detail/enrich";
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
//
// 2026-08-13 (SM44) — and a LATENCY guard, which the cost guards above did not
// give us. MAX_IDS bounds the number of calls, not their duration: with RAWG
// down (Cloudflare 522, ~19.8 s × 3 attempts ≈ 60 s per call) a 24-game batch
// measured **66 s** on one half-open probe, and ~3 min on a cold process before
// the breaker latched. The client's fetch simply hangs for all of it and no
// badge ever paints — which is exactly the "the score is missing while I'm
// searching" report this route was supposed to fix. See the deferred contract
// below; the general rule is in AGENTS.md ("per-source FAILURE isolation is not
// per-source LATENCY isolation") and it applies here even though this reads as
// a scoring endpoint: any route that awaits an enricher in a loop IS a provider
// path.
export const dynamic = "force-dynamic";

// One rail's worth. The client batches its visible pending cards; anything
// beyond this is dropped rather than silently truncated into a partial answer
// the caller can't distinguish (the response says which ids were skipped).
const MAX_IDS = 24;

// Whole-REQUEST wall clock for the heal loop — not http.ts's per-call
// BROWSE_BUDGET_MS, which wouldn't bound this: one request makes up to 48
// provider calls (24 games × IGDB + RAWG), so a per-call budget of 8 s still
// admits minutes in aggregate. 10 s is ~2× a measured healthy batch (4.3 s for
// 24 IGDB heals), so nothing that would have finished gets cut off, while a dead
// provider costs one budget instead of one ladder per item.
export const DEFAULT_HEAL_BUDGET_MS = 10_000;

// Overridable like SYNC_BUDGET_MS, and for the same reason — a test must not sit
// through the real budget to prove the route gives up.
export function healBudgetMs(): number {
  const raw = Number(process.env.HEAL_BUDGET_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HEAL_BUDGET_MS;
}

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
  // One context for the batch. Nothing in the heal loop below writes ip
  // aliases, item overrides or the scoring config, so this is exactly as fresh
  // as the per-item lookups it replaces.
  const ctx = scoringContext();
  const scores: Record<string, { score: number; center: number } | null> = {};
  // The THIRD state, and the easiest thing here to get wrong. `scores[id] =
  // null` means "asked, and the answer is genuinely no score" — the client
  // caches that as FINAL and stops the spinner forever. An item we simply
  // couldn't heal in time is not that: scoring it from links we know are stale
  // would hand back a depressed number (the exact thing `fandexPending` exists
  // to avoid), and calling it null would make it permanently unscoreable in the
  // client's module cache until a reload. So it goes here instead, and is
  // deliberately ABSENT from `scores` — a deferred id must never also be a null.
  const deferred: string[] = [];
  const budget = createHealBudget(healBudgetMs());
  let healed = false;

  for (const id of ids) {
    const links = loadLinks(id);
    if (!links.length) { scores[id] = null; continue; }
    const item = get<{ type: MediaType }>("SELECT type FROM media_items WHERE id = ?", [id]);
    if (!item) { scores[id] = null; continue; }

    // No-ops (and costs nothing) unless the row is genuinely stale; persists
    // when it heals. The shared budget means the first dead provider is written
    // off for the rest of the loop, so a healthy source later in the same batch
    // still heals, and past the deadline it stops calling providers at all — an
    // item with nothing stale still scores either way, needing no provider.
    const heal = await healLinks(links, item.type, budget);
    if (heal.healed) healed = true;
    if (heal.incomplete) { deferred.push(id); continue; }

    const merged = mergeLinks(links, item.type);
    const fx = computeFandexScore(extractFacets(links, item.type, merged), profile, undefined, { mediaItemId: id, ctx });
    scores[id] = fx ? { score: fx.score, center: fx.center } : null;
  }

  // A heal rewrote media_links, and the discovery cache's signature only
  // watches media_items — so without this the freshly-enriched facets would
  // stay invisible to every catalog-backed surface until the 5-minute TTL
  // lapsed, and the very next feed render would mark the same item pending
  // again.
  if (healed) invalidateDiscoveryCache();

  return NextResponse.json({ scores, skipped, deferred });
});
