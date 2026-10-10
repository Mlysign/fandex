import { describe, expect, it } from 'vitest';
import type { TaxonomyJson } from '~/lib/fandexScore';
import { suggestFranchisesByTitle, surveyFranchises, type CatalogTitle } from '~/lib/ipSurvey';

const ip = (key: string, label: string) => ({ key, label });

const TITLES: CatalogTitle[] = [
  { id: 'a', title: 'Alien', type: 'movie', ips: [ip('alien', 'Alien Collection')] },
  { id: 'b', title: 'Aliens', type: 'movie', ips: [ip('alien', 'Alien Collection')] },
  { id: 'c', title: 'Alien: Isolation', type: 'game', ips: [ip('alien franchise', 'Alien Franchise')] },
  { id: 'd', title: 'Blade Runner', type: 'movie', ips: [ip('blade runner', 'Blade Runner Collection')] },
  { id: 'e', title: 'Blade Runner 2049', type: 'movie', ips: [] },
  { id: 'f', title: 'Alien: Earth', type: 'show', ips: [] },
];

const taxonomy = (over: Partial<TaxonomyJson> = {}): TaxonomyJson => ({
  tagCategories: [], tagCategoryOverrides: [], tagAliases: [], ipAliases: [], itemIpOverrides: [], facetLabels: [], scoring: null, ...over,
});

const row = (rows: ReturnType<typeof surveyFranchises>, key: string) => rows.find((r) => r.key === key);

describe('the franchise survey', () => {
  it('groups titles by the franchise their providers gave them, biggest first', () => {
    const rows = surveyFranchises(TITLES, taxonomy());
    expect(rows.map((r) => [r.key, r.members.length])).toEqual([['alien', 2], ['alien franchise', 1], ['blade runner', 1]]);
    expect(row(rows, 'alien')).toMatchObject({ label: 'Alien Collection', types: ['movie'], aliases: [] });
  });

  it('folds a bundled franchise into its canonical one', () => {
    const rows = surveyFranchises(TITLES, taxonomy({ ipAliases: [['alien franchise', 'alien']] }));
    const alien = row(rows, 'alien')!;
    expect(alien.members.map((m) => m.mediaItemId)).toEqual(['a', 'c', 'b']);
    expect(alien.types).toEqual(['game', 'movie']);
    expect(alien.aliases).toEqual(['alien franchise']);
    expect(row(rows, 'alien franchise')).toBeUndefined();
  });

  it('adds a title attached by hand and drops one detached by hand', () => {
    const rows = surveyFranchises(TITLES, taxonomy({
      itemIpOverrides: [
        { mediaItemId: 'f', ipKey: 'alien', label: 'Alien', mode: 'add', source: 'manual' },
        { mediaItemId: 'b', ipKey: 'alien', label: 'Alien', mode: 'remove', source: 'manual' },
      ],
    }));
    const alien = row(rows, 'alien')!;
    expect(alien.members).toEqual([
      { mediaItemId: 'a', title: 'Alien', type: 'movie', source: 'provider' },
      { mediaItemId: 'f', title: 'Alien: Earth', type: 'show', source: 'manual' },
    ]);
  });

  it('shows the chosen name and keeps the providers one for the reset', () => {
    const rows = surveyFranchises(TITLES, taxonomy({ facetLabels: [['ip', 'alien', 'Alien'], ['tag', 'alien', 'not a franchise']] }));
    expect(row(rows, 'alien')).toMatchObject({ label: 'Alien', rawLabel: 'Alien Collection', labelOverridden: true });
    expect(row(rows, 'blade runner')).toMatchObject({ labelOverridden: false });
  });
});

describe('franchise suggestions by title', () => {
  it('offers a title that starts with a known franchise of two words or more', () => {
    const out = suggestFranchisesByTitle(TITLES, taxonomy());
    expect(out).toEqual([{ mediaItemId: 'e', title: 'Blade Runner 2049', type: 'movie', ipKey: 'blade runner', ipLabel: 'Blade Runner Collection', match: 'prefix' }]);
  });

  it('does not offer a one-word prefix, and offers an exact name of four letters or more', () => {
    const titles: CatalogTitle[] = [...TITLES, { id: 'g', title: 'Alien', type: 'game', ips: [] }];
    const out = suggestFranchisesByTitle(titles, taxonomy());
    // "Alien: Earth" starts with the one-word franchise "alien": too loose to suggest.
    expect(out.some((s) => s.mediaItemId === 'f')).toBe(false);
    expect(out.find((s) => s.mediaItemId === 'g')).toMatchObject({ ipKey: 'alien', match: 'exact' });
  });

  it('leaves out a title somebody already placed or detached', () => {
    const out = suggestFranchisesByTitle(TITLES, taxonomy({
      itemIpOverrides: [{ mediaItemId: 'e', ipKey: 'blade runner', label: 'Blade Runner', mode: 'remove', source: 'manual' }],
    }));
    expect(out).toEqual([]);
  });
});
