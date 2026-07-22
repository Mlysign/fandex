import { NextRequest, NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { readDbSize } from "@/lib/dbSize";

// Reads live DB state — never prerender this at build time.
export const dynamic = "force-dynamic";

// GET /api/dev/dbsize        — pragmas + per-table row counts (cheap).
// GET /api/dev/dbsize?deep=1 — plus exact bytes per table/index via dbstat.
//
// Admin-gated behind the same SCORING_ADMIN_USER_IDS allowlist /dev/scoring
// uses (non-admins get 404, per withScoringAdmin's fail-closed rule). Row counts
// and schema shape are not something an anonymous visitor should be able to
// enumerate — unlike /api/health, which is deliberately public for Railway's
// probe and only reports aggregate memory.
//
// ?deep=1 is a full B-tree scan. On prod's ~2.5 GB DB that reads the entire
// file into page cache, so run it once, read the answer, and don't poll it.
export const GET = withScoringAdmin(async (req: NextRequest) => {
  const deep = req.nextUrl.searchParams.get("deep") === "1";
  return NextResponse.json(readDbSize({ deep }));
});
