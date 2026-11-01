import { describe, expect, it } from 'vitest';
import { drawPicks, type PickInput } from './picks';

type T = PickInput & { id: string };
const title = (id: string, type: string, communityScore: number | null, communityVotes = 1000, fandexScore: number | null = null): T =>
  ({ id, type, communityScore, communityVotes, fandexScore });
const input = (t: T): PickInput => t;
const ids = (list: T[]) => list.map((t) => t.id);

/** A type's titles rated 0 to 99, all well voted. */
const ladder = (type: string, n = 100) => Array.from({ length: n }, (_, i) => title(`${type}${i}`, type, i));

describe('drawPicks', () => {
  it('opens on the top fifth of each type, shuffled, then the rest best first', () => {
    const films = ladder('movie');
    const out = drawPicks(films, input, 1);
    const hand = out.slice(0, 20);
    expect(new Set(ids(hand))).toEqual(new Set(ids(films.slice(80))));
    // Shuffled: not simply best first.
    expect(ids(hand)).not.toEqual(ids(films.slice(80).reverse()));
    expect(ids(out.slice(20))).toEqual(ids(films.slice(0, 80).reverse()));
    expect(out).toHaveLength(100);
  });

  it('is the same hand for the same seed, and a mostly different first screen for another', () => {
    const films = ladder('movie', 1000);
    expect(ids(drawPicks(films, input, 7))).toEqual(ids(drawPicks(films, input, 7)));
    const a = new Set(ids(drawPicks(films, input, 7).slice(0, 24)));
    const shared = ids(drawPicks(films, input, 8).slice(0, 24)).filter((id) => a.has(id));
    // A hand of 200: two first screens of 24 share about three by chance.
    expect(shared.length).toBeLessThan(10);
  });

  it('deals the types in turn, so the first cards are one of each', () => {
    const out = drawPicks([...ladder('game'), ...ladder('movie'), ...ladder('show')], input, 3);
    expect(out.slice(0, 6).map((t) => t.type)).toEqual(['game', 'movie', 'show', 'game', 'movie', 'show']);
  });

  it('ranks by your Fandex Score where there is one, over the crowd', () => {
    const films = ladder('movie');
    // The crowd's worst film is your best.
    films[0] = title('movie0', 'movie', 0, 1000, 99);
    const hand = ids(drawPicks(films, input, 1).slice(0, 20));
    expect(hand).toContain('movie0');
    expect(hand).not.toContain('movie80');
  });

  it('leaves a type\'s most obscure quarter out of the hand, however it is rated', () => {
    const films = ladder('movie');
    // A quarter of the films have two votes. The best rated, and your best, has one.
    for (let i = 0; i < 30; i++) films[i] = { ...films[i], communityVotes: 2 };
    films[99] = title('movie99', 'movie', 99, 1, 99);
    const out = drawPicks(films, input, 1);
    // A hand of 19, and it leads what follows.
    expect(ids(out.slice(0, 19))).not.toContain('movie99');
    expect(out[19].id).toBe('movie99');
  });

  it('puts what nobody rated last, and draws nothing from an empty list', () => {
    const out = drawPicks([title('a', 'movie', null, 0), ...ladder('movie', 10)], input, 1);
    expect(out[out.length - 1].id).toBe('a');
    expect(drawPicks([], input, 1)).toEqual([]);
  });
});
