// A franchise page split into its series: one carousel per provider series,
// everything else in the grid under them (Nils, 2026-10-18).
//
// A series is what one provider filed together, cut to one medium: Open
// Library's "Harry Potter" books, TMDB's "Harry Potter Collection" films,
// IGDB's "Harry Potter" games. The key is the provider's own franchise key
// before the taxonomy bundled it, so "The Dark Knight" films are their own
// series on the Batman page. A title attached to the franchise by hand has no
// such key and goes in the grid, as on the item page (AGENTS.md: a hand attach
// belongs in "More from", never in a series rail).
//
// IGDB's franchise is broad: every Harry Potter game, tie-ins and Hogwarts
// Legacy alike, is one franchise there. So for a game the series is IGDB's
// collection, carried on the franchise facet as `series` since 2026-10-18:
// the tie-ins are "Harry Potter", the LEGO games "Lego Harry Potter", and
// Hogwarts Legacy is in none, so it goes in the grid.

import { ipDisplayLabel, ipKey } from '@/lib/facets';
import type { CardItem } from '~/lib/cards';

/** Fewer titles than this is not a series. The item page's series rail starts at three too. */
export const SERIES_MIN = 3;

/** How a medium is named in a series' title: "Harry Potter books". */
const PLURAL: Record<string, string> = { movie: 'films', show: 'shows', game: 'games', book: 'books', boardgame: 'board games' };
/** Series that start the same year: the source before the screen, the screen before the game. */
const MEDIA_ORDER = ['book', 'movie', 'show', 'game', 'boardgame'];

export interface SeriesKey { key: string; label: string }
export interface Series { id: string; label: string; items: CardItem[] }

/**
 * The series one franchise facet puts a title in. A game's IGDB collections
 * when they are known ([] for a game in none); otherwise the franchise as the
 * provider named it, which for a film, a book or a game stored before
 * collections were asked for is the series.
 */
export function seriesOfFacet(f: { key: string; label: string; series?: string[] }): SeriesKey[] {
  if (!Array.isArray(f.series)) return [{ key: f.key, label: f.label }];
  return f.series.map((name) => ({ key: ipKey(name), label: name })).filter((s) => !!s.key);
}

const oldestFirst = (a: CardItem, b: CardItem) => {
  const da = a.releaseDate; const db = b.releaseDate;
  if (!da && !db) return a.title.localeCompare(b.title);
  if (!da) return 1;
  if (!db) return -1;
  return da.localeCompare(db);
};

/**
 * Which cards make a series, and which are left for the grid.
 *
 * `seriesOf` answers each card's provider franchise keys that belong to this
 * page (the canonical key or a name bundled into it). A card the device does
 * not hold has none; `fromProviders` says it came from the page's provider
 * question, which asks by the franchise's own name, so it joins that name's
 * series of its medium.
 *
 * A card in two series goes in the bigger one. A page that would be one
 * carousel and an empty grid stays a grid.
 */
export function splitSeries(input: {
  cards: CardItem[];
  seriesOf: (c: CardItem) => SeriesKey[] | undefined;
  /** The page's canonical key and its name as shown. */
  franchiseKey: string;
  franchiseLabel: string;
}): { series: Series[]; rest: CardItem[] } {
  const { cards, seriesOf, franchiseKey, franchiseLabel } = input;
  const own = (c: CardItem): SeriesKey[] => seriesOf(c) ?? [{ key: franchiseKey, label: franchiseLabel }];
  const group = (c: CardItem, k: SeriesKey) => `${k.key}|${c.type}`;

  const size = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const c of cards) {
    for (const k of new Map(own(c).map((x) => [group(c, x), x])).values()) {
      const g = group(c, k);
      size.set(g, (size.get(g) ?? 0) + 1);
      if (!labels.has(g)) labels.set(g, k.key === franchiseKey ? franchiseLabel : ipDisplayLabel(k.label || k.key));
    }
  }

  const members = new Map<string, CardItem[]>();
  for (const c of cards) {
    let best: string | null = null;
    for (const k of own(c)) {
      const g = group(c, k);
      const n = size.get(g) ?? 0;
      // Ties go to the page's own name.
      if (!best || n > (size.get(best) ?? 0) || (n === size.get(best) && k.key === franchiseKey)) best = g;
    }
    if (!best) continue;
    const list = members.get(best);
    if (list) list.push(c); else members.set(best, [c]);
  }

  const series: Series[] = [];
  for (const [g, list] of members) {
    // Counted toward here is not kept here: a card in two series went to the bigger one.
    if (list.length < SERIES_MIN) continue;
    const type = g.slice(g.lastIndexOf('|') + 1);
    series.push({ id: g, label: `${labels.get(g)} ${PLURAL[type] ?? type}`, items: [...list].sort(oldestFirst) });
  }
  const grouped = new Set(series.flatMap((s) => s.items));
  // The grid keeps the order it was given: the page's sort.
  const rest = cards.filter((c) => !grouped.has(c));
  if (series.length === 1 && !rest.length) return { series: [], rest: cards };

  // The series that started first comes first.
  const start = (s: Series) => s.items[0]?.releaseDate?.slice(0, 4) ?? '9999';
  const medium = (s: Series) => MEDIA_ORDER.indexOf(s.items[0]?.type ?? '');
  series.sort((a, b) => start(a).localeCompare(start(b)) || medium(a) - medium(b));
  return { series, rest };
}
