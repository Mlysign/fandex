import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

// Reminders on the day itself (2026-11-21): a wishlisted title of any type on
// its release day in your country, and a new season of a show you are caught
// up on. Real SQL for the wishlist, because the rules (hidden, already in the
// library, a whole date) are in the query.

vi.mock('expo-crypto', () => ({}));
vi.mock('~/lib/storage', () => ({ secretGet: vi.fn(), secretSet: vi.fn(), secretDelete: vi.fn() }));
const premieres = vi.hoisted(() => ({ premiereRows: vi.fn() }));
vi.mock('~/lib/seasonPremieres', () => premieres);

interface Statement { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown }
interface DatabaseSync { exec(sql: string): void; prepare(sql: string): Statement }
const NODE_SQLITE = 'node:sqlite';
const { DatabaseSync } = (await import(/* @vite-ignore */ NODE_SQLITE)) as { DatabaseSync: new (path: string) => DatabaseSync };

const { migrate } = await import('./db');
const R = await import('./releaseReminders');

function open(): { db: SQLiteDatabase; raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const db = {
    async execAsync(sql: string) { raw.exec(sql); },
    async runAsync(sql: string, params: unknown[] = []) { raw.prepare(sql).run(...params); },
    async getAllAsync(sql: string, params: unknown[] = []) { return raw.prepare(sql).all(...params); },
    async getFirstAsync(sql: string, params: unknown[] = []) { return raw.prepare(sql).get(...params) ?? null; },
    async withTransactionAsync(task: () => Promise<void>) { raw.exec('BEGIN'); try { await task(); raw.exec('COMMIT'); } catch (e) { raw.exec('ROLLBACK'); throw e; } },
  } as unknown as SQLiteDatabase;
  return { db, raw };
}

function title(raw: DatabaseSync, id: string, type: string, name: string, date: string | null) {
  raw.prepare(
    `INSERT INTO catalog (id, type, title, norm_title, slug, poster_url, release_date, world_date, year, community_score, community_votes, updated_at, vector, facets)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, NULL, NULL, 0, 0, '{}', '[]')`,
  ).run(id, type, name, name.toLowerCase(), id, date, date);
}
function state(raw: DatabaseSync, id: string, relation: 'wishlist' | 'library', source = 'trakt') {
  raw.prepare('INSERT INTO item_state (media_item_id, source, relation, added_at, updated_at) VALUES (?, ?, ?, 0, 0)').run(id, source, relation);
}

// Saturday 2026-11-21, 08:00 local.
const NOW = new Date(2026, 10, 21, 8, 0, 0);

describe('release reminders', () => {
  it('reminds of a wishlisted title of any type on its day, at nine, once, soonest first', async () => {
    const { db, raw } = open();
    await migrate(db);
    title(raw, 'film', 'movie', 'Dune: Part Three', '2026-12-18');
    title(raw, 'game', 'game', 'Hollow Knight: Silksong 2', '2026-11-21');
    title(raw, 'book', 'book', 'Wind and Truth 2', '2027-01-07');
    title(raw, 'year', 'game', 'Some Game', '2027');
    title(raw, 'past', 'movie', 'Old Film', '2026-11-20');
    title(raw, 'seen', 'movie', 'Seen Film', '2026-12-01');
    title(raw, 'hid', 'movie', 'Hidden Film', '2026-12-02');
    for (const id of ['film', 'game', 'book', 'year', 'past', 'seen', 'hid']) state(raw, id, 'wishlist');
    state(raw, 'film', 'wishlist', 'local'); // on two accounts: still one reminder
    state(raw, 'seen', 'library');
    raw.prepare('INSERT INTO hidden_item (media_item_id, hidden_at) VALUES (?, 0)').run('hid');

    const releases = await R.wishlistReleases(db, R.localDay(NOW));
    expect(releases.map((r) => r.id)).toEqual(['game', 'film', 'book']);
    const plan = R.planReminders({ releases, seasons: [], now: NOW });
    expect(plan.map((r) => r.identifier)).toEqual([
      'fandex-release:game:2026-11-21', 'fandex-release:film:2026-12-18', 'fandex-release:book:2027-01-07',
    ]);
    expect(plan[0].at).toEqual(new Date(2026, 10, 21, 9, 0, 0));
    expect(plan[1]).toMatchObject({ title: 'Dune: Part Three is out today', body: 'The movie on your wishlist.', url: '/movie/film' });
  });

  it('sets nothing for today once nine has passed, and nothing past the horizon', () => {
    const at = (d: string) => ({ id: d, type: 'movie', title: 'x', slug: null, release_date: d });
    const later = new Date(2026, 10, 21, 10, 0, 0);
    expect(R.planReminders({ releases: [at('2026-11-21')], seasons: [], now: later })).toEqual([]);
    expect(R.planReminders({ releases: [at('2027-06-01')], seasons: [], now: NOW })).toEqual([]);
  });

  it('reminds of a new season of a show you are caught up on, from the calendar’s own rows', async () => {
    const { db } = open();
    await migrate(db);
    premieres.premiereRows.mockImplementation(async (_db: unknown, month: string) => (month === '2026-12'
      ? [{ id: 'sev', title: 'Severance', slug: 'severance', type: 'show', season: 3, release_date: '2026-12-04' }]
      : []));
    const seasons = await R.seasonStarts(db, NOW);
    expect(premieres.premiereRows.mock.calls.map((c) => c[1])).toEqual(['2026-11', '2026-12', '2027-01', '2027-02', '2027-03']);
    const plan = R.planReminders({ releases: [], seasons, now: NOW });
    expect(plan).toEqual([expect.objectContaining({
      identifier: 'fandex-season:sev:3:2026-12-04', title: 'Severance: season 3 starts today', url: '/show/severance',
    })]);
  });

  it('keeps both kinds on until switched off, per phone', async () => {
    const { db } = open();
    await migrate(db);
    expect(await R.readReminderPrefs(db)).toEqual({ releases: true, seasons: true });
    await R.writeReminderPref(db, 'seasons', false);
    expect(await R.readReminderPrefs(db)).toEqual({ releases: true, seasons: false });
  });
});
