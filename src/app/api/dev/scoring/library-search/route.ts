import { NextRequest, NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { query } from "@/lib/db";

// GET /api/dev/scoring/library-search?q=... — the Weights panel's item
// picker: search the admin's OWN library (any item, rated or not) by title so
// they can pin specific items into the multi-item preview instead of only
// ever seeing their single top-rated item.
export const GET = withScoringAdmin(async (req: NextRequest, session) => {
  const raw = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (raw.length < 2) return NextResponse.json({ results: [] });

  const escaped = raw.replace(/[%_\\]/g, (c) => `\\${c}`);
  const rows = query<{ id: string; title: string; type: string }>(
    `SELECT mi.id, mi.title, mi.type FROM media_items mi
     JOIN user_library ul ON ul.media_item_id = mi.id
     WHERE ul.user_id = ? AND mi.title LIKE ? ESCAPE '\\'
     ORDER BY mi.title LIMIT 10`,
    [session.userId, `%${escaped}%`]
  );

  return NextResponse.json({ results: rows });
});
