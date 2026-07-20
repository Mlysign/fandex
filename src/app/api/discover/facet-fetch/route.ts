import { NextRequest, NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { buildExternalCandidates, FacetDetailItem } from "@/lib/facetDetail";
import { parseJsonBody } from "@/lib/validate";
import { FacetFetchSchema } from "@/lib/schemas";

// T24/T5 — when a must-include facet is active in search, pull its full external
// set from the databases (e.g. a person's TMDB filmography, a studio's catalog)
// so search isn't limited to locally-ingested titles. Multiple include facets
// are UNIONed (the local find() results still enforce strict AND; this is the
// "More from the databases" supplement). Type filter applied if given.
//
// Q17/Q27 fix (2026-07-19): originally reused buildFacetDetail (the facet
// detail page's builder), which merges in the user's own rated/owned catalog
// titles FIRST and caps the combined list at 150 — for a facet with a large
// existing local pool (a big anime library, say), every slot got consumed by
// titles the user already owns, so the hide-library/hide-wishlist filter had
// nothing left to let through even though the provider search itself found
// real new candidates. buildExternalCandidates skips that merge entirely:
// external-only, filtered by membership directly against user state.
export const POST = withUser(async (req: NextRequest, session) => {
  const body = await parseJsonBody(req, FacetFetchSchema);
  const facets = (body.facets ?? []).filter((f) => f.kind && f.key);
  if (facets.length === 0) return NextResponse.json({ items: [] });

  const types = body.types ?? [];
  const m = body.membership;
  const seen = new Set<string>();
  const out: FacetDetailItem[] = [];
  // Sequential to be gentle on the external APIs (each facet pull fans out already).
  for (const f of facets) {
    const items = await buildExternalCandidates(session.userId, f, m);
    for (const it of items) {
      if (types.length && !types.includes(it.type)) continue;
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      out.push(it);
    }
  }
  return NextResponse.json({ items: out });
});
