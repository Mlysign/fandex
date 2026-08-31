import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withOptionalUser } from "@/lib/withUser";
import {
  classifyReferrer, isCrawlerUserAgent, normalizePathKey, recordCrawlerView, recordPageView,
} from "@/lib/telemetry";
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
// engaged users worst. This number gates an ADS decision, and an ad network pays
// for impressions rendered in a real browser, not for Googlebot fetching a facet
// page, so the browser is the right place to count from.
//
// ⚠️ What this file used to claim, and what is actually true ────────────────
//
// It said a client beacon "excludes crawlers for free". It does not. That holds
// only for crawlers that fetch HTML and stop; Googlebot, AhrefsBot, Semrush and
// most modern SEO tools RENDER the page, run the bundle, and POST here exactly
// like a browser. Prod on 2026-08-20: 5,365 pageviews in 30 days, of which 4,314
// were /person, /tag and /studio against FOURTEEN homepage views. Nobody reaches
// 2,855 distinct person pages through a front door they opened fourteen times.
// The ads gate had been reading roughly 80% bot since the day it shipped, and
// nothing flagged it, because a wrong number and a right one look identical on a
// dashboard. `isCrawlerUserAgent` is the filter; the shape of the top-pages
// panel is the thing that gave it away, so keep that panel honest.
//
// Counts before 2026-08-20 are unfiltered and are not comparable to later ones.
//
// 60/min per anonymous IP: a real person cannot navigate 60 pages a minute, and
// this is a WRITE endpoint, so the default 240 (sized for local reads) is looser
// than what it spends. It is still only a rate limit, not an integrity guarantee: anyone can POST here, so treat the counters as a trend instrument and not as an
// auditable figure to hand an ad network.
export const POST = withOptionalUser(
  async (req: NextRequest, session) => {
    // Checked before the body is even read: a crawler's POST costs us nothing
    // beyond this line and one integer, and answering ok keeps the beacon silent
    // on the page.
    //
    // The rejection is COUNTED (migration 26). Until 2026-08-31 it was not, and
    // that left the filter unfalsifiable: "crawlers are being filtered", "the
    // filter is dropping real people" and "the filter silently stopped running"
    // all render as the same dashboard, differing only in a number nobody could
    // see. The counter is a bare (day, count) row: no user agent, no path, no
    // IP, so a crawl is still one UPSERT and carries nothing worth storing.
    if (isCrawlerUserAgent(req.headers.get("user-agent"))) {
      try {
        recordCrawlerView();
      } catch (e) {
        log.warn("telemetry_crawler_write_failed", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
      return NextResponse.json({ ok: true, counted: false });
    }

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
