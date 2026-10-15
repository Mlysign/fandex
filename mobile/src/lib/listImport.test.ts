import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({}));
vi.mock('~/lib/storage', () => ({ secretGet: vi.fn(), secretSet: vi.fn(), secretDelete: vi.fn() }));

import { strToU8, zipSync } from 'fflate';
import { ImportParseError, planImportWrites, readImportFiles, type ImportRowToWrite } from './listImport';

const RATINGS = 'Date,Name,Year,Letterboxd URI,Rating\n2024-01-02,Alien,1979,https://boxd.it/a,4.5\n2024-01-03,Heat,1995,https://boxd.it/b,4\n';
const WATCHLIST = 'Date,Name,Year,Letterboxd URI\n2024-02-01,Dune: Part Three,2026,https://boxd.it/c\n';

describe('reading an export on the device', () => {
  it('opens the Letterboxd ZIP as downloaded and reads only ratings and the watchlist', () => {
    const zip = zipSync({
      'ratings.csv': strToU8(RATINGS),
      'watchlist.csv': strToU8(WATCHLIST),
      'reviews.csv': strToU8('Date,Name,Year,Review\n2024-01-02,Alien,1979,Great\n'),
    });
    const parsed = readImportFiles([{ name: 'letterboxd-export.zip', bytes: zip }]);
    expect(parsed.source).toBe('letterboxd');
    expect(parsed.filesRead.sort()).toEqual(['ratings.csv', 'watchlist.csv']);
    // Half stars double exactly: 4.5 is a 9, never "about 9".
    expect(parsed.rows.map((r) => [r.title, r.relation, r.rating])).toEqual([
      ['Alien', 'library', 9], ['Heat', 'library', 8], ['Dune: Part Three', 'wishlist', null],
    ]);
  });

  it('reads a loose CSV too', () => {
    const parsed = readImportFiles([{ name: 'ratings.csv', bytes: strToU8(RATINGS) }]);
    expect(parsed.rows).toHaveLength(2);
  });

  it('says what it saw when nothing in the file is a rating or a watchlist', () => {
    expect(() => readImportFiles([{ name: 'ratings.csv', bytes: strToU8('Foo,Bar\n1,2\n') }])).toThrow(ImportParseError);
  });

  it('refuses a ZIP it cannot open, in words', () => {
    const broken = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
    expect(() => readImportFiles([{ name: 'x.zip', bytes: broken }])).toThrow(/could not be opened/);
  });
});

describe('what an import writes', () => {
  const row = (mediaItemId: string, over: Partial<ImportRowToWrite> = {}): ImportRowToWrite =>
    ({ mediaItemId, type: 'movie', relation: 'library', rating: 8, ratedAt: 100, ...over });

  it('adds and never overwrites: a title already rated keeps its rating', () => {
    const plan = planImportWrites({
      rows: [row('a', { rating: 10 }), row('b')],
      held: [{ mediaItemId: 'a', source: 'trakt', relation: 'library', rating: 6 }],
      traktOn: true, now: 500,
    });
    expect(plan.keptRated).toBe(1);
    expect(plan.upsert.map((u) => u.mediaItemId)).toEqual(['b']);
    expect(plan.trakt.ratings.map((r) => r.mediaItemId)).toEqual(['b']);
  });

  it('takes a rated title off the wishlist, on Trakt too', () => {
    const plan = planImportWrites({
      rows: [row('a')],
      held: [{ mediaItemId: 'a', source: 'trakt', relation: 'wishlist', rating: null }],
      traktOn: true, now: 500,
    });
    expect(plan.del).toEqual([{ mediaItemId: 'a', source: 'trakt', relation: 'wishlist' }]);
    expect(plan.trakt.watchlistRemove.map((r) => r.mediaItemId)).toEqual(['a']);
    expect(plan.upsert[0]).toMatchObject({ source: 'trakt', relation: 'library', status: 'watched', rating: 8, reviewedAt: 100 });
  });

  it('skips a wishlist row for a title rated in the same file or already listed', () => {
    const plan = planImportWrites({
      rows: [row('a', { relation: 'wishlist', rating: null }), row('a'), row('b', { relation: 'wishlist', rating: null })],
      held: [{ mediaItemId: 'b', source: 'local', relation: 'library', rating: null }],
      traktOn: false, now: 500,
    });
    expect(plan.upsert.map((u) => [u.mediaItemId, u.relation, u.source])).toEqual([['a', 'library', 'local']]);
    expect(plan.alreadyListed).toBe(1);
  });

  it('keeps a show rated on Trakt as Fandex\'s own row, and never posts a show to Trakt\'s history', () => {
    const plan = planImportWrites({ rows: [row('s', { type: 'show' })], held: [], traktOn: true, now: 500 });
    expect(plan.upsert[0].source).toBe('local');
    expect(plan.trakt.ratings.map((r) => r.mediaItemId)).toEqual(['s']);
    expect(plan.trakt.history).toEqual([]);
  });

  it('posts a film to Trakt\'s history only when Trakt does not hold it as watched', () => {
    const plan = planImportWrites({
      rows: [row('a'), row('b')],
      held: [{ mediaItemId: 'b', source: 'trakt', relation: 'library', rating: null }],
      traktOn: true, now: 500,
    });
    expect(plan.trakt.history.map((r) => r.mediaItemId)).toEqual(['a']);
  });

  it('writes nothing for Trakt when this device is not signed in to it', () => {
    const plan = planImportWrites({ rows: [row('a'), row('w', { relation: 'wishlist', rating: null })], held: [], traktOn: false, now: 500 });
    expect(plan.upsert.every((u) => u.source === 'local')).toBe(true);
    expect(Object.values(plan.trakt).every((l) => l.length === 0)).toBe(true);
  });
});
