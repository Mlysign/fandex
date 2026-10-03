import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { rateLimit } from "@/lib/rateLimit";

// ── Per-IP limit on PAGE routes ─────────────────────────────────────────────
//
// WHY THIS EXISTS (2026-10-03). /api/ was rate limited and the pages were not.
// On 2026-10-01 one IP pulled ~5,000 pages at a peak of 1,428 a minute. The
// process went to 1.98 GB to serve it, glibc kept the pages afterwards, and
// Railway billed the difference around the clock until the next restart.
//
// The number is sized from that day's log. The busiest honest client was a real
// browser at 84 requests a minute (mostly link prefetches, which the matcher
// below does not even count) and the busiest crawler was ClaudeBot at 48. 120
// leaves both alone and cuts the scraper by 92%.
//
// ⚠️ This is a blunt instrument for one job. It does not replace the limits on
// individual /api/ routes, which are sized to what each route SPENDS.
const DEFAULT_PAGES_PER_MINUTE = 120;
const WINDOW_MS = 60_000;
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

// Read at CALL time, so a test (and a Railway variable change) reaches it.
// 0 switches the limit off.
export function pageRateLimit(): number {
  const raw = process.env.PAGE_RATE_LIMIT_PER_MIN;
  if (raw === undefined || raw.trim() === "") return DEFAULT_PAGES_PER_MINUTE;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_PAGES_PER_MINUTE;
}

export function proxy(req: NextRequest) {
  const limit = pageRateLimit();
  if (limit === 0) return NextResponse.next();

  // A loopback address means nothing sits in front of us: local dev, the `prod`
  // launch config, a probe script. Next fills x-forwarded-for with the socket
  // address when no edge has, so "missing" never happens and loopback is the
  // case to test for. Limiting it would rate limit the developer, not a scraper.
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  if (!ip || LOOPBACK.has(ip)) return NextResponse.next();

  const d = rateLimit(`page:${ip}`, limit, WINDOW_MS);
  if (d.allowed) return NextResponse.next();

  const retryAfter = Math.max(1, Math.ceil(d.retryAfterMs / 1000));
  return new NextResponse("Too many requests. Please slow down and try again shortly.\n", {
    status: 429,
    headers: {
      "Retry-After": String(retryAfter),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// Pages only. /api/ has its own limits, /_next/ is static assets, and anything
// with a file extension is a public file (robots.txt and sitemap.xml included,
// which a crawler must always be able to read). Link prefetches are left out
// because one page of poster cards fires dozens of them.
export const config = {
  matcher: [
    {
      source: "/((?!api/|_next/|.*\\.[a-zA-Z0-9]+$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "next-router-segment-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
