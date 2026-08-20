import { describe, it, expect } from "vitest";
import {
  isCalendarMonth, shiftMonth, monthLabel, currentMonth,
  indexableMonths, isIndexableMonth, isServableMonth, monthNav, monthRobots,
  INDEXABLE_FUTURE_MONTHS, INDEXABLE_PAST_MONTHS,
} from "./calendarMonths";

// SEO (2026-08-20) — `/calendar/{YYYY-MM}`, the public month pages. The window
// is a CRAWL BOUND (each page fans out to three providers), so most of what
// matters here is that nothing can escape it.

const NOW = new Date("2026-08-20T05:00:00Z");

describe("isCalendarMonth", () => {
  it("accepts a real YYYY-MM", () => {
    expect(isCalendarMonth("2026-01")).toBe(true);
    expect(isCalendarMonth("2026-12")).toBe(true);
  });

  it("rejects a month outside 01–12, a bad shape, and nothing at all", () => {
    expect(isCalendarMonth("2026-00")).toBe(false);
    expect(isCalendarMonth("2026-13")).toBe(false);
    expect(isCalendarMonth("2026-1")).toBe(false);
    expect(isCalendarMonth("2026-09-01")).toBe(false);
    expect(isCalendarMonth("september")).toBe(false);
    expect(isCalendarMonth(null)).toBe(false);
    expect(isCalendarMonth(undefined)).toBe(false);
  });
});

describe("shiftMonth", () => {
  it("crosses a year boundary in both directions", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
  });

  it("shifts by more than a year", () => {
    expect(shiftMonth("2026-08", 12)).toBe("2027-08");
    expect(shiftMonth("2026-08", -20)).toBe("2024-12");
  });

  it("round-trips", () => {
    expect(shiftMonth(shiftMonth("2026-03", 7), -7)).toBe("2026-03");
  });
});

describe("monthLabel", () => {
  it("renders an English month and year", () => {
    expect(monthLabel("2026-09")).toBe("September 2026");
    expect(monthLabel("2026-01")).toBe("January 2026");
    expect(monthLabel("2026-12")).toBe("December 2026");
  });
});

describe("currentMonth", () => {
  it("reads UTC, not the server's local time", () => {
    // 23:30 on the 31st in UTC+2 is still the 31st in UTC — the point is that
    // the answer never depends on where the process runs.
    expect(currentMonth(new Date("2026-08-31T23:30:00Z"))).toBe("2026-08");
    expect(currentMonth(new Date("2026-09-01T00:30:00Z"))).toBe("2026-09");
  });
});

describe("indexableMonths", () => {
  it("spans one month back through six ahead, oldest first", () => {
    expect(indexableMonths(NOW)).toEqual([
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12", "2027-01", "2027-02",
    ]);
  });

  it("has exactly the length the two constants declare", () => {
    expect(indexableMonths(NOW)).toHaveLength(INDEXABLE_PAST_MONTHS + 1 + INDEXABLE_FUTURE_MONTHS);
  });

  it("every month it advertises is one it would also index", () => {
    for (const m of indexableMonths(NOW)) expect(isIndexableMonth(m, NOW)).toBe(true);
  });
});

describe("monthNav — the crawl corridor is closed at both ends", () => {
  it("links both ways in the middle of the window", () => {
    expect(monthNav("2026-10", NOW)).toEqual({ prev: "2026-09", next: "2026-11" });
  });

  it("drops the prev link at the oldest indexable month", () => {
    expect(monthNav("2026-07", NOW)).toEqual({ prev: null, next: "2026-08" });
  });

  it("drops the next link at the newest indexable month", () => {
    expect(monthNav("2027-02", NOW)).toEqual({ prev: "2027-01", next: null });
  });

  it("offers no way back IN from outside the window, so a crawler cannot loop", () => {
    expect(monthNav("2030-01", NOW)).toEqual({ prev: null, next: null });
    expect(monthNav("2001-01", NOW)).toEqual({ prev: null, next: null });
  });
});

describe("monthRobots", () => {
  it("leaves a healthy in-window month on the default", () => {
    expect(monthRobots("2026-09", 15, true, NOW)).toBeUndefined();
  });

  it("noindexes a month outside the crawl window, keeping follow", () => {
    expect(monthRobots("2028-05", 15, true, NOW)).toEqual({ index: false, follow: true });
  });

  it("noindexes a month with fewer than three releases", () => {
    expect(monthRobots("2026-09", 2, true, NOW)).toEqual({ index: false, follow: true });
    expect(monthRobots("2026-09", 0, true, NOW)).toEqual({ index: false, follow: true });
    expect(monthRobots("2026-09", 3, true, NOW)).toBeUndefined();
  });

  it("the soft-launch switch overrides everything", () => {
    expect(monthRobots("2026-09", 15, false, NOW)).toEqual({ index: false, follow: false });
  });
});

describe("isServableMonth — the compute bound", () => {
  it("serves a year either side of now", () => {
    expect(isServableMonth("2026-08", NOW)).toBe(true);
    expect(isServableMonth("2025-08", NOW)).toBe(true);
    expect(isServableMonth("2027-08", NOW)).toBe(true);
  });

  it("refuses a month beyond the range, so no provider is ever called for it", () => {
    expect(isServableMonth("2025-07", NOW)).toBe(false);
    expect(isServableMonth("2027-09", NOW)).toBe(false);
    expect(isServableMonth("1874-03", NOW)).toBe(false);
    expect(isServableMonth("2099-01", NOW)).toBe(false);
  });

  it("refuses a malformed month without needing a separate shape check", () => {
    expect(isServableMonth("2026-13", NOW)).toBe(false);
    expect(isServableMonth("nonsense", NOW)).toBe(false);
  });

  it("every indexable month is servable — the windows can never invert", () => {
    for (const m of indexableMonths(NOW)) expect(isServableMonth(m, NOW)).toBe(true);
  });
});
