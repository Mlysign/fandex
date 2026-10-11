import { describe, expect, it } from 'vitest';
import { facetId as siteFacetId } from '@/lib/facets';
import type { ItemVector } from '~/lib/api';
import { facetId, prepareTaxonomy, type ScoreFacet, type TaxonomyJson } from '~/lib/fandexScore';
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
    const picked = pickRelated({ id: 'alien', facets: alien.facets, index, vectors });
    expect(picked.franchise).toEqual({ label: 'Alien', ids: ['aliens'] });
    expect(picked.similar).not.toContain('aliens');
    expect(picked.similar).not.toContain('alien');
  });

  it('ranks by shared facets, the rare ones counting for more', () => {
    const { similar } = pickRelated({ id: 'alien', facets: alien.facets, index, vectors });
    // Space and the director: two rare facets. Then space and horror. A film
    // sharing only one comes after, and one sharing nothing is not there.
    expect(similar.slice(0, 2)).toEqual(['prometheus', 'event horizon']);
    expect(similar).toContain('gladiator');
    expect(similar).not.toContain('f0');
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
    const { similar } = pickRelated({ id: 'x', facets: rows[0].facets, index: idx, vectors: new Map() });
    expect(similar.slice(0, 2).sort()).toEqual(['aliens', 'event horizon']);
  });

  it('shows no similar rail for fewer than three titles, and no franchise rail for a franchise of one', () => {
    const rows = [{ id: 'a', facets: [ip('solo'), tag('odd')] }, { id: 'b', facets: [tag('odd')] }, { id: 'c', facets: [tag('other')] }];
    const small = indexFacets(rows, tax);
    expect(pickRelated({ id: 'a', facets: rows[0].facets, index: small, vectors: new Map([['a', vector('a')]]) })).toEqual({ franchise: null, similar: [] });
  });

  it('bundling two franchises makes one rail of both', () => {
    const bundled = taxonomy({ ipAliases: [['alien prequels', 'alien']] });
    const idx = indexFacets(ROWS, bundled);
    const v = new Map(['alien', 'aliens', 'prometheus'].map((id, i) => [id, vector(id, { releaseDate: `201${i}-01-01` })]));
    const picked = pickRelated({ id: 'alien', facets: alien.facets, index: idx, vectors: v });
    // Newest first.
    expect(picked.franchise?.ids).toEqual(['prometheus', 'aliens']);
    expect(picked.similar).not.toContain('prometheus');
  });
});
