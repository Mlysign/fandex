import { describe, expect, it } from 'vitest';
import { balanceByType, RAIL_SIZE, recommend, tierOf, upcomingRail, type Candidate, type FeedCard, type Scored } from '~/lib/homeFeed';
import { BAND_MARGIN } from '~/lib/scoreReasons';

/** A score as `recommend` takes one: the number that ranks, with a plain label behind it. */
const scored = (n: number | null | undefined): Scored | null => (n == null ? null : { score: n, label: 'usual', taste: 'usual', pull: null });

const card = (key: string, id: string | null = null, type: Candidate['type'] = 'movie'): Candidate => ({
  key, id, type, title: key, releaseDate: '2026-12-01', posterUrl: null, communityScore: null, genres: [],
});

describe('an even share of each type', () => {
  const many = (type: string, n: number) => Array.from({ length: n }, (_, i) => ({ type, key: `${type}${i}` }));

  it('deals the types in turn, each from its own ranking', () => {
    const out = balanceByType([...many('game', 40), ...many('movie', 40), ...many('book', 40)], 15, 'test', '2026-10-18');
    expect(out).toHaveLength(15);
    const count = (t: string) => out.filter((c) => c.type === t).length;
    expect(count('game')).toBe(5);
    expect(count('movie')).toBe(5);
    expect(count('book')).toBe(5);
    expect(out.slice(0, 3).map((c) => c.type).sort()).toEqual(['book', 'game', 'movie']);
    // The best of each type leads its share.
    expect(out.filter((c) => c.type === 'book')[0].key).toBe('book0');
  });

  it('hands a short type’s unused slots to the others', () => {
    const out = balanceByType([...many('game', 40), ...many('book', 2)], 15, 'test', '2026-10-18');
    expect(out).toHaveLength(15);
    expect(out.filter((c) => c.type === 'book')).toHaveLength(2);
    expect(out.filter((c) => c.type === 'game')).toHaveLength(13);
  });

  it('is the plain rotation when one type is all there is', () => {
    const out = balanceByType(many('game', 40), 15, 'test', '2026-10-18');
    expect(out).toHaveLength(15);
    expect(out.slice(0, 3).map((c) => c.key)).toEqual(['game0', 'game1', 'game2']);
  });

  it('keeps Recommended to the types on screen before sharing', () => {
    const cards = [...Array.from({ length: 20 }, (_, i) => card(`g${i}`, null, 'game')), ...Array.from({ length: 20 }, (_, i) => card(`b${i}`, null, 'book'))];
    const out = recommend([cards], () => scored(90), () => false, 50, ['book']);
    expect(out).toHaveLength(RAIL_SIZE);
    expect(out.every((c) => c.type === 'book')).toBe(true);
  });

  it('builds Upcoming for the types on screen, soonest first', () => {
    const feed = (key: string, type: FeedCard['type'], date: string): FeedCard => ({ ...card(key, null, type), releaseDate: date, genres: [] });
    const out = upcomingRail([feed('g', 'game', '2026-12-05'), feed('m', 'movie', '2026-11-01'), feed('b', 'book', '2026-11-20')], ['movie', 'book']);
    expect(out.map((c) => c.key)).toEqual(['m', 'b']);
  });
});

describe('Recommended for you', () => {
  const scores: Record<string, number | null> = { strong: 75, stronger: 80, typical: 55, weak: 30, unscored: null };
  const cards = Object.keys(scores).map((k) => card(k));
  const scoreOf = (c: Candidate) => scored(scores[c.key]);

  it('carries only titles in the green band, best first', () => {
    // Your average is 50: strong from 60, weak under 40 (the badge's margin).
    expect(recommend([cards], scoreOf, () => false, 50).map((c) => c.key)).toEqual(['stronger', 'strong']);
    expect(recommend([cards], scoreOf, () => false, 60 + BAND_MARGIN).map((c) => c.key)).toEqual(['stronger']);
  });

  it('leaves out what you already hold or hid', () => {
    expect(recommend([cards], scoreOf, (c) => c.key === 'stronger', 50).map((c) => c.key)).toEqual(['strong']);
  });

  it('recommends nothing without a taste profile', () => {
    expect(recommend([cards], scoreOf, () => false, null)).toEqual([]);
  });

  it('fills from the first tier before a better score in the next, and counts a title once', () => {
    const upcoming = [card('soon', 'a'), card('later', 'b')];
    const older = [card('classic', 'c'), card('soon again', 'a')];
    const by: Record<string, number> = { soon: 70, later: 65, classic: 95, 'soon again': 99 };
    expect(recommend([upcoming, older], (c) => scored(by[c.key]), () => false, 50).map((c) => c.key)).toEqual(['soon', 'later', 'classic']);
  });

  it('puts a title in its tier by date: to come, the last year, the rest', () => {
    expect(tierOf('2026-12-01', '2026-10-17')).toBe(0);
    expect(tierOf('2026-01-10', '2026-10-17')).toBe(1);
    expect(tierOf('2025-10-17', '2026-10-17')).toBe(1);
    expect(tierOf('2025-10-16', '2026-10-17')).toBe(2);
    expect(tierOf('2024', '2026-10-17')).toBe(2);
    expect(tierOf(null, '2026-10-17')).toBe(2);
  });
});

describe('wishlisted titles in Recommended (2026-10-23)', () => {
  it('lets at most two through, the strongest ones', () => {
    const cards = ['w1', 'w2', 'w3', 'a', 'b'].map((key) => ({ key, id: key, type: 'movie' as const, releaseDate: null }));
    const score: Record<string, number> = { w1: 99, w2: 98, w3: 97, a: 90, b: 89 };
    const out = recommend([cards as never[]], (c: { key: string }) => scored(score[c.key]), () => false, 50, undefined, (c: { key: string }) => c.key.startsWith('w'));
    expect(out.map((c: { key: string }) => c.key)).toEqual(['w1', 'w2', 'a', 'b']);
  });
});
