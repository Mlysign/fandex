// What Home's rails are made from.
//
// The site built them on the server once a day (src/lib/homeSnapshot.ts): real
// trending endpoints for "Popular right now", the calendar's ranked month
// candidates for "Upcoming", and the taste model over those candidates for
// "Recommended for you". Here:
//
//   Popular right now   TMDB's trending films and shows this week, asked from
//                       the device, and the games out in the last sixty days,
//                       most rated first (/v1/browse/games?window=recent), as
//                       the site's trendingPool. Since 2026-10-15; before, it
//                       was recent releases, which is still the fallback when
//                       none of those answers.
//   Upcoming            what is still to come over three months, soonest first
//   Recommended         the upcoming titles your taste scores a strong match
//                       (the green band, the one the badge colours), best first
//
// The rotation is the site's own (src/lib/dailyRotation.ts): a rail is the
// same all day and different tomorrow, with its top three kept.

import { dayISO, rotateRail, seedFor } from '@/lib/dailyRotation';
import { tagKey } from '@/lib/facets';
import { boardgamesOn } from '~/lib/features';
import { api, type CalendarCard } from '~/lib/api';
import type { CardItem } from '~/lib/cards';
import { currentMonth, shiftMonth, todayIso } from '~/lib/dates';
import { tmdbTrending } from '~/lib/tmdb';
import type { AxisBand, ScoreFacet, ScoreLabel } from '~/lib/fandexScore';
import { scoreBand } from '~/lib/scoreReasons';

export const RAIL_SIZE = 15;

/** A calendar card, as a poster card, with the genres the taste model can read. */
export interface FeedCard extends CardItem { genres: string[] }

export interface HomeFeed {
  trending: FeedCard[];
  upcoming: FeedCard[];
  /** Every upcoming candidate, unranked: what "Recommended for you" is chosen from. */
  candidates: FeedCard[];
}

/**
 * A title the catalog holds: its id, and its slug so the card links
 * /{type}/{slug}. Without the slug every held card linked /item/{id} (SM80).
 */
export interface Held { id: string; slug: string | null }

const cardKey = (c: CalendarCard) => `${c.source}:${c.type}:${c.sourceId}`;

export function toCard(c: CalendarCard, held: Map<string, Held>): FeedCard {
  const key = cardKey(c);
  return {
    key, id: held.get(key)?.id ?? null, slug: held.get(key)?.slug ?? null, source: c.source, sourceId: c.sourceId, type: c.type, title: c.title,
    releaseDate: c.releaseDate, posterUrl: c.posterUrl, genres: c.genres ?? [],
    communityScore: c.voteAverage != null && c.voteCount > 0 ? Math.round(c.voteAverage * 10) : null,
    communityVotes: c.voteCount,
  };
}

/** The genres as the facets the score is computed from. A calendar card carries nothing finer. */
export function genreFacets(genres: string[]): ScoreFacet[] {
  return genres.map((g) => ({ kind: 'tag' as const, key: tagKey(g), label: g })).filter((f) => f.key);
}

/**
 * Which of these the catalog already holds, as card key to catalog id, so a
 * card can show your bookmark and your real score. One request, and it never
 * makes the Worker fetch. A failure is an empty answer: the cards still open.
 */
export async function lookupHeld(cards: CalendarCard[]): Promise<Map<string, Held>> {
  const held = new Map<string, Held>();
  if (!cards.length) return held;
  try {
    const res = await api.lookup(cards.map((c) => ({ source: c.source, type: c.type, id: c.sourceId })));
    for (const f of res.found) held.set(`${f.source}:${f.type}:${f.id}`, { id: f.mediaItemId, slug: f.slug ?? null });
  } catch { /* they just do not know your state */ }
  return held;
}

/**
 * The trending pool: each source in its own order, taken in turn (a film, a
 * show, a game, a book, a board game) so no one source fills the rail. The site ranked across
 * sources by each one's median (popularMonth.ts); taking turns is the same
 * idea without a number the three do not share. Null when nothing answered.
 */
async function trendingPool(): Promise<FeedCard[] | null> {
  const settle = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);
  const [films1, films2, shows, games, books, boardgames] = await Promise.all([
    settle(tmdbTrending('movie', 1)), settle(tmdbTrending('movie', 2)), settle(tmdbTrending('show', 1)),
    settle(api.browseGames(1, 'recent').then((r) => r.results.filter((g) => g.posterUrl))),
    // Open Library's weekly trending and BGG's hot list (2026-10-17). Board games
    // answer "not switched on" without a BGG token: an empty list, as a failure is.
    settle(api.browseShelf('books').then((r) => r.results.filter((b) => b.posterUrl))),
    settle(boardgamesOn().then((on) => (on ? api.browseShelf('boardgames').then((r) => r.results.filter((b) => b.posterUrl)) : []))),
  ]);
  const lists: { source: string; sourceId: string; type: CardItem['type']; title: string; releaseDate: string | null; posterUrl: string | null; votes: number; score?: number | null; rating?: number | null }[][] =
    [[...films1, ...films2], shows, games, books, boardgames];
  if (lists.every((l) => !l.length)) return null;
  const out: FeedCard[] = [];
  const seen = new Set<string>();
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const list of lists) {
      const c = list[i];
      if (!c) continue;
      const key = `${c.source}:${c.type}:${c.sourceId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key, id: null, source: c.source, sourceId: c.sourceId, type: c.type, title: c.title,
        releaseDate: c.releaseDate, posterUrl: c.posterUrl, genres: [],
        communityScore: c.score ?? c.rating ?? null, communityVotes: c.votes,
      });
    }
  }
  try {
    const res = await api.lookup(out.map((c) => ({ source: c.source as string, type: c.type, id: c.sourceId as string })));
    const held = new Map(res.found.map((f) => [`${f.source}:${f.type}:${f.id}`, f]));
    for (const c of out) {
      const f = held.get(c.key);
      c.id = f?.mediaItemId ?? null;
      c.slug = f?.slug ?? null;
    }
  } catch { /* the cards still open; they just do not know your state */ }
  return out;
}

let cached: { at: number; region: string; feed: HomeFeed } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function loadHomeFeed(region: string): Promise<HomeFeed> {
  if (cached && cached.region === region && Date.now() - cached.at < TTL_MS) return cached.feed;

  const now = currentMonth();
  const months = [shiftMonth(now, -1), now, shiftMonth(now, 1), shiftMonth(now, 2)];
  // A month that fails is a shorter rail, not an empty home page.
  const trendingAsked = trendingPool();
  const answers = await Promise.all(months.map((m) => api.calendar(m, region).catch(() => null)));
  if (answers.every((a) => a === null)) throw new Error('The calendar did not answer');

  const today = todayIso();
  const byMonth = answers.map((a, i) => (a?.data.items ?? []).filter((c) => c.releaseDate?.startsWith(months[i])));
  const seen = new Set<string>();
  const unique = (list: CalendarCard[]) => list.filter((c) => (seen.has(cardKey(c)) ? false : (seen.add(cardKey(c)), true)));

  // This month before last month, each in the rank the Worker gave it.
  const released = unique([...byMonth[1], ...byMonth[0]].filter((c) => (c.releaseDate as string) <= today));
  seen.clear();
  const future = unique([...byMonth[1], ...byMonth[2], ...byMonth[3]].filter((c) => (c.releaseDate as string) > today));

  const held = await lookupHeld([...released, ...future]);

  const day = dayISO();
  const candidates = future.map((c) => toCard(c, held));
  const upcoming = upcomingRail(candidates);
  const trending = rotateRail((await trendingAsked) ?? released.map((c) => toCard(c, held)), RAIL_SIZE, seedFor('trending', day));

  const feed = { trending, upcoming, candidates };
  cached = { at: Date.now(), region, feed };
  return feed;
}

/** Today's Upcoming rail out of the calendar's candidates: an even share of each type the viewer is looking at, soonest first. */
export function upcomingRail(candidates: FeedCard[], types?: readonly string[]): FeedCard[] {
  const pool = types ? candidates.filter((c) => types.includes(c.type)) : candidates;
  return balanceByType(pool, RAIL_SIZE, 'upcoming')
    .sort((a, b) => ((a.releaseDate as string) < (b.releaseDate as string) ? -1 : 1));
}

/** A title the rail may recommend: a calendar card, or a row of the catalog copy. */
export type Candidate = CardItem & { genres?: string[] };

/**
 * The candidates your taste scores a strong match, best first, as today's rail.
 * Strong is the badge's green band (`scoreBand`, the same margin over your own
 * average that colours a score on every card): a rail called "Recommended"
 * must not carry a title it would paint orange (Nils, 2026-10-17).
 *
 * `tiers` come in the order they should fill the rail: what is still to come
 * first, then what is recent, then the rest of the catalog. The next three
 * months of the calendar alone left one green card (Nils, same day: "it should
 * find the right items to show"), so the catalog copy on the device is a
 * candidate too, scored with its full facets. A title in two tiers counts in
 * the first. `center` is your average; null means there is no taste profile,
 * and nothing is recommended.
 */
/** At most this many titles you already wishlisted in one Recommended rail (Nils, 2026-10-23). */
export const MAX_WISHLISTED = 2;

/** What `recommend` asks of a candidate: the number that ranks it, and the label and bands its card shows. */
export type Scored = { score: number; label: ScoreLabel; taste: AxisBand; pull: AxisBand | null };

export function recommend<T extends Candidate>(
  tiers: T[][], scoreOf: (c: T) => Scored | null, skip: (c: T) => boolean, center: number | null,
  /** The media types the rail may hold, each given an even share. Everything when absent. */
  types?: readonly string[],
  /** Titles on your wishlist: they may be recommended, `MAX_WISHLISTED` to a rail. */
  wishlisted: (c: T) => boolean = () => false,
): (T & { fandexScore: number })[] {
  if (center == null) return [];
  const seen = new Set<string>();
  const ranked: (T & { fandexScore: number })[] = [];
  for (const tier of tiers) {
    const strong = tier
      .filter((c) => {
        const key = c.id ?? c.key;
        if (seen.has(key) || skip(c) || (types && !types.includes(c.type))) return false;
        seen.add(key);
        return true;
      })
      .map((c): T & { fandexScore: number | null } => { const s = scoreOf(c); return { ...c, fandexScore: s?.score ?? null, match: s ? { label: s.label, taste: s.taste, pull: s.pull } : null }; })
      .filter((c): c is T & { fandexScore: number } => c.fandexScore != null && scoreBand(c.fandexScore, center) === 'high')
      .sort((a, b) => b.fandexScore - a.fandexScore);
    ranked.push(...strong);
  }
  let kept = 0;
  const capped = ranked.filter((c) => !wishlisted(c) || kept++ < MAX_WISHLISTED);
  return balanceByType(capped, RAIL_SIZE, 'recommendation');
}

/**
 * A rail with an even share of each media type in `ranked` (Nils, 2026-10-18:
 * Recommended "is now flooded with games"; books were in neither rail). Each
 * type's titles are rotated out of its own ranking, so a type with a hundred
 * green games and one with three books each get their share of the fifteen,
 * and a type that runs out leaves its slots to the others. The types are
 * dealt in turn, so the first cards on screen are one of each.
 */
export function balanceByType<T extends { type: string }>(ranked: T[], size: number, railName: string, day = dayISO()): T[] {
  const byType = new Map<string, T[]>();
  for (const c of ranked) {
    const list = byType.get(c.type);
    if (list) list.push(c); else byType.set(c.type, [c]);
  }
  if (byType.size < 2) return rotateRail(ranked, size, seedFor(railName, day));
  // Shares: an even split, with what a short type cannot use handed on.
  const share = new Map<string, number>();
  let left = size;
  let open = [...byType.entries()].sort((a, b) => a[1].length - b[1].length);
  while (open.length && left > 0) {
    const each = Math.ceil(left / open.length);
    const [type, list] = open[0];
    const take = Math.min(each, list.length);
    share.set(type, take);
    left -= take;
    open = open.slice(1);
  }
  const picked = new Map<string, T[]>();
  for (const [type, list] of byType) picked.set(type, rotateRail(list, share.get(type) ?? 0, seedFor(railName, type, day), 1));
  const out: T[] = [];
  const order = [...byType.keys()];
  for (let i = 0; out.length < size && order.some((t) => i < (picked.get(t)?.length ?? 0)); i++) {
    for (const t of order) {
      const c = picked.get(t)?.[i];
      if (c) out.push(c);
    }
  }
  return out;
}

/** Which tier a catalog title falls in, by its date: 0 still to come, 1 out in the last year, 2 the rest. A title with no date is the rest. */
export function tierOf(releaseDate: string | null, today: string): 0 | 1 | 2 {
  if (!releaseDate) return 2;
  if (releaseDate > today) return 0;
  const yearAgo = `${Number(today.slice(0, 4)) - 1}${today.slice(4)}`;
  return releaseDate >= yearAgo ? 1 : 2;
}
