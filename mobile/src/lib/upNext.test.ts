import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({}));
vi.mock('~/lib/storage', () => ({ secretGet: vi.fn(), secretSet: vi.fn(), secretDelete: vi.fn() }));
vi.mock('~/lib/widget', () => ({ publishWidget: vi.fn() }));

import { readProgress, showsToCheck } from './upNext';

const NOW = Date.parse('2026-10-04T12:00:00Z') / 1000;
const DAY = 86_400;

describe("reading Trakt's answer for a show", () => {
  it('takes the next episode and when the last one was watched', () => {
    expect(readProgress({
      last_watched_at: '2026-10-01T20:00:00.000Z',
      next_episode: { season: 2, number: 5, title: 'The Fifth', first_aired: '2026-09-30T01:00:00.000Z' },
    }, NOW)).toEqual({
      season: 2, episode: 5, title: 'The Fifth',
      airedAt: Date.parse('2026-09-30T01:00:00.000Z') / 1000,
      lastWatchedAt: Date.parse('2026-10-01T20:00:00.000Z') / 1000,
      upcomingAt: null,
    });
  });

  it('reads a show with nothing left as caught up', () => {
    expect(readProgress({ last_watched_at: '2026-10-01T20:00:00.000Z', next_episode: null }, NOW).season).toBeNull();
  });

  it('does not offer an episode that has not aired, or a special', () => {
    expect(readProgress({ next_episode: { season: 2, number: 6, first_aired: '2026-10-09T01:00:00.000Z' } }, NOW).season).toBeNull();
    expect(readProgress({ next_episode: { season: 0, number: 1, first_aired: '2020-01-01T00:00:00.000Z' } }, NOW).season).toBeNull();
    // An announced season nobody has scheduled: Trakt lists its first episode with no date.
    expect(readProgress({ next_episode: { season: 2, number: 1, title: 'Episode #2.1', first_aired: null } }, NOW).season).toBeNull();
    expect(readProgress({ next_episode: { season: 2, number: 1, title: 'Episode 1' } }, NOW).season).toBeNull();
  });

  it('remembers when a dated next episode airs, so the show is asked about again then', () => {
    const at = Date.parse('2026-10-09T01:00:00.000Z') / 1000;
    expect(readProgress({ next_episode: { season: 13, number: 3, first_aired: '2026-10-09T01:00:00.000Z' } }, NOW).upcomingAt).toBe(at);
    expect(readProgress({ next_episode: { season: 2, number: 1, first_aired: null } }, NOW).upcomingAt).toBeNull();
    expect(readProgress({ next_episode: null }, NOW).upcomingAt).toBeNull();
  });

  it('survives an answer that is not the expected shape', () => {
    expect(readProgress('nonsense', NOW)).toEqual({ season: null, episode: null, title: null, airedAt: null, lastWatchedAt: null, upcomingAt: null });
  });
});

describe('which shows to ask about', () => {
  const show = (id: string, daysAgo: number, watchedCount = 5) => ({ mediaItemId: id, watchedCount, lastWatchedAt: NOW - daysAgo * DAY });
  const row = (id: string, checkedDaysAgo: number, watched_count = 5) => ({ media_item_id: id, watched_count, checked_at: NOW - checkedDaysAgo * DAY });

  it('asks about a show it has never asked about, most recently watched first', () => {
    expect(showsToCheck([show('old', 300), show('new', 1)], [], NOW).map((s) => s.mediaItemId)).toEqual(['new', 'old']);
  });

  it('asks again when an episode was ticked since', () => {
    expect(showsToCheck([show('a', 1, 6)], [row('a', 0)], NOW).map((s) => s.mediaItemId)).toEqual(['a']);
  });

  it('asks a show you are watching every six hours, and a dormant one once a week', () => {
    expect(showsToCheck([show('active', 3)], [row('active', 0.2)], NOW)).toEqual([]);
    expect(showsToCheck([show('active', 3)], [row('active', 0.3)], NOW)).toHaveLength(1);
    expect(showsToCheck([show('dormant', 400)], [row('dormant', 3)], NOW)).toEqual([]);
    expect(showsToCheck([show('dormant', 400)], [row('dormant', 8)], NOW)).toHaveLength(1);
  });

  it('asks again as soon as the episode it was told about has aired', () => {
    // ZDF Magazin Royale, 2026-10-17: a weekly show, checked the day before its new episode.
    const stored = { ...row('weekly', 0.1), next_air_at: NOW - 60 };
    expect(showsToCheck([show('weekly', 3)], [stored], NOW)).toHaveLength(1);
    expect(showsToCheck([show('weekly', 3)], [{ ...stored, next_air_at: NOW + 3600 }], NOW)).toEqual([]);
    // Dormant too: a show you stopped watching still gets its new season on the day.
    expect(showsToCheck([show('dormant', 400)], [{ ...row('dormant', 1), next_air_at: NOW - 60 }], NOW)).toHaveLength(1);
  });

  it('stops at the budget', () => {
    const many = Array.from({ length: 30 }, (_, i) => show(`s${i}`, i));
    expect(showsToCheck(many, [], NOW, 12)).toHaveLength(12);
  });
});
