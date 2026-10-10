import { describe, expect, it } from 'vitest';
import type { SQLiteDatabase } from 'expo-sqlite';
import type { TaxonomyJson } from '~/lib/fandexScore';
import { buildTagRows, filterTagRows, rawTagCounts } from '~/lib/tagVocab';

const tag = (key: string, label: string, category?: string) => ({ kind: 'tag', key, label, category });

/** A catalog of four titles. Two spellings of science fiction, on one title together. */
const CATALOG = [
  [tag('sci-fi', 'Sci-Fi', 'genre'), tag('science fiction', 'Science Fiction', 'genre'), tag('dark', 'Dark', 'mood')],
  [tag('sci-fi', 'Sci-Fi', 'genre'), { kind: 'person', key: 'ridley scott', label: 'Ridley Scott' }],
  [tag('science fiction', 'Science Fiction', 'genre'), tag('dark', 'Dark', 'mood')],
  [tag('cozy', 'Cozy')],
];

const db = { getAllAsync: async () => CATALOG.map((f) => ({ facets: JSON.stringify(f) })) } as unknown as SQLiteDatabase;

const taxonomy = (over: Partial<TaxonomyJson> = {}): TaxonomyJson => ({
  tagCategories: [], tagCategoryOverrides: [], tagAliases: [], ipAliases: [], itemIpOverrides: [], facetLabels: [], scoring: null, ...over,
});

describe('the tag vocabulary', () => {
  it('counts each spelling once per title, tags only', async () => {
    const raw = await rawTagCounts(db);
    expect(raw.get('sci-fi')).toMatchObject({ count: 2, category: 'genre' });
    expect(raw.get('cozy')).toMatchObject({ count: 1, category: 'other' });
    expect(raw.has('ridley scott')).toBe(false);
  });

  it('lists every tag by frequency when nothing is bundled', async () => {
    const rows = buildTagRows(await rawTagCounts(db), taxonomy());
    expect(rows.map((r) => [r.key, r.count])).toEqual([['dark', 2], ['sci-fi', 2], ['science fiction', 2], ['cozy', 1]]);
  });

  it('folds a spelling into its canonical tag and counts a title carrying both once', async () => {
    const rows = buildTagRows(await rawTagCounts(db), taxonomy({ tagAliases: [['sci-fi', 'science fiction']] }));
    const sf = rows.find((r) => r.key === 'science fiction')!;
    // Three titles carry one spelling or the other. Their sum would say four.
    expect(sf.count).toBe(3);
    expect(sf.aka).toEqual([{ key: 'sci-fi', label: 'Sci-Fi', count: 2 }]);
    expect(rows.some((r) => r.key === 'sci-fi')).toBe(false);
  });

  it('shows the category and the name chosen by hand, and says they were chosen', async () => {
    const rows = buildTagRows(await rawTagCounts(db), taxonomy({
      tagCategoryOverrides: [['dark', 'theme']],
      facetLabels: [['tag', 'dark', 'Dark & Gritty'], ['ip', 'dark', 'not a tag']],
    }));
    expect(rows.find((r) => r.key === 'dark')).toMatchObject({ category: 'theme', overridden: true, label: 'Dark & Gritty', labelOverridden: true });
    expect(rows.find((r) => r.key === 'cozy')).toMatchObject({ category: 'other', overridden: false, labelOverridden: false });
  });

  it('keeps a canonical that no title carries under that exact spelling', async () => {
    const rows = buildTagRows(await rawTagCounts(db), taxonomy({ tagAliases: [['sci-fi', 'sf'], ['science fiction', 'sf']] }));
    expect(rows.find((r) => r.key === 'sf')).toMatchObject({ count: 3, category: 'genre', label: 'Sci-Fi' });
  });

  it('filters by category and by a term that also matches a folded spelling', async () => {
    const rows = buildTagRows(await rawTagCounts(db), taxonomy({ tagAliases: [['sci-fi', 'science fiction']] }));
    expect(filterTagRows(rows, 'mood', '').map((r) => r.key)).toEqual(['dark']);
    expect(filterTagRows(rows, '', 'sci-fi').map((r) => r.key)).toEqual(['science fiction']);
    expect(filterTagRows(rows, 'mood', 'sci')).toEqual([]);
  });
});
