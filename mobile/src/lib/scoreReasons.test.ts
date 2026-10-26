import { describe, expect, it } from 'vitest';
import type { ScoreReason } from '~/lib/fandexScore';
import { axisRows, axisWord, cappedRows, labelSentence, oddsLine, pullSentence, reasonHref, scoreBand, signed, sortReasons, tasteSentence } from '~/lib/scoreReasons';

const reason = (label: string, contribution: number, over: Partial<ScoreReason> = {}): ScoreReason => ({
  axis: 'taste', kind: 'tag', key: label.toLowerCase(), label, contribution, impact: contribution, BA: 7, n: 4, ...over,
});

describe('the score band', () => {
  it('sits around your own average, not around 50', () => {
    expect(scoreBand(70, 80)).toBe('low');
    expect(scoreBand(70, 70)).toBe('baseline');
    expect(scoreBand(70, 60)).toBe('high');
    // Ten either way is the edge, and the edge counts.
    expect(scoreBand(90, 80)).toBe('high');
    expect(scoreBand(89.9, 80)).toBe('baseline');
  });
});

describe('the sentence under the label', () => {
  const fx = (taste: 'high' | 'usual' | 'low', pull: 'high' | 'usual' | 'low' | null) => ({ taste: { points: 0, band: taste }, pull: pull ? { points: 0, band: pull } : null });
  it('names both axes, pull first', () => {
    expect(labelSentence(fx('high', 'high'))).toBe('You seek this out, and you rate it well.');
    expect(labelSentence(fx('high', 'low'))).toBe('Not your usual pick, but you rate this kind of thing well.');
    expect(labelSentence(fx('low', 'high'))).toBe('You seek this out, but you tend not to love it.');
    expect(labelSentence(fx('low', 'low'))).toBe('Not your kind of thing, and you tend not to love it.');
  });
  it('names the one axis that moved when only one did, and says so when neither did', () => {
    expect(labelSentence(fx('high', 'usual'))).toBe('You rate this kind of thing well.');
    expect(labelSentence(fx('usual', 'high'))).toBe('You seek this out.');
    expect(labelSentence(fx('usual', 'usual'))).toBe('About your usual, on both counts.');
    // Without a catalog there is no pull axis, and the sentence does not pretend there is.
    expect(labelSentence(fx('high', null))).toBe('You rate this kind of thing well.');
  });
  it('ends each bar in a word', () => {
    expect(axisWord('taste', 'high')).toBe('above usual');
    expect(axisWord('pull', 'high')).toBe('high');
    expect(axisWord('pull', 'usual')).toBe('usual');
  });
});

describe('the odds line', () => {
  const odds = { all: { 'safe-bet': 1.17, usual: 0.94, bycatch: 0.47 }, movie: { 'safe-bet': 1.44 } };
  it('names the medium and reads the ratio in words', () => {
    expect(oddsLine('safe-bet', 'movie', odds)).toBe('Films like this: an 8 or more about 1.4× as often as usual.');
    expect(oddsLine('usual', 'movie', odds)).toBe('Films like this: an 8 or more about as often as usual.');
    expect(oddsLine('bycatch', 'game', odds)).toBe('Games like this: an 8 or more about half as often as usual.');
  });
  it('falls back to every medium, and says nothing it does not know', () => {
    expect(oddsLine('safe-bet', 'game', odds)).toBe('Games like this: an 8 or more about 1.2× as often as usual.');
    expect(oddsLine('safe-bet', undefined, odds)).toBe('Titles like this: an 8 or more about 1.2× as often as usual.');
    expect(oddsLine('hidden-gem', 'movie', odds)).toBeNull();
  });
});

describe('the rows', () => {
  it('puts counted rows first by what they add, and rows left out last', () => {
    const rows = [reason('left out', 0, { capped: true, impact: 9 }), reason('minus', -3), reason('plus', 4), reason('small', 1)];
    expect(sortReasons(rows).map((r) => r.label)).toEqual(['plus', 'small', 'minus', 'left out']);
  });
  it('splits by axis and keeps the left-out rows apart', () => {
    const rows = [reason('a', 2), reason('b', 5, { axis: 'pull', times: 3, titles: 4 }), reason('c', 0, { capped: true, impact: -3 }), reason('d', 1, { axis: 'pull' })];
    expect(axisRows(rows, 'taste').map((r) => r.label)).toEqual(['a']);
    expect(axisRows(rows, 'pull').map((r) => r.label)).toEqual(['b', 'd']);
    expect(cappedRows(rows).map((r) => r.label)).toEqual(['c']);
  });
  it('reads a row as one sentence with its count', () => {
    expect(tasteSentence(reason('noir', 2, { BA: 7.64, n: 41 }))).toBe('you rate it 7.6 over 41 titles');
    expect(tasteSentence(reason('Tim Burton', 2, { kind: 'person', role: 'director', BA: 7.5, n: 1 }))).toBe('you rate them 7.5 over 1 title');
  });
  it('says a pull row in Nils\'s words: how many times more or less often than average, and the titles behind it', () => {
    const pull = (over: Partial<ScoreReason>) => reason('anime', 3, { axis: 'pull', ...over });
    expect(pullSentence(pull({ times: 4.6, titles: 88, media: ['movie'] }))).toBe('you pick it 5 times more often than average (88 of your films)');
    expect(pullSentence(pull({ times: 4.6, titles: 88, media: ['movie', 'show'] }), 'anime')).toBe('You pick anime 5 times more often than average (88 of your titles)');
    expect(pullSentence(pull({ times: 1 / 3, titles: 2, media: ['movie'] }), 'musicals')).toBe('You pick musicals 3 times less often than average (2 of your films)');
    expect(pullSentence(pull({ times: 1.44, titles: 12, media: ['game'] }))).toBe('you pick it 1.4 times more often than average (12 of your games)');
    expect(pullSentence(pull({ kind: 'person', times: 6, titles: 12, media: ['movie'] }))).toBe('you pick them 6 times more often than average (12 of your films)');
    // No titles behind it: no count.
    expect(pullSentence(pull({ times: 0.25, titles: 0, media: [] }))).toBe('you pick it 4 times less often than average');
    expect(pullSentence(pull({ followed: 'follow', titles: 3, media: ['book'] }), 'steampunk')).toBe('You follow steampunk (3 of your books)');
    expect(pullSentence(pull({ followed: 'avoid' }))).toBe('you asked not to be shown it');
  });
});

describe('where a reason leads', () => {
  it('goes to the page the item page links the same thing to', () => {
    expect(reasonHref(reason('Science Fiction', 1))).toBe('/tag/science-fiction');
    expect(reasonHref(reason('Christopher Nolan', 1, { kind: 'person', role: 'director' }))).toBe('/person/christopher-nolan');
    expect(reasonHref(reason('Warner Bros. Pictures', 1, { kind: 'company', role: 'studio' }))).toMatch(/^\/studio\/warner/);
  });
  it('has a page for a franchise, under the key every spelling of its name shares', () => {
    expect(reasonHref(reason('Alien Collection', 1, { kind: 'ip', role: 'ip' }))).toBe('/franchise/alien');
  });
});

describe('a contribution as text', () => {
  it('always carries its sign and one decimal', () => {
    expect(signed(4.25)).toBe('+4.3');
    expect(signed(0)).toBe('+0.0');
    expect(signed(-1)).toBe('−1.0');
  });
});
