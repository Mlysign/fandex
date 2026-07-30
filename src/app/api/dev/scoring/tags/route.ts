import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { getTagVocab, getRawTagCounts } from "@/lib/discovery";
import { getTagCategoryOverrides } from "@/lib/scoringConfig";
import { listTagBundles } from "@/lib/tagAlias";
import { categorizeTag } from "@/lib/tags";

// GET /api/dev/scoring/tags?category=<id>&q=<search>&limit=<n> — the tag admin
// table's data source (T6, 2026-07-29). ONE row per CANONICAL tag; alias
// members are nested under it as `aka`, never a separate top-level row —
// getTagVocab() already folds them in (applyTagAliases runs before the vocab
// is built, see discovery.ts's buildCache), so `count` here is already the
// combined total across the tag itself and every aka member with zero extra
// summing needed. `aka[].count` uses getRawTagCounts() (the pre-fold
// per-key counts) since a folded member has no row of its own to read a
// count from otherwise.
export const GET = withScoringAdmin(async (req: NextRequest) => {
  const category = req.nextUrl.searchParams.get("category");
  const q = req.nextUrl.searchParams.get("q")?.trim().toLowerCase() || null;
  const limit = Math.min(Math.max(Number(req.nextUrl.searchParams.get("limit")) || 200, 1), 1000);

  const overrides = getTagCategoryOverrides();
  const rawCounts = getRawTagCounts();
  const bundlesByCanonical = new Map(listTagBundles().map((b) => [b.canonical, b.members]));

  const rows = getTagVocab().map((v) => ({
    key: v.key,
    label: v.label,
    count: v.count,
    category: overrides.get(v.key) ?? categorizeTag(v.key),
    overridden: overrides.has(v.key),
    aka: (bundlesByCanonical.get(v.key) ?? []).map((memberKey) => ({
      key: memberKey,
      label: rawCounts.get(memberKey)?.label ?? memberKey,
      count: rawCounts.get(memberKey)?.count ?? 0,
    })),
  }));

  const filtered = rows.filter((r) => {
    if (category && r.category !== category) return false;
    if (q) {
      const hit = r.label.toLowerCase().includes(q) || r.key.toLowerCase().includes(q)
        || r.aka.some((a) => a.label.toLowerCase().includes(q) || a.key.toLowerCase().includes(q));
      if (!hit) return false;
    }
    return true;
  });

  return NextResponse.json({ tags: filtered.slice(0, limit), total: filtered.length });
});
