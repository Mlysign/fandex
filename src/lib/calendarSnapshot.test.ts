import { describe, it, expect, beforeEach } from "vitest";
import { initDb, run, get, query } from "./db";
import {
  snapshotMonths, isSnapshotMonth, readMonthSnapshot, calendarSnapshotIsDue,
  buildCalendarSnapshot, pinnedCalendarItemCount, indexableMonthsOutsideSnapshot, snapshotRegions,
  CALENDAR_SNAPSHOT_MAX_AGE_MS, CALENDAR_SNAPSHOT_TTL_MS,
} from "./calendarSnapshot";
import { indexableMonths, currentMonth, shiftMonth } from "./calendarMonths";
import { POPULAR_PER_MONTH } from "./popularMonth";
import { DEFAULT_COUNTRY } from "./countries";
import type { FeedCandidate } from "./discoverFeed";

// The calendar's Popular scope is served from `calendar_snapshot` rather than a
// per-request provider fan-out. What is worth pinning here is the set of
// properties that fail SILENTLY: a crawlable month that quietly falls outside
// the window and starts costing a fan-out again, a sliding window that never
// drops what it moved past, and a failed build that empties a working calendar.
//
// The provider fetch is INJECTED into `buildCalendarSnapshot`, so these run it
// end to end with a stub instead of mocking a payload shape nobody verified.
// That distinction cost four deploys once, on Trakt's episodes.

initDb();

const NOW = new Date("2026-08-26T12:00:00Z");

// A stable provider id per (month, index), so rebuilding the same month
// resolves to the SAME catalog rows rather than minting new ones. That is what
// the real feed does, and the pin-count assertions depend on it.
function tmdbId(month: string, i: number): number {
  const [y, m] = month.split("-").map(Number);
  return (y! * 12 + m!) * 1000 + i;
}

function candidate(month: string, i: number): FeedCandidate {
  // ⚠️ `raw` is not optional decoration here. `persistDiscoverItems` skips any
  // item without it (a link with no payload cannot be stored), so a stub built
  // with `raw: null` pins nothing and every prune-protection assertion below
  // passes for the wrong reason. The first version of this file did exactly
  // that.
  const id = tmdbId(month, i);
  return {
    id: `tmdb:${id}`, rawId: id, source: "tmdb", type: "movie",
    title: `Title ${id}`, releaseDate: `${month}-15`, posterUrl: "https://example.test/p.jpg",
    ids: { tmdb: id },
    genreNames: [], originalLanguage: "en", voteCount: 10, voteAverage: 7, popularity: 5,
    raw: { source: "tmdb", sourceId: String(id), data: { id, title: `Title ${id}` } },
  } as FeedCandidate;
}

/** A stub provider that returns `count` candidates for every month asked. */
const stubFetch = (count: number, seen?: string[]) =>
  async (month: string) => {
    seen?.push(month);
    return Array.from({ length: count }, (_, i) => candidate(month, i));
  };

beforeEach(() => {
  run("DELETE FROM calendar_snapshot");
  run("DELETE FROM calendar_snapshot_item");
  run("DELETE FROM media_items");
});

describe("the snapshot window", () => {
  it("covers 12 months, from 5 back to 6 forward", () => {
    const months = snapshotMonths(NOW);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-03");
    expect(months[5]).toBe(currentMonth(NOW));
    expect(months[11]).toBe("2027-02");
  });

  it("⚠️ is a SUPERSET of every month the sitemap advertises", () => {
    // The one assertion in this file that protects against a pure cost
    // regression rather than a visible bug. `indexableMonths()` reaches +6 while
    // Nils's ask was "+- 5"; a five-month future window would leave the last
    // indexed month outside the snapshot, quietly falling back to a live
    // provider fan-out on a crawler's request. Nothing else would ever surface
    // that: the page renders, the links work, and the bill goes up.
    expect(indexableMonthsOutsideSnapshot(NOW)).toEqual([]);
    for (const m of indexableMonths(NOW)) expect(isSnapshotMonth(m, NOW)).toBe(true);
  });
});

describe("buildCalendarSnapshot", () => {
  it("stores every month in the window", async () => {
    const seen: string[] = [];
    const result = await buildCalendarSnapshot(stubFetch(40, seen), [DEFAULT_COUNTRY], NOW);

    expect(result.months).toBe(12);
    expect(result.refreshed).toBe(12);
    expect(seen).toEqual(snapshotMonths(NOW));
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM calendar_snapshot")?.n).toBe(12);
  });

  it("pins only the titles a month page actually SHOWS", async () => {
    // The pool is 40 deep and the page renders POPULAR_PER_MONTH of it. Pinning
    // the other 25 would keep rows nothing links out of the boot prune forever,
    // which is the slow-leak shape this repo has been bitten by twice.
    await buildCalendarSnapshot(stubFetch(40), [DEFAULT_COUNTRY], NOW);
    expect(pinnedCalendarItemCount()).toBe(12 * POPULAR_PER_MONTH);
  });

  it("⚠️ deletes months the window has moved past", async () => {
    // `home_snapshot` cannot grow: one key, INSERT OR REPLACE. This one can,
    // because the key includes the month and the window slides, so every month
    // that passes retires one key and mints another. Without the eviction it
    // gains a row a month forever and keeps pinning their titles.
    await buildCalendarSnapshot(stubFetch(20), [DEFAULT_COUNTRY], NOW);
    expect(get<{ n: number }>("SELECT COUNT(*) n FROM calendar_snapshot")?.n).toBe(12);

    // Roll forward three months and rebuild.
    const later = new Date("2026-11-26T12:00:00Z");
    await buildCalendarSnapshot(stubFetch(20), [DEFAULT_COUNTRY], later);

    const stored = query<{ month: string }>("SELECT month FROM calendar_snapshot").map((r) => r.month);
    expect(stored).toHaveLength(12);
    expect(new Set(stored)).toEqual(new Set(snapshotMonths(later)));
    // The three oldest months from the first build are gone, not accumulated.
    expect(stored).not.toContain("2026-03");
  });

  it("⚠️ keeps the previous payload when a month's fetch fails", async () => {
    // Rule 1, per month. A provider having a bad day must not empty a calendar
    // that was working. Clearing first and rebuilding is the obvious design and
    // is exactly what would.
    await buildCalendarSnapshot(stubFetch(20), [DEFAULT_COUNTRY], NOW);
    const before = readMonthSnapshot(currentMonth(NOW));
    expect(before).toHaveLength(20);

    const result = await buildCalendarSnapshot(
      async () => { throw new Error("provider down"); }, [DEFAULT_COUNTRY], NOW,
    );
    expect(result.refreshed).toBe(0);
    expect(result.kept).toBe(12);
    expect(readMonthSnapshot(currentMonth(NOW))).toHaveLength(20);
  });

  it("⚠️ keeps the previous payload when a month comes back EMPTY", async () => {
    // The subtler half of rule 1: an empty array is what both "nothing releases
    // that month" and "the provider returned nothing today" look like from here,
    // and they are indistinguishable. The stored row is the better guess.
    await buildCalendarSnapshot(stubFetch(20), [DEFAULT_COUNTRY], NOW);
    await buildCalendarSnapshot(async () => [], [DEFAULT_COUNTRY], NOW);
    expect(readMonthSnapshot(currentMonth(NOW))).toHaveLength(20);
  });

  it("keeps pinning a month it could not refresh", async () => {
    // A month that falls back to its stored payload must still contribute its
    // pins, or the boot prune deletes the titles its page is about to link.
    await buildCalendarSnapshot(stubFetch(20), [DEFAULT_COUNTRY], NOW);
    const pinned = pinnedCalendarItemCount();
    expect(pinned).toBeGreaterThan(0);

    await buildCalendarSnapshot(async () => { throw new Error("down"); }, [DEFAULT_COUNTRY], NOW);
    expect(pinnedCalendarItemCount()).toBe(pinned);
  });
});

describe("readMonthSnapshot", () => {
  it("returns null for a month that was never built", () => {
    expect(readMonthSnapshot("2026-09")).toBeNull();
  });

  it("refuses a payload past the maximum age", async () => {
    await buildCalendarSnapshot(stubFetch(5), [DEFAULT_COUNTRY], NOW);
    run(
      "UPDATE calendar_snapshot SET built_at = ?",
      [Date.now() - CALENDAR_SNAPSHOT_MAX_AGE_MS - 1000],
    );
    expect(readMonthSnapshot(currentMonth(NOW))).toBeNull();
  });

  it("treats a corrupt payload as a miss, never as a throw", () => {
    // `candidatesForMonth` falls through to a live fetch on null, so the cost of
    // being wrong here is one provider call. A throw would be a 500 on the
    // calendar.
    run(
      "INSERT OR REPLACE INTO calendar_snapshot (region, month, built_at, payload) VALUES (?, ?, ?, ?)",
      [DEFAULT_COUNTRY, "2026-09", Date.now(), "{not json"],
    );
    expect(readMonthSnapshot("2026-09")).toBeNull();
  });

  it("reads only its own region", async () => {
    await buildCalendarSnapshot(stubFetch(5), [DEFAULT_COUNTRY], NOW);
    expect(readMonthSnapshot(currentMonth(NOW), "ZZ")).toBeNull();
    expect(readMonthSnapshot(currentMonth(NOW))).not.toBeNull();
  });
});

describe("calendarSnapshotIsDue", () => {
  it("is due when nothing has been built", () => {
    expect(calendarSnapshotIsDue(NOW)).toBe(true);
  });

  it("is not due right after a build", async () => {
    await buildCalendarSnapshot(stubFetch(5), [DEFAULT_COUNTRY], NOW);
    expect(calendarSnapshotIsDue(NOW)).toBe(false);
  });

  it("is due as soon as the window gains a month", async () => {
    // The normal trigger. The window slides by one, so the newest month is
    // simply absent rather than stale, and an age-only check would miss it for
    // a whole day.
    await buildCalendarSnapshot(stubFetch(5), [DEFAULT_COUNTRY], NOW);
    const nextMonth = new Date("2026-09-01T00:00:00Z");
    expect(calendarSnapshotIsDue(nextMonth)).toBe(true);
  });

  it("is due once the stored rows pass the TTL", async () => {
    await buildCalendarSnapshot(stubFetch(5), [DEFAULT_COUNTRY], NOW);
    run("UPDATE calendar_snapshot SET built_at = ?", [Date.now() - CALENDAR_SNAPSHOT_TTL_MS - 1000]);
    expect(calendarSnapshotIsDue(NOW)).toBe(true);
  });
});

describe("the window and the servable range are different bounds", () => {
  it("leaves servable-but-unsnapshotted months to the live path", () => {
    // ±12 is servable, -5..+6 is snapshotted. A shared link into month +9 must
    // still render, which means `candidatesForMonth` keeps its provider
    // fallback. Asserting the gap exists is what stops someone "simplifying"
    // the fallback away.
    const far = shiftMonth(currentMonth(NOW), 9);
    expect(isSnapshotMonth(far, NOW)).toBe(false);
  });
});

describe("regions", () => {
  // ⚠️ THE BUG THIS SECTION EXISTS FOR. The first version built DEFAULT_COUNTRY
  // only, copying the home snapshot, and every test above passed. Paging eleven
  // months while signed in still moved the provider counters by 33, because
  // `/api/calendar/popular` passes the VIEWER's region through and the account
  // doing the testing is `DE`. The anonymous path was genuinely fixed, which is
  // exactly why it read as done.
  const withUsers = (countries: (string | null)[]) => {
    run("DELETE FROM users");
    countries.forEach((c, i) => run("INSERT INTO users (id, country) VALUES (?, ?)", [`u-${i}`, c]));
  };

  it("always includes the default country, even with no users at all", () => {
    withUsers([]);
    expect(snapshotRegions()).toEqual([DEFAULT_COUNTRY]);
  });

  it("includes every country a user has actually set", () => {
    withUsers(["DE", "DE", "GB", null]);
    const regions = snapshotRegions();
    expect(regions).toContain(DEFAULT_COUNTRY);
    expect(regions).toContain("DE");
    expect(regions).toContain("GB");
    // A null country means "not set", which resolves to the default at read
    // time. It must not become a region of its own.
    expect(regions).not.toContain(null as never);
  });

  it("builds and reads a non-default region independently", async () => {
    await buildCalendarSnapshot(stubFetch(10), [DEFAULT_COUNTRY, "DE"], NOW);
    const month = currentMonth(NOW);
    expect(readMonthSnapshot(month, "DE")).toHaveLength(10);
    expect(readMonthSnapshot(month, DEFAULT_COUNTRY)).toHaveLength(10);
    // A region nobody built still misses, so `candidatesForMonth` falls through
    // to the live path rather than serving another country's release dates.
    expect(readMonthSnapshot(month, "JP")).toBeNull();
  });

  it("is due when a region in use has never been built", async () => {
    withUsers([]);
    await buildCalendarSnapshot(stubFetch(5), [DEFAULT_COUNTRY], NOW);
    expect(calendarSnapshotIsDue(NOW)).toBe(false);

    // Somebody sets a country nobody has used before. Their calendar falls back
    // to the live path until the next hourly check, which must notice.
    withUsers(["DE"]);
    expect(calendarSnapshotIsDue(NOW)).toBe(true);
  });

  it("evicts a region that dropped out of use", async () => {
    await buildCalendarSnapshot(stubFetch(5), [DEFAULT_COUNTRY, "DE"], NOW);
    expect(query("SELECT 1 FROM calendar_snapshot WHERE region = 'DE'")).toHaveLength(12);

    // The last DE user changes country. Without the region half of the eviction
    // those twelve rows would sit there forever, pinning their titles out of the
    // boot prune along with them.
    await buildCalendarSnapshot(stubFetch(5), [DEFAULT_COUNTRY], NOW);
    expect(query("SELECT 1 FROM calendar_snapshot WHERE region = 'DE'")).toHaveLength(0);
  });
});
