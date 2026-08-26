import { get, query, run, transaction } from "@/lib/db";
import { log, errorFields } from "@/lib/logger";
import { DEFAULT_COUNTRY, normalizeCountry } from "@/lib/countries";
import { currentMonth, shiftMonth, indexableMonths } from "@/lib/calendarMonths";
import { POPULAR_PER_MONTH } from "@/lib/popularMonth";
import { persistDiscoverItems } from "@/lib/discoverPersist";
import type { FeedCandidate } from "@/lib/discoverFeed";

// THE DAILY CALENDAR SNAPSHOT: the popular-releases half of the calendar, for a
// window of months, built once a day on the server.
//
// The same move migration 21 made for `/` (Nils: "can we apply the same logic to
// the calendar page?"), and it buys three different things here.
//
//   · LATENCY. Paging the calendar used to wait on a provider fan-out for each
//     new month. Measured cold: 1.24 s. It is now a table read behind the
//     existing in-memory cache.
//   · COST. The fan-out is 4 provider page fetches per month per region. It now
//     happens 12 times a day in total, no matter how many people page through
//     the calendar or how many crawlers walk the month pages.
//   · LINKS, which is the one nobody asked for. `/calendar/{YYYY-MM}` is public,
//     crawlable and in the sitemap, and it persists with a null user by design
//     (PR15), so any title we do not already hold renders as dead text with no
//     href. Measured on 2026-09 before this shipped: 8 of 15 items linkable. The
//     daily builder persists the shown titles once, bounded, off the request
//     path, so the month pages ship real links.
//
// ⚠️ THE PER-USER HALF IS NOT IN HERE AND MUST NOT BE. The calendar merges the
// viewer's wishlist and library over this feed client-side (`mergeMyStuff` in
// CalendarPageClient). A snapshot is by definition the half of a page that is
// identical for everybody; the moment it holds one user's rows it is a cache
// with a leak in it.
//
// The four rules from `homeSnapshot.ts` all apply here unchanged. Rule 4 is the
// one that differs in mechanism and it is called out on the migration: this
// table's key includes the month, and the window SLIDES, so it CAN grow. The
// build deletes out-of-window rows on every run.

/**
 * How far back and forward the snapshot covers.
 *
 * Nils asked for "current month +- 5". The past side is exactly that. The future
 * side is SIX, not five, and the extra month is not a preference:
 * `indexableMonths()` advertises `-1 .. +6` in the sitemap, so a five-month
 * future window would leave `/calendar/{+6}` outside the snapshot while it is
 * still a crawlable, indexed url. That month would quietly fall back to a live
 * provider fan-out on a crawler's request, which is the exact cost this exists
 * to remove, and nothing would ever surface it.
 *
 * ⚠️ A test asserts this window stays a SUPERSET of `indexableMonths()`. If the
 * index window ever widens, this has to widen with it.
 */
export const SNAPSHOT_PAST_MONTHS = 5;
export const SNAPSHOT_FUTURE_MONTHS = 6;

/** Rebuilt once a day, same as the home snapshot. */
export const CALENDAR_SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Past this age a stored month is ignored and the caller falls back to a live
 * fetch. Deliberately generous, for the same reason the home snapshot's is: a
 * failed build keeps the previous rows, and a week of provider trouble should
 * degrade to "slightly stale" rather than to "empty".
 */
export const CALENDAR_SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The months the snapshot covers, oldest first. Currently 12. */
export function snapshotMonths(now: Date = new Date()): string[] {
  const here = currentMonth(now);
  const count = SNAPSHOT_PAST_MONTHS + 1 + SNAPSHOT_FUTURE_MONTHS;
  return Array.from({ length: count }, (_, i) => shiftMonth(here, i - SNAPSHOT_PAST_MONTHS));
}

/** Whether a month is inside the snapshot window. */
export function isSnapshotMonth(month: string, now: Date = new Date()): boolean {
  return snapshotMonths(now).includes(month);
}

/**
 * The stored ranked candidates for one month, or null.
 *
 * ⚠️ Never builds. A build is the provider fan-out this exists to remove, and
 * putting it on a request path hands it to whichever visitor arrives first,
 * which in practice is a crawler. `candidatesForMonth` owns the fallback.
 */
export function readMonthSnapshot(
  month: string,
  region: string = DEFAULT_COUNTRY,
): FeedCandidate[] | null {
  const row = get<{ built_at: number; payload: string }>(
    "SELECT built_at, payload FROM calendar_snapshot WHERE region = ? AND month = ?",
    [region, month],
  );
  if (!row) return null;
  if (Date.now() - row.built_at > CALENDAR_SNAPSHOT_MAX_AGE_MS) return null;

  try {
    const parsed = JSON.parse(row.payload) as FeedCandidate[];
    // An empty array is a real answer for a month with nothing in it, but it is
    // also what a half-written row looks like, and the cost of being wrong is
    // one live fetch. Treat it as a miss.
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch (e) {
    log.warn("calendar_snapshot_parse_failed", { month, region, ...errorFields(e) });
    return null;
  }
}

// ── WHICH REGIONS GET BUILT ─────────────────────────────────────────────────
//
// ⚠️ THIS IS NOT A COMPLETENESS FLOURISH. The first version of this file built
// DEFAULT_COUNTRY only, exactly like the home snapshot, and it was verified by
// measuring the provider counters. Paging eleven months while signed in moved
// them by 33, not 0, because `/api/calendar/popular` passes the VIEWER's region
// through and this account is `DE`. Every signed-in visitor outside the default
// country would have got the old slow path and the full provider bill, from a
// change whose entire point was removing both. It measured as working because
// the anonymous path really was fixed.
//
// So the window is months × REGIONS ACTUALLY IN USE. That set is bounded by the
// people who have signed up, not by the country list: today it is two.
//
// ⚠️ The incremental cost of a region is smaller than it looks, and also more
// wasteful than it needs to be. Of the four provider calls a month costs, only
// `fetchMoviePage` takes a region at all. RAWG, IGDB and the TMDB show endpoint
// ignore it, so an extra region re-fetches three identical payloads to get one
// different one. Fine at two regions (48 calls a day); worth splitting the fetch
// by region-sensitivity if this ever reaches double digits.
const MAX_SNAPSHOT_REGIONS = 8;

/**
 * Every region worth pre-building, most-used first, DEFAULT_COUNTRY always
 * included.
 *
 * Capped, and the cap LOGS when it bites. A silent truncation here would read as
 * "the calendar is snapshotted" while some users quietly kept paying for a live
 * fan-out, which is the exact failure this function exists to stop, and which
 * already happened once.
 */
export function snapshotRegions(): string[] {
  const rows = query<{ country: string | null; n: number }>(
    `SELECT country, COUNT(*) AS n FROM users
      WHERE country IS NOT NULL AND TRIM(country) != ''
      GROUP BY country ORDER BY n DESC`,
    [],
  );

  const out = [DEFAULT_COUNTRY];
  for (const r of rows) {
    const c = normalizeCountry(r.country);
    if (c && !out.includes(c)) out.push(c);
  }

  if (out.length > MAX_SNAPSHOT_REGIONS) {
    log.warn("calendar_snapshot_regions_capped", {
      cap: MAX_SNAPSHOT_REGIONS,
      inUse: out.length,
      dropped: out.slice(MAX_SNAPSHOT_REGIONS),
    });
    return out.slice(0, MAX_SNAPSHOT_REGIONS);
  }
  return out;
}

/**
 * Whether any region in use is missing months or due for a rebuild.
 *
 * Checking every region, not just the default, is what makes a NEW region
 * self-healing: someone sets their country to one nobody has used before, their
 * calendar falls back to the live path, and the next hourly check builds it.
 */
export function calendarSnapshotIsDue(now: Date = new Date()): boolean {
  const want = snapshotMonths(now);
  const cutoff = Date.now() - CALENDAR_SNAPSHOT_TTL_MS;
  const rows = query<{ region: string; month: string; built_at: number }>(
    "SELECT region, month, built_at FROM calendar_snapshot",
    [],
  );
  const have = new Map(rows.map((r) => [`${r.region}:${r.month}`, r.built_at]));

  for (const region of snapshotRegions()) {
    for (const month of want) {
      const at = have.get(`${region}:${month}`);
      // Missing is the NORMAL trigger, not staleness: the window slides by one
      // month at a time, so the newest month is simply absent. An age-only check
      // would miss it for a whole day.
      if (at === undefined || at <= cutoff) return true;
    }
  }
  return false;
}

export interface CalendarSnapshotResult {
  regions: string[];
  /** Months in the window. */
  months: number;
  /** (region, month) payloads refreshed from the providers. */
  refreshed: number;
  /** (region, month) pairs whose fetch failed or was empty, keeping the old row. */
  kept: number;
  /** Distinct catalog rows the shown titles resolve to, across the whole window. */
  pinned: number;
  /** Stored rows the window has moved past, deleted. */
  evicted: number;
}

/**
 * Build every month in the window, for every region in use, and store it.
 *
 * `fetchMonth` is INJECTED rather than imported, to break a cycle:
 * `popularMonthFeed` reads this module's snapshot, so it cannot also be a static
 * dependency of it. `instrumentation.ts` wires the real one.
 */
export async function buildCalendarSnapshot(
  fetchMonth: (month: string, region: string) => Promise<FeedCandidate[]>,
  regions: string[] = snapshotRegions(),
  now: Date = new Date(),
): Promise<CalendarSnapshotResult> {
  const months = snapshotMonths(now);
  const result: CalendarSnapshotResult = {
    regions, months: months.length, refreshed: 0, kept: 0, pinned: 0, evicted: 0,
  };

  // Every uuid the window's SHOWN titles resolve to, across every region,
  // written as one replacement set at the end. See `replacePins` for why this
  // is not done per month.
  const pins = new Set<string>();

  for (const region of regions) {
    for (const month of months) {
      let candidates: FeedCandidate[] | null = null;
      try {
        const fetched = await fetchMonth(month, region);
        if (fetched.length > 0) candidates = fetched;
      } catch (e) {
        // ⚠️ RULE 1, per month. A month that fails keeps whatever it already
        // had, and the loop continues: one bad month must not cost the other
        // eleven. The same per-source isolation `candidatesForMonth` already
        // applies within a month, one level up.
        log.warn("calendar_snapshot_month_failed", { month, region, ...errorFields(e) });
      }

      if (candidates) {
        const payload = JSON.stringify(candidates);
        run(
          `INSERT OR REPLACE INTO calendar_snapshot (region, month, built_at, payload)
           VALUES (?, ?, ?, ?)`,
          [region, month, Date.now(), payload],
        );
        result.refreshed++;
      } else {
        // Rule 1's other half. An empty result is what both "nothing releases
        // that month" and "the provider returned nothing today" look like from
        // here, and they are indistinguishable; the stored row is the better
        // guess either way. Fall back to it so this month still contributes its
        // pins.
        candidates = readMonthSnapshot(month, region);
        result.kept++;
        if (!candidates) continue;
      }

      // ⚠️ RULE 2: the bounded, once-a-day catalog write that makes the public
      // month pages link. Only the titles the page actually SHOWS, never the
      // full 40-deep pool: pinning what is never linked would be a slow leak of
      // un-prunable rows. `persistDiscoverItems` directly rather than a fake
      // user through `persistDiscoverBatch`, so the request-path gate keeps its
      // shape. It looks up first and writes only misses, so re-running it over a
      // month that did not change is a pure read.
      try {
        for (const id of persistDiscoverItems(candidates.slice(0, POPULAR_PER_MONTH) as never).values()) {
          pins.add(id);
        }
      } catch (e) {
        // A failed persist costs links, not the snapshot: a fast calendar with
        // some dead text beats a slow one.
        log.warn("calendar_snapshot_persist_failed", { month, region, ...errorFields(e) });
      }
    }
  }

  result.pinned = pins.size;
  result.evicted = evictOutsideWindow(months, regions);
  replacePins(pins);

  log.info("calendar_snapshot_built", { ...result });
  return result;
}

/**
 * Drop stored rows the window has moved past, or whose region nobody uses.
 *
 * ⚠️ THIS IS THE BOUND, AND UNLIKE `home_snapshot` IT IS NOT STRUCTURAL. That
 * table is keyed by region alone, so `INSERT OR REPLACE` makes growth
 * impossible. This one is keyed by region AND month over a window that SLIDES,
 * so every month that passes retires one key and mints another. Without this it
 * gains a row a month forever, and each row keeps its titles out of the boot
 * prune along with it. A slow version of the shape that grew `facet_page_cache`
 * to 222.8 MB, and slow is worse: nobody would connect it back to this file.
 *
 * The region half matters too, just less often: a user changing their country
 * away from one nobody else uses would otherwise leave that region's twelve
 * months stored forever.
 */
function evictOutsideWindow(keepMonths: string[], keepRegions: string[]): number {
  const mHolders = keepMonths.map(() => "?").join(",");
  const rHolders = keepRegions.map(() => "?").join(",");
  const where = `month NOT IN (${mHolders}) OR region NOT IN (${rHolders})`;
  const params = [...keepMonths, ...keepRegions];

  const stale = query<{ region: string; month: string }>(
    `SELECT region, month FROM calendar_snapshot WHERE ${where}`, params,
  );
  if (stale.length > 0) run(`DELETE FROM calendar_snapshot WHERE ${where}`, params);
  return stale.length;
}

/**
 * Replace the whole prune-pin set in one transaction.
 *
 * Rebuilt wholesale rather than edited per month because a title can legitimately
 * appear in TWO months at once (a release that slipped, present in the old month
 * from a stale payload and in the new one from a fresh fetch) and in every region
 * at once. Deleting a month's pins individually would drop a row another month
 * still links.
 */
function replacePins(ids: Set<string>): void {
  transaction(() => {
    run("DELETE FROM calendar_snapshot_item", []);
    for (const id of ids) {
      run("INSERT OR IGNORE INTO calendar_snapshot_item (media_item_id) VALUES (?)", [id]);
    }
  });
}

/** Test seam: what the prune pin currently protects. */
export function pinnedCalendarItemCount(): number {
  return get<{ n: number }>("SELECT COUNT(*) n FROM calendar_snapshot_item")?.n ?? 0;
}

/**
 * The snapshot window must cover everything the sitemap advertises.
 *
 * Exported for the test rather than asserted at runtime: a month outside the
 * window still works, it just costs a live provider fan-out on a crawler's
 * request. That is a cost regression, not an outage, and it is exactly the kind
 * of thing nothing surfaces without a test.
 */
export function indexableMonthsOutsideSnapshot(now: Date = new Date()): string[] {
  const covered = new Set(snapshotMonths(now));
  return indexableMonths(now).filter((m) => !covered.has(m));
}
