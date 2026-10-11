import { describe, expect, it } from 'vitest';
import { byPopularity, byRating, type Crowd } from '~/lib/sortCards';

type Card = Crowd & { title: string };
const card = (title: string, type: string, score: number | null, votes: number): Card => ({ title, type, score, votes });
const self = (c: Card) => c;
const titles = (list: Card[]) => list.map((c) => c.title);

describe('sorting by rating', () => {
  it('does not let one vote of 10 beat thousands of votes of 9', () => {
    const list = [
      card('One fan', 'game', 100, 1),
      card('Classic', 'movie', 90, 20_000),
      card('Solid', 'movie', 85, 5_000),
      card('Fine', 'show', 70, 900),
    ];
    // One vote is pulled almost all the way to the list's average (8.2): above
    // a well-voted 7, below a well-voted 8.5.
    expect(titles(byRating(list, self))).toEqual(['Classic', 'Solid', 'One fan', 'Fine']);
  });

  it('puts a title nobody rated last, and breaks a tie with the votes', () => {
    const list = [card('Unrated', 'game', null, 0), card('Few', 'game', 80, 100), card('Many', 'game', 80, 9_000)];
    expect(titles(byRating(list, self))).toEqual(['Many', 'Few', 'Unrated']);
  });

  it('leaves the list it was given alone', () => {
    const list = [card('b', 'game', 50, 10), card('a', 'game', 90, 10)];
    byRating(list, self);
    expect(titles(list)).toEqual(['b', 'a']);
  });
});

describe('sorting by popularity', () => {
  // A game's count includes its Steam reviews. Raw, the games take the top.
  const LIST = [
    card('Game 1', 'game', 80, 700_000), card('Game 2', 'game', 80, 400_000), card('Game 3', 'game', 80, 300_000),
    card('Film 1', 'movie', 80, 40_000), card('Film 2', 'movie', 80, 30_000),
    card('Show 1', 'show', 80, 9_000),
  ];

  it('is the raw count when asked for one, which is what a search wants', () => {
    expect(titles(byPopularity(LIST, self))).toEqual(['Game 1', 'Game 2', 'Game 3', 'Film 1', 'Film 2', 'Show 1']);
  });

  it('opens a browsed list with the most popular of each type, then the second of each', () => {
    expect(titles(byPopularity(LIST, self, true))).toEqual(['Game 1', 'Film 1', 'Show 1', 'Game 2', 'Film 2', 'Game 3']);
  });

  it('is the raw count for a list of one type, whatever was asked', () => {
    const films = LIST.filter((c) => c.type === 'movie').reverse();
    expect(titles(byPopularity(films, self, true))).toEqual(['Film 1', 'Film 2']);
  });
});
