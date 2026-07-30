import type { NextRequest} from "next/server";
import { NextResponse } from "next/server";
import { withUser } from "@/lib/withUser";
import { BadRequestError } from "@/lib/validate";
import { getUserCountry } from "@/lib/userCountry";
import { BoundedCache } from "@/lib/boundedCache";
import { decorateSection } from "@/lib/liveDiscover";
import { persistDiscoverBatch, annotateUserState } from "@/lib/annotateDiscover";
import { rankPopularMonth, POPULAR_PER_MONTH } from "@/lib/popularMonth";
import type {
  FeedCandidate} from "@/lib/discoverFeed";
import { monthWindow,
  fetchGamePage, fetchMoviePage, fetchShowPage, fetchIgdbGamePage,
} from "@/lib/discoverFeed";

// The calendar's "Popular" scope (2026-07-28): the month's biggest releases
// straight from the providers, independent of anything the user has saved.
// One month per request — the calendar fetches lazily as you page through it.
//
// Trakt is deliberately absent from the source list: /movies/anticipated and
// /shows/anticipated take no date parameter, so they can't answer "this month"
// and can never answer a month in the past.
//
// This route is withUser, not public, for three reasons: it's only reachable
// from an already-auth-gated page; it gets the shared 300/60s per-user cap for
// free (these are OUR provider keys being spent); and persistDiscoverBatch's
// session gate means an anonymous crawler can never mint media_items rows here
// — the failure mode that grew the pool to ~676k rows on /discover. Don't
// relax it.

// Past months never change and future months move slowly, so a 6h TTL is
// generous. `max` holds a few years of months across a couple of regions.
const POPULAR_TTL_MS = 6 * 60 * 60 * 1000;
const _monthCache = new BoundedCache<string, FeedCandidate[]>({ max: 120, ttlMs: POPULAR_TTL_MS });

const MONTH_RE = /^(\d{4})-(\d{2})$/;
// Providers have nothing useful outside roughly this range, and an unbounded
// month lets a caller walk us through thousands of upstream requests.
const MIN_YEAR = 1950;
const MAX_YEAR = 2100;

function parseMonth(raw: string | null): string {
  const m = raw?.match(MONTH_RE);
  if (!m) throw new BadRequestError("month must be YYYY-MM");
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) throw new BadRequestError("month must be YYYY-MM");
  if (year < MIN_YEAR || year > MAX_YEAR) throw new BadRequestError(`year must be between ${MIN_YEAR} and ${MAX_YEAR}`);
  return `${m[1]}-${m[2]}`;
}

async function candidatesForMonth(month: string, region: string): Promise<FeedCandidate[]> {
  const key = `${month}:${region}`;
  const hit = _monthCache.get(key);
  if (hit) return hit;

  const win = monthWindow(month);
  // Page 1 of each source is enough: each is already sorted by its own
  // popularity, so page 2 holds items that could never place in a top-15.
  // `.catch` per source, not one shared await — one provider being down should
  // cost its own titles, not the whole month.
  const [games, igdbGames, movies, shows] = await Promise.all([
    fetchGamePage(1, "future", win).catch(() => []),
    fetchIgdbGamePage(1, "future", win).catch(() => []),
    fetchMoviePage(1, "future", region, win).catch(() => []),
    fetchShowPage(1, "future", win).catch(() => []),
  ]);

  // RAWG before IGDB: on a duplicate game, rankPopularMonth keeps the first
  // seen, and RAWG's list payload carries the richer poster/platform data.
  const ranked = rankPopularMonth([...games, ...igdbGames, ...movies, ...shows], POPULAR_PER_MONTH);
  _monthCache.set(key, ranked);
  return ranked;
}

export const GET = withUser(async (req: NextRequest, session) => {
  const month = parseMonth(req.nextUrl.searchParams.get("month"));
  const region = getUserCountry(session.userId);

  const ranked = await candidatesForMonth(month, region);
  // decorate → persist (strips `raw`, mints uuids) → annotate with this user's
  // wishlist/library state, so a popular item they already track renders with
  // the same bookmark/check the rest of the calendar shows.
  const decorated = decorateSection(ranked, session.userId);
  const items = annotateUserState(persistDiscoverBatch(decorated, session.userId), session.userId);

  return NextResponse.json({ month, items });
});
