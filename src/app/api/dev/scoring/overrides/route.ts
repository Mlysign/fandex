import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { setTagCategoryOverrides, deleteTagCategoryOverride, listTagCategoryOverrides } from "@/lib/scoringConfig";
import { parseJsonBody } from "@/lib/validate";
import { TagCategoryOverridePostSchema } from "@/lib/schemas";

// POST /api/dev/scoring/overrides — reassign one tag key, or a batch of them,
// to a category (the taxonomy editor's triage view). buildProfile() reads
// getTagCategoryOverrides() fresh on every call (own cache,
// signature-invalidated on write) — no need to bust the catalog cache too,
// since VocabEntry doesn't carry category at all.
//
// Both request shapes land on the same batch writer, so there is one code path
// to reason about: the single-tag caller is a batch of one.
export const POST = withScoringAdmin(async (req: NextRequest) => {
  const body = await parseJsonBody(req, TagCategoryOverridePostSchema);
  const tagKeys = [...(body.tagKeys ?? []), ...(body.tagKey ? [body.tagKey] : [])];
  const applied = setTagCategoryOverrides(tagKeys, body.categoryId);
  return NextResponse.json({ ok: true, applied, overrides: listTagCategoryOverrides() });
});

// DELETE /api/dev/scoring/overrides?tagKey=... — revert to the code heuristic.
export const DELETE = withScoringAdmin(async (req: NextRequest) => {
  const tagKey = req.nextUrl.searchParams.get("tagKey");
  if (!tagKey) return NextResponse.json({ error: "tagKey required" }, { status: 400 });
  deleteTagCategoryOverride(tagKey);
  return NextResponse.json({ ok: true, overrides: listTagCategoryOverrides() });
});
