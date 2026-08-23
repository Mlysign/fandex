import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withScoringAdmin } from "@/lib/devAdmin";
import { parseJsonBody } from "@/lib/validate";
import { surveyFranchises, runFranchiseSweep } from "@/lib/franchiseSweep";
import { franchiseSweepStats } from "@/lib/franchiseMembers";

// Reads + mutates live DB state, and makes outbound provider calls — never prerender.
export const dynamic = "force-dynamic";

// Fill `franchise_members` against PROD (2026-08-23).
//
// The item page's "More from …" rail could only ever list catalog rows, and the
// catalog is thin exactly where franchises are concerned: measured that day,
// **167 of 249 distinct TMDB collections held exactly one title**, so two thirds
// of films carrying a franchise showed no rail at all while TMDB knew the full
// list. Star Wars showed 9 of 12; Terminator 5 of 6.
//
// Admin-gated behind the same SCORING_ADMIN_USER_IDS allowlist as
// /api/dev/prune, /api/dev/dbsize and /api/dev/crosslink — a non-admin gets
// 404, not 403. There is no shell on the Railway volume, so an admin route is
// how a sweep reaches prod at all.
//
// GET  — survey. Pure counts, no network, no writes. Safe any time.
// POST — run one bounded batch. Repeat until `remaining` is 0.
//
// No confirmation string, deliberately, and for the same reason /api/dev/
// crosslink has none: this only ever replaces one (franchise, source)
// membership set with a freshly fetched one. It writes no media_items, touches
// no user data, and the worst case of a stray call is a few seconds of provider
// requests. The prune's speed bump exists because the prune is unrecoverable.
//
// COST, so nobody has to re-derive it: ~421 calls to sweep everything once,
// against 158,257 TMDB calls in a month. 0.16% of one month's budget. Neither
// provider is RAWG, so the exhausted RAWG quota is not a constraint here.

export const GET = withScoringAdmin(async () => {
  const targets = surveyFranchises();
  const bySource: Record<string, { franchises: number; swept: number }> = {};
  for (const t of targets) {
    const b = (bySource[t.source] ??= { franchises: 0, swept: 0 });
    b.franchises++;
    if (t.fetchedAt > 0) b.swept++;
  }
  return NextResponse.json({
    mode: "survey",
    targets: targets.length,
    bySource,
    stored: franchiseSweepStats(),
    // The ten biggest gaps, so a survey answers "is it worth running" rather
    // than only "how much is left".
    largestUnswept: targets
      .filter((t) => t.fetchedAt === 0)
      .slice(0, 10)
      .map((t) => ({ source: t.source, name: t.name, providerId: t.providerId })),
    hint: 'POST {"source":"tmdb","maxItems":25} and repeat until remaining is 0. TMDB first: it is ~4.8 members per collection against IGDB\'s ~78, so it is the cheap half.',
  });
});

const BodySchema = z.object({
  // One source at a time is the normal shape. TMDB is much cheaper per call and
  // covers films; IGDB franchises are an order of magnitude larger.
  source: z.enum(["tmdb", "igdb"]).optional(),
  // Each item is one provider call of roughly 0.2–0.5 s, so 25 sits well inside
  // a request even with a slow provider.
  maxItems: z.number().int().positive().max(200).optional(),
  // What counts as due for a re-sweep. Franchise membership changes on the
  // order of months, so the default is 30 days. Pass 0 to force a full re-sweep.
  maxAgeSec: z.number().int().nonnegative().optional(),
  budgetMs: z.number().int().positive().max(120_000).optional(),
});

export const POST = withScoringAdmin(async (req: NextRequest) => {
  const body = await parseJsonBody(req, BodySchema);
  const result = await runFranchiseSweep({
    source: body.source,
    maxItems: body.maxItems,
    maxAgeSec: body.maxAgeSec,
    budgetMs: body.budgetMs,
  });
  return NextResponse.json({
    mode: "sweep",
    ...result,
    stored: franchiseSweepStats(),
  });
});
