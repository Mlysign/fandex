import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A show the catalog copy does not hold yet must not be stored as caught up.
// A catalog start-over refills the copy page by page, and Up next ran on every
// page: after the 2026-10-16 fold every device stored most of its shows as
// caught up without asking Trakt, and kept that answer for a day to a week.
// Real SQL, because the fix is in the query.

const trakt = vi.hoisted(() => ({ traktGet: vi.fn() }));
vi.mock('~/lib/trakt', () => ({
  TraktBusyError: class extends Error {},
  traktAccessToken: async () => 'token',
  traktGet: trakt.traktGet,
  traktPost: vi.fn(),
}));
vi.mock('~/lib/api', () => ({ api: {} }));
vi.mock('~/lib/stateSync', () => ({ applyLocalWrite: vi.fn() }));
vi.mock('~/lib/widget', () => ({ publishWidget: vi.fn() }));

// Node's own SQLite. The app has no Node types (it runs on a phone), so the
// module is named through a variable and typed by hand, as much as is used here.
interface Statement { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown }
interface DatabaseSync { exec(sql: string): void; prepare(sql: string): Statement }
const NODE_SQLITE = 'node:sqlite';
const { DatabaseSync } = (await import(/* @vite-ignore */ NODE_SQLITE)) as { DatabaseSync: new (path: string) => DatabaseSync };

const { migrate } = await import('./db');
const { refreshUpNext, upNextList, upNextPending } = await import('./upNext');

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

function addShow(raw: DatabaseSync, id: string, traktId: number | null) {
  const sources = traktId == null ? [] : [{ source: 'trakt', sourceId: String(traktId) }];
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

describe('the schema step that heals a stored "caught up"', () => {
  it('asks every caught-up show again and keeps the real answers', async () => {
    const { db, raw } = open();
    await migrate(db);
    // Back to how a version 4 database looked.
    raw.exec('ALTER TABLE up_next DROP COLUMN next_air_at');
    raw.exec('PRAGMA user_version = 4');
    raw.exec(`INSERT INTO up_next (media_item_id, season, episode, watched_count, checked_at) VALUES
              ('wrongly-caught-up', NULL, NULL, 6, ${NOW}), ('real', 1, 7, 6, ${NOW})`);
    await migrate(db);
    expect(raw.prepare('SELECT media_item_id FROM up_next').all()).toEqual([{ media_item_id: 'real' }]);
    expect(raw.prepare('PRAGMA user_version').get()).toEqual({ user_version: 6 });
  });
});
