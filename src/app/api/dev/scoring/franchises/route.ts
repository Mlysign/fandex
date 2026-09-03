import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { parseJsonBody } from "@/lib/validate";
import { FranchiseActionSchema } from "@/lib/schemas";
import { surveyFranchises, suggestFranchisesByTitle } from "@/lib/ipSurvey";
import {
  setIpAlias, deleteIpAlias, deleteIpBundle,
  setItemIpOverride, deleteItemIpOverride,
} from "@/lib/ipAlias";
import { setFacetLabel } from "@/lib/facetLabel";

// /api/dev/scoring/franchises — the Taxonomy panel's Franchises section.
//
// Two mechanisms behind one screen, and they fix different problems (see
// ipAlias.ts): BUNDLE folds two names for one franchise together; ATTACH /
// DETACH fixes which items are in it. Both are global catalog corrections, so
// this sits behind the same SCORING_ADMIN_USER_IDS allowlist as the rest of
// /api/dev/scoring — a non-admin gets 404, not 403.
//
// Reads + mutates live DB state → never prerender.
export const dynamic = "force-dynamic";

// GET — the whole panel state. `?suggest=1` adds title-match candidates, which
// cost a full catalog scan, so they are opt-in rather than always computed.
export const GET = withScoringAdmin(async (req: NextRequest) => {
  const sp = req.nextUrl.searchParams;
  const wantSuggestions = sp.get("suggest") === "1";
  const types = sp.get("types")?.split(",").filter(Boolean);

  return NextResponse.json({
    franchises: surveyFranchises(),
    suggestions: wantSuggestions ? suggestFranchisesByTitle({ types: types?.length ? types : undefined }) : null,
  });
});

// POST — one action per call. Every one is reversible from this same screen,
// which is why none of them carry a confirmation string.
export const POST = withScoringAdmin(async (req: NextRequest) => {
  const body = await parseJsonBody(req, FranchiseActionSchema);

  try {
    switch (body.action) {
      case "bundle":
        setIpAlias(body.alias, body.canonical);
        // 2026-09-03. In the SAME request as the bundle, not a follow-up call:
        // Nils asked for the name as part of bundling, and two requests would
        // leave a window where the two franchises are folded under a name
        // nobody chose.
        if (body.displayLabel) setFacetLabel("ip", body.canonical, body.displayLabel);
        break;
      case "unbundle":
        deleteIpAlias(body.alias);
        break;
      case "dissolve":
        deleteIpBundle(body.canonical);
        break;
      case "attach":
        setItemIpOverride(body.mediaItemId, body.label, "add", body.label);
        break;
      case "detach":
        // A 'remove' ROW, not a delete: the franchise came from the provider, so
        // deleting an override would just let the next read re-derive it.
        setItemIpOverride(body.mediaItemId, body.ipKey, "remove", body.label ?? body.ipKey);
        break;
      case "clear":
        deleteItemIpOverride(body.mediaItemId, body.ipKey);
        break;
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, franchises: surveyFranchises() });
});
