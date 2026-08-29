import { createHash, timingSafeEqual } from "crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { kpiSnapshot } from "@/lib/telemetry";
import { log } from "@/lib/logger";

// Reads live DB state. Never prerender this at build time.
export const dynamic = "force-dynamic";

// GET /api/telemetry/kpi   header: X-BW-Admin: <KPI_READ_KEY>
//
// The portfolio hub at https://nilsmlynarek.eu/analytics/ shows three product
// numbers per project. This is Fandex's answer to the shared KPI contract; the
// response shape is documented on `KpiSnapshot` in src/lib/telemetry.ts.
//
// ── Why this exists next to /api/dev/analytics rather than inside it ────────
//
// /api/dev/analytics is gated by `withScoringAdmin`, which wraps `withUser` and
// checks a session against SCORING_ADMIN_USER_IDS. There is no bearer path
// through it, so a server-to-server caller cannot authenticate at all. That,
// and not CORS, is what blocks the hub. Loosening that gate is the wrong fix:
// it also protects /dev/scoring and /api/dev/dbsize, which serve per-item and
// per-user data. This is a second, much narrower door, and it is the whole
// reason the two routes are separate files: nothing here can widen that one.
//
// It lives under /api/telemetry/ beside the pv beacon rather than under
// /api/dev/, where every other route is session-gated. A key-gated route sitting
// in that tree is a trap for the next reader.
//
// ── What it deliberately does not do ────────────────────────────────────────
//
// * No session, no cookies, no user context. Safe to call from a server holding
//   nothing but the secret.
// * No CORS headers. The hub never calls this directly. A small PHP proxy on
//   nilsmlynarek.eu holds the key server-side and re-serves the same JSON
//   same-origin. Adding CORS would only invite the secret into a browser later.
// * Aggregates only. Counts and totals, no user ids, no paths, no referrers.
// * `no-store`, so no proxy or CDN between here and the hub can hold a
//   key-gated response. The `server` field is for spotting a stale cache the
//   hub's own proxy chose to keep, not a licence to be cached here.

const HEADER = "x-bw-admin";

/**
 * A shorter key than this is treated as unset.
 *
 * The key is the ONLY thing protecting an unauthenticated public endpoint, so a
 * weak one is a hole rather than a preference. Failing closed on it means a
 * typo'd or truncated value produces the same 404 as no configuration at all,
 * which is the state the caller can actually diagnose from the other side.
 */
const MIN_KEY_LENGTH = 16;

/**
 * Constant-time key comparison.
 *
 * Both sides are hashed to a fixed 32 bytes BEFORE comparing. `timingSafeEqual`
 * throws on unequal lengths, and the length guard that would otherwise be needed
 * in front of it leaks the secret's length to anyone willing to time it. Hashing
 * removes the question.
 *
 * Read at CALL time, never at module load: a gate resolved once at import is a
 * gate no test can set an env var for (AGENTS.md, "a SAFETY GATE read at module
 * load is a gate nothing tests").
 */
function keyMatches(presented: string | null): boolean {
  const secret = process.env.KPI_READ_KEY;
  if (!secret || !presented) return false;
  if (secret.length < MIN_KEY_LENGTH) {
    log.warn("kpi_read_key_too_short", { minLength: MIN_KEY_LENGTH });
    return false;
  }
  const a = createHash("sha256").update(secret).digest();
  const b = createHash("sha256").update(presented).digest();
  return timingSafeEqual(a, b);
}

// 404, never 401: a wrong key and a missing route look identical from outside,
// which is a deliberate convention across every project on the hub. Same body as
// withScoringAdmin's refusal, so the two gates read the same way from here.
function notFound(): NextResponse {
  return NextResponse.json({ error: "Not found" }, { status: 404 });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  // Checked before anything touches the database: an unauthenticated caller
  // costs one header read and a hash, which is what keeps a public endpoint
  // cheap to be pointed at.
  if (!keyMatches(req.headers.get(HEADER))) return notFound();

  return NextResponse.json(kpiSnapshot(), {
    headers: { "cache-control": "no-store" },
  });
}
