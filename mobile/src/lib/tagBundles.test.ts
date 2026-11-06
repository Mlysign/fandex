import { describe, expect, it } from 'vitest';
import { buildProfile, prepareTaxonomy, type RatedTitle, type ScoreFacet, type TaxonomyJson } from './fandexScore';
import { pageImpacts } from './facetImpact';
import { foldTag, tagPageKeys } from './tagBundles';

const json = (over: Partial<TaxonomyJson> = {}): TaxonomyJson => ({
  tagCategories: [{ id: 'genre', label: 'Genre', color: '#fff', weight: 1, ignored: 0, sortOrder: 0 }],
  tagCategoryOverrides: [], tagAliases: [], ipAliases: [], itemIpOverrides: [], facetLabels: [],
  scoring: { version: 1, config: { priorStrength: 2, mappingConstantUp: 10, mappingConstantDown: 4 } },
  ...over,
});
const tax = prepareTaxonomy(json({ tagAliases: [['action & adventure', 'action adventure'], ['action/adventure', 'action adventure']] }));
const tag = (key: string, label = key): ScoreFacet => ({ kind: 'tag', key, label, category: 'genre' });

describe('a tag page gathers every bundled spelling (0.3.37)', () => {
  it('looks for the canonical tag and each spelling bundled into it', () => {
    const page = tagPageKeys('action adventure', tax);
    expect(page.key).toBe('action adventure');
    expect(page.members.sort()).toEqual(['action & adventure', 'action adventure', 'action/adventure']);
    expect(page.spoken.has('action & adventure')).toBe(true);
  });

  it("opens a bundled spelling's address on the tag it is bundled into", () => {
    const page = tagPageKeys('action & adventure', tax);
    expect(page.key).toBe('action adventure');
    expect(page.members).toContain('action/adventure');
  });

  it('is the one spelling with no taxonomy, or no bundle', () => {
    expect(tagPageKeys('fantasy', null)).toMatchObject({ key: 'fantasy', members: ['fantasy'] });
    expect(tagPageKeys('fantasy', tax).members).toEqual(['fantasy']);
  });

  it('counts the same titles the impact learned from', () => {
    // Game of Thrones carries only TMDB's "Action & Adventure"; the impact counts it under the canonical tag.
    const library: RatedTitle[] = [
      { id: 'got', rating: 9, facets: [tag('action & adventure', 'Action & Adventure')] },
      { id: 'tlou', rating: 8, facets: [tag('action adventure', 'Action-Adventure')] },
      { id: 'both', rating: 7, facets: [tag('action adventure'), tag('action/adventure')] },
      ...Array.from({ length: 12 }, (_, i): RatedTitle => ({ id: `x${i}`, rating: 5, facets: [tag('drama')] })),
    ];
    const page = tagPageKeys('action adventure', tax);
    const onPage = library.filter((r) => r.facets.some((f) => page.spoken.has(f.key)));
    const [impact] = pageImpacts('tag', page.key, buildProfile(library, tax), tax);
    expect(onPage.map((r) => r.id)).toEqual(['got', 'tlou', 'both']);
    expect(impact.ratedCount).toBe(onPage.length);
  });
});

describe('Insights folds a bundled spelling into its tag (0.3.37)', () => {
  it('files a spelling under the canonical key', () => {
    expect(foldTag(tag('action & adventure', 'Action & Adventure'), tax)).toMatchObject({ key: 'action adventure', label: 'Action & Adventure' });
  });
  it('uses a chosen name when there is one', () => {
    const named = prepareTaxonomy(json({ tagAliases: [['sci fi', 'science fiction']], facetLabels: [['tag', 'science fiction', 'Sci-Fi']] }));
    expect(foldTag(tag('sci fi'), named)).toMatchObject({ key: 'science fiction', label: 'Sci-Fi' });
    expect(foldTag(tag('science fiction'), named)).toMatchObject({ key: 'science fiction', label: 'Sci-Fi' });
  });
  it('leaves an unbundled tag, a person and a missing taxonomy alone', () => {
    const plain = tag('drama');
    expect(foldTag(plain, tax)).toBe(plain);
    const person = { kind: 'person', key: 'action & adventure', label: 'x' };
    expect(foldTag(person, tax)).toBe(person);
    expect(foldTag(tag('action & adventure'), null).key).toBe('action & adventure');
  });
});
