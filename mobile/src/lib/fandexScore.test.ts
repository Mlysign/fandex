import { describe, expect, it } from 'vitest';
import { buildProfile, buildPullModel, centreFor, computeFandexScore, MIN_RATED_FOR_MEDIUM_CENTRE, prepareTaxonomy, pullFacetIds, resolveFacets, softRange, type FandexScore, type RatedTitle, type ScoreFacet, type TaxonomyJson } from './fandexScore';

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
    expect(tax.config.roleWeights.ip).toBe(1.5);
    expect(buildProfile(library, tax).meta.get('person|director|villeneuve')?.classWeight).toBe(2);
  });
});

describe('the pull axis (one model against the baseline, 2026-10-26)', () => {
  // The baseline: 200 ordinary films. Anime is on 10 of them, and firefighters
  // only ever turn up on anime (two of the ten). Noir, musicals and westerns
  // are 20 each; the rest are dramas.
  const film = (id: string, keys: string[]) => ({ id, type: 'movie', facets: keys.map((k) => tag(k)) });
  const baseline = [
    ...Array.from({ length: 10 }, (_, i) => film(`b-anime${i}`, i < 2 ? ['anime', 'firefighter'] : ['anime'])),
    ...Array.from({ length: 20 }, (_, i) => film(`b-noir${i}`, ['noir'])),
    ...Array.from({ length: 20 }, (_, i) => film(`b-musical${i}`, ['musical'])),
    ...Array.from({ length: 20 }, (_, i) => film(`b-western${i}`, ['western'])),
    ...Array.from({ length: 130 }, (_, i) => film(`b-drama${i}`, ['drama'])),
  ];
  // Your 40 films: 20 anime, four of them about firefighters; no musicals; four
  // westerns (what the baseline expects of 40 films); the rest dramas.
  const picks = [
    ...Array.from({ length: 20 }, (_, i) => ({ ...film(`anime${i}`, i < 4 ? ['anime', 'firefighter'] : ['anime']), weight: 1 })),
    ...Array.from({ length: 4 }, (_, i) => ({ ...film(`western${i}`, ['western']), weight: 1 })),
    ...Array.from({ length: 16 }, (_, i) => ({ ...film(`drama${i}`, ['drama']), weight: 1 })),
  ];
  // A penalty and a gain sized for 40 titles; the shipped ones are sized for thousands.
  const tax = prepareTaxonomy(json({ scoring: { version: 1, config: { priorStrength: 2, mappingConstantUp: 10, mappingConstantDown: 10, pullGain: 10, pullL1: 1, pullL2: 0.1, tasteBandMargin: 3 } } }));
  const lib: RatedTitle[] = [
    rated('anime0', 7, [tag('anime'), tag('firefighter')]), rated('anime1', 7, [tag('anime')]),
    rated('western0', 9, [tag('western')]), rated('drama0', 5, [tag('drama')]),
  ];
  const model = buildPullModel(picks, baseline, tax);
  const profile = buildProfile(lib, tax, { consumed: picks, pull: model });
  const pullRows = (fx: FandexScore | null) => fx?.reasons.filter((r) => r.axis === 'pull') ?? [];

  it('gives the credit to the facet that explains your picks, and none to one that only rides along', () => {
    const fx = computeFandexScore([tag('anime'), tag('firefighter')], 'x', profile, tax, 'movie')!;
    expect(fx.pull!.points).toBeGreaterThan(0);
    // Firefighter is on four of your films, twice what the baseline expects, but every one is anime: no row, no points.
    expect(pullRows(fx).map((r) => r.label)).toEqual(['anime']);
    expect(pullRows(fx)[0]).toMatchObject({ titles: 20, media: ['movie'] });
    // Twenty of your forty films against two expected (10 in 200 of 40).
    expect(pullRows(fx)[0].times).toBeGreaterThan(5);
    expect(model!.beta.has('tag||firefighter')).toBe(false);
  });

  it('reads a facet you skip as pull the other way, and one you pick at the usual rate as nothing', () => {
    const musical = computeFandexScore([tag('musical')], 'x', profile, tax, 'movie')!;
    expect(musical.pull!.points).toBeLessThan(0);
    expect(pullRows(musical)[0].times).toBeLessThan(1);
    expect(pullRows(computeFandexScore([tag('western')], 'x', profile, tax, 'movie'))).toEqual([]);
  });

  it('holds a facet at zero until it has evidence', () => {
    // Two of your films carry "heist" and no baseline film does: a hint, not a habit.
    const withHeist = picks.map((p, i) => (i >= 24 && i < 26 ? { ...p, facets: [...p.facets, tag('heist')] } : p));
    const m = buildPullModel(withHeist, baseline, tax);
    expect(m!.beta.has('tag||heist')).toBe(false);
  });

  it('adds up: the centre plus every counted row is the score, and pull is beside it, not in it (2026-10-27)', () => {
    const fx = computeFandexScore([tag('anime'), tag('drama')], 'x', profile, tax, 'movie')!;
    expect(Math.abs(fx.center + fx.reasons.reduce((n, r) => n + r.contribution, 0) - fx.score)).toBeLessThan(0.15);
    expect(Math.abs(fx.taste.points - (fx.score - fx.center))).toBeLessThan(0.15);
    // The pull axis still speaks: its points, and how many times more often a title like this is one of your picks.
    expect(fx.pull!.points).toBeGreaterThan(0);
    expect(fx.pull!.times).toBeGreaterThan(1);
    expect(pullRows(fx).every((r) => r.contribution === 0 && r.impact > 0)).toBe(true);
  });

  it('scores a title you picked by the model that did not see it, and leaves it out of its own count', () => {
    const held = pullRows(computeFandexScore([tag('anime')], 'anime5', profile, tax, 'movie'))[0];
    const unseen = pullRows(computeFandexScore([tag('anime')], 'x', profile, tax, 'movie'))[0];
    expect(held.titles).toBe(19);
    expect(unseen.titles).toBe(20);
  });

  it('lets a follow set a facet to the strongest pull and an avoid to the weakest, and moves nothing on taste', () => {
    const followed = buildProfile(lib, tax, { consumed: picks, pull: model, follows: new Map([['tag||western', 'follow']]) });
    const avoided = buildProfile(lib, tax, { consumed: picks, pull: model, follows: new Map([['tag||anime', 'avoid']]) });
    const western = computeFandexScore([tag('western')], 'y', followed, tax, 'movie')!;
    expect(pullRows(western)[0]).toMatchObject({ followed: 'follow' });
    expect(western.pull!.points).toBeGreaterThan(0);
    expect(computeFandexScore([tag('anime')], 'y', avoided, tax, 'movie')!.pull!.points).toBeLessThan(0);
    // The taste row and band are the ones they were; only the bend's share of the points moves with the bigger sum.
    const plain = computeFandexScore([tag('western')], 'y', profile, tax, 'movie')!;
    const tasteRow = (fx: FandexScore) => fx.reasons.find((r) => r.axis === 'taste')!;
    expect(tasteRow(western).impact).toBe(tasteRow(plain).impact);
    expect(western.taste.band).toBe(plain.taste.band);
  });

  it('has no pull axis without a baseline, or for a medium the baseline does not cover', () => {
    const none = buildProfile(lib, tax, { consumed: picks });
    expect(computeFandexScore([tag('anime')], 'x', none, tax, 'movie')!.pull).toBeNull();
    expect(computeFandexScore([tag('anime')], 'x', profile, tax, 'book')!.pull).toBeNull();
    // The band is the score's own, with or without a pull axis.
    expect(computeFandexScore([tag('western')], 'x', none, tax, 'movie')!.band).toBe('high');
    expect(computeFandexScore([tag('western')], 'x', profile, tax, 'movie')!.band).toBe('high');
  });

  it('leaves the number where it was whether or not the device has a baseline', () => {
    const none = buildProfile(lib, tax, { consumed: picks });
    expect(computeFandexScore([tag('anime')], 'x', none, tax, 'movie')!.score).toBe(computeFandexScore([tag('anime')], 'x', profile, tax, 'movie')!.score);
  });

  it('leaves a tag in an ignored category out of the model', () => {
    const ids = pullFacetIds([tag('anime'), tag('pc', 'meta'), director('kon')], 'x', tax);
    expect(ids).toEqual(['tag||anime', 'person|director|kon']);
  });
});

describe('tag tiers (2026-10-25)', () => {
  const tiered = (key: string, tier: string): ScoreFacet => ({ kind: 'tag', key, label: key, category: 'genre', tier });

  it('weighs a keyword occurrence by its tier when learning and when scoring, and a genre in full', () => {
    const tax = prepareTaxonomy(json({ scoring: { version: 1, config: { priorStrength: 2, mappingConstantUp: 10, mappingConstantDown: 10, tagTierWeights: { genre: 1, keyword: 0.5 } } } }));
    // A stored tier fills the rest from the defaults (genre is 0.5 there since 2026-10-27).
    expect(tax.config.tagTierWeights).toEqual({ genre: 1, theme: 1, voted: 1, keyword: 0.5 });
    expect(prepareTaxonomy(json({ scoring: { version: 1, config: { tagTierWeights: { keyword: 0.25 } } } })).config.tagTierWeights).toEqual({ genre: 0.5, theme: 1, voted: 1, keyword: 0.25 });
    // The same ratings behind "noir" as a genre and as a keyword: the keyword is half the evidence.
    const asGenre = buildProfile([rated('a', 10, [tiered('noir', 'genre')]), rated('b', 10, [tiered('noir', 'genre')]), rated('c', 2, [tag('musical')]), rated('d', 2, [tag('musical')])], tax);
    const asKeyword = buildProfile([rated('a', 10, [tiered('noir', 'keyword')]), rated('b', 10, [tiered('noir', 'keyword')]), rated('c', 2, [tag('musical')]), rated('d', 2, [tag('musical')])], tax);
    expect(asKeyword.meta.get('tag||noir')!.weightedCount).toBe(1);
    expect(asGenre.meta.get('tag||noir')!.weightedCount).toBe(2);
    expect(asKeyword.w.get('tag||noir')!).toBeLessThan(asGenre.w.get('tag||noir')!);
    // On a title, the same facet counts half when the title carries it as a keyword.
    const genreRow = computeFandexScore([tiered('noir', 'genre')], 'x', asGenre, tax)!.reasons[0];
    const keywordRow = computeFandexScore([tiered('noir', 'keyword')], 'x', asGenre, tax)!.reasons[0];
    expect(keywordRow.contribution).toBeCloseTo(genreRow.contribution / 2, 1);
    expect(keywordRow.tier).toBe('keyword');
    expect(genreRow.tier).toBe('genre');
    // A facet from before tiers existed carries none and counts in full.
    expect(computeFandexScore([tag('noir')], 'x', asGenre, tax)!.reasons[0].contribution).toBe(genreRow.contribution);
  });

  it('leaves a rated title out exactly, tier weight included', () => {
    const tax = prepareTaxonomy(json());
    const lib = [rated('a', 10, [tiered('noir', 'keyword')]), rated('b', 9, [tiered('noir', 'genre')]), rated('c', 3, [tag('musical')]), rated('d', 2, [tag('musical')])];
    const left = computeFandexScore(lib[0].facets, 'a', buildProfile(lib, tax), tax)!;
    const without = computeFandexScore(lib[0].facets, 'a', buildProfile(lib.slice(1), tax), tax)!;
    expect(left.score).toBe(without.score);
  });
});


describe('the centre is your average for the medium (2026-10-27)', () => {
  const tax = prepareTaxonomy(json());
  // Twelve games rated 8 (one of them a 10), twelve films rated 6, five books rated 9.
  const games = Array.from({ length: 12 }, (_, i) => ({ ...rated(`g${i}`, i === 0 ? 10 : 8, [tag('arcade')]), type: 'game' }));
  const films = Array.from({ length: 12 }, (_, i) => ({ ...rated(`f${i}`, 6, [tag('drama')]), type: 'movie' }));
  const books = Array.from({ length: 5 }, (_, i) => ({ ...rated(`b${i}`, 9, [tag('drama')]), type: 'book' }));
  const profile = buildProfile([...games, ...films, ...books], tax);

  it('starts a game from your games average and a film from your films average, and says what the rows are measured against', () => {
    const game = computeFandexScore([tag('arcade')], 'x', profile, tax, 'game')!;
    expect(game.center).toBeCloseTo((8 * 11 + 10) / 12 * 10, 1);
    expect(computeFandexScore([tag('drama')], 'x', profile, tax, 'movie')!.center).toBe(60);
    // The rows' baseline is your average over everything (the offset keeps a medium's gap out of its tags).
    expect(game.usual).toBeCloseTo(((8 * 11 + 10 + 6 * 12 + 9 * 5) / 29) * 10, 0);
  });

  it('falls back to your overall average below ten ratings in the medium, or without one', () => {
    expect(MIN_RATED_FOR_MEDIUM_CENTRE).toBe(10);
    const overall = (8 * 11 + 10 + 6 * 12 + 9 * 5) / 29;
    expect(centreFor(profile, 'book')).toBeCloseTo(overall, 6);
    expect(centreFor(profile, undefined)).toBeCloseTo(overall, 6);
    expect(computeFandexScore([tag('drama')], 'x', profile, tax)!.center).toBeCloseTo(overall * 10, 1);
  });

  it('leaves a rated title out of its own centre', () => {
    // g0 is the 10: without it the games average is 8, and the facets have nothing to add on an all-8 tag.
    expect(centreFor(profile, 'game', { id: 'g0' })).toBe(8);
    expect(computeFandexScore(games[0].facets, 'g0', profile, tax, 'game')!.center).toBe(80);
    // Out of a medium with too few ratings, the overall average without the title.
    expect(centreFor(profile, 'book', { id: 'b0' })).toBeCloseTo((8 * 11 + 10 + 6 * 12 + 9 * 4) / 28, 6);
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
