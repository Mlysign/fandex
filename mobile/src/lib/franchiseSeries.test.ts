import { describe, expect, it } from 'vitest';
import type { MediaType } from '@/types';
import type { CardItem } from '~/lib/cards';
import { seriesOfFacet, splitSeries, type SeriesKey } from '~/lib/franchiseSeries';

const card = (id: string, type: MediaType, releaseDate: string | null): CardItem => ({
  key: id, id, type, title: id, releaseDate, posterUrl: null, communityScore: null, communityVotes: 0,
});

// The Harry Potter page as prod holds it (2026-10-18): every book, film and
// game carries the provider key "harry potter"; the show is attached by hand.
const HP: SeriesKey = { key: 'harry potter', label: 'Harry Potter' };
const FILMS: SeriesKey = { key: 'harry potter', label: 'Harry Potter Collection' };
const books = Array.from({ length: 7 }, (_, i) => card(`book${i}`, 'book', `${1997 + i}-07-01`));
const films = Array.from({ length: 8 }, (_, i) => card(`film${i}`, 'movie', `${2001 + i}-11-16`));
const games = Array.from({ length: 5 }, (_, i) => card(`game${i}`, 'game', `${2001 + i}-11-15`));
const show = card('show', 'show', '2027-01-01');
const keys = new Map<string, SeriesKey[]>([
  ...books.map((c) => [c.key, [HP]] as [string, SeriesKey[]]),
  ...films.map((c) => [c.key, [FILMS]] as [string, SeriesKey[]]),
  ...games.map((c) => [c.key, [HP]] as [string, SeriesKey[]]),
  ['show', []],
]);
const seriesOf = (c: CardItem) => keys.get(c.key);

describe('a franchise page split into series', () => {
  it('is one carousel per medium of the provider series, the show left for the grid', () => {
    const { series, rest } = splitSeries({ cards: [show, ...games, ...films, ...books], seriesOf, franchiseKey: 'harry potter', franchiseLabel: 'Harry Potter' });
    expect(series.map((s) => s.label)).toEqual(['Harry Potter books', 'Harry Potter films', 'Harry Potter games']);
    expect(series[0].items.map((c) => c.key)).toEqual(books.map((c) => c.key));
    expect(rest).toEqual([show]);
  });

  it('shows each series oldest first, whatever order the page is sorted in', () => {
    const { series } = splitSeries({ cards: [...books].reverse(), seriesOf, franchiseKey: 'harry potter', franchiseLabel: 'Harry Potter' });
    // One series and nothing else stays a grid.
    expect(series).toEqual([]);
    const both = splitSeries({ cards: [show, ...[...books].reverse()], seriesOf, franchiseKey: 'harry potter', franchiseLabel: 'Harry Potter' });
    expect(both.series[0].items.map((c) => c.releaseDate)).toEqual(books.map((c) => c.releaseDate));
  });

  it('names a bundled series by its own name, and leaves fewer than three in the grid', () => {
    const dk: SeriesKey = { key: 'the dark knight', label: 'The Dark Knight Collection' };
    const own = [card('bb', 'movie', '2005-06-15'), card('tdk', 'movie', '2008-07-18'), card('tdkr', 'movie', '2012-07-20')];
    const lego = [card('lego1', 'game', '2008-01-01'), card('lego2', 'game', '2012-01-01')];
    const map = new Map<string, SeriesKey[]>([...own.map((c) => [c.key, [dk]] as [string, SeriesKey[]]), ...lego.map((c) => [c.key, [{ key: 'batman', label: 'Batman' }]] as [string, SeriesKey[]])]);
    const { series, rest } = splitSeries({ cards: [...own, ...lego], seriesOf: (c) => map.get(c.key), franchiseKey: 'batman', franchiseLabel: 'Batman' });
    expect(series.map((s) => s.label)).toEqual(['The Dark Knight films']);
    expect(rest).toEqual(lego);
  });

  it('puts a title the device does not hold in the series its provider was asked for', () => {
    const extra = { ...card('film9', 'movie', '2011-07-15'), id: null };
    const { series } = splitSeries({ cards: [show, ...films, extra], seriesOf, franchiseKey: 'harry potter', franchiseLabel: 'Harry Potter' });
    expect(series[0].items.at(-1)).toBe(extra);
  });

  it('puts a title in two series in the bigger one', () => {
    const lego: SeriesKey = { key: 'lego harry potter', label: 'LEGO Harry Potter' };
    const both = card('lego', 'game', '2010-06-25');
    const map = new Map(keys);
    map.set('lego', [lego, HP]);
    const { series } = splitSeries({ cards: [show, ...games, both], seriesOf: (c) => map.get(c.key), franchiseKey: 'harry potter', franchiseLabel: 'Harry Potter' });
    expect(series).toHaveLength(1);
    expect(series[0].items).toContain(both);
  });
});

describe('a game read by its IGDB collection', () => {
  const hp = (series?: string[]) => ({ key: 'harry potter', label: 'Harry Potter', ...(series ? { series } : {}) });

  it('is in its collections when they are known, in none for [], and in the franchise when not known', () => {
    expect(seriesOfFacet(hp(['Harry Potter', 'Lego Harry Potter']))).toEqual([
      { key: 'harry potter', label: 'Harry Potter' }, { key: 'lego harry potter', label: 'Lego Harry Potter' },
    ]);
    expect(seriesOfFacet(hp([]))).toEqual([]);
    expect(seriesOfFacet(hp())).toEqual([{ key: 'harry potter', label: 'Harry Potter' }]);
  });

  it('splits the tie-ins from the LEGO games, and leaves Hogwarts Legacy for the grid', () => {
    const tieIns = Array.from({ length: 4 }, (_, i) => card(`tie${i}`, 'game', `${2001 + i}-11-15`));
    const lego = Array.from({ length: 3 }, (_, i) => card(`lego${i}`, 'game', `${2010 + i}-06-25`));
    const legacy = card('legacy', 'game', '2023-02-10');
    const map = new Map<string, SeriesKey[]>([
      ...tieIns.map((c) => [c.key, seriesOfFacet(hp(['Harry Potter']))] as [string, SeriesKey[]]),
      ...lego.map((c) => [c.key, seriesOfFacet(hp(['Lego Harry Potter']))] as [string, SeriesKey[]]),
      ['legacy', seriesOfFacet(hp([]))],
    ]);
    const { series, rest } = splitSeries({ cards: [legacy, ...lego, ...tieIns], seriesOf: (c) => map.get(c.key), franchiseKey: 'harry potter', franchiseLabel: 'Harry Potter' });
    expect(series.map((s) => s.label)).toEqual(['Harry Potter games', 'Lego Harry Potter games']);
    expect(rest).toEqual([legacy]);
  });
});
