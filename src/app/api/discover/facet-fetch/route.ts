import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { buildExternalSets } from "@/lib/facetDetail";
import { parseJsonBody } from "@/lib/validate";
import { FacetFetchSchema } from "@/lib/schemas";

// T24/T5 — when a must-include facet is active in search, pull its full external
// set from the databases (e.g. a person's TMDB filmography, a studio's catalog)
// so search isn't limited to locally-ingested titles. Type filter applied if given.
//
// 2026-08-13 — multiple include facets are **AND**ed, matching the local find()
// half. They used to be UNIONed here, which meant one filter had two readings:
// `deckbuilding` + `tower defense` gave 0 local results and 69 external ones,
// putting StarCraft and Doom 3 on screen under a filter neither matches. Nils's
// call — one filter, one meaning, even when the honest answer is "very little".
//
// Q17/Q27 fix (2026-07-19): originally reused buildFacetDetail (the facet
// detail page's builder), which merges in the user's own rated/owned catalog
// titles FIRST and caps the combined list at 150 — for a facet with a large
// existing local pool (a big anime library, say), every slot got consumed by
// titles the user already owns, so the hide-library/hide-wishlist filter had
// nothing left to let through even though the provider search itself found
// real new candidates. buildExternalSets skips that merge entirely:
// external-only, filtered by membership directly against user state.
export const POST = withUser(async (req: NextRequest, session) => {
  const body = await parseJsonBody(req, FacetFetchSchema);
  const facets = (body.facets ?? []).filter((f) => f.kind && f.key);
  if (facets.length === 0) return NextResponse.json({ items: [] });

  const types = body.types ?? [];
  const candidates = await buildExternalSets(session.userId, facets, body.membership);
  const seen = new Set<string>();
  const out = candidates.filter((it) => {
    if (types.length && !types.includes(it.type)) return false;
    if (seen.has(it.id)) return false;
    seen.add(it.id);
    return true;
  });
  return NextResponse.json({ items: out });
});
