import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { setFacetLabel, clearFacetLabel, getFacetLabel } from "@/lib/facetLabel";
import { invalidateDiscoveryCache } from "@/lib/discovery";
import { parseJsonBody } from "@/lib/validate";
import { FacetLabelPostSchema } from "@/lib/schemas";

// /api/dev/scoring/labels — which spelling of a facet people see (2026-09-03).
//
// Nils: "when i bundle franchises or tags, i need an option to choose which
// version i want to use as display name on fandex. the other name should then
// never be displayed again."
//
// Separate from the alias routes on purpose. Bundling changes what a facet IS
// (one average instead of two); naming changes what it is CALLED. They are
// reversible independently, and a name applies perfectly well to a facet that is
// in no bundle at all, which is the case the first badly-spelled provider tag
// will need.
//
// ⚠️ `invalidateDiscoveryCache()` for the same reason the alias routes call it:
// a label lives in the catalog pool's vocab, and the pool is guarded by a
// content signature that an editorial edit does not move. Without this the edit
// would appear to do nothing for up to the five-minute TTL.
//
// Reads + mutates live DB state → never prerender.
export const dynamic = "force-dynamic";

// POST { kind: "tag" | "ip", key, label } — set the display name.
export const POST = withScoringAdmin(async (req: NextRequest) => {
  const { kind, key, label } = await parseJsonBody(req, FacetLabelPostSchema);
  try {
    setFacetLabel(kind, key, label);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
  invalidateDiscoveryCache();
  return NextResponse.json({ ok: true, kind, key, label: getFacetLabel(kind, key) });
});

// DELETE ?kind=&key= — revert to whatever the providers call it.
export const DELETE = withScoringAdmin(async (req: NextRequest) => {
  const kind = req.nextUrl.searchParams.get("kind");
  const key = req.nextUrl.searchParams.get("key");
  if ((kind !== "tag" && kind !== "ip") || !key) {
    return NextResponse.json({ error: "kind (tag|ip) and key required" }, { status: 400 });
  }
  clearFacetLabel(kind, key);
  invalidateDiscoveryCache();
  return NextResponse.json({ ok: true, kind, key, label: null });
});
