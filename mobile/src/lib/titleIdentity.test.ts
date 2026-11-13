import { describe, expect, it } from 'vitest';
import { providerLinks, titleIndex, titleKeys } from '~/lib/titleIdentity';

// Spotlight as the device holds it in Germany, and as TMDB lists it on Liev Schreiber's credits.
const held = { id: 'c96a', type: 'movie', title: 'Spotlight', releaseDate: '2016-02-25', worldDate: '2015-11-06' };
const tmdb = { id: null, type: 'movie', title: 'Spotlight', releaseDate: '2015-11-06' };

describe('the same title from the device and from a provider', () => {
  it("matches a provider's worldwide year against a held card dated in the device's country", () => {
    expect(titleIndex([held]).has(tmdb)).toBe(true);
    expect(titleIndex([tmdb]).find(held)).toBe(tmdb);
  });

  it('matches by Fandex id whatever the name says', () => {
    expect(titleIndex([held]).has({ id: 'c96a', type: 'movie', title: 'Spotlight (2015)', releaseDate: null })).toBe(true);
  });

  it('keeps apart another year, another medium and a title it cannot read', () => {
    const index = titleIndex([held]);
    expect(index.has({ ...tmdb, releaseDate: '2009-01-01' })).toBe(false);
    expect(index.has({ ...tmdb, type: 'show' })).toBe(false);
    const kanji = { id: null, type: 'movie', title: '千と千尋の神隠し', releaseDate: '2001-07-20' };
    expect(titleKeys(kanji)).toEqual([]);
    expect(titleIndex([kanji]).has({ ...kanji, title: '紅の豚' })).toBe(false);
  });

  it('matches a dateless card only to a dateless one', () => {
    expect(titleKeys({ type: 'book', title: 'Dune', releaseDate: null })).toEqual(['book|dune|']);
    expect(titleIndex([{ type: 'book', title: 'Dune', releaseDate: null }]).has({ type: 'book', title: 'Dune', releaseDate: '1965-08-01' })).toBe(false);
  });

  it('learns a card added after it was built, as a rail does once the Worker names a part', () => {
    const index = titleIndex<typeof held>([]);
    index.add(held);
    expect(index.has(tmdb)).toBe(true);
  });
});

describe('a provider id before name and year', () => {
  // As the device held it on 2026-11-13 (Hardcover's year 30), and as Open Library's search answers.
  const kanon = {
    id: '588299c5', type: 'book', title: 'Der Kanon mechanischer Seelen', releaseDate: '0030', worldDate: '0030',
    links: providerLinks('openlibrary:OL21526941W hardcover:2257108'),
  };
  const fromOpenLibrary = { id: null, source: 'openlibrary', sourceId: 'OL21526941W', type: 'book', title: 'Der Kanon mechanischer Seelen', releaseDate: '2017' };

  it('matches a held title to the provider card of the same id, whatever year either says', () => {
    expect(titleIndex([kanon]).find(fromOpenLibrary)).toBe(kanon);
    expect(titleIndex([kanon]).has({ ...fromOpenLibrary, source: 'hardcover', sourceId: '2257108' })).toBe(true);
  });

  it('keeps the media type in the key: one provider number can be a film and a show', () => {
    const film = { id: 'f1', type: 'movie', title: 'Being John Malkovich', releaseDate: '1999', links: ['trakt:386'] };
    expect(titleIndex([film]).has({ id: null, source: 'trakt', sourceId: '386', type: 'show', title: 'SpongeBob SquarePants', releaseDate: '1999' })).toBe(false);
  });

  it('reads the SQL column, and reads nothing as no links', () => {
    expect(providerLinks('tmdb:603 trakt:481')).toEqual(['tmdb:603', 'trakt:481']);
    expect(providerLinks(null)).toBeUndefined();
    expect(providerLinks('')).toBeUndefined();
  });
});
