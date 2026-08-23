import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { readDbSize } from "@/lib/dbSize";
import { cacheWeights } from "@/lib/boundedCache";

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
// ?caches=1 adds the in-memory cache WEIGHTS (2026-08-23), which is a different
// question from everything else here: the rest of this route is about bytes on
// the volume, and that is the cheap resource. Memory is 77% of the Railway bill
// and every cache in the app is bounded by ENTRY COUNT, so nothing could say how
// many bytes a `max: 3000` was actually authorising. Sampled, not walked, and
// opt-in for the same reason `?deep=1` is.
export const GET = withScoringAdmin(async (req: NextRequest) => {
  const deep = req.nextUrl.searchParams.get("deep") === "1";
  const wantCaches = req.nextUrl.searchParams.get("caches") === "1";
  return NextResponse.json({
    ...readDbSize({ deep }),
    ...(wantCaches ? { cacheWeights: cacheWeights() } : {}),
  });
});
