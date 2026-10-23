import type { SQLiteDatabase } from 'expo-sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeltaCursor, DeltaPage } from './api';

// The sync's whole job is to never lose its place. These tests drive it against
// a fake Worker and a fake database that can fail on demand, and check where the
// cursor ends up.

const pages = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('~/lib/api', () => ({ api: { catalogDelta: pages.fetch } }));
// Where the catalog files are. Null (no files) unless a test says otherwise, so
// no test here ever asks the real website for them.
const files = vi.hoisted(() => ({ CATALOG_FILES_URL: null as string | null }));
vi.mock('~/lib/config', () => files);

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

  // The score profile waits while the copy is partial, and only then (RV31).
  it('says the start-over is a refill, and the delta before it is not', async () => {
    const rows = ['a', 'b', 'c'].map((id, i) => item(id, 100 + i));
    serve(rows, 10);
    const f = fakeDb();
    const first: boolean[] = [];
    await syncCatalog(f.db, (p) => first.push(p.refill));
    expect(first).toEqual([true]);

    serve([rows[0], rows[2]], 10);
    const later: boolean[] = [];
    await syncCatalog(f.db, (p) => later.push(p.refill));
    // The delta on the whole copy, then the download after the start-over.
    expect(later).toEqual([false, true]);
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

// The Worker keeps its pool count instead of counting on every sync, and a kept
// count can be wrong. Too low used to mean: throw the catalog away, download it,
// find it is still "too many", and do that again without end.
describe('a pool count that is too low', () => {
  it('starts over once, keeps what it downloaded, and returns', async () => {
    const rows = ['a', 'b', 'c'].map((id, i) => item(id, 100 + i));
    serve(rows, 10, 2);
    const f = fakeDb();
    const result = await syncCatalog(f.db);
    // The first pass, then one start-over. Not a third.
    expect(pages.fetch).toHaveBeenCalledTimes(2);
    expect(f.ids()).toEqual(['a', 'b', 'c']);
    expect(result).toMatchObject({ total: 3, poolCount: 2 });
  });

  it('does not start over again on the next sync', async () => {
    const rows = ['a', 'b', 'c'].map((id, i) => item(id, 100 + i));
    serve(rows, 10, 2);
    const f = fakeDb();
    await syncCatalog(f.db);
    pages.fetch.mockClear();
    const again = await syncCatalog(f.db);
    expect(pages.fetch).toHaveBeenCalledTimes(1);
    expect(again.written).toBe(0);
    expect(f.ids()).toEqual(['a', 'b', 'c']);
  });

  it('tries again a day later, when the Worker has counted afresh', async () => {
    const rows = ['a', 'b', 'c'].map((id, i) => item(id, 100 + i));
    serve(rows, 10, 2);
    const f = fakeDb();
    await syncCatalog(f.db);

    // "b" really has left the pool, and the count is the same 2 it wrongly was:
    // the number alone cannot tell the two apart, the day can.
    serve([rows[0], rows[2]], 10);
    await syncCatalog(f.db);
    expect(f.ids()).toEqual(['a', 'b', 'c']);

    const now = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 25 * 60 * 60 * 1000);
    try {
      await syncCatalog(f.db);
    } finally {
      now.mockRestore();
    }
    expect(f.ids()).toEqual(['a', 'c']);
  });
});

// A first sync through the Worker is two D1 rows read per title, for every new
// visitor. The website's build writes the same pages as files, and an empty
// device starts from those.
describe('starting from the catalog files', () => {
  const rows = ['a', 'b', 'c', 'd', 'e'].map((id, i) => item(id, 100 + i));
  const page = (slice: typeof rows) => ({ items: slice, next: { since: slice[slice.length - 1].updatedAt, after: slice[slice.length - 1].vector.id } });

  /** A website holding these files. Anything not listed is a 404. */
  function site(served: Record<string, unknown>) {
    const asked: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      asked.push(url);
      const body = served[url.replace('https://site.test', '')];
      return body === undefined
        ? { ok: false, status: 404, json: async () => { throw new Error('not json'); } }
        : { ok: true, status: 200, json: async () => body };
    }));
    return asked;
  }

  beforeEach(() => { files.CATALOG_FILES_URL = 'https://site.test'; });
  afterEach(() => { files.CATALOG_FILES_URL = null; vi.unstubAllGlobals(); });

  it('fills an empty device from the files and asks the Worker only for what came after', async () => {
    site({
      '/catalog/index.json': { version: 1, pages: ['p000.json', 'p001.json'] },
      '/catalog/p000.json': page(rows.slice(0, 2)),
      '/catalog/p001.json': page(rows.slice(2, 4)),
    });
    serve(rows, 10); // "e" was added after the files were written.
    const f = fakeDb();
    const result = await syncCatalog(f.db);
    expect(f.ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
    // One request to the Worker, from where the files stopped.
    expect(pages.fetch).toHaveBeenCalledTimes(1);
    expect(pages.fetch.mock.calls[0][0]).toEqual({ since: 103, after: 'd' });
    expect(result).toMatchObject({ written: 5, total: 5 });
  });

  it('is not asked for by a device that already has a catalog', async () => {
    const asked = site({});
    serve(rows, 10);
    const f = fakeDb();
    files.CATALOG_FILES_URL = null;
    await syncCatalog(f.db);
    files.CATALOG_FILES_URL = 'https://site.test';
    await syncCatalog(f.db);
    expect(asked).toEqual([]);
  });

  it('falls back to the Worker when there are no files, or they are not what they should be', async () => {
    for (const served of [
      {},
      { '/catalog/index.json': { version: 2, pages: ['p000.json'] } },
      { '/catalog/index.json': { version: 1, pages: ['../secret.json'] } },
      { '/catalog/index.json': { version: 1, pages: ['p000.json'] }, '/catalog/p000.json': { items: 'nope' } },
    ]) {
      site(served);
      serve(rows, 10);
      pages.fetch.mockClear();
      const f = fakeDb();
      await syncCatalog(f.db);
      expect(f.ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(pages.fetch.mock.calls[0][0]).toEqual({ since: 0, after: '' });
    }
  });

  it('carries on from the last file that landed when a later one is missing', async () => {
    site({
      '/catalog/index.json': { version: 1, pages: ['p000.json', 'p001.json'] },
      '/catalog/p000.json': page(rows.slice(0, 2)),
    });
    serve(rows, 10);
    const f = fakeDb();
    await syncCatalog(f.db);
    expect(pages.fetch.mock.calls[0][0]).toEqual({ since: 101, after: 'b' });
    expect(f.ids()).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('does not start a start-over from the files, which still hold the title that left', async () => {
    // The files hold a, b, c. "b" has left the pool since they were written.
    const asked = site({
      '/catalog/index.json': { version: 1, pages: ['p000.json'] },
      '/catalog/p000.json': page(rows.slice(0, 3)),
    });
    serve([rows[0], rows[2]], 10);
    const f = fakeDb();
    const result = await syncCatalog(f.db);
    expect(f.ids()).toEqual(['a', 'c']);
    expect(result.total).toBe(2);
    // The files were read once, for the first attempt only.
    expect(asked.filter((u) => u.endsWith('index.json'))).toHaveLength(1);
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
