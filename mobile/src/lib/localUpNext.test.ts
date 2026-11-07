import { describe, expect, it, vi } from 'vitest';

vi.mock('~/lib/api', () => ({ api: {} }));
vi.mock('~/lib/stateSync', () => ({ applyLocalWrite: vi.fn() }));
vi.mock('~/lib/widget', () => ({ publishWidget: vi.fn() }));
vi.mock('~/lib/trakt', () => ({ TraktBusyError: class extends Error {} }));

import { readShowStatus, type ShowStatus } from './tmdb';
import { nextLocalEpisode } from './upNext';

// Up next without Trakt (2026-11-07): the next episode is the one after the
// latest you watched, if it is out.

const status = (over: Partial<ShowStatus> = {}): ShowStatus => ({
  seasons: [{ season: 1, episodeCount: 8 }, { season: 2, episodeCount: 8 }, { season: 3, episodeCount: 8 }],
  lastAired: { season: 2, episode: 8, airDate: '2024-10-03' },
  nextToAir: { season: 3, episode: 1, airDate: '2026-11-10' },
  ...over,
});
const eps = (season: number, upTo: number) => Array.from({ length: upTo }, (_, i) => ({ season, episode: i + 1 }));
const at = (date: string) => Date.parse(`${date}T00:00:00Z`) / 1000;

describe('the next episode without Trakt', () => {
  it('is the episode after the latest one watched', () => {
    expect(nextLocalEpisode([...eps(1, 8), ...eps(2, 3)], status()).next).toEqual({ season: 2, episode: 4 });
  });

  it('moves to the next season after a season finale', () => {
    expect(nextLocalEpisode(eps(1, 8), status()).next).toEqual({ season: 2, episode: 1 });
  });

  it('is nothing when you are up to the last episode out, with the day the next one is due', () => {
    expect(nextLocalEpisode([...eps(1, 8), ...eps(2, 8)], status())).toEqual({ next: null, upcomingAt: at('2026-11-10') });
  });

  it('does not hold a show back for an episode skipped early on', () => {
    const watched = [...eps(1, 8).filter((e) => e.episode !== 3), ...eps(2, 8)];
    expect(nextLocalEpisode(watched, status()).next).toBeNull();
  });

  it('ignores specials', () => {
    expect(nextLocalEpisode([...eps(1, 2), { season: 0, episode: 5 }], status()).next).toEqual({ season: 1, episode: 3 });
  });

  it('is nothing when TMDB says nothing has aired', () => {
    expect(nextLocalEpisode(eps(1, 1), status({ lastAired: null, nextToAir: null }))).toEqual({ next: null, upcomingAt: null });
  });

  it('skips a later season TMDB lists with no episodes yet', () => {
    const s = status({ seasons: [{ season: 1, episodeCount: 8 }, { season: 2, episodeCount: 0 }, { season: 3, episodeCount: 6 }], lastAired: { season: 3, episode: 2, airDate: '2026-11-01' } });
    expect(nextLocalEpisode(eps(1, 8), s).next).toEqual({ season: 3, episode: 1 });
  });
});

describe("TMDB's /tv/{id}, read", () => {
  it('keeps the numbered seasons and the last and next episodes', () => {
    expect(readShowStatus({
      seasons: [{ season_number: 0, episode_count: 3 }, { season_number: 2, episode_count: 8 }, { season_number: 1, episode_count: 8 }],
      last_episode_to_air: { season_number: 2, episode_number: 8, air_date: '2024-10-03' },
      next_episode_to_air: { season_number: 3, episode_number: 1, air_date: '2026-11-10' },
    })).toEqual({
      seasons: [{ season: 1, episodeCount: 8 }, { season: 2, episodeCount: 8 }],
      lastAired: { season: 2, episode: 8, airDate: '2024-10-03' },
      nextToAir: { season: 3, episode: 1, airDate: '2026-11-10' },
    });
  });

  it('reads a payload with nothing in it as a show with nothing out', () => {
    expect(readShowStatus(null)).toEqual({ seasons: [], lastAired: null, nextToAir: null });
    expect(readShowStatus({ next_episode_to_air: null, last_episode_to_air: { season_number: 0, episode_number: 1 } }).lastAired).toBeNull();
  });
});
