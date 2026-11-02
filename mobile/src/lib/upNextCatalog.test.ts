import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A show the catalog copy does not hold yet must not be stored as caught up.
// A catalog start-over refills the copy page by page, and Up next ran on every
// page: after the 2026-10-16 fold every device stored most of its shows as
// caught up without asking Trakt, and kept that answer for a day to a week.
// Real SQL, because the fix is in the query.

const trakt = vi.hoisted(() => ({ traktGet: vi.fn(), traktPost: vi.fn(), writeState: vi.fn(), applyLocalWrite: vi.fn() }));
vi.mock('~/lib/trakt', () => ({
  TraktBusyError: class extends Error {},
  loadTraktTokens: async () => null,
  traktAccessToken: async () => 'token',
  traktGet: trakt.traktGet,
  traktPost: trakt.traktPost,
  traktMissed: (answer: { not_found?: Record<string, unknown[]> } | null) =>
    Object.values(answer?.not_found ?? {}).some((v) => v.length > 0),
}));
vi.mock('~/lib/api', () => ({ api: { writeState: trakt.writeState } }));
vi.mock('~/lib/stateSync', () => ({ applyLocalWrite: trakt.applyLocalWrite }));
vi.mock('~/lib/widget', () => ({ publishWidget: vi.fn() }));

// Node's own SQLite. The app has no Node types (it runs on a phone), so the
// module is named through a variable and typed by hand, as much as is used here.
interface Statement { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown }
interface DatabaseSync { exec(sql: string): void; prepare(sql: string): Statement }
const NODE_SQLITE = 'node:sqlite';
const { DatabaseSync } = (await import(/* @vite-ignore */ NODE_SQLITE)) as { DatabaseSync: new (path: string) => DatabaseSync };

const { migrate, SCHEMA_VERSION } = await import('./db');
const { refreshUpNext, setEpisodesWatched, upNextList, upNextPending } = await import('./upNext');

/** expo-sqlite's async surface over node:sqlite, as much of it as these modules use. */
function open(): { db: SQLiteDatabase; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const db = {
    async execAsync(sql: string) { raw.exec(sql); },
    async runAsync(sql: string, params: unknown[] = []) { raw.prepare(sql).run(...params); },
    async getAllAsync(sql: string, params: unknown[] = []) { return raw.prepare(sql).all(...params); },
    async getFirstAsync(sql: string, params: unknown[] = []) { return raw.prepare(sql).get(...params) ?? null; },
  } as unknown as SQLiteDatabase;
  return { db, raw };
}

const NOW = Math.floor(Date.now() / 1000);

function addShow(raw: DatabaseSync, id: string, traktId: number | null, tmdbId: number | null = null) {
  const sources = [
    ...(traktId == null ? [] : [{ source: 'trakt', sourceId: String(traktId) }]),
    ...(tmdbId == null ? [] : [{ source: 'tmdb', sourceId: String(tmdbId) }]),
  ];
  raw.prepare(`INSERT INTO catalog (id, type, title, norm_title, updated_at, vector, facets)
               VALUES (?, 'show', ?, ?, 0, ?, '{}')`).run(id, id, id, JSON.stringify({ sources }));
}

function watch(raw: DatabaseSync, id: string, episodes: number) {
  for (let e = 1; e <= episodes; e++) {
    raw.prepare(`INSERT INTO episode_state (media_item_id, season, episode, watched_at, sources) VALUES (?, 1, ?, ?, '[]')`)
      .run(id, e, NOW - 3600);
  }
}

const nextEpisode = (n: number) => ({
  last_watched_at: new Date((NOW - 3600) * 1000).toISOString(),
  next_episode: { season: 1, number: n, title: `Episode ${n}`, first_aired: '2024-07-10T00:00:00.000Z' },
});

describe('Up next while the catalog copy is still filling', () => {
  beforeEach(() => trakt.traktGet.mockReset());

  it('leaves a show the copy does not hold yet unasked, then asks once it lands', async () => {
    const { db, raw } = open();
    await migrate(db);
    addShow(raw, 'sunny', 193230);
    watch(raw, 'sunny', 6);
    watch(raw, 'lucky', 2); // its catalog page has not landed
    trakt.traktGet.mockImplementation(async (url: unknown) => nextEpisode(String(url).includes('193230') ? 7 : 3));

    expect(await upNextPending(db)).toBe(1);
    await refreshUpNext(db);
    expect(trakt.traktGet).toHaveBeenCalledTimes(1);
    expect(raw.prepare('SELECT media_item_id FROM up_next').all()).toEqual([{ media_item_id: 'sunny' }]);

    addShow(raw, 'lucky', 265812);
    expect(await upNextPending(db)).toBe(1);
    await refreshUpNext(db);
    expect((await upNextList(db)).map((e) => `${e.mediaItemId} ${e.episode}`).sort()).toEqual(['lucky 3', 'sunny 7']);
  });

  it('still stores a show with no Trakt link as caught up, so it is not asked every run', async () => {
    const { db, raw } = open();
    await migrate(db);
    addShow(raw, 'local-only', null);
    watch(raw, 'local-only', 1);
    await refreshUpNext(db);
    expect(trakt.traktGet).not.toHaveBeenCalled();
    expect(raw.prepare('SELECT season FROM up_next').all()).toEqual([{ season: null }]);
    expect((await refreshUpNext(db)).checked).toBe(0);
  });
});

// Most pool shows carry only a TMDB id (1,415 of 1,706 on 2026-11-02). Up next
// stored every one of them as caught up without asking Trakt.
describe('a show the catalog knows only by its TMDB id', () => {
  beforeEach(() => trakt.traktGet.mockReset());
  const lookup = (tmdb: number, traktId: number) => [{ type: 'show', score: 1000, show: { title: 'x', ids: { trakt: traktId, tmdb } } }];

  it('asks Trakt which show it is once, then asks for its progress', async () => {
    const { db, raw } = open();
    await migrate(db);
    addShow(raw, 'nocturne', null, 292741);
    watch(raw, 'nocturne', 2);
    trakt.traktGet.mockImplementation(async (url: unknown) =>
      String(url).startsWith('/search/tmdb/292741') ? lookup(292741, 271001) : nextEpisode(3));
    await refreshUpNext(db);
    expect(trakt.traktGet.mock.calls.map((c) => String(c[0]).split('?')[0])).toEqual(['/search/tmdb/292741', '/shows/271001/progress/watched']);
    expect((await upNextList(db)).map((e) => `${e.mediaItemId} ${e.episode}`)).toEqual(['nocturne 3']);

    // A new tick moves the count, so the show is due again; the id is kept.
    raw.prepare(`INSERT INTO episode_state (media_item_id, season, episode, watched_at, sources) VALUES ('nocturne', 1, 3, ?, '[]')`).run(NOW - 60);
    trakt.traktGet.mockClear();
    await refreshUpNext(db);
    expect(trakt.traktGet.mock.calls.map((c) => String(c[0]).split('?')[0])).toEqual(['/shows/271001/progress/watched']);
  });

  it('is caught up when Trakt has no such show, and the answer is kept', async () => {
    const { db, raw } = open();
    await migrate(db);
    addShow(raw, 'unknown', null, 999);
    watch(raw, 'unknown', 1);
    trakt.traktGet.mockResolvedValue([]);
    await refreshUpNext(db);
    expect(trakt.traktGet).toHaveBeenCalledTimes(1);
    expect(raw.prepare('SELECT season FROM up_next').all()).toEqual([{ season: null }]);
    expect(raw.prepare('SELECT tmdb_id, trakt_id FROM trakt_show').all()).toEqual([{ tmdb_id: 999, trakt_id: null }]);
  });

  it('keeps nothing when the lookup is not a list', async () => {
    const { db, raw } = open();
    await migrate(db);
    addShow(raw, 'odd', null, 5);
    watch(raw, 'odd', 1);
    trakt.traktGet.mockResolvedValue({ error: 'x' });
    await expect(refreshUpNext(db)).rejects.toThrow();
    expect(raw.prepare('SELECT COUNT(*) n FROM trakt_show').get()).toEqual({ n: 0 });
    expect(raw.prepare('SELECT COUNT(*) n FROM up_next').get()).toEqual({ n: 0 });
  });
});

describe('ticking an episode', () => {
  beforeEach(() => {
    for (const f of [trakt.traktGet, trakt.traktPost, trakt.writeState, trakt.applyLocalWrite]) f.mockReset();
    trakt.writeState.mockResolvedValue({});
  });

  it('names a show outside the catalog copy to Trakt by the TMDB id its page holds', async () => {
    const { db } = open();
    await migrate(db);
    trakt.traktPost.mockResolvedValue({ added: { episodes: 1 }, not_found: { shows: [], episodes: [] } });
    await setEpisodesWatched(db, 'nocturne', [{ season: 1, episode: 1 }], true, [{ source: 'tmdb', sourceId: '292741' }]);
    expect(trakt.traktPost).toHaveBeenCalledWith('/sync/history', 'token', {
      shows: [{ ids: { tmdb: 292741 }, seasons: [{ number: 1, episodes: [{ number: 1 }] }] }],
    });
    expect(trakt.writeState).toHaveBeenCalledTimes(1);
  });

  it('prefers the Trakt id the catalog copy holds', async () => {
    const { db, raw } = open();
    await migrate(db);
    addShow(raw, 'sunny', 193230, 2710);
    trakt.traktPost.mockResolvedValue({});
    trakt.traktGet.mockResolvedValue(nextEpisode(2));
    await setEpisodesWatched(db, 'sunny', [{ season: 1, episode: 1 }], true, [{ source: 'tmdb', sourceId: '2710' }]);
    expect(trakt.traktPost.mock.calls[0][2]).toMatchObject({ shows: [{ ids: { trakt: 193230 } }] });
  });

  it('saves nothing when Trakt could not match the show', async () => {
    const { db } = open();
    await migrate(db);
    trakt.traktPost.mockResolvedValue({ added: { episodes: 0 }, not_found: { shows: [{ ids: { tmdb: 1 } }] } });
    await expect(setEpisodesWatched(db, 'x', [{ season: 1, episode: 1 }], true, [{ source: 'tmdb', sourceId: '1' }]))
      .rejects.toThrow(/Trakt could not find/);
    expect(trakt.writeState).not.toHaveBeenCalled();
  });

  it('says so when there is no id to name the show by', async () => {
    const { db } = open();
    await migrate(db);
    await expect(setEpisodesWatched(db, 'x', [{ season: 1, episode: 1 }], true)).rejects.toThrow(/no Trakt or TMDB id/);
    expect(trakt.traktPost).not.toHaveBeenCalled();
  });
});

describe('a weekly show checked the day before its new episode', () => {
  afterEach(() => vi.useRealTimers());

  it('is asked about again once the episode airs, not a day later', async () => {
    const { db, raw } = open();
    await migrate(db);
    addShow(raw, 'zdf', 169246);
    watch(raw, 'zdf', 2);
    const airs = NOW + 3600;
    trakt.traktGet.mockReset();
    trakt.traktGet.mockResolvedValueOnce({ next_episode: { season: 13, number: 3, first_aired: new Date(airs * 1000).toISOString() } });
    await refreshUpNext(db);
    expect(await upNextList(db)).toEqual([]);

    vi.useFakeTimers({ now: (NOW + 1800) * 1000, toFake: ['Date'] });
    expect((await refreshUpNext(db)).checked).toBe(0);

    vi.setSystemTime((airs + 60) * 1000);
    trakt.traktGet.mockResolvedValueOnce({ next_episode: { season: 13, number: 3, first_aired: new Date(airs * 1000).toISOString() } });
    await refreshUpNext(db);
    expect(trakt.traktGet).toHaveBeenCalledTimes(2);
    expect((await upNextList(db)).map((e) => `${e.mediaItemId} ${e.season}x${e.episode}`)).toEqual(['zdf 13x3']);
  });
});

describe('step 9', () => {
  it('asks every caught-up show again, since a TMDB-only show was never asked', async () => {
    const { db, raw } = open();
    await migrate(db);
    raw.exec('DROP TABLE trakt_show');
    raw.exec('PRAGMA user_version = 8');
    raw.exec(`INSERT INTO up_next (media_item_id, season, episode, watched_count, checked_at) VALUES
              ('tmdb-only', NULL, NULL, 2, ${NOW}), ('real', 1, 7, 6, ${NOW})`);
    await migrate(db);
    expect(raw.prepare('SELECT media_item_id FROM up_next').all()).toEqual([{ media_item_id: 'real' }]);
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 9 });
  });
});

describe('the schema step that heals a stored "caught up"', () => {
  it('asks every caught-up show again and keeps the real answers', async () => {
    const { db, raw } = open();
    await migrate(db);
    // Back to how a version 4 database looked.
    raw.exec('ALTER TABLE up_next DROP COLUMN next_air_at');
    raw.exec('ALTER TABLE catalog DROP COLUMN world_date');
    raw.exec('DROP TABLE regional_date');
    raw.exec('PRAGMA user_version = 4');
    raw.exec(`INSERT INTO up_next (media_item_id, season, episode, watched_count, checked_at) VALUES
              ('wrongly-caught-up', NULL, NULL, 6, ${NOW}), ('real', 1, 7, 6, ${NOW})`);
    await migrate(db);
    expect(raw.prepare('SELECT media_item_id FROM up_next').all()).toEqual([{ media_item_id: 'real' }]);
    expect(raw.prepare('SELECT COUNT(*) n FROM trakt_show').get()).toEqual({ n: 0 });
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: SCHEMA_VERSION });
  });
});
