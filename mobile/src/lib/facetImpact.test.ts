import { describe, expect, it } from 'vitest';
import { pageImpacts } from './facetImpact';
import { buildProfile, computeFandexScore, prepareTaxonomy, type RatedTitle, type ScoreFacet, type TaxonomyJson } from './fandexScore';

const json = (over: Partial<TaxonomyJson> = {}): TaxonomyJson => ({
  tagCategories: [
    { id: 'genre', label: 'Genre', color: '#fff', weight: 1, ignored: 0, sortOrder: 0 },
    { id: 'setting', label: 'Setting', color: '#fff', weight: 2, ignored: 0, sortOrder: 1 },
    { id: 'meta', label: 'Meta', color: '#fff', weight: 0, ignored: 1, sortOrder: 2 },
  ],
  tagCategoryOverrides: [], tagAliases: [], ipAliases: [], itemIpOverrides: [], facetLabels: [],
  scoring: { version: 1, config: { priorStrength: 2, mappingConstantUp: 10, mappingConstantDown: 4 } },
  ...over,
});
const tag = (key: string, category = 'genre'): ScoreFacet => ({ kind: 'tag', key, label: key, category });
const person = (role: string, key: string): ScoreFacet => ({ kind: 'person', role, key, label: key });
const rated = (id: string, rating: number, facets: ScoreFacet[]): RatedTitle => ({ id, rating, facets });

const library: RatedTitle[] = [
  rated('a', 10, [tag('steampunk', 'setting'), person('director', 'denis-villeneuve'), person('writer', 'denis-villeneuve')]),
  rated('b', 9, [tag('steampunk', 'setting'), person('director', 'denis-villeneuve')]),
  rated('c', 3, [tag('musical'), person('writer', 'denis-villeneuve')]),
  rated('d', 2, [tag('musical'), tag('pc', 'meta')]),
];

describe("a facet page's Fandex impact", () => {
  it('is the number the item page prints for the same tag', () => {
    const tax = prepareTaxonomy(json());
    const profile = buildProfile(library, tax);
    const [row] = pageImpacts('tag', 'steampunk', profile, tax);
    const onATitle = computeFandexScore([tag('steampunk', 'setting')], 'x', profile, tax)!.reasons[0];
    expect(row.points).toBe(onATitle.impact);
    expect(row.points).toBe(onATitle.contribution);
    // The category weight is in it: a setting counts double here.
    expect(row.points).toBeCloseTo(10 * 2 * (profile.meta.get('tag||steampunk')!.BA - profile.baseline), 1);
    expect(row).toMatchObject({ direction: 'up', ratedCount: 2 });
  });

  it('uses the downward gain for a tag you rate below your average', () => {
    const tax = prepareTaxonomy(json());
    const profile = buildProfile(library, tax);
    const [row] = pageImpacts('tag', 'musical', profile, tax);
    expect(row.direction).toBe('down');
    expect(row.points).toBeCloseTo(4 * (profile.meta.get('tag||musical')!.BA - profile.baseline), 1);
  });

  it('gives a person one row per role, and matches a key stored with hyphens', () => {
    const tax = prepareTaxonomy(json());
    const rows = pageImpacts('person', 'denis villeneuve', buildProfile(library, tax), tax);
    expect(rows.map((r) => r.role).sort()).toEqual(['director', 'writer']);
    expect(Math.abs(rows[0].points)).toBeGreaterThanOrEqual(Math.abs(rows[1].points));
  });

  it("reads a bundled tag's canonical entry from a member spelling's page", () => {
    const tax = prepareTaxonomy(json({ tagAliases: [['steam-punk', 'steampunk']] }));
    const profile = buildProfile(library, tax);
    expect(pageImpacts('tag', 'steam punk', profile, tax)).toEqual(pageImpacts('tag', 'steampunk', profile, tax));
  });

  it('is empty for an ignored category, an unrated facet, and a profile too small to score', () => {
    const tax = prepareTaxonomy(json());
    const profile = buildProfile(library, tax);
    expect(pageImpacts('tag', 'pc', profile, tax)).toEqual([]);
    expect(pageImpacts('tag', 'western', profile, tax)).toEqual([]);
    expect(pageImpacts('company', 'steampunk', profile, tax)).toEqual([]);
    expect(pageImpacts('tag', 'steampunk', buildProfile(library.slice(0, 2), tax), tax)).toEqual([]);
  });
});
