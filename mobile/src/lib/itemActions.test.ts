import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({}));
vi.mock('~/lib/storage', () => ({ secretGet: vi.fn(), secretSet: vi.fn(), secretDelete: vi.fn() }));

import { ratingWrite, traktIds, type ActionTarget, type HeldRow } from './itemActions';

const ID = '00000000-0000-4000-8000-00000000000a';
const film: ActionTarget = { id: ID, type: 'movie', sources: [{ source: 'tmdb', sourceId: '603' }, { source: 'trakt', sourceId: '481' }] };
const game: ActionTarget = { id: ID, type: 'game', sources: [{ source: 'igdb', sourceId: '1942' }] };
const held = (source: string, over: Partial<HeldRow> = {}): HeldRow =>
  ({ source, relation: 'library', status: 'watched', rating: 7, review: null, ...over });

describe('finding a title on Trakt', () => {
  it("uses Trakt's own id when the catalog holds one, else TMDB's", () => {
    expect(traktIds(film)).toEqual({ trakt: 481 });
    expect(traktIds({ ...film, sources: [{ source: 'tmdb', sourceId: '603' }] })).toEqual({ tmdb: 603 });
  });
  it('gives up on a title with neither', () => {
    expect(traktIds(game)).toBeNull();
  });
});

describe('the rows a rating writes', () => {
  it('puts a first rating in its home row, as watched', () => {
    expect(ratingWrite({ target: film, rows: [], rating: 8, home: 'trakt', now: 500 })).toEqual({
      items: { upsert: [{ mediaItemId: ID, source: 'trakt', relation: 'library', status: 'watched', rating: 8, review: null, reviewedAt: 500 }] },
    });
  });

  it('rates a game in Fandex alone, as played', () => {
    const w = ratingWrite({ target: game, rows: [], rating: 9, home: 'local', now: 500 });
    expect(w.items?.upsert).toEqual([{ mediaItemId: ID, source: 'local', relation: 'library', status: 'played', rating: 9, review: null, reviewedAt: 500 }]);
  });

  it('writes the new rating to every row that carries one, so the average is the new rating', () => {
    const w = ratingWrite({ target: film, rows: [held('trakt'), held('tmdb', { rating: 6, review: 'Fine' })], rating: 9, home: 'trakt', now: 500 });
    expect(w.items?.upsert?.map((r) => [r.source, r.rating, r.review])).toEqual([['trakt', 9, null], ['tmdb', 9, 'Fine']]);
  });

  it("leaves Steam's row alone, and an owned game that is rated has been played", () => {
    const w = ratingWrite({ target: game, rows: [held('steam', { status: 'owned', rating: null })], rating: 7, home: 'local', now: 500 });
    expect(w.items?.upsert?.map((r) => [r.source, r.status])).toEqual([['local', 'played']]);
  });

  it('takes the title off the wishlist, except where Steam holds it', () => {
    const w = ratingWrite({
      target: game, rating: 7, home: 'local', now: 500,
      rows: [held('local', { relation: 'wishlist', status: null, rating: null }), held('steam', { relation: 'wishlist', status: null, rating: null })],
    });
    expect(w.items?.delete).toEqual([{ mediaItemId: ID, source: 'local', relation: 'wishlist' }]);
  });

  it('clears the score on every row and keeps the title in the library', () => {
    const w = ratingWrite({ target: film, rows: [held('trakt'), held('tmdb', { rating: 6 })], rating: null, home: 'trakt', now: 500 });
    expect(w.items?.upsert?.map((r) => [r.source, r.rating, r.status])).toEqual([['trakt', null, 'watched'], ['tmdb', null, 'watched']]);
    expect(w.items?.delete).toBeUndefined();
  });

  it('writes nothing when there is no rating to clear', () => {
    expect(ratingWrite({ target: film, rows: [held('trakt', { rating: null })], rating: null, home: 'trakt', now: 500 })).toEqual({});
  });
});
