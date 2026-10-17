import { describe, expect, it } from 'vitest';
import { recommend, type FeedCard } from '~/lib/homeFeed';
import { BAND_MARGIN } from '~/lib/scoreReasons';

const card = (key: string): FeedCard => ({
  key, id: null, type: 'movie', title: key, releaseDate: '2026-12-01', posterUrl: null, communityScore: null, genres: [],
});

describe('Recommended for you', () => {
  const scores: Record<string, number | null> = { strong: 75, stronger: 80, typical: 55, weak: 30, unscored: null };
  const cards = Object.keys(scores).map(card);
  const scoreOf = (c: FeedCard) => scores[c.key];

  it('carries only titles in the green band, best first', () => {
    // Your average is 50: strong from 60, weak under 40 (the badge's margin).
    expect(recommend(cards, scoreOf, () => false, 50).map((c) => c.key)).toEqual(['stronger', 'strong']);
    expect(recommend(cards, scoreOf, () => false, 60 + BAND_MARGIN).map((c) => c.key)).toEqual(['stronger']);
  });

  it('leaves out what you already hold or hid', () => {
    expect(recommend(cards, scoreOf, (c) => c.key === 'stronger', 50).map((c) => c.key)).toEqual(['strong']);
  });

  it('recommends nothing without a taste profile', () => {
    expect(recommend(cards, scoreOf, () => false, null)).toEqual([]);
  });
});
