import { describe, expect, it } from 'vitest';
import type { ScoreBand, ScoreFacet } from '~/lib/fandexScore';
import { fitPullModel, type PullPick, type PullTitle } from '~/lib/pullModel';
import { MAX_RAILS_PER_KIND, MAX_SEEK_RAILS, MIN_SEEK_RAIL, parseSeekList, SEEK_LIST_VERSION, seekFacets, seekRails, sortSeek, type SeekFacet } from '~/lib/seekOut';

// What you seek out (lib/seekOut.ts): the list Insights shows and the rails
// the Recommendations page is made of. The model's own maths is pullModel.test.ts.

const titles = (prefix: string, n: number, type: string, facets: string[]): PullTitle[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, type, facets }));
const picked = (list: PullTitle[], weight = 1): PullPick[] => list.map((t) => ({ ...t, weight }));
const OPTS = { l1: 1, l2: 0.1, folds: 0 };

const tag = (key: string, category = 'setting'): ScoreFacet => ({ kind: 'tag', key, label: key[0].toUpperCase() + key.slice(1), category });
const person = (role: string, key: string): ScoreFacet => ({ kind: 'person', role, key, label: key });
const named = (...facets: ScoreFacet[]) => new Map(facets.map((f) => [`${f.kind}|${f.role ?? ''}|${f.key}`, f]));

describe('what you seek out', () => {
  // Steampunk is on one baseline film in twenty and on two of your five; drama is on half of both.
  const baseline = [...titles('bs', 20, 'movie', ['tag||steampunk', 'tag||drama']), ...titles('bd', 180, 'movie', ['tag||drama']), ...titles('bn', 200, 'movie', [])];
  const picks = picked([...titles('s', 40, 'movie', ['tag||steampunk', 'tag||drama']), ...titles('d', 10, 'movie', ['tag||drama']), ...titles('n', 50, 'movie', [])]);
  const model = fitPullModel(picks, baseline, OPTS)!;

  it('lists a facet the model weighs, with the plain count behind it', () => {
    const list = seekFacets(model, named(tag('steampunk'), tag('drama', 'genre')));
    expect(list.map((f) => f.key)).toEqual(['steampunk']);
    const [steampunk] = list;
    expect(steampunk).toMatchObject({ id: 'tag|steampunk', kind: 'tag', label: 'Steampunk', category: 'setting', titles: 40, media: ['movie'], facetIds: ['tag||steampunk'] });
    // 40 of your 100 against 5 in 100 of the baseline: about eight times, half a title added to both sides.
    expect(steampunk.times).toBeCloseTo(40.5 / 5.5, 5);
    expect(steampunk.weight).toBeGreaterThan(0);
  });

  it('leaves out a facet nothing names, and one you pick about as often as anybody', () => {
    expect(seekFacets(model, named(tag('drama', 'genre')))).toEqual([]);
  });

  it('takes a tag’s category from the taxonomy when it is given one', () => {
    const [steampunk] = seekFacets(model, named(tag('steampunk')), () => 'theme');
    expect(steampunk.category).toBe('theme');
  });

  it('makes one entry of a person the model weighs in two roles, spoken for by the stronger', () => {
    const base = [...titles('b', 196, 'movie', []), ...titles('bd', 2, 'movie', ['person|director|tim burton', 'person|writer|tim burton']), ...titles('bw', 2, 'movie', ['person|director|tim burton'])];
    const mine = picked([
      ...titles('both', 6, 'movie', ['person|director|tim burton', 'person|writer|tim burton']),
      ...titles('dir', 12, 'movie', ['person|director|tim burton']),
      ...titles('rest', 60, 'movie', []),
    ]);
    const m = fitPullModel(mine, base, OPTS)!;
    const list = seekFacets(m, named(person('director', 'tim burton'), person('writer', 'tim burton')));
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'person|tim burton', role: 'director', titles: 18 });
    expect(list[0].facetIds).toContain('person|director|tim burton');
  });

  it('reads a kept list back whole, and takes no other version or shape for one', () => {
    const list = { v: SEEK_LIST_VERSION, facets: seekFacets(model, named(tag('steampunk'))), picks: 100, baseline: 400 };
    expect(parseSeekList(JSON.parse(JSON.stringify(list)))).toEqual(list);
    expect(parseSeekList({ ...list, v: SEEK_LIST_VERSION + 1 })).toBeNull();
    expect(parseSeekList({ ...list, facets: [{ id: 'tag|steampunk' }] })).toBeNull();
    expect(parseSeekList(undefined)).toBeNull();
    expect(parseSeekList('[]')).toBeNull();
  });

  it('sorts by how far above average, or by how many of your titles', () => {
    const a = { id: 'a', weight: 3, times: 2, titles: 50 } as SeekFacet;
    const b = { id: 'b', weight: 2, times: 9, titles: 5 } as SeekFacet;
    const c = { id: 'c', weight: 1, times: 4, titles: 20 } as SeekFacet;
    expect(sortSeek([a, b, c], 'weight').map((f) => f.id)).toEqual(['a', 'b', 'c']);
    expect(sortSeek([a, b, c], 'times').map((f) => f.id)).toEqual(['b', 'c', 'a']);
    expect(sortSeek([a, b, c], 'titles').map((f) => f.id)).toEqual(['a', 'c', 'b']);
  });
});

describe('the rails', () => {
  const facet = (key: string, kind: SeekFacet['kind'] = 'tag', weight = 1): SeekFacet =>
    ({ id: `${kind}|${key}`, kind, key, label: key, facetIds: [`${kind}||${key}`], weight, times: 4, titles: 10, media: ['movie'] });
  const card = (id: string, type = 'movie') => ({ id, type });
  const band = (score: number): { score: number; band: ScoreBand } => ({ score, band: score >= 70 ? 'high' : score < 50 ? 'low' : 'usual' });

  /** A world of cards: `carriers` by facet id, every card recommendable unless left out of `cards`. */
  const world = (carriers: Record<string, string[]>, scores: Record<string, number>, types: Record<string, string> = {}) => ({
    carriers: (id: string) => carriers[id] ?? [],
    card: (id: string) => (id in scores || id in types ? card(id, types[id] ?? 'movie') : undefined),
    scoreOf: (id: string) => (id in scores ? band(scores[id]) : undefined),
    day: '2026-11-26',
  });

  it('holds the titles carrying the facet, best match first, and never one the score puts below your usual', () => {
    const w = world({ 'tag||steampunk': ['a', 'b', 'c', 'd', 'low', 'unscored'] }, { a: 60, b: 90, c: 75, d: 55, low: 30 }, { unscored: 'movie' });
    const [rail] = seekRails({ facets: [facet('steampunk')], ...w });
    expect(rail.facet.key).toBe('steampunk');
    expect(rail.items.map((c) => c.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('is no rail with too few titles, or with none of a type on screen', () => {
    const few = world({ 'tag||steampunk': ['a', 'b', 'c'] }, { a: 60, b: 90, c: 75 });
    expect(MIN_SEEK_RAIL).toBe(4);
    expect(seekRails({ facets: [facet('steampunk')], ...few })).toEqual([]);
    const games = world({ 'tag||steampunk': ['a', 'b', 'c', 'd'] }, { a: 60, b: 90, c: 75, d: 80 }, { a: 'game', b: 'game', c: 'game', d: 'game' });
    expect(seekRails({ facets: [facet('steampunk')], ...games, types: ['movie'] })).toEqual([]);
    expect(seekRails({ facets: [facet('steampunk')], ...games, types: ['game'] })).toHaveLength(1);
  });

  it('leaves out what you hid, what cannot be recommended, and all but two of what you wishlisted', () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const w = world({ 'tag||steampunk': [...ids, 'mine'] }, Object.fromEntries(ids.map((id, i) => [id, 90 - i])));
    const [rail] = seekRails({ facets: [facet('steampunk')], ...w, hidden: new Set(['a']), wishlisted: new Set(['b', 'c', 'd']) });
    // "mine" has no card (it is in your library); a is hidden; d is the third wishlisted title.
    expect(rail.items.map((c) => c.id)).toEqual(['b', 'c', 'e', 'f', 'g']);
  });

  it('puts a title in the first rail that claims it and in no other', () => {
    const scores = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) => [id, 90 - i]));
    const w = world({ 'tag||steampunk': ['a', 'b', 'c', 'd'], 'tag||airship': ['a', 'b', 'e', 'f', 'g', 'h'] }, scores);
    const rails = seekRails({ facets: [facet('steampunk'), facet('airship')], ...w });
    expect(rails.map((r) => r.items.map((c) => c.id))).toEqual([['a', 'b', 'c', 'd'], ['e', 'f', 'g', 'h']]);
  });

  it('reads every role a person is weighed in', () => {
    const burton: SeekFacet = { ...facet('tim burton', 'person'), facetIds: ['person|director|tim burton', 'person|writer|tim burton'] };
    const w = world({ 'person|director|tim burton': ['a', 'b'], 'person|writer|tim burton': ['b', 'c', 'd'] }, { a: 60, b: 61, c: 62, d: 63 });
    expect(seekRails({ facets: [burton], ...w })[0].items.map((c) => c.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  /** `n` facets of a kind, each on four titles of its own that score well. */
  const plenty = (...kinds: [SeekFacet['kind'], number][]) => {
    const carriers: Record<string, string[]> = {};
    const scores: Record<string, number> = {};
    const facets: SeekFacet[] = [];
    for (const [kind, n] of kinds) {
      for (let i = 0; i < n; i++) {
        const f = facet(`${kind}${i}`, kind);
        facets.push(f);
        carriers[f.facetIds[0]] = [0, 1, 2, 3].map((j) => `${kind}${i}-${j}`);
        for (const id of carriers[f.facetIds[0]]) scores[id] = 80;
      }
    }
    return { facets, ...world(carriers, scores) };
  };

  it('gives the kinds turns: a tag, a person, a studio, a franchise, then the next of each', () => {
    // Franchises lead by weight (they are listed first here), and still take only every fourth rail.
    const rails = seekRails(plenty(['ip', 9], ['company', 9], ['person', 9], ['tag', 9]));
    expect(rails).toHaveLength(MAX_SEEK_RAILS);
    expect(rails.slice(0, 5).map((r) => r.facet.id)).toEqual(['tag|tag0', 'person|person0', 'company|company0', 'ip|ip0', 'tag|tag1']);
    for (const kind of ['tag', 'person', 'company', 'ip']) expect(rails.filter((r) => r.facet.kind === kind)).toHaveLength(3);
  });

  it('lets the other kinds fill in for one that runs short, up to the limit per kind', () => {
    const rails = seekRails(plenty(['person', 9], ['tag', 1]));
    expect(rails.map((r) => r.facet.kind)).toEqual(['tag', 'person', 'person', 'person', 'person', 'person']);
    expect(rails.filter((r) => r.facet.kind === 'person')).toHaveLength(MAX_RAILS_PER_KIND);
  });

  it('passes over a facet that makes no rail and takes the next of its kind in the same turn', () => {
    const w = plenty(['tag', 2], ['person', 1]);
    // The strongest tag is on three titles only: not a rail.
    const short = { ...w, carriers: (id: string) => (id === 'tag||tag0' ? ['tag0-0', 'tag0-1', 'tag0-2'] : w.carriers(id)) };
    expect(seekRails(short).map((r) => r.facet.id)).toEqual(['tag|tag1', 'person|person0']);
  });
});
