import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The device replaces its copy of your rows wholesale, which means it deletes.
// So the property under test is the prune invariant: a pull that did not finish
// must leave the copy exactly as it was.

const worker = vi.hoisted(() => ({
  stateCounts: vi.fn(),
  stateItems: vi.fn(),
  stateEpisodes: vi.fn(),
  stateHidden: vi.fn(),
}));
vi.mock('~/lib/api', () => ({ api: worker }));

const { syncState, clearState } = await import('./stateSync');

function fakeDb() {
  let tables: Record<string, Map<string, unknown[]>> = {
    item_state: new Map(), episode_state: new Map(), hidden_item: new Map(), meta: new Map(),
  };
  let failWrites = false;

  const keyFor = (table: string, p: unknown[]) =>
    table === 'item_state' || table === 'episode_state' ? p.slice(0, 3).join('|') : String(p[0]);
  const tableIn = (sql: string) => Object.keys(tables).find((t) => new RegExp(`\\b${t}\\b`).test(sql))!;

  const write = (sql: string, params: unknown[]) => {
    if (failWrites && sql.startsWith('INSERT')) throw new Error('disk full');
    const table = tableIn(sql);
    if (sql.startsWith('DELETE FROM meta WHERE')) tables.meta.delete(String(params[0]));
    else if (sql.startsWith('DELETE')) tables[table].clear();
    else tables[table].set(keyFor(table, params), params);
  };

  const db = {
    async getFirstAsync(_sql: string, params: unknown[] = []) {
      const row = tables.meta.get(String(params[0]));
      return row ? { value: row[1] } : null;
    },
    async runAsync(sql: string, params: unknown[] = []) { write(sql, params); },
    async prepareAsync(sql: string) {
      return { async executeAsync(params: unknown[]) { write(sql, params); }, async finalizeAsync() {} };
    },
    async withTransactionAsync(task: () => Promise<void>) {
      const before = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, new Map(v)]));
      try { await task(); } catch (e) { tables = before; throw e; }
    },
  };

  return {
    db: db as unknown as SQLiteDatabase,
    count: (t: string) => tables[t].size,
    keys: (t: string) => [...tables[t].keys()].sort(),
    failWrites: (v: boolean) => { failWrites = v; },
  };
}

const item = (id: string, source = 'trakt', relation = 'library') => ({
  mediaItemId: id, source, relation, status: 'watched', rating: 8, review: null, reviewedAt: null, addedAt: 100, updatedAt: 200,
});
const episode = (id: string, s: number, e: number) => ({ mediaItemId: id, season: s, episode: e, watchedAt: 300, sources: ['trakt'] });

/** A fake Worker holding these rows, paging them the way the real one does. */
function serve(items: ReturnType<typeof item>[], episodes: ReturnType<typeof episode>[], hidden: string[], pageSize = 2, stamp = 1) {
  worker.stateCounts.mockResolvedValue({
    items: items.length, itemsUpdatedAt: stamp, episodes: episodes.length, episodesUpdatedAt: stamp, hidden: hidden.length, hiddenUpdatedAt: stamp,
  });
  const page = <T,>(rows: T[], after: unknown, key: (r: T) => string) => {
    const from = after ? rows.findIndex((r) => key(r) === key(after as T)) + 1 : 0;
    const slice = rows.slice(from, from + pageSize);
    return { rows: slice, limit: pageSize, done: slice.length < pageSize };
  };
  worker.stateItems.mockImplementation(async (after?: unknown) => page(items, after, (r) => `${r.mediaItemId}|${r.source}|${r.relation}`));
  worker.stateEpisodes.mockImplementation(async (after?: unknown) => page(episodes, after, (r) => `${r.mediaItemId}|${r.season}|${r.episode}`));
  worker.stateHidden.mockResolvedValue({ rows: hidden.map((id) => ({ mediaItemId: id, hiddenAt: 1 })) });
}

beforeEach(() => {
  for (const fn of Object.values(worker)) fn.mockReset();
});

describe('a pull', () => {
  it('walks every page of every kind and lands all of it', async () => {
    serve(
      [item('a'), item('b'), item('b', 'tmdb'), item('c', 'local', 'wishlist'), item('d')],
      [episode('s', 1, 1), episode('s', 1, 2), episode('s', 1, 3)],
      ['h1'],
    );
    const f = fakeDb();
    const res = await syncState(f.db);
    expect(res).toEqual({ changed: true, items: 5, episodes: 3, hidden: 1 });
    expect(f.count('item_state')).toBe(5);
    expect(f.count('episode_state')).toBe(3);
    expect(f.keys('hidden_item')).toEqual(['h1']);
    // Paged, not one request: five items at two a page is three requests.
    expect(worker.stateItems).toHaveBeenCalledTimes(3);
  });

  it('fetches nothing when the Worker says nothing changed', async () => {
    serve([item('a')], [], []);
    const f = fakeDb();
    await syncState(f.db);
    worker.stateItems.mockClear();
    const again = await syncState(f.db);
    expect(again.changed).toBe(false);
    expect(worker.stateItems).not.toHaveBeenCalled();
  });

  it('replaces the copy when a row was removed on another device', async () => {
    serve([item('a'), item('b'), item('c')], [], []);
    const f = fakeDb();
    await syncState(f.db);

    // "b" was deleted elsewhere. The count differs, so the device pulls again
    // and the row goes, which a merge of new rows over old could never do.
    serve([item('a'), item('c')], [], [], 2, 2);
    await syncState(f.db);
    expect(f.keys('item_state')).toEqual(['a|trakt|library', 'c|trakt|library']);
  });

  it('pulls again when forced, even if the signature matches', async () => {
    serve([item('a')], [], []);
    const f = fakeDb();
    await syncState(f.db);
    worker.stateItems.mockClear();
    expect((await syncState(f.db, true)).changed).toBe(true);
    expect(worker.stateItems).toHaveBeenCalled();
  });
});

describe('a pull that fails', () => {
  it('leaves the library untouched when the network drops half way', async () => {
    serve([item('a'), item('b'), item('c')], [episode('s', 1, 1)], ['h']);
    const f = fakeDb();
    await syncState(f.db);

    // Something changed, and the second page of the new pull never arrives.
    serve([item('a'), item('b'), item('c'), item('d'), item('e')], [], [], 2, 2);
    const real = worker.stateItems.getMockImplementation()!;
    let calls = 0;
    worker.stateItems.mockImplementation(async (after?: unknown) => {
      if (++calls === 2) throw new Error('offline');
      return real(after);
    });

    await expect(syncState(f.db)).rejects.toThrow('offline');
    // Not the two rows that arrived, and not empty: the three it had before.
    expect(f.keys('item_state')).toEqual(['a|trakt|library', 'b|trakt|library', 'c|trakt|library']);
    expect(f.count('episode_state')).toBe(1);
    expect(f.count('hidden_item')).toBe(1);
  });

  it('rolls the whole replace back when a local write fails', async () => {
    serve([item('a'), item('b')], [], []);
    const f = fakeDb();
    await syncState(f.db);

    serve([item('x')], [], [], 2, 2);
    f.failWrites(true);
    await expect(syncState(f.db)).rejects.toThrow('disk full');
    // The DELETE at the top of the transaction went with it.
    expect(f.keys('item_state')).toEqual(['a|trakt|library', 'b|trakt|library']);

    // And the signature was not advanced, so the next sync tries again.
    f.failWrites(false);
    expect((await syncState(f.db)).changed).toBe(true);
    expect(f.keys('item_state')).toEqual(['x|trakt|library']);
  });

  it('does not touch anything when the first question fails', async () => {
    serve([item('a')], [], []);
    const f = fakeDb();
    await syncState(f.db);
    worker.stateCounts.mockRejectedValue(new Error('offline'));
    await expect(syncState(f.db)).rejects.toThrow('offline');
    expect(f.count('item_state')).toBe(1);
  });
});

describe('signing out', () => {
  it('forgets the rows and the signature, so the next account starts clean', async () => {
    serve([item('a')], [episode('s', 1, 1)], ['h']);
    const f = fakeDb();
    await syncState(f.db);
    await clearState(f.db);
    expect(f.count('item_state') + f.count('episode_state') + f.count('hidden_item')).toBe(0);
    // Without clearing the signature, a second account with the same counts
    // would be told "nothing changed" and shown an empty library.
    expect((await syncState(f.db)).changed).toBe(true);
  });
});
