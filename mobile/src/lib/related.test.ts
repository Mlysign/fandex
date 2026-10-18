import { describe, expect, it } from 'vitest';
import { facetId as siteFacetId } from '@/lib/facets';
import type { ItemVector } from '~/lib/api';
import { facetId, prepareTaxonomy, resolveFacets, type ScoreFacet, type TaxonomyJson } from '~/lib/fandexScore';
import { franchiseCandidateIds, indexFacets, pickRelated } from '~/lib/related';

// The rankers are the site's and are tested there (similarItems, franchise).
// What is tested here is the index they are fed from, and that the two rails
// never show the same title.

const tag = (key: string): ScoreFacet => ({ kind: 'tag', key, label: key });
const ip = (key: string, label = key): ScoreFacet => ({ kind: 'ip', role: 'ip', key, label });
const person = (key: string): ScoreFacet => ({ kind: 'person', role: 'director', key, label: key });

const taxonomy = (over: Partial<TaxonomyJson> = {}) => prepareTaxonomy({
  tagCategories: [], tagCategoryOverrides: [], tagAliases: [], ipAliases: [], itemIpOverrides: [], facetLabels: [], scoring: null, ...over,
});

const vector = (id: string, over: Partial<ItemVector> = {}): ItemVector => ({
  id, type: 'movie', title: id, slug: id, posterUrl: null, backdropUrl: null, releaseDate: '2020-01-01', year: 2020,
  communityScore: 70, communityAvg: 70, communityVotes: 10, runtimeMinutes: 100, addedAt: 1, sources: [{ source: 'tmdb', sourceId: id }], ...over,
});

// Ten films nobody would confuse, so "noir" is rare and "drama" is not.
const filler = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, facets: [tag('drama')] }));
const ROWS = [
  { id: 'alien', facets: [ip('alien', 'Alien Collection'), tag('space'), tag('horror'), person('ridley scott')] },
  { id: 'aliens', facets: [ip('alien', 'Alien Collection'), tag('space'), tag('horror')] },
  { id: 'prometheus', facets: [ip('alien prequels', 'Alien Prequels'), tag('space'), person('ridley scott')] },
  { id: 'event horizon', facets: [tag('space'), tag('horror')] },
  { id: 'sunshine', facets: [tag('space'), tag('drama')] },
  { id: 'gladiator', facets: [person('ridley scott'), tag('drama')] },
  { id: 'the thing', facets: [tag('horror')] },
  ...filler,
];

describe('the facet index', () => {
  it('agrees with the site on what a facet is called', () => {
    for (const f of [tag('noir'), ip('alien'), person('ridley scott')]) expect(facetId(f)).toBe(siteFacetId(f as never));
  });

  it('lists the titles carrying a facet, in catalog order, each once', () => {
    const index = indexFacets([{ id: 'a', facets: [tag('noir'), tag('noir')] }, { id: 'b', facets: [tag('noir')] }], taxonomy());
    expect(index.size).toBe(2);
    expect(index.byFacet.get(facetId(tag('noir')))).toEqual([0, 1]);
  });

  it('reads facets the way the score does: bundled, attached and detached', () => {
    const tax = taxonomy({
      tagAliases: [['sci fi', 'science fiction']],
      ipAliases: [['alien prequels', 'alien']],
      itemIpOverrides: [
        { mediaItemId: 'x', ipKey: 'alien', label: 'Alien', mode: 'add', source: 'manual' },
        { mediaItemId: 'y', ipKey: 'alien', label: 'Alien', mode: 'remove', source: 'manual' },
      ],
    });
    const index = indexFacets([
      { id: 'p', facets: [ip('alien prequels'), tag('sci fi')] },
      { id: 'x', facets: [] },
      { id: 'y', facets: [ip('alien')] },
    ], tax);
    expect(index.byFacet.get(facetId(ip('alien')))).toEqual([0, 1]);
    expect(index.byFacet.get(facetId(tag('science fiction')))).toEqual([0]);
    expect(index.byFacet.has(facetId(tag('sci fi')))).toBe(false);
  });

  it('can be filled a chunk at a time', () => {
    const tax = taxonomy();
    const index = indexFacets(ROWS.slice(0, 3), tax);
    indexFacets(ROWS.slice(3), tax, index);
    expect(index).toEqual(indexFacets(ROWS, tax));
  });
});

describe('the two rails', () => {
  const tax = taxonomy();
  const index = indexFacets(ROWS, tax);
  const alien = ROWS[0];
  const vectors = new Map(['alien', 'aliens'].map((id) => [id, vector(id)]));

  it('names the titles whose vectors the franchise rail needs', () => {
    expect(franchiseCandidateIds(index, alien.facets).sort()).toEqual(['alien', 'aliens']);
  });

  it('puts the franchise in one rail and leaves it out of the other', () => {
    const picked = pickRelated({ id: 'alien', facets: alien.facets, index, vectors, tax });
    expect(picked.franchise).toEqual({ label: 'Alien', ids: ['aliens'] });
    expect(picked.similar).not.toContain('aliens');
    expect(picked.similar).not.toContain('alien');
  });

  it('ranks by shared facets, the rare ones counting for more', () => {
    const { similar } = pickRelated({ id: 'alien', facets: alien.facets, index, vectors, tax });
    // Space and the director first. These tags carry no category, so no genre
    // rule applies and the director counts most: Gladiator and Event Horizon
    // follow. A film sharing nothing is not there.
    expect(similar[0]).toBe('prometheus');
    expect(similar.slice(1, 3).sort()).toEqual(['event horizon', 'gladiator']);
    expect(similar).not.toContain('f0');
  });

  // 2026-10-17: the site's ranker gave Alien Saving Private Ryan and Top Gun,
  // through a bit-part actor and a one-off keyword.
  describe('what a person would call alike', () => {
    const genre = (key: string): ScoreFacet => ({ kind: 'tag', key, label: key, category: 'genre' });
    const keyword = (key: string): ScoreFacet => ({ kind: 'tag', key, label: key, category: 'other' });
    const cast = (key: string): ScoreFacet => ({ kind: 'person', role: 'cast', key, label: key });
    const extras = (n: number, from = 0) => Array.from({ length: n }, (_, i) => cast(`extra ${from + i}`));
    const rows = [
      { id: 'alien', type: 'movie', votes: 9000, facets: [genre('horror'), genre('science fiction'), person('ridley scott'), cast('sigourney weaver'), ...extras(6), keyword('countdown')] },
      { id: 'event horizon', type: 'movie', votes: 2000, facets: [genre('horror'), genre('science fiction'), keyword('space')] },
      // Shares a bit-part actor and a rare keyword, and no genre.
      { id: 'top gun', type: 'movie', votes: 9000, facets: [genre('action'), cast('extra 5'), keyword('countdown')] },
      // The same director, another genre.
      { id: 'gladiator', type: 'movie', votes: 9000, facets: [genre('action'), person('ridley scott')] },
      // Alike, and nobody has rated it.
      { id: 'obscure', type: 'movie', votes: 0, facets: [genre('horror'), genre('science fiction'), keyword('space')] },
      { id: 'alien isolation', type: 'game', votes: 3000, facets: [genre('horror'), genre('science fiction'), keyword('space')] },
      ...Array.from({ length: 20 }, (_, i) => ({ id: `d${i}`, type: 'movie', votes: 10, facets: [genre('drama')] })),
    ];
    const idx = indexFacets(rows, tax);
    const like = pickRelated({ id: 'alien', type: 'movie', facets: rows[0].facets, index: idx, vectors: new Map(), tax }).similar;

    it('needs a shared genre: an actor or a keyword in common is not enough', () => {
      expect(like).not.toContain('top gun');
      expect(like).not.toContain('gladiator');
    });

    it('puts the crowd-known title before an unknown one equally alike, and another medium after both', () => {
      expect(like).toEqual(['event horizon', 'obscure', 'alien isolation']);
    });

    it('counts a top-billed actor far above a bit part', () => {
      const r2 = [
        rows[0],
        { id: 'lead', type: 'movie', votes: 100, facets: [genre('horror'), cast('sigourney weaver')] },
        { id: 'extra', type: 'movie', votes: 100, facets: [genre('horror'), cast('extra 5')] },
        { id: 'third', type: 'movie', votes: 100, facets: [genre('horror'), keyword('nothing')] },
        ...rows.slice(6),
      ];
      const ranked = pickRelated({ id: 'alien', type: 'movie', facets: r2[0].facets, index: indexFacets(r2, tax), vectors: new Map(), tax }).similar;
      expect(ranked.indexOf('lead')).toBeLessThan(ranked.indexOf('extra'));
    });
  });

  it('is not emptied by facets only this title carries', () => {
    // Nine facets nobody else has: more than the eight the ranker looks at, and
    // each one rarer than anything shared. Left in, they take every place and
    // the rail comes back empty.
    const own = Array.from({ length: 9 }, (_, i) => person(`bit part ${i}`));
    const rows = [
      { id: 'x', facets: [...own, tag('space'), tag('horror')] },
      ...ROWS.filter((r) => r.id !== 'alien'),
    ];
    const idx = indexFacets(rows, tax);
    const { similar } = pickRelated({ id: 'x', facets: rows[0].facets, index: idx, vectors: new Map(), tax });
    expect(similar.slice(0, 2).sort()).toEqual(['aliens', 'event horizon']);
  });

  it('shows no similar rail for fewer than three titles, and no franchise rail for a franchise of one', () => {
    const rows = [{ id: 'a', facets: [ip('solo'), tag('odd')] }, { id: 'b', facets: [tag('odd')] }, { id: 'c', facets: [tag('other')] }];
    const small = indexFacets(rows, tax);
    expect(pickRelated({ id: 'a', facets: rows[0].facets, index: small, vectors: new Map([['a', vector('a')]]), tax })).toEqual({ series: null, franchise: null, similar: [] });
  });

  // 2026-10-18: "the franchise carousel of Harry Potter has so many entries and
  // it is not clear which books are the main book series".
  describe('the series rail', () => {
    const hp = (id: string, type: string, raw: string, year: number): { id: string; type: string; facets: ScoreFacet[] } =>
      ({ id, type, facets: [ip(raw, raw === 'harry potter' ? 'Harry Potter Collection' : 'Harry Potter'), tag('magic')] });
    // Seven books and eight films under the provider key; a game and a companion book attached by hand.
    const rows = [
      ...Array.from({ length: 7 }, (_, i) => hp(`book${i + 1}`, 'book', 'harry potter', 1997 + i)),
      ...Array.from({ length: 8 }, (_, i) => hp(`film${i + 1}`, 'movie', 'harry potter', 2001 + i)),
      { id: 'game', type: 'game', facets: [tag('magic')] },
      { id: 'companion', type: 'book', facets: [tag('magic')] },
    ];
    const tax = taxonomy({ itemIpOverrides: [
      { mediaItemId: 'game', ipKey: 'harry potter', label: 'Harry Potter', mode: 'add', source: 'manual' },
      { mediaItemId: 'companion', ipKey: 'harry potter', label: 'Harry Potter', mode: 'add', source: 'manual' },
    ] });
    const idx = indexFacets(rows, tax);
    const vectors = new Map(rows.map((r, i) => [r.id, vector(r.id, { type: r.type as never, releaseDate: `${1990 + i}-01-01` })]));
    const pick = (id: string) => pickRelated({ id, facets: resolveFacets(rows.find((r) => r.id === id)!.facets, id, tax), rawFacets: rows.find((r) => r.id === id)!.facets, index: idx, vectors, tax });

    it('is the provider series of this medium, oldest first, beside the whole franchise', () => {
      const picked = pick('book3');
      expect(picked.series).toEqual({ label: 'Harry Potter books', ids: ['book1', 'book2', 'book4', 'book5', 'book6', 'book7'] });
      // The franchise rail still holds everything: the films, the game and the companion book.
      expect(picked.franchise?.ids).toHaveLength(16);
      expect(picked.franchise?.ids).toContain('companion');
    });

    it('names a series inside a bigger franchise by its own name', () => {
      const dk = (id: string, year: number) => ({ id, type: 'movie', facets: [ip('the dark knight', 'The Dark Knight Collection')] });
      const bat = (id: string) => ({ id, type: 'movie', facets: [ip('batman', 'Batman Collection')] });
      const r = [dk('begins', 2005), dk('dark knight', 2008), dk('rises', 2012), bat('batman 89'), bat('returns'), bat('forever')];
      const bundled = taxonomy({ ipAliases: [['the dark knight', 'batman']] });
      const i2 = indexFacets(r, bundled);
      const v = new Map(r.map((x, n) => [x.id, vector(x.id, { releaseDate: `${2000 + n}-01-01` })]));
      const picked = pickRelated({ id: 'begins', facets: resolveFacets(r[0].facets, 'begins', bundled), rawFacets: r[0].facets, index: i2, vectors: v, tax: bundled });
      expect(picked.series).toEqual({ label: 'The Dark Knight series', ids: ['dark knight', 'rises'] });
      // The franchise rail is the whole bundle (its label is the item's own spelling until a name is chosen).
      expect(picked.franchise?.ids).toHaveLength(5);
    });

    it('is left out when it would repeat the franchise rail, or for fewer than three titles', () => {
      const r = [hp('a', 'movie', 'alien', 1979), hp('b', 'movie', 'alien', 1986), hp('c', 'movie', 'alien', 1992)];
      const i2 = indexFacets(r, taxonomy());
      const v = new Map(r.map((x) => [x.id, vector(x.id)]));
      expect(pickRelated({ id: 'a', facets: r[0].facets, rawFacets: r[0].facets, index: i2, vectors: v, tax: taxonomy() }).series).toBeNull();
      expect(pick('game').series).toBeNull();
    });
  });

  it('bundling two franchises makes one rail of both', () => {
    const bundled = taxonomy({ ipAliases: [['alien prequels', 'alien']] });
    const idx = indexFacets(ROWS, bundled);
    const v = new Map(['alien', 'aliens', 'prometheus'].map((id, i) => [id, vector(id, { releaseDate: `201${i}-01-01` })]));
    const picked = pickRelated({ id: 'alien', facets: alien.facets, index: idx, vectors: v, tax: bundled });
    // Newest first.
    expect(picked.franchise?.ids).toEqual(['prometheus', 'aliens']);
    expect(picked.similar).not.toContain('prometheus');
  });
});
