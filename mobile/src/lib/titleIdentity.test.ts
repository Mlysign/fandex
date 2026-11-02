import { describe, expect, it } from 'vitest';
import { titleIndex, titleKeys } from '~/lib/titleIdentity';

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
