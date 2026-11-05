import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// A facet page's provider halves fail on their own, and the page is told which
// failed. A Worker 502 for an author's books once read as "they wrote one book",
// with nothing on the page saying more had been asked and lost (2026-11-03).

const worker = vi.hoisted(() => ({ facetBooks: vi.fn(), facetGames: vi.fn(), lookup: vi.fn() }));
vi.mock('~/lib/api', () => ({ api: worker }));
const config = vi.hoisted(() => ({ key: 'k' }));
vi.mock('~/lib/config', () => ({ get TMDB_API_KEY() { return config.key; }, tmdbConfigured: () => config.key.length > 0 }));

const { providerFacet } = await import('./facetProviders');

const book = (id: string, title: string) => ({
  source: 'openlibrary', sourceId: id, type: 'book', title, releaseDate: '2021', posterUrl: null, rating: null, votes: 0, genres: [],
});

/** TMDB answering every call with the same JSON, or failing every call. */
function tmdb(ok: boolean) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (!url.startsWith('https://api.themoviedb.org')) return { ok: false, status: 404, json: async () => ({}) };
    return ok ? { ok: true, status: 200, json: async () => ({ results: [] }) } : { ok: false, status: 503, json: async () => ({}) };
  }));
}

beforeEach(() => {
  config.key = 'k';
  worker.lookup.mockResolvedValue({ found: [] });
  worker.facetGames.mockResolvedValue({ results: [] });
});
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe('providerFacet', () => {
  it('names the books half when the Worker fails it, and still answers TMDB', async () => {
    tmdb(true);
    worker.facetBooks.mockRejectedValue(new Error('provider-unavailable'));
    const p = await providerFacet('person', 'jason schreier', 'Jason Schreier', 'DE');
    expect(p.failed).toEqual(['books']);
  });

  it('keeps the books when TMDB fails, and names TMDB', async () => {
    tmdb(false);
    worker.facetBooks.mockResolvedValue({ results: [book('OL1W', 'Press Reset'), book('OL2W', 'Play Nice')] });
    const p = await providerFacet('person', 'jason schreier', 'Jason Schreier', 'DE');
    expect(p.failed).toEqual(['tmdb']);
    expect(p.cards.map((c) => c.title)).toEqual(['Press Reset', 'Play Nice']);
  });

  it('reports nothing failed when every half answers, even with nothing', async () => {
    tmdb(true);
    worker.facetBooks.mockResolvedValue({ results: [] });
    const p = await providerFacet('tag', 'heist', 'heist', 'DE');
    expect(p.failed).toEqual([]);
  });

  it('names the games half on a tag page', async () => {
    tmdb(true);
    worker.facetBooks.mockResolvedValue({ results: [] });
    worker.facetGames.mockRejectedValue(new Error('provider-unavailable'));
    const p = await providerFacet('tag', 'heist', 'heist', 'DE');
    expect(p.failed).toEqual(['games']);
  });

  it('names the books half without a TMDB key too', async () => {
    config.key = '';
    tmdb(true);
    worker.facetBooks.mockRejectedValue(new Error('provider-unavailable'));
    const p = await providerFacet('person', 'jason schreier', 'Jason Schreier', 'DE');
    expect(p.failed).toEqual(['books']);
  });

  it('still throws when the page aborts', async () => {
    const abort = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => { abort.abort(); throw new DOMException('aborted', 'AbortError'); }));
    worker.facetBooks.mockResolvedValue({ results: [] });
    await expect(providerFacet('person', 'x y', 'X Y', 'DE', abort.signal)).rejects.toThrow();
  });
});
