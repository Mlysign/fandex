import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { withOptionalUser } from "@/lib/withUser";
import {
  classifyReferrer, isCrawlerUserAgent, isSameOriginBeacon, normalizePathKey, recordCrawlerView, recordPageView,
} from "@/lib/telemetry";
import { log } from "@/lib/logger";

// Writes to the DB on every call. Never prerender or cache this.
export const dynamic = "force-dynamic";

/**
 * The path keys a facet crawl walks. Deep, public, and never the ones a person
 * spends a session on, which is what makes them the right sample frame: on
 * 2026-09-02 these four took 9,532 of 9,917 views against 42 for "/".
 */
const SAMPLED_PATHS = new Set([
  "/person/[slug]", "/tag/[slug]", "/studio/[slug]", "/[type]/[id]",
]);

/**
 * Roughly one in this many sampled requests is logged.
 *
 * ⚠️ Read at CALL time, never at module load. A threshold read once at import is
 * a switch nothing can turn off and nothing can test, which has shipped here
 * three times (the backfill ceiling, the housekeeping threshold, the browse
 * minimum) with a test asserting the default instead of the behaviour.
 */
function sampleThisOne(): boolean {
  const raw = process.env.TELEMETRY_AGENT_SAMPLE?.trim();
  if (raw === "0" || raw === "off" || raw === "false") return false;
  const rate = Number(raw);
  const n = Number.isFinite(rate) && rate >= 1 ? rate : 20;
  return Math.random() < 1 / n;
}

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
    //
    // 2026-09-03 — a SECOND gate beside the user-agent one, and it checks a
    // shape rather than a name. See isSameOriginBeacon for the measurement that
    // forced it: 9,917 pageviews on 2026-09-02, of which 9,532 were facet and
    // item pages against 42 homepage views, with 15 caught by the UA filter.
    // Both rejections land in the same counter, because from the dashboard's
    // point of view they are the same statement: this was not a reader.
    const notABrowser =
      isCrawlerUserAgent(req.headers.get("user-agent")) ||
      !isSameOriginBeacon({
        origin: req.headers.get("origin"),
        secFetchSite: req.headers.get("sec-fetch-site"),
        host: req.headers.get("host"),
      });

    if (notABrowser) {
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

    // ── The diagnostic (2026-09-03), so the next filter is not another guess ──
    //
    // Nothing stores a user agent, by design — the whole schema is counters, and
    // that is what keeps this feature a privacy argument we can win. The cost is
    // that when something DOES get through both gates, there is no way to learn
    // what it was: "crawlers are filtered", "the filter is eating real people"
    // and "a new crawler walked past it" all render as the same dashboard. That
    // is the same unfalsifiability that `recordCrawlerView` was added to fix
    // from the other side.
    //
    // So: a SAMPLED log line, on the deep pages a crawl walks and never on the
    // signed-in ones. It goes to the app log, which Railway rotates, and NOT to
    // the database — nothing here is retained, aggregated or joined to anything.
    // Switch it off with `TELEMETRY_AGENT_SAMPLE=0` once the question is
    // answered; read at call time, not at module load, so the switch works.
    if (!session && SAMPLED_PATHS.has(pathKey) && sampleThisOne()) {
      log.info("telemetry_agent_sample", {
        pathKey,
        refClass: classifyReferrer(ref, selfHost),
        ua: (req.headers.get("user-agent") ?? "").slice(0, 300),
      });
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
