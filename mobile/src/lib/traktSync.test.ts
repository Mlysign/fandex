import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({}));
vi.mock('~/lib/storage', () => ({ secretGet: vi.fn(), secretSet: vi.fn(), secretDelete: vi.fn() }));

import {
  foldTraktPull, planTraktSync, TraktSyncRefused,
  type LocalEpisodeRow, type LocalItemRow, type RawTraktPull, type TraktPull,
} from './traktSync';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';

const empty: RawTraktPull = {
  watchedMovies: [], watchedShows: [], ratedMovies: [], ratedShows: [], watchlistMovies: [], watchlistShows: [], episodeHistory: [],
};
const movie = (trakt: number, tmdb: number | null = trakt + 1000) => ({ movie: { ids: { trakt, tmdb } } });
const show = (trakt: number, tmdb: number | null = trakt + 1000) => ({ show: { ids: { trakt, tmdb } } });
const play = (showId: number, season: number, number: number, at: string) => ({
  watched_at: at, show: { ids: { trakt: showId } }, episode: { season, number },
});

describe('reading what Trakt answered', () => {
  it('makes the library from what was watched, and decorates it with ratings', () => {
    const pull = foldTraktPull({
      ...empty,
      watchedMovies: [{ ...movie(1), last_watched_at: '2026-01-02T00:00:00.000Z' }, { ...movie(2), last_watched_at: '2026-01-03T00:00:00.000Z' }],
      ratedMovies: [{ ...movie(1), rating: 8, rated_at: '2026-02-01T00:00:00.000Z' }, { ...movie(9), rating: 3, rated_at: '2026-02-01T00:00:00.000Z' }],
    });
    expect(pull.library).toEqual([
      { type: 'movie', traktId: 1, tmdbId: 1001, rating: 8, reviewedAt: Date.parse('2026-02-01T00:00:00.000Z') / 1000 },
      { type: 'movie', traktId: 2, tmdbId: 1002, rating: null, reviewedAt: Date.parse('2026-01-03T00:00:00.000Z') / 1000 },
    ]);
    // Rated and never watched is not in the library, as on the site.
    expect(pull.library.some((t) => t.traktId === 9)).toBe(false);
  });

  it('folds the play log to one row per episode, the latest play, and drops specials', () => {
    const pull = foldTraktPull({
      ...empty,
      episodeHistory: [
        play(5, 1, 1, '2025-01-01T00:00:00.000Z'),
        play(5, 1, 1, '2026-01-01T00:00:00.000Z'),
        play(5, 0, 1, '2026-01-01T00:00:00.000Z'),
        play(5, 1, 2, '2025-06-01T00:00:00.000Z'),
      ],
    });
    expect(pull.episodesByShow.get(5)).toEqual([
      { season: 1, episode: 1, watchedAt: Date.parse('2026-01-01T00:00:00.000Z') / 1000 },
      { season: 1, episode: 2, watchedAt: Date.parse('2025-06-01T00:00:00.000Z') / 1000 },
    ]);
  });

  it('skips an entry with no Trakt id instead of guessing', () => {
    const pull = foldTraktPull({ ...empty, watchedMovies: [{ movie: { ids: {} } }, { nonsense: true }, null], watchlistShows: [show(3)] });
    expect(pull.library).toEqual([]);
    expect(pull.wishlist).toEqual([{ type: 'show', traktId: 3, tmdbId: 1003 }]);
  });
});

const lib = (traktId: number, type: 'movie' | 'show' = 'movie', rating: number | null = 8, reviewedAt: number | null = 100) =>
  ({ type, traktId, tmdbId: null, rating, reviewedAt });
const localItem = (mediaItemId: string, over: Partial<LocalItemRow> = {}): LocalItemRow =>
  ({ mediaItemId, relation: 'library', status: 'watched', rating: 8, review: null, reviewedAt: 100, ...over });
const localEp = (mediaItemId: string, season: number, episode: number, over: Partial<LocalEpisodeRow> = {}): LocalEpisodeRow =>
  ({ mediaItemId, season, episode, watchedAt: 50, sources: ['trakt'], ...over });
const pullOf = (over: Partial<TraktPull>): TraktPull => ({ library: [], wishlist: [], episodesByShow: new Map(), ...over });

describe('working out what to send', () => {
  it('sends nothing when the account already matches Trakt', () => {
    const plan = planTraktSync({
      pull: pullOf({ library: [lib(1), lib(2, 'show')], episodesByShow: new Map([[2, [{ season: 1, episode: 1, watchedAt: 50 }]]]) }),
      ids: new Map([['movie:1', A], ['show:2', B]]),
      deferred: 0,
      localItems: [localItem(A), localItem(B)],
      localEpisodes: [localEp(B, 1, 1)],
    });
    expect(plan).toEqual({ itemUpserts: [], itemDeletes: [], episodeUpserts: [], episodeDeletes: [], unmatched: 0 });
  });

  it('upserts a new title and a changed rating, and keeps a review the row already holds', () => {
    const plan = planTraktSync({
      pull: pullOf({ library: [lib(1, 'movie', 9), lib(2)], wishlist: [{ type: 'movie', traktId: 3, tmdbId: null }] }),
      ids: new Map([['movie:1', A], ['movie:2', B], ['movie:3', C]]),
      deferred: 0,
      localItems: [localItem(A, { review: 'Loved it' })],
      localEpisodes: [],
    });
    expect(plan.itemUpserts).toEqual([
      { mediaItemId: A, source: 'trakt', relation: 'library', status: 'watched', rating: 9, reviewedAt: 100, review: 'Loved it' },
      { mediaItemId: B, source: 'trakt', relation: 'library', status: 'watched', rating: 8, reviewedAt: 100, review: null },
      { mediaItemId: C, source: 'trakt', relation: 'wishlist', status: null, rating: null, reviewedAt: null, review: null },
    ]);
    expect(plan.itemDeletes).toEqual([]);
  });

  it('deletes a row Trakt no longer lists', () => {
    const many = Array.from({ length: 30 }, (_, i) => `00000000-0000-4000-8000-0000000001${String(i).padStart(2, '0')}`);
    const plan = planTraktSync({
      pull: pullOf({ library: many.map((_, i) => lib(100 + i)) }),
      ids: new Map(many.map((id, i) => [`movie:${100 + i}`, id])),
      deferred: 0,
      localItems: [...many.map((id) => localItem(id)), localItem(A, { relation: 'wishlist', status: null, rating: null, reviewedAt: null })],
      localEpisodes: [],
    });
    expect(plan.itemDeletes).toEqual([{ mediaItemId: A, source: 'trakt', relation: 'wishlist' }]);
  });

  it('deletes nothing while any title is still waiting to be matched', () => {
    const plan = planTraktSync({
      pull: pullOf({ library: [lib(1)] }),
      ids: new Map([['movie:1', A]]),
      deferred: 1,
      localItems: [localItem(A), localItem(B)],
      localEpisodes: [localEp(B, 1, 1)],
    });
    expect(plan.itemDeletes).toEqual([]);
    expect(plan.episodeDeletes).toEqual([]);
  });

  it('refuses a run that would delete most of the library, which is what a short pull looks like', () => {
    const held = Array.from({ length: 200 }, (_, i) => localItem(`00000000-0000-4000-8000-0000000002${String(i).padStart(2, '0')}`));
    expect(() => planTraktSync({ pull: pullOf({}), ids: new Map(), deferred: 0, localItems: held, localEpisodes: [] }))
      .toThrow(TraktSyncRefused);
  });

  it('refuses a run that would delete most of the episodes', () => {
    const eps = Array.from({ length: 2000 }, (_, i) => localEp(A, 1, i + 1));
    expect(() => planTraktSync({
      pull: pullOf({ library: [lib(1, 'show')] }), ids: new Map([['show:1', A]]), deferred: 0,
      localItems: [localItem(A)], localEpisodes: eps,
    })).toThrow(TraktSyncRefused);
  });

  it('adds new episodes, removes un-watched ones, and leaves an episode ticked in Fandex alone', () => {
    const plan = planTraktSync({
      pull: pullOf({ library: [lib(1, 'show')], episodesByShow: new Map([[1, [{ season: 1, episode: 1, watchedAt: 50 }, { season: 1, episode: 3, watchedAt: 70 }]]]) }),
      ids: new Map([['show:1', A]]),
      deferred: 0,
      localItems: [localItem(A)],
      localEpisodes: [localEp(A, 1, 1), localEp(A, 1, 2), localEp(A, 2, 1, { sources: ['local'] }), localEp(A, 2, 2, { sources: ['local', 'trakt'] })],
    });
    expect(plan.episodeUpserts).toEqual([{ mediaItemId: A, season: 1, episode: 3, watchedAt: 70, sources: ['trakt'] }]);
    expect(plan.episodeDeletes).toEqual([{ mediaItemId: A, season: 1, episode: 2 }]);
  });

  it('counts a Trakt entry with no catalog title, and writes nothing for it', () => {
    const plan = planTraktSync({ pull: pullOf({ library: [lib(1), lib(2)] }), ids: new Map([['movie:1', A]]), deferred: 0, localItems: [localItem(A)], localEpisodes: [] });
    expect(plan.unmatched).toBe(1);
    expect(plan.itemUpserts).toEqual([]);
  });

  it('never touches a relation it does not manage', () => {
    const plan = planTraktSync({
      pull: pullOf({ library: [lib(1)] }), ids: new Map([['movie:1', A]]), deferred: 0,
      localItems: [localItem(A), localItem(B, { relation: 'ignored' })], localEpisodes: [],
    });
    expect(plan.itemDeletes).toEqual([]);
  });
});
