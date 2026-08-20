import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withScoringAdmin } from "@/lib/devAdmin";
import { parseJsonBody } from "@/lib/validate";
import { surveyGameCrossLinks, runCrossLinkBatch } from "@/lib/sources/crossLinkBackfill";
import { GAME_SOURCES } from "@/lib/sources/crossLink";
import type { Source } from "@/types";

// Reads + mutates live DB state, and makes outbound provider calls — never prerender.
export const dynamic = "force-dynamic";

// SM48 — run the game cross-link backfill against PROD.
//
// The sync adapters cross-link everything they ingest now, but under a small
// per-pass allowance (so a never-backfilled catalog can't turn a routine sync
// into minutes of title searches). That leaves an existing catalog draining over
// many syncs. `scripts/backfill-game-crosslinks.ts` drains a LOCAL database;
// this is how the same pass reaches the Railway volume, where there is no shell.
//
// Admin-gated behind the same SCORING_ADMIN_USER_IDS allowlist as
// /api/dev/prune and /api/dev/dbsize — a non-admin gets 404, not 403.
//
// GET  — survey. Pure counts, no network, no writes. Safe any time.
// POST — run one bounded batch and return a cursor to continue from.
//
// Deliberately NO confirmation string, unlike the prune's. That speed bump
// exists there because the prune DELETES hundreds of thousands of rows and is
// unrecoverable; this is insert-only (a source already linked is skipped before
// any network call) and the worst case of a stray call is a few seconds of
// searches. What it IS bounded by is cost: every item is a real provider search,
// so each request caps both the count and the wall clock, and the caller repeats.

export const GET = withScoringAdmin(async () => {
  return NextResponse.json({
    mode: "survey",
    all: surveyGameCrossLinks(),
    bySource: Object.fromEntries(
      GAME_SOURCES.map((s) => [s, surveyGameCrossLinks([s]).needing])
    ),
    hint: 'POST {"source":"steam","maxItems":25} then repeat with the returned nextAfterId until remaining is 0.',
  });
});

const BodySchema = z.object({
  // One source at a time is the normal shape: Steam is the tag source and worth
  // doing first, and RAWG is worth skipping entirely while RAWG is down.
  source: z.enum(["steam", "rawg", "igdb"]).optional(),
  // Kept small by default — each item is a live title search of roughly 0.6 s,
  // so 25 is about 15 s, comfortably inside a request.
  maxItems: z.number().int().positive().max(200).optional(),
  budgetMs: z.number().int().positive().max(120_000).optional(),
  afterId: z.string().optional(),
});

export const POST = withScoringAdmin(async (req: NextRequest) => {
  const body = await parseJsonBody(req, BodySchema);
  const sources: readonly Source[] = body.source ? [body.source] : GAME_SOURCES;

  const result = await runCrossLinkBatch({
    sources,
    maxItems: body.maxItems ?? 25,
    // Under a typical proxy timeout, so a batch returns a cursor rather than
    // dying halfway with its progress unreported (the writes would survive, but
    // the caller wouldn't know where to resume).
    budgetMs: body.budgetMs ?? 20_000,
    afterId: body.afterId ?? null,
  });

  return NextResponse.json({
    mode: "applied",
    sources,
    result,
    survey: surveyGameCrossLinks(sources),
    hint: result.nextAfterId
      ? `Repeat with {"afterId":"${result.nextAfterId}"}. ${result.remaining} still to visit.`
      : "Sweep complete for these sources.",
  });
});
