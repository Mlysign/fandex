import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeltaCursor, DeltaPage } from './api';

// The sync's whole job is to never lose its place. These tests drive it against
// a fake Worker and a fake database that can fail on demand, and check where the
// cursor ends up.

const pages = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('~/lib/api', () => ({ api: { catalogDelta: pages.fetch } }));

const { syncCatalog, resetCatalog, lastSyncedAt } = await import('./catalogSync');

/** Just enough SQLite for catalogSync: two tables, a transaction that rolls back. */
function fakeDb() {
  let catalog = new Map<string, unknown[]>();
  let meta = new Map<string, string>();
  let failInsertAfter: number | null = null;
  let inserts = 0;

  const db = {
    async getFirstAsync(sql: string, params: unknown[] = []) {
      if (sql.includes('FROM meta')) {
        const v = meta.get(String(params[0]));
        return v === undefined ? null : { value: v };
      }
      if (sql.includes('COUNT(*)')) return { n: catalog.size };
      throw new Error(`fake db: unhandled read: ${sql}`);
    },
    async runAsync(sql: string, params: unknown[] = []) {
      if (sql.startsWith('INSERT INTO meta')) meta.set(String(params[0]), String(params[1]));
      else if (sql.startsWith('DELETE FROM catalog')) catalog.clear();
      else if (sql.startsWith('DELETE FROM meta')) for (const k of params) meta.delete(String(k));
      else throw new Error(`fake db: unhandled write: ${sql}`);
      return { changes: 1, lastInsertRowId: 0 };
    },
    async prepareAsync() {
      return {
        async executeAsync(params: unknown[]) {
          inserts++;
          if (failInsertAfter !== null && inserts > failInsertAfter) throw new Error('disk full');
          catalog.set(String(params[0]), params);
        },
        async finalizeAsync() {},
      };
    },
    async withTransactionAsync(task: () => Promise<void>) {
      const before = { catalog: new Map(catalog), meta: new Map(meta) };
      try {
        await task();
      } catch (e) {
        catalog = before.catalog;
        meta = before.meta;
        throw e;
      }
    },
  };

  return {
    db: db as unknown as SQLiteDatabase,
    ids: () => [...catalog.keys()].sort(),
    row: (id: string) => catalog.get(id),
    cursor: (): DeltaCursor | null => (meta.has('catalog_cursor') ? JSON.parse(meta.get('catalog_cursor')!) : null),
    failInsertsAfter: (n: number | null) => { failInsertAfter = n; inserts = 0; },
  };
}

const item = (id: string, updatedAt: number, title = `Title ${id}`) => ({
  updatedAt,
  vector: {
    id, type: 'movie', title, slug: id, posterUrl: null, backdropUrl: null, releaseDate: '2020-01-01', year: 2020,
    communityScore: 70, communityAvg: 70, communityVotes: 10, runtimeMinutes: 100, addedAt: 1, sources: [],
  },
  facets: [],
});

/** A fake Worker holding `rows`, answering the delta contract a page at a time. */
function serve(rows: ReturnType<typeof item>[], pageSize: number, poolCount = rows.length) {
  pages.fetch.mockImplementation(async (cursor: DeltaCursor): Promise<DeltaPage> => {
    const after = rows
      .filter((r) => r.updatedAt > cursor.since || (r.updatedAt === cursor.since && r.vector.id > cursor.after))
      .sort((a, b) => a.updatedAt - b.updatedAt || (a.vector.id < b.vector.id ? -1 : 1));
    const slice = after.slice(0, pageSize);
    const done = slice.length < pageSize;
    const last = slice[slice.length - 1];
    return {
      items: slice as unknown as DeltaPage['items'],
      next: last ? { since: last.updatedAt, after: last.vector.id } : cursor,
      done,
      poolCount: done ? poolCount : null,
      serverTime: 9_999_999,
    };
  });
}

// Braces, not an expression body. mockReset() returns the mock, and Vitest
// treats a function returned from beforeEach as a cleanup hook and CALLS it.
beforeEach(() => {
  pages.fetch.mockReset();
});

describe('a first sync', () => {
  it('walks every page and ends on the last row', async () => {
    const rows = ['a', 'b', 'c', 'd', 'e'].map((id, i) => item(id, 100 + i));
    serve(rows, 2);
    const f = fakeDb();
    const result = await syncCatalog(f.db);
    expect(result).toMatchObject({ written: 5, total: 5, poolCount: 5 });
    expect(f.ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(f.cursor()).toEqual({ since: 104, after: 'e' });
    expect(await lastSyncedAt(f.db)).toBeGreaterThan(0);
  });

  it('stores the title normalised, with the rule the catalog itself uses', async () => {
    serve([item('a', 100, "Marvel's Spider-Man")], 10);
    const f = fakeDb();
    await syncCatalog(f.db);
    // The fourth bound value is norm_title. Apostrophes are dropped and other
    // punctuation becomes a space: the site's normalizeName, imported, so a
    // search on the device matches the way the catalog's own matcher does.
    expect(f.row('a')![3]).toBe('marvels spider man');
  });

  it('reports progress as pages land', async () => {
    serve(['a', 'b', 'c'].map((id, i) => item(id, 100 + i)), 2);
    const f = fakeDb();
    const seen: number[] = [];
    await syncCatalog(f.db, (p) => seen.push(p.written));
    expect(seen).toEqual([2, 3]);
  });
});

describe('a later sync', () => {
  it('asks from where the last one stopped and writes only what changed', async () => {
    const rows = ['a', 'b', 'c'].map((id, i) => item(id, 100 + i));
    serve(rows, 10);
    const f = fakeDb();
    await syncCatalog(f.db);

    rows.push(item('d', 200));
    rows[0] = item('a', 201, 'Renamed');
    serve(rows, 10);
    pages.fetch.mockClear();
    const second = await syncCatalog(f.db);
    expect(pages.fetch.mock.calls[0][0]).toEqual({ since: 102, after: 'c' });
    expect(second.written).toBe(2);
    expect(f.ids()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('writes nothing and keeps its cursor when nothing changed', async () => {
    serve([item('a', 100)], 10);
    const f = fakeDb();
    await syncCatalog(f.db);
    const before = f.cursor();
    const again = await syncCatalog(f.db);
    expect(again.written).toBe(0);
    expect(f.cursor()).toEqual(before);
  });
});

describe('when something fails half way', () => {
  it('keeps every page that landed and resumes after it', async () => {
    const rows = ['a', 'b', 'c', 'd'].map((id, i) => item(id, 100 + i));
    serve(rows, 2);
    const f = fakeDb();

    // The network drops on the second page.
    const real = pages.fetch.getMockImplementation()!;
    let calls = 0;
    pages.fetch.mockImplementation(async (c: DeltaCursor) => {
      if (++calls === 2) throw new Error('offline');
      return real(c);
    });
    await expect(syncCatalog(f.db)).rejects.toThrow('offline');
    expect(f.ids()).toEqual(['a', 'b']);
    expect(f.cursor()).toEqual({ since: 101, after: 'b' });

    // The next sync picks up at page two, not at the start.
    serve(rows, 2);
    pages.fetch.mockClear();
    await syncCatalog(f.db);
    expect(pages.fetch.mock.calls[0][0]).toEqual({ since: 101, after: 'b' });
    expect(f.ids()).toEqual(['a', 'b', 'c', 'd']);
  });

  it('does not advance the cursor past a page that only half wrote', async () => {
    const rows = ['a', 'b', 'c', 'd'].map((id, i) => item(id, 100 + i));
    serve(rows, 2);
    const f = fakeDb();
    // The third insert fails: page one lands whole, page two fails on its first row.
    f.failInsertsAfter(2);
    await expect(syncCatalog(f.db)).rejects.toThrow('disk full');
    // Page two rolled back as a unit, rows AND cursor. A cursor that had moved
    // on would skip those rows forever.
    expect(f.ids()).toEqual(['a', 'b']);
    expect(f.cursor()).toEqual({ since: 101, after: 'b' });
  });
});

describe('a title removed upstream', () => {
  it('starts over when the device holds more than the pool', async () => {
    const rows = ['a', 'b', 'c'].map((id, i) => item(id, 100 + i));
    serve(rows, 10);
    const f = fakeDb();
    await syncCatalog(f.db);
    expect(f.ids()).toEqual(['a', 'b', 'c']);

    // "b" leaves the pool. A delta cannot say so; the pool count can.
    serve([rows[0], rows[2]], 10);
    const result = await syncCatalog(f.db);
    expect(f.ids()).toEqual(['a', 'c']);
    expect(result.total).toBe(2);
  });

  it('does not loop when the counts agree', async () => {
    serve([item('a', 100)], 10);
    const f = fakeDb();
    await syncCatalog(f.db);
    await syncCatalog(f.db);
    // One request for the first sync, one for the second. No restart.
    expect(pages.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('reset', () => {
  it('forgets the rows and the cursor together', async () => {
    serve([item('a', 100)], 10);
    const f = fakeDb();
    await syncCatalog(f.db);
    await resetCatalog(f.db);
    expect(f.ids()).toEqual([]);
    expect(f.cursor()).toBeNull();
    expect(await lastSyncedAt(f.db)).toBeNull();
  });
});
