import { describe, expect, it, vi } from 'vitest';

// The titles a new account is asked to rate. Real SQL on node:sqlite.

vi.mock('~/lib/api', () => ({ api: {} }));

const { migrate } = await import('./db');
const { cursorAfter, interleave, ratedCount, ratingPicksPage } = await import('./ratingPicks');
const { openTestDb } = await import('./testSqlite');

const TODAY = '2026-11-07';

async function setup() {
  const { db, raw } = await openTestDb();
  await migrate(db);
  const add = (id: string, type: string, votes: number, opts: { date?: string | null; poster?: string | null; addon?: boolean } = {}) =>
    raw.prepare(`INSERT INTO catalog (id, type, title, norm_title, poster_url, release_date, world_date, community_votes, updated_at, vector, facets)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, '[]')`).run(
      id, type, id, id,
      opts.poster === undefined ? `https://img/${id}.jpg` : opts.poster,
      opts.date === undefined ? '2020-01-01' : opts.date, opts.date === undefined ? '2020-01-01' : opts.date,
      votes, opts.addon ? '{"addon":1}' : '{}');
  return { db, raw, add };
}

describe('ratingPicksPage', () => {
  it('reads one type, most votes first, and leaves out what cannot or need not be rated', async () => {
    const { db, raw, add } = await setup();
    add('alien', 'movie', 900);
    add('dune', 'movie', 800);
    add('heat', 'movie', 700);
    add('soon', 'movie', 5000, { date: '2027-03-01' });
    add('tba', 'movie', 4000, { date: null });
    add('blank', 'movie', 3000, { poster: null });
    add('rated', 'movie', 2000);
    add('hidden', 'movie', 1500);
    add('dlc', 'game', 9000, { addon: true });
    add('zelda', 'game', 100);
    raw.prepare("INSERT INTO item_state (media_item_id, source, relation, rating, added_at, updated_at) VALUES ('rated', 'local', 'library', 8, 0, 0)").run();
    raw.prepare("INSERT INTO hidden_item (media_item_id, hidden_at) VALUES ('hidden', 0)").run();

    expect((await ratingPicksPage(db, 'movie', null, 10, TODAY)).map((r) => r.id)).toEqual(['alien', 'dune', 'heat']);
    expect((await ratingPicksPage(db, 'game', null, 10, TODAY)).map((r) => r.id)).toEqual(['zelda']);
    expect(await ratedCount(db)).toBe(1);
  });

  it('pages by key, so rating a title on page one does not skip one on page two', async () => {
    const { db, raw, add } = await setup();
    add('a', 'movie', 50);
    add('b', 'movie', 40);
    add('c', 'movie', 30);
    add('d', 'movie', 30);
    const first = await ratingPicksPage(db, 'movie', null, 2, TODAY);
    expect(first.map((r) => r.id)).toEqual(['a', 'b']);
    raw.prepare("INSERT INTO item_state (media_item_id, source, relation, rating, added_at, updated_at) VALUES ('a', 'local', 'library', 7, 0, 0)").run();
    const second = await ratingPicksPage(db, 'movie', cursorAfter(first, null), 2, TODAY);
    expect(second.map((r) => r.id)).toEqual(['c', 'd']);
    expect(cursorAfter([], { votes: 1, id: 'x' })).toEqual({ votes: 1, id: 'x' });
  });
});

describe('interleave', () => {
  it('lets the types take turns, and a short one drops out', () => {
    expect(interleave([['m1', 'm2', 'm3'], ['g1'], ['s1', 's2']])).toEqual(['m1', 'g1', 's1', 'm2', 's2', 'm3']);
    expect(interleave([])).toEqual([]);
  });
});
