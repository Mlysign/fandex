import type { SQLiteDatabase } from 'expo-sqlite';
import { describe, expect, it, vi } from 'vitest';

// Every title in the account's language, and found by its other names
// (2026-11-21). Real SQL, because the language pick for the whole catalog is a
// query, and it must pick what the shared rule picks.

vi.mock('expo-crypto', () => ({}));
vi.mock('~/lib/storage', () => ({ secretGet: vi.fn(), secretSet: vi.fn(), secretDelete: vi.fn() }));

interface Statement { run(...p: unknown[]): unknown; all(...p: unknown[]): unknown[]; get(...p: unknown[]): unknown }
interface DatabaseSync { exec(sql: string): void; prepare(sql: string): Statement }
const NODE_SQLITE = 'node:sqlite';
const { DatabaseSync } = (await import(/* @vite-ignore */ NODE_SQLITE)) as { DatabaseSync: new (path: string) => DatabaseSync };

const { migrate } = await import('./db');
const { catalogSearchNames, localTitle, pointTitlesAt, titleLangs } = await import('./localTitles');

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

const YOUR_NAME = {
  id: 'yn', type: 'movie', title: 'Your Name.',
  titles: { en: '', de: 'Your Name. - Gestern, heute und für immer', fr: '', ja: '君の名は。' },
  aka: ['Kimi no Na wa.'],
};
// A German original: its German editions carry the book's own title, stored as "".
const KANON = { id: 'kanon', type: 'book', title: 'Der Kanon mechanischer Seelen', titles: { de: '', en: 'The Canon of Mechanical Souls' } };
const PLAIN = { id: 'inception', type: 'movie', title: 'Inception' };

function add(raw: DatabaseSync, v: { id: string; type: string; title: string }) {
  raw.prepare(
    `INSERT INTO catalog (id, type, title, norm_title, slug, poster_url, release_date, world_date, year, community_score, community_votes, updated_at, vector, facets)
     VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, NULL, 0, 0, ?, '[]')`,
  ).run(v.id, v.type, v.title, v.title.toLowerCase(), JSON.stringify(v));
}

const titles = (raw: DatabaseSync) =>
  Object.fromEntries((raw.prepare('SELECT id, title FROM catalog ORDER BY id').all() as { id: string; title: string }[]).map((r) => [r.id, r.title]));

describe('titles in the account’s language', () => {
  it('rewrites the catalog once per change of country, picking what the shared rule picks', async () => {
    const { db, raw } = open();
    await migrate(db);
    for (const v of [YOUR_NAME, KANON, PLAIN]) add(raw, v);

    expect(await pointTitlesAt(db, 'DE')).toBe(true);
    expect(await titleLangs(db)).toEqual(['de', 'en']);
    expect(titles(raw)).toEqual({
      inception: 'Inception', kanon: 'Der Kanon mechanischer Seelen', yn: 'Your Name. - Gestern, heute und für immer',
    });
    for (const v of [YOUR_NAME, KANON, PLAIN]) expect(titles(raw)[v.id]).toBe(localTitle(v, ['de', 'en']));
    expect(await pointTitlesAt(db, 'DE')).toBe(false);

    expect(await pointTitlesAt(db, 'US')).toBe(true);
    expect(titles(raw)).toEqual({ inception: 'Inception', kanon: 'The Canon of Mechanical Souls', yn: 'Your Name.' });

    expect(await pointTitlesAt(db, 'FR')).toBe(true);
    expect(titles(raw).yn).toBe('Your Name.');
  });

  it('finds a title by its original, a romanization and English, for the device’s languages', async () => {
    const { db, raw } = open();
    await migrate(db);
    for (const v of [YOUR_NAME, KANON, PLAIN]) add(raw, v);
    await pointTitlesAt(db, 'DE');
    const names = await catalogSearchNames(db);
    expect(names.get('yn')).toEqual(expect.arrayContaining(['Your Name.', 'Kimi no Na wa.', 'Your Name. - Gestern, heute und für immer']));
    expect(names.get('kanon')).toEqual(expect.arrayContaining(['Der Kanon mechanischer Seelen', 'The Canon of Mechanical Souls']));
    expect(names.has('inception')).toBe(false);
  });
});
