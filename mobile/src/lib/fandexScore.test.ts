import { describe, expect, it } from 'vitest';
import { buildProfile, computeFandexScore, prepareTaxonomy, resolveFacets, type RatedTitle, type ScoreFacet, type TaxonomyJson } from './fandexScore';

// Agreement with the site over a real library is scripts/probe-app-score.mjs's
// job (4,559 of 4,559 identical on 2026-10-04). These pin the rules a change
// here is most likely to break without that script being run.

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
