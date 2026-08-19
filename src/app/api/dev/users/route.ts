import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withScoringAdmin } from "@/lib/devAdmin";
import { userAnalyticsSnapshot } from "@/lib/userAnalytics";

// Reads live DB state. Never prerender this at build time.
export const dynamic = "force-dynamic";

// GET /api/dev/users?days=30 returns everything /dev/users renders.
//
// Behind the same SCORING_ADMIN_USER_IDS allowlist as /dev/scoring and
// /api/dev/analytics (non-admins get 404, per withScoringAdmin's fail-closed
// rule). This one matters more than the traffic route: the payload describes
// real people's collections, so it must never be reachable without the gate.
export const GET = withScoringAdmin(async (req: NextRequest) => {
  const raw = Number(req.nextUrl.searchParams.get("days") ?? 30);
  const days = Number.isFinite(raw) ? Math.min(365, Math.max(7, Math.trunc(raw))) : 30;
  return NextResponse.json(userAnalyticsSnapshot(days));
});
