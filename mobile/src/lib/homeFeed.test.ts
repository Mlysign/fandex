import { describe, expect, it } from 'vitest';
import { recommend, tierOf, type Candidate } from '~/lib/homeFeed';
import { BAND_MARGIN } from '~/lib/scoreReasons';

const card = (key: string, id: string | null = null): Candidate => ({
  key, id, type: 'movie', title: key, releaseDate: '2026-12-01', posterUrl: null, communityScore: null, genres: [],
});

describe('Recommended for you', () => {
  const scores: Record<string, number | null> = { strong: 75, stronger: 80, typical: 55, weak: 30, unscored: null };
  const cards = Object.keys(scores).map((k) => card(k));
  const scoreOf = (c: Candidate) => scores[c.key];

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
    expect(recommend([upcoming, older], (c) => by[c.key], () => false, 50).map((c) => c.key)).toEqual(['soon', 'later', 'classic']);
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
