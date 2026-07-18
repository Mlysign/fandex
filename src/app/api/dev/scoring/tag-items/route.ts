import { NextRequest, NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { itemsWithFacet } from "@/lib/discovery";

// GET /api/dev/scoring/tag-items?key=... — the taxonomy triage view's
// click-to-reveal: a catalog-wide sample of items carrying a tag (so the admin
// can eyeball whether two spellings are the same thing before bundling them).
// itemsWithFacet canonicalizes the key, so a bundled member returns the whole
// bundle's items.
export const GET = withScoringAdmin(async (req: NextRequest) => {
  const key = req.nextUrl.searchParams.get("key")?.trim();
  if (!key) return NextResponse.json({ items: [] });

  const items = itemsWithFacet({ kind: "tag", key })
    .slice(0, 12)
    .map((v) => ({ id: v.id, title: v.title, type: v.type, posterUrl: v.posterUrl, year: v.year }));

  return NextResponse.json({ items });
});
