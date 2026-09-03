import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { parseJsonBody } from "@/lib/validate";
import { SuggestionDismissSchema } from "@/lib/schemas";
import {
  runTaxonomySweep, dismissSuggestion, undismissSuggestion, invalidateSweepCache,
} from "@/lib/taxonomySuggestions";

// /api/dev/scoring/suggestions — the Taxonomy panel's Review section
// (2026-09-03).
//
// Nils: "build me an easy way to review those suggestions and either accept,
// deny or correct them right away."
//
// There is no ACCEPT here, and that is the design. Accepting a tag batch posts
// to /api/dev/scoring/overrides, a franchise merge posts the `bundle` action to
// /api/dev/scoring/franchises, and a membership posts `attach` to the same
// route. Every invariant those paths carry keeps holding without being restated,
// and no suggestion can reach a write path that manual review does not already
// use. This route only generates the queue and remembers the NOs.
//
// Reads + mutates live DB state → never prerender.
export const dynamic = "force-dynamic";

// GET ?refresh=1 — the whole queue plus the sweep's headline numbers.
//
// The sweep is cached for 60s (two whole-catalog scans), so the client passes
// `refresh=1` after applying anything. Without it an accepted card reappears
// for up to a minute, which reads exactly like the accept failing.
export const GET = withScoringAdmin(async (req: NextRequest) => {
  if (req.nextUrl.searchParams.get("refresh") === "1") invalidateSweepCache();
  return NextResponse.json(runTaxonomySweep());
});

// POST { kind, ref } — "no, and stop suggesting this".
export const POST = withScoringAdmin(async (req: NextRequest) => {
  const { kind, ref, undo } = await parseJsonBody(req, SuggestionDismissSchema);
  if (undo) undismissSuggestion(kind, ref);
  else dismissSuggestion(kind, ref);
  return NextResponse.json(runTaxonomySweep());
});
