import { NextRequest, NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { setTagAlias, deleteTagAlias, deleteTagBundle, listTagBundles } from "@/lib/tagAlias";
import { invalidateDiscoveryCache } from "@/lib/discovery";
import { parseJsonBody } from "@/lib/validate";
import { TagAliasPostSchema } from "@/lib/schemas";

// H5.6 — tag bundling. Bundle several member spellings under one canonical key
// (docs/fandex-score.md). Mirrors the tag_category_override route. buildProfile's
// cache busts via scoringConfigSignature (which now folds in tagAliasSignature),
// but the catalog cache (vocab/vectors) is guarded by catalogSignature, which a
// bundle edit doesn't change — so invalidate it explicitly here.

// GET /api/dev/scoring/aliases — the taxonomy panel's bundle list.
export const GET = withScoringAdmin(async () => {
  return NextResponse.json({ bundles: listTagBundles() });
});

// POST /api/dev/scoring/aliases — { canonical, members[] } bundles each member
// (except the canonical itself) under the canonical.
export const POST = withScoringAdmin(async (req: NextRequest) => {
  const { canonical, members } = await parseJsonBody(req, TagAliasPostSchema);
  const applied: string[] = [];
  try {
    for (const m of members) {
      if (m === canonical) continue;
      setTagAlias(m, canonical);
      applied.push(m);
    }
  } catch (e) {
    invalidateDiscoveryCache();
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not bundle" }, { status: 400 });
  }
  invalidateDiscoveryCache();
  return NextResponse.json({ ok: true, applied, bundles: listTagBundles() });
});

// DELETE /api/dev/scoring/aliases?alias=... removes one member;
// ?canonical=... dissolves a whole bundle.
export const DELETE = withScoringAdmin(async (req: NextRequest) => {
  const alias = req.nextUrl.searchParams.get("alias");
  const canonical = req.nextUrl.searchParams.get("canonical");
  if (alias) deleteTagAlias(alias);
  else if (canonical) deleteTagBundle(canonical);
  else return NextResponse.json({ error: "alias or canonical required" }, { status: 400 });
  invalidateDiscoveryCache();
  return NextResponse.json({ ok: true, bundles: listTagBundles() });
});
