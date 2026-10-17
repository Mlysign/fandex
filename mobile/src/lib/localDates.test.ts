import { describe, expect, it, vi } from 'vitest';

// Every screen reads `catalog.release_date`; it must hold the film's date in the
// country the device is set to, survive a catalog re-sync, and come back to the
// worldwide date for a country with no date of its own. Real SQL on node:sqlite.

vi.mock('~/lib/config', () => ({ CATALOG_FILES_URL: null }));
vi.mock('~/lib/api', () => ({
  api: {},
  ApiError: class extends Error { constructor(public status: number, public code: string) { super(code); } },
}));

const { migrate } = await import('./db');
const { fillRegionalDates, pointDatesAt, filmsToAsk } = await import('./localDates');
const { openTestDb } = await import('./testSqlite');
const { ApiError } = await import('~/lib/api');

async function setup() {
  const { db, raw } = await openTestDb();
  await migrate(db);
  const add = (id: string, type: string, date: string | null) =>
    raw.prepare(`INSERT INTO catalog (id, type, title, norm_title, release_date, world_date, updated_at, vector, facets)
                 VALUES (?, ?, ?, ?, ?, ?, 0, '{}', '[]')`).run(id, type, id, id, date, date);
  add('digger', 'movie', '2026-09-28');
  add('alien', 'movie', '1979-05-25');
  add('severance', 'show', '2022-02-18');
  const dateOf = (id: string) => (raw.prepare('SELECT release_date d FROM catalog WHERE id = ?').get(id) as { d: string | null }).d;
  return { db, raw, dateOf };
}

describe("a film's date in your country", () => {
  it('puts the local date where every screen reads it, and only for films', async () => {
    const { db, dateOf } = await setup();
    await pointDatesAt(db, 'DE');
    const ask = vi.fn(async (_r: string, ids: string[]): Promise<{ dates: Record<string, string> }> => ({ dates: ids.includes('digger') ? { digger: '2026-10-01' } : {} }));
    expect(await fillRegionalDates(db, 'DE', ask)).toBe(1);
    // Shows are never asked about: they have one date everywhere.
    expect(ask.mock.calls[0][1].sort()).toEqual(['alien', 'digger']);
    expect(dateOf('digger')).toBe('2026-10-01');
    expect(dateOf('alien')).toBe('1979-05-25');
    expect(dateOf('severance')).toBe('2022-02-18');
  });

  it('switches country without asking again, and back', async () => {
    const { db, dateOf } = await setup();
    await pointDatesAt(db, 'DE');
    await fillRegionalDates(db, 'DE', async () => ({ dates: { digger: '2026-10-01' } }));
    await pointDatesAt(db, 'US');
    expect(dateOf('digger')).toBe('2026-09-28');
    await fillRegionalDates(db, 'US', async () => ({ dates: {} }));
    const ask = vi.fn(async () => ({ dates: {} }));
    expect(await pointDatesAt(db, 'DE')).toBe(true);
    await fillRegionalDates(db, 'DE', ask);
    expect(ask).not.toHaveBeenCalled();
    expect(dateOf('digger')).toBe('2026-10-01');
  });

  it('keeps the local date when the catalog sync rewrites the row', async () => {
    const { db, raw, dateOf } = await setup();
    await pointDatesAt(db, 'DE');
    await fillRegionalDates(db, 'DE', async () => ({ dates: { digger: '2026-10-01' } }));
    const { storePage } = await import('./catalogSync');
    const vector = { id: 'digger', type: 'movie', title: 'Digger', slug: 'digger', posterUrl: null, releaseDate: '2026-09-28', year: 2026, communityScore: null, communityVotes: 0, sources: [] };
    await storePage(db, [{ updatedAt: 1, vector, facets: [] }] as never, { since: 1, after: 'digger' });
    expect((raw.prepare('SELECT world_date w FROM catalog WHERE id = ?').get('digger') as { w: string }).w).toBe('2026-09-28');
    expect(dateOf('digger')).toBe('2026-10-01');
  });

  it('asks again only when an answer is stale, the settled ones far less often', async () => {
    const { db } = await setup();
    const now = Math.floor(Date.parse('2026-10-17T12:00:00Z') / 1000);
    vi.useFakeTimers({ now: now * 1000, toFake: ['Date'] });
    await fillRegionalDates(db, 'DE', async () => ({ dates: {} }));
    expect(await filmsToAsk(db, 'DE', now + 4 * 86_400, 100)).toEqual(['digger']);
    expect((await filmsToAsk(db, 'DE', now + 31 * 86_400, 100)).sort()).toEqual(['alien', 'digger']);
    vi.useRealTimers();
  });

  it('stops on a rate limit and keeps what landed', async () => {
    const { db } = await setup();
    await pointDatesAt(db, 'DE');
    await expect(fillRegionalDates(db, 'DE', async () => { throw new ApiError(429, 'rate-limited'); })).resolves.toBe(0);
  });
});
