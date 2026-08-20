// The public, crawlable release-calendar months (`/calendar/{YYYY-MM}`).
//
// `/calendar` itself is the interactive app: client-rendered, its data endpoint
// under the `/api/` robots disallow, and two of its three scopes per-user. A
// crawler can only ever see it empty, which is why it stays disallowed. But
// "what's coming out in September" is the one genuinely public, genuinely
// searched thing Fandex knows, and it had no indexable surface at all — so
// these month pages are that surface, server-rendered, one stable URL each.
//
// ⚠️ THE WINDOW IS A CRAWL BOUND, NOT A PREFERENCE. Each month page fans out to
// TMDB, RAWG and IGDB on our keys (cached 6 h per month+region). Month → month
// prev/next navigation over an unbounded range is an infinite crawl corridor:
// a crawler that follows "next" forever walks us through thousands of upstream
// requests, which is the same shape as the crawl that filled facet_page_cache
// to 222 MB on 2026-08-19. So the nav links, the sitemap entries and the index
// directive all come from ONE window, computed here.
//
// A month OUTSIDE the window still renders — shared links must not rot — it
// simply carries `noindex` and no navigation out of itself.

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

// English-only on purpose. The app has no locale routing (only /legal/{en,de}
// does), so a German month name here would contradict the page's own `lang`.
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** How far ahead the calendar is worth indexing. Providers thin out past this. */
export const INDEXABLE_FUTURE_MONTHS = 6;

/** One month back, so "what came out last month" still resolves for a searcher. */
export const INDEXABLE_PAST_MONTHS = 1;

// ── The SERVABLE range, which is a different and stricter bound ─────────────
//
// The index window above decides what we ADVERTISE. This decides what we will
// spend a provider fan-out on at all, and it exists because `Allow: /calendar/`
// opens the whole path space to any crawler that guesses the pattern — nothing
// links outside the window, but "nothing links there" has never been a bound.
// Without this, `/calendar/1874-03` is a live 200 that reaches TMDB, RAWG and
// IGDB on our keys, and there are ~1,800 of those.
//
// Wider than the index window on purpose, so a link shared while a month was
// current still renders for a year rather than 404ing a month later. Outside
// this range the route is a plain 404 and touches no provider.
export const SERVABLE_PAST_MONTHS = 12;
export const SERVABLE_FUTURE_MONTHS = 12;

// A month page listing one or two releases duplicates the item pages it points
// at and says nothing more — the same test the facet pages use, same reason.
export const MIN_INDEXABLE_RELEASES = 3;

export function isCalendarMonth(s: string | null | undefined): boolean {
  return !!s && MONTH_RE.test(s);
}

// month -> absolute month index, so shifting never has to reason about December.
function toIndex(month: string): number {
  const m = MONTH_RE.exec(month);
  if (!m) throw new Error(`not a YYYY-MM month: ${month}`);
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

function fromIndex(idx: number): string {
  const year = Math.floor(idx / 12);
  const month = (idx % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function shiftMonth(month: string, delta: number): string {
  return fromIndex(toIndex(month) + delta);
}

/** "2026-09" → "September 2026". */
export function monthLabel(month: string): string {
  const m = MONTH_RE.exec(month);
  if (!m) return month;
  return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
}

// UTC, not local time. The server's month must not depend on where the process
// happens to run, or the sitemap and the page would disagree across a midnight
// boundary in one direction and not the other.
export function currentMonth(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Every month we advertise for crawl, oldest first. Currently 8. */
export function indexableMonths(now: Date = new Date()): string[] {
  const start = toIndex(currentMonth(now)) - INDEXABLE_PAST_MONTHS;
  const count = INDEXABLE_PAST_MONTHS + 1 + INDEXABLE_FUTURE_MONTHS;
  return Array.from({ length: count }, (_, i) => fromIndex(start + i));
}

/**
 * Whether the route will build this month at all. Outside it the page 404s
 * WITHOUT calling a provider — this is the compute bound, not a UX choice.
 */
export function isServableMonth(month: string, now: Date = new Date()): boolean {
  if (!isCalendarMonth(month)) return false;
  const idx = toIndex(month);
  const here = toIndex(currentMonth(now));
  return idx >= here - SERVABLE_PAST_MONTHS && idx <= here + SERVABLE_FUTURE_MONTHS;
}

export function isIndexableMonth(month: string, now: Date = new Date()): boolean {
  if (!isCalendarMonth(month)) return false;
  const idx = toIndex(month);
  const here = toIndex(currentMonth(now));
  return idx >= here - INDEXABLE_PAST_MONTHS && idx <= here + INDEXABLE_FUTURE_MONTHS;
}

/**
 * The prev/next months a page may LINK to — inside the window only, so the
 * crawl corridor is closed at both ends. Returns null on a side that would
 * leave the window.
 */
export function monthNav(month: string, now: Date = new Date()): { prev: string | null; next: string | null } {
  const prev = shiftMonth(month, -1);
  const next = shiftMonth(month, 1);
  return {
    prev: isIndexableMonth(prev, now) ? prev : null,
    next: isIndexableMonth(next, now) ? next : null,
  };
}

/**
 * The robots directive for a month page, or undefined for the default. Outside
 * the crawl window, or too thin to be worth a result, it is noindex — `follow`
 * stays on so the item links it does carry are still worth something.
 *
 * `itemsIndexable` is PUBLIC_ITEMS_INDEXABLE, passed in rather than imported so
 * this stays pure. It is here for the same reason facetRobots takes it: the
 * soft-launch switch means "nothing public is indexed", and a surface that
 * quietly exempted itself would be a hole in that claim rather than a feature.
 */
export function monthRobots(
  month: string,
  releaseCount: number,
  itemsIndexable: boolean,
  now: Date = new Date()
): { index: boolean; follow: boolean } | undefined {
  if (!itemsIndexable) return { index: false, follow: false };
  if (!isIndexableMonth(month, now)) return { index: false, follow: true };
  if (releaseCount < MIN_INDEXABLE_RELEASES) return { index: false, follow: true };
  return undefined;
}
