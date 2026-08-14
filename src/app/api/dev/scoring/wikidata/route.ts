import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { withScoringAdmin } from "@/lib/devAdmin";
import { parseJsonBody } from "@/lib/validate";
import { surveyWikidataSweep, runWikidataSweep } from "@/lib/sources/wikidataSweep";

// /api/dev/scoring/wikidata — run the franchise sweep against a live catalog.
//
// Same shape and reasoning as /api/dev/crosslink: prod has no shell, every item
// is a real provider round-trip, so each request caps both count and wall clock
// and the caller repeats until `remaining` is 0. Insert-only — the worst case of
// a stray call is a few seconds of SPARQL — so there is no confirmation string.
//
// Reads + mutates live DB state and makes outbound calls → never prerender.
export const dynamic = "force-dynamic";

export const GET = withScoringAdmin(async () => {
  return NextResponse.json({
    mode: "survey",
    ...surveyWikidataSweep(),
    hint: 'POST {"maxItems":100} and repeat until remaining is 0.',
  });
});

const BodySchema = z.object({
  maxItems: z.number().int().positive().max(500).optional(),
  budgetMs: z.number().int().positive().max(120_000).optional(),
});

export const POST = withScoringAdmin(async (req: NextRequest) => {
  const body = await parseJsonBody(req, BodySchema);
  try {
    return NextResponse.json(await runWikidataSweep(body));
  } catch (e) {
    // A provider failure surfaces as an error rather than an empty success:
    // the sweep marks nothing checked on a throw, so retrying re-asks the same
    // items instead of recording them as "Wikidata doesn't know".
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
});
