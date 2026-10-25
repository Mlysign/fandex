import { describe, expect, it } from 'vitest';
import { buildProfile, catalogCountsFrom, computeFandexScore, prepareTaxonomy, resolveFacets, softRange, type RatedTitle, type ScoreFacet, type TaxonomyJson } from './fandexScore';

// The old site's agreement probe went with the site (tag `old-site-final`), and
// since 2026-10-23 the app departs from it on purpose. These pin the rules a
// change here is most likely to break.

const json = (over: Partial<TaxonomyJson> = {}): TaxonomyJson => ({
  tagCategories: [
    { id: 'genre', label: 'Genre', color: '#fff', weight: 1, ignored: 0, sortOrder: 0 },
    { id: 'meta', label: 'Meta', color: '#fff', weight: 0, ignored: 1, sortOrder: 1 },
  ],
  tagCategoryOverrides: [], tagAliases: [], ipAliases: [], itemIpOverrides: [], facetLabels: [],
  scoring: { version: 1, config: { priorStrength: 2, mappingConstantUp: 10, mappingConstantDown: 10 } },
  ...over,
});
const tag = (key: string, category = 'genre'): ScoreFacet => ({ kind: 'tag', key, label: key, category });
const director = (key: string): ScoreFacet => ({ kind: 'person', role: 'director', key, label: key });
const rated = (id: string, rating: number, facets: ScoreFacet[]): RatedTitle => ({ id, rating, facets });

const library: RatedTitle[] = [
  rated('a', 10, [tag('noir'), director('villeneuve')]),
  rated('b', 9, [tag('noir')]),
  rated('c', 3, [tag('musical')]),
  rated('d', 2, [tag('musical'), tag('pc', 'meta')]),
];

describe('the Fandex Score on the device', () => {
  it('centres on your own average and moves with what you like and dislike', () => {
    const tax = prepareTaxonomy(json());
    const profile = buildProfile(library, tax);
    expect(profile.baseline).toBe(6);
    const liked = computeFandexScore([tag('noir')], 'x', profile, tax)!;
    const disliked = computeFandexScore([tag('musical')], 'y', profile, tax)!;
    expect(liked.center).toBe(60);
    expect(liked.score).toBeGreaterThan(60);
    expect(disliked.score).toBeLessThan(60);
    // The breakdown IS the computation: centre plus the contributions is the score.
    expect(liked.center + liked.reasons.reduce((n, r) => n + r.contribution, 0)).toBeCloseTo(liked.score, 1);
  });

  it('scores a title you rated as if you had not rated it', () => {
    const tax = prepareTaxonomy(json());
    const lib = [...library, rated('e', 8, [tag('noir'), director('villeneuve')])];
    const left = computeFandexScore(lib[0].facets, 'a', buildProfile(lib, tax), tax)!;
    // The same as a profile that never held title a, to the tenth, breakdown included.
    const without = computeFandexScore(lib[0].facets, 'a', buildProfile(lib.slice(1), tax), tax)!;
    expect(left.score).toBe(without.score);
    expect(left.center).toBe(without.center);
    expect(left.reasons.map((r) => [r.label, r.contribution, r.n])).toEqual(without.reasons.map((r) => [r.label, r.contribution, r.n]));
    // A facet only that title carried says nothing about it.
    const solo = computeFandexScore([tag('noir'), tag('heist')], 'z', buildProfile([...lib, rated('z', 10, [tag('heist')])], tax), tax)!;
    expect(solo.reasons.map((r) => r.label)).toEqual(['noir']);
  });

  it('never passes 100 or 0, and leaves an ordinary score as it was', () => {
    const tax = prepareTaxonomy(json({ scoring: { version: 1, config: { priorStrength: 0.1, mappingConstantUp: 80, mappingConstantDown: 80 } } }));
    const lib = [rated('a', 10, [tag('noir')]), rated('b', 10, [tag('noir')]), rated('c', 1, [tag('musical')]), rated('d', 1, [tag('musical')])];
    const profile = buildProfile(lib, tax);
    const high = computeFandexScore([tag('noir')], 'x', profile, tax)!;
    const low = computeFandexScore([tag('musical')], 'y', profile, tax)!;
    expect(high.score).toBeLessThanOrEqual(100);
    expect(high.score).toBeGreaterThan(90);
    expect(low.score).toBeGreaterThanOrEqual(0);
    expect(low.score).toBeLessThan(10);
    // Bent, the breakdown still adds up.
    expect(high.center + high.reasons.reduce((n, r) => n + r.contribution, 0)).toBeCloseTo(high.score, 0);
  });

  it('gives no score below three rated titles, or when nothing matches', () => {
    const tax = prepareTaxonomy(json());
    expect(computeFandexScore([tag('noir')], 'x', buildProfile(library.slice(0, 2), tax), tax)).toBeNull();
    expect(computeFandexScore([tag('western')], 'x', buildProfile(library, tax), tax)).toBeNull();
  });

  it('leaves an ignored category out of the profile entirely', () => {
    const tax = prepareTaxonomy(json());
    expect(buildProfile(library, tax).w.has('tag||pc')).toBe(false);
  });

  it('counts only the strongest few tags and shows the rest as not counted', () => {
    const tax = prepareTaxonomy(json({ scoring: { version: 1, config: { topTagsPositive: 1 } } }));
    const lib = [rated('a', 10, [tag('noir'), tag('heist')]), rated('b', 10, [tag('noir')]), rated('c', 2, [tag('musical')])];
    const fx = computeFandexScore([tag('noir'), tag('heist')], 'x', buildProfile(lib, tax), tax)!;
    expect(fx.reasons.filter((r) => !r.capped).map((r) => r.label)).toEqual(['noir']);
    expect(fx.reasons.find((r) => r.label === 'heist')).toMatchObject({ capped: true, contribution: 0 });
  });

  it('learns and scores a bundled tag under one key', () => {
    const tax = prepareTaxonomy(json({ tagAliases: [['film-noir', 'noir']] }));
    const profile = buildProfile([...library, rated('e', 10, [tag('film-noir')])], tax);
    expect(profile.meta.get('tag||noir')?.n).toBe(3);
    expect(computeFandexScore([tag('film-noir')], 'x', profile, tax)).not.toBeNull();
  });

  it('attaches and detaches a franchise per title', () => {
    const tax = prepareTaxonomy(json({
      itemIpOverrides: [
        { mediaItemId: 'x', ipKey: 'dune', label: 'Dune', mode: 'add', source: 'manual' },
        { mediaItemId: 'y', ipKey: 'alien', label: 'Alien', mode: 'remove', source: 'manual' },
      ],
    }));
    expect(resolveFacets([], 'x', tax)).toEqual([{ kind: 'ip', role: 'ip', key: 'dune', label: 'Dune' }]);
    expect(resolveFacets([{ kind: 'ip', role: 'ip', key: 'alien', label: 'Alien' }], 'y', tax)).toEqual([]);
  });

  it('weights a director by the stored role weight, with the default for a role the stored config lacks', () => {
    const tax = prepareTaxonomy(json({ scoring: { version: 1, config: { roleWeights: { director: 2 } } } }));
    expect(tax.config.roleWeights.director).toBe(2);
    expect(tax.config.roleWeights.ip).toBe(1.3);
    expect(buildProfile(library, tax).meta.get('person|director|villeneuve')?.classWeight).toBe(2);
  });
});

describe('the pull axis', () => {
  // A catalog of twenty titles: eight noir, four musicals, eight westerns. You
  // have been through six of the noirs, every musical, and one western.
  const catalogRows = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: `n${i}`, facets: [tag('noir')] })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `m${i}`, facets: [tag('musical')] })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `w${i}`, facets: [tag('western')] })),
  ];
  const consumed = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `n${i}`, facets: [tag('noir')], weight: 1 })),
    ...Array.from({ length: 4 }, (_, i) => ({ id: `m${i}`, facets: [tag('musical')], weight: 1 })),
    { id: 'w0', facets: [tag('western')], weight: 1 },
  ];
  // A gain high enough for twenty titles to move a band; the shipped one is sized for thousands.
  const strongPull = () => prepareTaxonomy(json({ scoring: { version: 1, config: { priorStrength: 2, mappingConstantUp: 10, mappingConstantDown: 10, pullGain: 40 } } }));
  const lib: RatedTitle[] = [
    rated('n0', 10, [tag('noir')]), rated('n1', 9, [tag('noir')]),
    rated('m0', 3, [tag('musical')]), rated('m1', 2, [tag('musical')]),
    rated('w0', 10, [tag('western')]), rated('w1', 9, [tag('western')]),
  ];

  it('reads a facet you consume beyond your usual share as pull, and one you avoid as the reverse', () => {
    const tax = strongPull();
    const profile = buildProfile(lib, tax, { consumed, catalog: catalogCountsFrom(catalogRows, tax) });
    // Your usual share is 11 of 20; every musical is more than that, one western in eight is less.
    const musical = computeFandexScore([tag('musical')], 'x', profile, tax)!;
    const western = computeFandexScore([tag('western')], 'y', profile, tax)!;
    expect(musical.pull!.points).toBeGreaterThan(0);
    expect(western.pull!.points).toBeLessThan(0);
    const row = musical.reasons.find((r) => r.axis === 'pull')!;
    expect(row).toMatchObject({ label: 'musical', consumed: 4, catalog: 4 });
    // Both axes are rows of one sum: the centre plus every counted row is the score (each row is printed to a tenth, so the rows may be a tenth off together).
    expect(Math.abs(musical.center + musical.reasons.reduce((n, r) => n + r.contribution, 0) - musical.score)).toBeLessThan(0.15);
    expect(Math.abs(musical.taste.points + musical.pull!.points - (musical.score - musical.center))).toBeLessThan(0.15);
  });

  it('leaves your own place in the counts out when scoring a title you hold', () => {
    const tax = strongPull();
    const profile = buildProfile(lib, tax, { consumed, catalog: catalogCountsFrom(catalogRows, tax) });
    const held = computeFandexScore([tag('noir')], 'n0', profile, tax)!.reasons.find((r) => r.axis === 'pull')!;
    const unseen = computeFandexScore([tag('noir')], 'n7', profile, tax)!.reasons.find((r) => r.axis === 'pull')!;
    expect(held.consumed).toBe(5);
    expect(held.catalog).toBe(7);
    expect(unseen.consumed).toBe(6);
    expect(unseen.catalog).toBe(8);
  });

  it('lets a follow set a facet to the maximum and an avoid to the minimum', () => {
    const tax = strongPull();
    const plain = buildProfile(lib, tax, { consumed, catalog: catalogCountsFrom(catalogRows, tax) });
    const followed = buildProfile(lib, tax, { consumed, catalog: catalogCountsFrom(catalogRows, tax), follows: new Map([['tag||western', 'follow']]) });
    const avoided = buildProfile(lib, tax, { consumed, catalog: catalogCountsFrom(catalogRows, tax), follows: new Map([['tag||noir', 'avoid']]) });
    expect(computeFandexScore([tag('western')], 'y', followed, tax)!.pull!.points).toBeGreaterThan(computeFandexScore([tag('western')], 'y', plain, tax)!.pull!.points);
    expect(computeFandexScore([tag('western')], 'y', followed, tax)!.reasons.find((r) => r.axis === 'pull')).toMatchObject({ followed: 'follow' });
    expect(computeFandexScore([tag('noir')], 'x', avoided, tax)!.pull!.points).toBeLessThan(0);
    // A follow moves pull only: the taste row is the one it was, and so is its band.
    const tasteRow = (fx: ReturnType<typeof computeFandexScore>) => fx!.reasons.find((r) => r.axis === 'taste')!;
    expect(tasteRow(computeFandexScore([tag('western')], 'y', followed, tax)).impact).toBe(tasteRow(computeFandexScore([tag('western')], 'y', plain, tax)).impact);
    expect(computeFandexScore([tag('western')], 'y', followed, tax)!.taste.band).toBe(computeFandexScore([tag('western')], 'y', plain, tax)!.taste.band);
  });

  it('names the label from where the two axes land, and from taste alone without a catalog', () => {
    const tax = strongPull();
    const profile = buildProfile(lib, tax, { consumed, catalog: catalogCountsFrom(catalogRows, tax) });
    expect(computeFandexScore([tag('noir')], 'x', profile, tax)!.label).toBe('sure-thing');
    expect(computeFandexScore([tag('musical')], 'x', profile, tax)!.label).toBe('bycatch');
    expect(computeFandexScore([tag('western')], 'y', profile, tax)!.label).toBe('hidden-gem');
    const noCatalog = buildProfile(lib, tax);
    expect(computeFandexScore([tag('noir')], 'x', noCatalog, tax)!.pull).toBeNull();
    expect(computeFandexScore([tag('noir')], 'x', noCatalog, tax)!.label).toBe('sure-thing');
    expect(computeFandexScore([tag('musical')], 'x', noCatalog, tax)!.label).toBe('not-for-you');
  });

  it('weighs a medium\'s pull by its own weight', () => {
    const tax = prepareTaxonomy(json({ scoring: { version: 1, config: { pullGain: 30, pullWeight: { game: 0.5 } } } }));
    const profile = buildProfile(lib, tax, { consumed, catalog: catalogCountsFrom(catalogRows, tax) });
    const film = computeFandexScore([tag('musical')], 'x', profile, tax, 'movie')!;
    const game = computeFandexScore([tag('musical')], 'x', profile, tax, 'game')!;
    expect(game.pull!.points).toBeCloseTo(film.pull!.points / 2, 0);
  });
});

describe('the medium offset', () => {
  it('moves each medium\'s ratings to your overall average before a facet learns from them', () => {
    const tax = prepareTaxonomy(json());
    // You rate games 8 and films 6. Without the offset "arcade" reads as a taste and "drama" as a dislike; with it both are just the medium.
    const games = [rated('g1', 8, [tag('arcade')]), rated('g2', 8, [tag('arcade')])];
    const films = [rated('f1', 6, [tag('drama')]), rated('f2', 6, [tag('drama')])];
    const plain = buildProfile([...games, ...films], tax);
    expect(plain.w.get('tag||arcade')).toBeGreaterThan(0);
    const offset = buildProfile([...games.map((r) => ({ ...r, type: 'game' })), ...films.map((r) => ({ ...r, type: 'movie' }))], tax);
    expect(offset.w.get('tag||arcade')).toBeCloseTo(0, 6);
    expect(offset.w.get('tag||drama')).toBeCloseTo(0, 6);
    // The centre does not move: the moved ratings still average what your ratings average.
    expect(offset.baseline).toBeCloseTo(plain.baseline, 6);
    expect(offset.typeMeans.get('game')).toBe(8);
  });
});

describe('the soft range', () => {
  it('is the identity up to halfway to the edge, then bends toward it and never reaches it', () => {
    expect(softRange(70, 10)).toBe(10);
    expect(softRange(70, 15)).toBe(15);
    expect(softRange(70, 30)).toBeLessThan(30);
    expect(softRange(70, 30)).toBeGreaterThan(softRange(70, 20));
    expect(70 + softRange(70, 500)).toBeLessThanOrEqual(100);
    expect(70 + softRange(70, -500)).toBeGreaterThanOrEqual(0);
    expect(softRange(70, -35)).toBe(-35);
  });
});
