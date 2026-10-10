// What Home's rails are made from.
//
// The site built them on the server once a day (src/lib/homeSnapshot.ts): real
// trending endpoints for "Popular right now", the calendar's ranked month
// candidates for "Upcoming", and the taste model over those candidates for
// "Recommended for you". The Worker has no home route yet, so this uses the one
// ranked feed it does serve, the calendar's months:
//
//   Popular right now   what came out in the last weeks, in the month's own rank order
//   Upcoming            what is still to come over three months, soonest first
//   Recommended         the upcoming titles, ordered by your taste
//
// ⚠️ "Popular right now" is therefore recent releases by popularity, not watch
// activity. It becomes the site's rail when the Worker serves trending.
//
// The rotation is the site's own (src/lib/dailyRotation.ts): a rail is the
// same all day and different tomorrow, with its top three kept.

import { dayISO, rotateRail, seedFor } from '@/lib/dailyRotation';
import { tagKey } from '@/lib/facets';
import { api, type CalendarCard } from '~/lib/api';
import type { CardItem } from '~/lib/cards';
import { currentMonth, shiftMonth, todayIso } from '~/lib/dates';
import type { ScoreFacet } from '~/lib/fandexScore';

export const RAIL_SIZE = 15;

/** A calendar card, as a poster card, with the genres the taste model can read. */
export interface FeedCard extends CardItem { genres: string[] }

export interface HomeFeed {
  trending: FeedCard[];
  upcoming: FeedCard[];
  /** Every upcoming candidate, unranked: what "Recommended for you" is chosen from. */
  candidates: FeedCard[];
}

const cardKey = (c: CalendarCard) => `${c.source}:${c.type}:${c.sourceId}`;

export function toCard(c: CalendarCard, held: Map<string, string>): FeedCard {
  const key = cardKey(c);
  return {
    key, id: held.get(key) ?? null, source: c.source, sourceId: c.sourceId, type: c.type, title: c.title,
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
export async function lookupHeld(cards: CalendarCard[]): Promise<Map<string, string>> {
  const held = new Map<string, string>();
  if (!cards.length) return held;
  try {
    const res = await api.lookup(cards.map((c) => ({ source: c.source, type: c.type, id: c.sourceId })));
    for (const f of res.found) held.set(`${f.source}:${f.type}:${f.id}`, f.mediaItemId);
  } catch { /* they just do not know your state */ }
  return held;
}

let cached: { at: number; region: string; feed: HomeFeed } | null = null;
const TTL_MS = 10 * 60 * 1000;

export async function loadHomeFeed(region: string): Promise<HomeFeed> {
  if (cached && cached.region === region && Date.now() - cached.at < TTL_MS) return cached.feed;

  const now = currentMonth();
  const months = [shiftMonth(now, -1), now, shiftMonth(now, 1), shiftMonth(now, 2)];
  // A month that fails is a shorter rail, not an empty home page.
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
  const upcoming = rotateRail(candidates, RAIL_SIZE, seedFor('upcoming', day))
    .sort((a, b) => ((a.releaseDate as string) < (b.releaseDate as string) ? -1 : 1));
  const trending = rotateRail(released.map((c) => toCard(c, held)), RAIL_SIZE, seedFor('trending', day));

  const feed = { trending, upcoming, candidates };
  cached = { at: Date.now(), region, feed };
  return feed;
}

/** Order the candidates by a score, best first, and take today's rail from them. */
export function recommend(candidates: FeedCard[], scoreOf: (c: FeedCard) => number | null, skip: (c: FeedCard) => boolean): (FeedCard & { fandexScore: number })[] {
  const ranked = candidates
    .filter((c) => !skip(c))
    .map((c) => ({ ...c, fandexScore: scoreOf(c) }))
    .filter((c): c is FeedCard & { fandexScore: number } => c.fandexScore != null)
    .sort((a, b) => b.fandexScore - a.fandexScore);
  return rotateRail(ranked, RAIL_SIZE, seedFor('recommendation', dayISO()));
}
