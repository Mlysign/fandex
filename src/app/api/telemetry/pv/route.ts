import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withOptionalUser } from "@/lib/withUser";
import { classifyReferrer, normalizePathKey, recordPageView } from "@/lib/telemetry";
import { log } from "@/lib/logger";

// Writes to the DB on every call. Never prerender or cache this.
export const dynamic = "force-dynamic";

// POST /api/telemetry/pv  { path: string, ref?: string }
//
// The pageview beacon. Public by design: anonymous traffic is precisely the
// population the ads gate is denominated in, and PR15's write gate is untouched
// because nothing here writes a catalog or user row, only two integer counters
// that carry no identity (see migration 17).
//
// ── Why a client beacon rather than server-side counting ────────────────────
//
// Under the App Router an internal navigation never reaches the server, so a
// middleware or layout counter would miss most of a session and undercount the
// engaged users worst. The beacon also excludes crawlers for free, which is what
// we want here: this number gates an ADS decision, and an ad network pays for
// impressions rendered in a real browser, not for Googlebot fetching a facet page.
// Server-rendered crawler traffic is therefore deliberately invisible to it. Read
// that number from the access log or Search Console, not from this dashboard.
//
// 60/min per anonymous IP: a real person cannot navigate 60 pages a minute, and
// this is a WRITE endpoint, so the default 240 (sized for local reads) is looser
// than what it spends. It is still only a rate limit, not an integrity guarantee: anyone can POST here, so treat the counters as a trend instrument and not as an
// auditable figure to hand an ad network.
export const POST = withOptionalUser(
  async (req: NextRequest, session) => {
    let body: { path?: unknown; ref?: unknown };
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    if (typeof body.path !== "string" || body.path.length > 512) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    const pathKey = normalizePathKey(body.path);
    if (!pathKey) return NextResponse.json({ ok: true, counted: false });

    const ref = typeof body.ref === "string" && body.ref.length <= 2048 ? body.ref : null;
    let selfHost: string | null = null;
    try {
      selfHost = new URL(req.url).hostname;
    } catch {
      selfHost = null;
    }

    try {
      recordPageView({ pathKey, authed: !!session, refClass: classifyReferrer(ref, selfHost) });
    } catch (e) {
      // A telemetry write must never be visible to a visitor, and must never
      // become a reason a page errors. Log it and answer ok.
      log.warn("telemetry_write_failed", { error: e instanceof Error ? e.message : String(e) });
    }
    return NextResponse.json({ ok: true, counted: true });
  },
  { anonLimit: 60 },
);
