import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { analyticsSnapshot } from "@/lib/telemetry";

// Reads live DB state. Never prerender this at build time.
export const dynamic = "force-dynamic";

// GET /api/dev/analytics?days=30 returns everything /dev/analytics renders.
//
// Behind the same SCORING_ADMIN_USER_IDS allowlist as /dev/scoring and
// /api/dev/dbsize (non-admins get 404, per withScoringAdmin's fail-closed rule).
// Traffic totals and user counts are business data, not something to serve to
// whoever asks.
//
// All of it is aggregate reads over two counter tables plus three COUNT(*)s on
// `users`, cheap enough to hit on every dashboard load without a cache.
export const GET = withScoringAdmin(async (req: NextRequest) => {
  const raw = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = Number.isFinite(raw) ? Math.min(365, Math.max(7, Math.trunc(raw))) : 30;
  return NextResponse.json(analyticsSnapshot(days));
});
