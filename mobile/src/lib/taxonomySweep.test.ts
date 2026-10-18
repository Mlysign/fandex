import { describe, expect, it } from 'vitest';
import type { TaxonomyJson } from '~/lib/fandexScore';
import type { CatalogTitle } from '~/lib/ipSurvey';
import type { TagRow } from '~/lib/tagVocab';
import { runTaxonomySweep, type FranchiseMergeSuggestion, type FranchiseNewSuggestion, type TagCategorySuggestion } from '~/lib/taxonomySweep';

// The rules are the site's (src/lib/taxonomyRules.ts) and are tested there. What
// is tested here is what the port adds: which tags are candidates, which live
// category a rule lands on, and that a remembered "no" stays gone.

const tag = (key: string, count: number, over: Partial<TagRow> = {}): TagRow => ({
  key, label: key, count, category: 'other', overridden: false, aka: [], labelOverridden: false, ...over,
});

const category = (id: string, label: string) => ({ id, label, color: '#000000', weight: 1, ignored: false, sortOrder: 0 });

const taxonomy = (over: Partial<TaxonomyJson> = {}): TaxonomyJson => ({
  tagCategories: [category('meta', 'Meta / Noise'), category('genre', 'Genre')],
  tagCategoryOverrides: [], tagAliases: [], ipAliases: [], itemIpOverrides: [], facetLabels: [], scoring: null, ...over,
});

const ip = (key: string, label: string) => ({ key, label });
const film = (id: string, title: string, ips: CatalogTitle['ips'] = []): CatalogTitle => ({ id, title, type: 'movie', ips });

const sweep = (over: Partial<Parameters<typeof runTaxonomySweep>[0]> = {}) =>
  runTaxonomySweep({ tags: [], titles: [], tax: taxonomy(), dismissed: [], ...over });

const tagCards = (r: ReturnType<typeof sweep>) => r.suggestions.filter((s): s is TagCategorySuggestion => s.kind === 'tag-category');
const merges = (r: ReturnType<typeof sweep>) => r.suggestions.filter((s): s is FranchiseMergeSuggestion => s.kind === 'franchise-merge');

describe('tag category proposals', () => {
  const TAGS = [tag('co op', 40), tag('pvp', 12), tag('steam achievements', 30), tag('zzz no rule knows this', 2)];

  it('groups the tags in Other by the rule that claims them, biggest change first', () => {
    const r = sweep({ tags: TAGS });
    expect(tagCards(r).map((s) => [s.ref, s.tags.map((t) => t.key), s.itemsAffected])).toEqual([
      ['modes', ['co op', 'pvp'], 52],
      ['store-plumbing', ['steam achievements'], 30],
    ]);
    expect(r.stats).toMatchObject({ totalTags: 4, otherTags: 4, tagsCovered: 3, otherAfterAccepting: 1, itemsAffected: 82 });
  });

  it('leaves a tag somebody moved by hand, and one the code already places, alone', () => {
    const r = sweep({ tags: [tag('co op', 40, { overridden: true, category: 'genre' }), tag('pvp', 12), tag('action', 900, { category: 'genre' })] });
    expect(tagCards(r).map((s) => s.tags.map((t) => t.key))).toEqual([['pvp']]);
    // Neither is counted as sitting in Other either.
    expect(r.stats.otherTags).toBe(1);
  });

  it('lands on the category that exists, under whichever id it was made with', () => {
    // The rule prefers `mode` and knows `modes` means the same category.
    const created = tagCards(sweep({ tags: TAGS }))[0];
    expect(created).toMatchObject({ categoryId: 'mode', createsCategory: { id: 'mode', label: 'Mode' } });

    const tax = taxonomy({ tagCategories: [category('modes', 'Modes'), category('meta', 'Meta / Noise')] });
    const existing = tagCards(sweep({ tags: TAGS, tax }))[0];
    expect(existing).toMatchObject({ categoryId: 'modes', categoryLabel: 'Modes', createsCategory: null });
  });

  it('does not bring back a rule somebody said no to', () => {
    const r = sweep({ tags: TAGS, dismissed: [['tag-category', 'modes']] });
    expect(tagCards(r).map((s) => s.ref)).toEqual(['store-plumbing']);
    // Its tags still sit in Other, and the count says so.
    expect(r.stats).toMatchObject({ otherTags: 4, tagsCovered: 1, otherAfterAccepting: 3, dismissed: 1 });
  });
});

describe('franchise merge proposals', () => {
  const TITLES = [
    film('a', 'The Terminator', [ip('the terminator', 'The Terminator Collection')]),
    film('b', 'Terminator 2', [ip('the terminator', 'The Terminator Collection')]),
    film('c', 'Terminator: Resistance', [ip('terminator', 'Terminator')]),
    film('d', 'Metal Gear', [ip('metal gear', 'Metal Gear')]),
    film('e', 'Metal Gear Solid', [ip('metal gear solid', 'Metal Gear Solid')]),
    film('f', 'Metal Gear Solid 2', [ip('metal gear solid', 'Metal Gear Solid')]),
  ];

  it('proposes the same name with and without an article, into the bigger one', () => {
    const m = merges(sweep({ titles: TITLES })).find((s) => s.ref === 'terminator>the terminator');
    expect(m).toMatchObject({ aliasSize: 1, canonicalSize: 2, canonicalSample: ['Terminator 2', 'The Terminator'] });
  });

  it('proposes folding a sub-series into the general name, with titles from both sides', () => {
    const m = merges(sweep({ titles: TITLES })).find((s) => s.ref === 'metal gear solid>metal gear');
    expect(m).toMatchObject({ aliasLabel: 'Metal Gear Solid', canonicalLabel: 'Metal Gear', aliasSample: ['Metal Gear Solid', 'Metal Gear Solid 2'], canonicalSample: ['Metal Gear'] });
  });

  it('keeps a denied direction gone and still offers nothing for a bundled pair', () => {
    const denied = sweep({ titles: TITLES, dismissed: [['franchise-merge', 'metal gear solid>metal gear']] });
    expect(merges(denied).map((s) => s.ref)).toEqual(['terminator>the terminator']);

    const bundled = sweep({ titles: TITLES, tax: taxonomy({ ipAliases: [['terminator', 'the terminator']] }) });
    expect(merges(bundled).map((s) => s.ref)).toEqual(['metal gear solid>metal gear']);
  });

  it('does not match a short name as a prefix', () => {
    const titles = [film('a', 'Alien', [ip('alien', 'Alien')]), film('b', 'Alien Nation', [ip('alien nation', 'Alien Nation')])];
    expect(merges(sweep({ titles }))).toEqual([]);
  });
});

describe('missing member proposals', () => {
  const TITLES = [
    film('a', 'Blade Runner', [ip('blade runner', 'Blade Runner Collection')]),
    film('b', 'Blade Runner 2049'),
    film('c', 'Something Else'),
  ];

  it('offers a title that names a known franchise and is in none', () => {
    const r = sweep({ titles: TITLES });
    expect(r.suggestions).toMatchObject([{ kind: 'franchise-member', ref: 'b>blade runner', itemTitle: 'Blade Runner 2049', ipLabel: 'Blade Runner Collection', franchiseSize: 1 }]);
    expect(r.stats).toMatchObject({ franchises: 1, singletonFranchises: 1 });
  });

  it('stops offering it once it is denied, or attached', () => {
    expect(sweep({ titles: TITLES, dismissed: [['franchise-member', 'b>blade runner']] }).suggestions).toEqual([]);
    const attached = taxonomy({ itemIpOverrides: [{ mediaItemId: 'b', ipKey: 'blade runner', label: 'Blade Runner', mode: 'add', source: 'manual' }] });
    expect(sweep({ titles: TITLES, tax: attached }).suggestions).toEqual([]);
  });
});

describe('new franchise proposals', () => {
  // The real titles of the 2026-10-17 hand sweep, before it ran.
  const book = (id: string, title: string, ips: CatalogTitle['ips'] = []): CatalogTitle => ({ id, title, type: 'book', ips });
  const game = (id: string, title: string, ips: CatalogTitle['ips'] = []): CatalogTitle => ({ id, title, type: 'game', ips });
  const show = (id: string, title: string, ips: CatalogTitle['ips'] = []): CatalogTitle => ({ id, title, type: 'show', ips });
  const TITLES = [
    book('dracula-book', 'Dracula'), film('dracula-film', 'Dracula'),
    game('mt1', 'Monster Train'), game('mt2', 'Monster Train 2'), game('mt3', 'Monster Train 2: Destiny of the Railforged'),
    // False friends: the same name, and not the same work.
    game('limbo-game', 'Limbo'), film('limbo-film', 'Limbo'),
    game('prey-game', 'Prey'), film('prey-film', 'Prey', [ip('predator', 'Predator Collection')]),
  ];
  const news = (r: ReturnType<typeof sweep>) => r.suggestions.filter((s): s is FranchiseNewSuggestion => s.kind === 'franchise-new');
  const cards = (over: Partial<Parameters<typeof runTaxonomySweep>[0]> = {}) =>
    news(sweep({ titles: TITLES, ...over })).map((s) => [s.ref, s.ipLabel, s.signal, s.members.map((m) => m.mediaItemId)]);

  it('pairs a book and its film, and names a series three games begin with', () => {
    expect(cards()).toEqual([
      ['dracula', 'Dracula', 'same-work', ['dracula-book', 'dracula-film']],
      ['monster train', 'Monster Train', 'shared-words', ['mt1', 'mt2', 'mt3']],
    ]);
    expect(news(sweep({ titles: TITLES }))[0]).toMatchObject({ title: 'New franchise: Dracula', joins: false, why: expect.stringContaining('a book and a film') });
  });

  it('never pairs a game with a film by name alone', () => {
    const refs = news(sweep({ titles: TITLES })).map((s) => s.ref);
    expect(refs).not.toContain('limbo');
    expect(refs).not.toContain('prey');
    // A book of the game's name is what lets a game in.
    expect(cards({ titles: [game('g', 'Limbo'), book('b', 'Limbo')] })).toEqual([['limbo', 'Limbo', 'same-work', ['b', 'g']]]);
  });

  it('counts a hand-made attach as placed, not only the provider data', () => {
    const attach = (mediaItemId: string, ipKey: string, label: string) => ({ mediaItemId, ipKey, label, mode: 'add' as const, source: 'manual' as const });
    const placed = taxonomy({
      itemIpOverrides: [
        attach('dracula-book', 'dracula', 'Dracula'), attach('dracula-film', 'dracula', 'Dracula'),
        attach('mt1', 'monster train', 'Monster Train'), attach('mt2', 'monster train', 'Monster Train'), attach('mt3', 'monster train', 'Monster Train'),
      ],
    });
    expect(cards({ tax: placed })).toEqual([]);
    // Half placed: the franchise exists, so the book is a membership card and not a second "Dracula".
    const half = sweep({ titles: TITLES, tax: taxonomy({ itemIpOverrides: [attach('dracula-film', 'dracula', 'Dracula')] }) });
    expect(news(half).map((s) => s.ref)).toEqual(['monster train']);
    expect(half.suggestions).toContainEqual(expect.objectContaining({ kind: 'franchise-member', ref: 'dracula-book>dracula' }));
  });

  it('joins the franchise the placed half of a pair already sits in', () => {
    const titles = [film('h-film', 'Hannibal', [ip('the hannibal lecter', 'The Hannibal Lecter Collection')]), show('h-show', 'Hannibal')];
    expect(news(sweep({ titles }))).toMatchObject([{ ref: 'the hannibal lecter', title: 'Join The Hannibal Lecter Collection', joins: true, members: [{ mediaItemId: 'h-show' }] }]);
  });

  it('takes the part before a colon, and a numbered sequel as a series of two', () => {
    expect(cards({ titles: [book('b', 'Snowpiercer'), show('s', 'Snowpiercer: The Series')] })).toEqual([['snowpiercer', 'Snowpiercer', 'same-work', ['b', 's']]]);
    expect(cards({ titles: [game('a', 'Just Cause 2'), game('b', 'Just Cause 3')] })).toEqual([['just cause', 'Just Cause', 'shared-words', ['a', 'b']]]);
    expect(cards({ titles: [game('a', 'The Gallery: Episode 1 - Call of the Starseed'), game('b', 'The Gallery: Episode 2 - Heart of the Emberstone')] }))
      .toEqual([['the gallery', 'The Gallery', 'shared-words', ['a', 'b']]]);
  });

  it('is not fooled by a zero, by twins, or by filler words', () => {
    expect(cards({ titles: [film('a', 'Event Horizon'), game('b', 'Event[0]')] })).toEqual([]);
    expect(cards({ titles: [game('a', 'PUBG: Battlegrounds'), game('b', 'PUBG: Battlegrounds'), game('c', 'PUBG: Battlegrounds')] })).toEqual([]);
    expect(cards({ titles: [film('a', 'The Last Duel'), show('b', 'The Last Kingdom'), film('c', 'The Last Samurai')] })).toEqual([]);
  });

  it('does not bring back a franchise somebody said no to', () => {
    expect(cards({ dismissed: [['franchise-new', 'dracula']] }).map(([ref]) => ref)).toEqual(['monster train']);
  });
});
