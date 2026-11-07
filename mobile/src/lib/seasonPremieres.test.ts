import { describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/api', () => ({ api: {} }));

import type { SeasonPremiere } from '~/lib/api';
import { forgetSeasonPremieres, premiereRecheckAt, premieresYouWaitFor, seasonPremieres } from './seasonPremieres';

const premiere = (id: string, season: number, airDate = '2026-11-10'): SeasonPremiere =>
  ({ id, season, name: `Season ${season}`, episodeCount: 8, airDate, posterUrl: null });

describe('which new seasons are on your calendar', () => {
  const rings = premiere('rings', 3);
  const abandoned = premiere('abandoned', 2);
  const untouched = premiere('untouched', 2);

  it('shows a season when every episode before it is watched, and not one you left halfway', () => {
    const progress = new Map<string, number | null>([
      // Seasons 1 and 2 seen, season 3 not out yet: Up next has nothing to offer.
      ['rings', null],
      // Halfway through season 1: Up next offers a season 1 episode.
      ['abandoned', 1],
    ]);
    expect(premieresYouWaitFor([rings, abandoned, untouched], progress)).toEqual([rings]);
  });

  it('keeps the premiere once it is out and its first episode is what Up next offers', () => {
    expect(premieresYouWaitFor([rings], new Map([['rings', 3]]))).toEqual([rings]);
  });

  it('drops it when an episode from an earlier season is still unwatched', () => {
    expect(premieresYouWaitFor([rings], new Map([['rings', 2]]))).toEqual([]);
  });

  it('leaves out a show you never started, which has no Up next row', () => {
    expect(premieresYouWaitFor([untouched], new Map())).toEqual([]);
  });
});

describe('asking Up next again when a season starts', () => {
  const day = Date.parse('2026-11-10T00:00:00Z') / 1000;

  it('asks on the premiere day when the last check was before it', () => {
    expect(premiereRecheckAt(day - 5 * 86_400, ['2026-11-10'])).toBe(day);
  });

  it('asks once more a day later, then stops', () => {
    expect(premiereRecheckAt(day + 3600, ['2026-11-10'])).toBe(day + 86_400);
    expect(premiereRecheckAt(day + 86_400 + 60, ['2026-11-10'])).toBeNull();
  });

  it('takes the nearest of several premieres and skips a date it cannot read', () => {
    expect(premiereRecheckAt(day - 86_400, ['2026-11-20', 'soon', '2026-11-10'])).toBe(day);
  });
});

describe('the Worker call', () => {
  it('asks once per month and forgets a failed answer', async () => {
    forgetSeasonPremieres();
    const ask = vi.fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ seasons: [premiere('rings', 3)] });
    await expect(seasonPremieres('2026-11', ask)).rejects.toThrow('offline');
    expect(await seasonPremieres('2026-11', ask)).toHaveLength(1);
    expect(await seasonPremieres('2026-11', ask)).toHaveLength(1);
    expect(ask).toHaveBeenCalledTimes(2);
  });
});
