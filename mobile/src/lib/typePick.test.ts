import { describe, expect, it } from 'vitest';
import { MEDIA_TYPES, visibleTypes } from '@/lib/mediaTypes';
import { excludePick, settlePick, tapPick } from '~/lib/typePick';

const offered = ['game', 'movie', 'show', 'book'];
const noGames = ['movie', 'show', 'book'];

describe('settlePick', () => {
  it('stores nothing for the account default, so the row reads "your types" again', () => {
    expect(settlePick(['show', 'movie', 'book'], offered, noGames)).toEqual([]);
    expect(settlePick(offered, offered, null)).toEqual([]);
  });

  it('stores every type when every type is on and the default has some off', () => {
    const pick = settlePick(offered, offered, noGames);
    expect(visibleTypes(pick, noGames)).toEqual(expect.arrayContaining(offered));
    expect(pick).toEqual([...MEDIA_TYPES]);
  });

  it('stores nothing for an empty pick', () => {
    expect(settlePick([], offered, noGames)).toEqual([]);
  });

  it('drops types the row does not offer', () => {
    expect(settlePick(['boardgame', 'game'], offered, noGames)).toEqual(['game']);
  });
});

describe('tapPick', () => {
  it('narrows a full default row to the tapped type', () => {
    expect(tapPick('game', offered, offered, null, true)).toEqual(['game']);
  });

  it('from a partial default, adds the type that is off', () => {
    const pick = tapPick('game', noGames, offered, noGames, true);
    expect(visibleTypes(pick, noGames)).toEqual(expect.arrayContaining(offered));
  });

  it('from a partial default, drops a type that is on', () => {
    expect(tapPick('movie', noGames, offered, noGames, true)).toEqual(['show', 'book']);
  });

  it('adding the default back lands on no pick', () => {
    expect(tapPick('movie', ['show', 'book'], offered, noGames, false)).toEqual([]);
  });

  it('a full row that is an explicit pick still adds and drops, it does not narrow', () => {
    expect(tapPick('game', offered, offered, noGames, false)).toEqual([]);
  });
});

describe('excludePick', () => {
  it('hides one type from a full row', () => {
    expect(excludePick('game', offered, offered, null)).toEqual(noGames);
  });

  it('hiding the last one goes back to the default', () => {
    expect(excludePick('game', ['game'], offered, noGames)).toEqual([]);
  });
});
