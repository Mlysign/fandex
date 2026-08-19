import { describe, it, expect, beforeEach } from "vitest";
import { getDb } from "@/lib/db";
import {
  classifyReferrer,
  normalizePathKey,
  recordPageView,
  pageViewSeries,
  topPages,
  referrerBreakdown,
  utcDay,
} from "@/lib/telemetry";

describe("normalizePathKey", () => {
  it("keeps known static routes verbatim", () => {
    expect(normalizePathKey("/")).toBe("/");
    expect(normalizePathKey("/calendar")).toBe("/calendar");
    expect(normalizePathKey("/insights/facet")).toBe("/insights/facet");
  });

  it("templates dynamic segments so cardinality stays bounded", () => {
    expect(normalizePathKey("/tag/roguelike")).toBe("/tag/[slug]");
    expect(normalizePathKey("/tag/tower-defense")).toBe("/tag/[slug]");
    expect(normalizePathKey("/person/hideo-kojima")).toBe("/person/[slug]");
    expect(normalizePathKey("/studio/kojima-productions")).toBe("/studio/[slug]");
    expect(normalizePathKey("/game/abc-123")).toBe("/[type]/[id]");
    expect(normalizePathKey("/movie/abc-123")).toBe("/[type]/[id]");
    expect(normalizePathKey("/show/abc-123")).toBe("/[type]/[id]");
    expect(normalizePathKey("/legal/de/imprint")).toBe("/legal/[locale]/[doc]");
  });

  it("normalizes case, trailing slashes and query strings", () => {
    expect(normalizePathKey("/Calendar/")).toBe("/calendar");
    expect(normalizePathKey("/tag/Horror?x=1#y")).toBe("/tag/[slug]");
    expect(normalizePathKey("library")).toBe("/library");
  });

  // The whole point of the "other" bucket: an arbitrary path must not be able to
  // mint an arbitrary row. Without this, POSTing 10k random paths would write 10k
  // rows a day, the unbounded-growth shape migration 17 exists to avoid.
  it("collapses unknown paths to a single bucket", () => {
    expect(normalizePathKey("/nope")).toBe("other");
    expect(normalizePathKey("/a/b/c/d/e")).toBe("other");
    expect(normalizePathKey("/tag/a/b")).toBe("other");
  });

  it("refuses paths that must never be counted", () => {
    expect(normalizePathKey("/api/detail")).toBeNull();
    expect(normalizePathKey("/_next/static/chunk.js")).toBeNull();
    expect(normalizePathKey("/.well-known/assetlinks.json")).toBeNull();
    expect(normalizePathKey("/favicon.ico")).toBeNull();
    // The admin surface is not traffic. Counting it would let the dashboard
    // inflate the very numbers it reports.
    expect(normalizePathKey("/dev/analytics")).toBeNull();
    expect(normalizePathKey("/dev/scoring")).toBeNull();
  });
});

describe("classifyReferrer", () => {
  it("treats a missing referrer as direct", () => {
    expect(classifyReferrer(null)).toBe("direct");
    expect(classifyReferrer("")).toBe("direct");
    expect(classifyReferrer(undefined)).toBe("direct");
  });

  it("recognizes search engines", () => {
    expect(classifyReferrer("https://www.google.com/search?q=x")).toBe("search");
    expect(classifyReferrer("https://duckduckgo.com/")).toBe("search");
    expect(classifyReferrer("https://www.google.de/")).toBe("search");
  });

  it("recognizes social sources", () => {
    expect(classifyReferrer("https://www.reddit.com/r/games")).toBe("social");
    expect(classifyReferrer("https://x.com/someone")).toBe("social");
  });

  it("classifies our own host as internal, including subdomains", () => {
    expect(classifyReferrer("https://fandex.org/calendar", "fandex.org")).toBe("internal");
    expect(classifyReferrer("https://www.fandex.org/calendar", "www.fandex.org")).toBe("internal");
  });

  it("does not confuse a lookalike host for our own", () => {
    expect(classifyReferrer("https://fandex.org.evil.test/x", "fandex.org")).not.toBe("internal");
  });

  it("falls back to other for anything unparseable or unknown", () => {
    expect(classifyReferrer("not a url")).toBe("other");
    expect(classifyReferrer("https://example.test/x")).toBe("other");
  });
});

describe("recordPageView", () => {
  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM page_view_daily; DELETE FROM referrer_daily;");
  });

  it("upserts rather than inserting a row per view", () => {
    const db = getDb();
    for (let i = 0; i < 5; i++) {
      recordPageView({ pathKey: "/calendar", authed: false, refClass: "search" });
    }
    const rows = db.prepare("SELECT * FROM page_view_daily").all() as { count: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(5);
  });

  it("counts anonymous and signed-in views as separate dimensions", () => {
    recordPageView({ pathKey: "/", authed: false, refClass: "direct" });
    recordPageView({ pathKey: "/", authed: true, refClass: "internal" });
    recordPageView({ pathKey: "/", authed: true, refClass: "internal" });

    const series = pageViewSeries(1);
    expect(series).toHaveLength(1);
    expect(series[0].anon).toBe(1);
    expect(series[0].authed).toBe(2);
    expect(series[0].total).toBe(3);
  });

  it("stores no identity: the table has no user_id column", () => {
    // Load-bearing, not cosmetic: account erasure finds its targets by looking
    // for a column literally named `user_id` (AGENTS.md). These counters must
    // stay outside that set, or deleting an account would retroactively rewrite
    // last month's traffic totals.
    const cols = (getDb().prepare("PRAGMA table_info(page_view_daily)").all() as { name: string }[])
      .map((c) => c.name);
    expect(cols).not.toContain("user_id");
    expect(cols).toEqual(["day", "path_key", "authed", "count"]);
  });

  it("aggregates top pages and referrer classes over the window", () => {
    recordPageView({ pathKey: "/tag/[slug]", authed: false, refClass: "search" });
    recordPageView({ pathKey: "/tag/[slug]", authed: false, refClass: "search" });
    recordPageView({ pathKey: "/calendar", authed: true, refClass: "internal" });

    expect(topPages(7)[0]).toEqual({ pathKey: "/tag/[slug]", count: 2 });

    const refs = referrerBreakdown(7);
    expect(refs.find((r) => r.refClass === "search")?.count).toBe(2);
    expect(refs.find((r) => r.refClass === "internal")?.count).toBe(1);
    // Every class is present even at zero, so a chart can't silently omit one.
    expect(refs).toHaveLength(5);
    expect(refs.find((r) => r.refClass === "social")?.count).toBe(0);
  });
});

describe("pageViewSeries", () => {
  beforeEach(() => {
    getDb().exec("DELETE FROM page_view_daily; DELETE FROM referrer_daily;");
  });

  it("zero-fills days with no traffic", () => {
    recordPageView({ pathKey: "/", authed: false, refClass: "direct" });
    const series = pageViewSeries(7);
    expect(series).toHaveLength(7);
    expect(series[series.length - 1].day).toBe(utcDay());
    expect(series[series.length - 1].total).toBe(1);
    expect(series.slice(0, 6).every((d) => d.total === 0)).toBe(true);
  });

  it("returns days in ascending order, ending today", () => {
    const series = pageViewSeries(30);
    expect(series).toHaveLength(30);
    const days = series.map((d) => d.day);
    expect([...days].sort()).toEqual(days);
  });
});
