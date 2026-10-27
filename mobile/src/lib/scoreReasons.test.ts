import { describe, expect, it } from 'vitest';
import type { ScoreReason } from '~/lib/fandexScore';
import type { MediumCalibration } from '~/lib/scoreCalibration';
import { axisRows, calibrationLine, cappedRows, centreSentence, pullLine, pullSentence, ratingOf, reasonHref, rungLine, scoreSentence, signed, sortReasons, tasteSentence } from '~/lib/scoreReasons';

const reason = (label: string, contribution: number, over: Partial<ScoreReason> = {}): ScoreReason => ({
  axis: 'taste', kind: 'tag', key: label.toLowerCase(), label, contribution, impact: contribution, BA: 7, n: 4, ...over,
});

describe('the sentence under the number (2026-10-27)', () => {
  it('reads the score as the rating you would give, a whole number', () => {
    expect(ratingOf(72)).toBe(7);
    expect(ratingOf(65)).toBe(7);
    expect(ratingOf(64.9)).toBe(6);
    expect(scoreSentence({ score: 72, band: 'high' }, 'movie')).toBe("You'd probably give this a 7, above your usual for films.");
    expect(scoreSentence({ score: 63, band: 'usual' }, 'game')).toBe("You'd probably give this a 6, about your usual for games.");
    expect(scoreSentence({ score: 48, band: 'low' }, 'show')).toBe("You'd probably give this a 5, below your usual for shows.");
    expect(scoreSentence({ score: 80, band: 'high' })).toBe("You'd probably give this an 8, above your usual for titles.");
  });
  it('anchors the number on your average for the medium', () => {
    expect(centreSentence(64.1, 'movie')).toBe('You give films 6.4 on average.');
    expect(centreSentence(72.6, 'game', true)).toBe('You give games 7.3 on average, this one left out.');
  });
});

describe('the pull line, beside the number', () => {
  it('says how many times more or less often you pick this kind of thing, and nothing without a pull axis', () => {
    expect(pullLine({ points: 5, band: 'high', times: 3.2 }, 'movie')).toBe('You pick films like this 3 times more often than average.');
    expect(pullLine({ points: -3, band: 'low', times: 0.5 }, 'game')).toBe('You pick games like this 2 times less often than average.');
    expect(pullLine({ points: -1.5, band: 'usual', times: 0.62 }, 'game')).toBe('You pick games like this 1.6 times less often than average.');
    expect(pullLine({ points: 0.4, band: 'usual', times: 1.1 }, 'show')).toBe('You pick shows like this about as often as average.');
    expect(pullLine(null, 'movie')).toBeNull();
  });
});

describe('the honesty lines', () => {
  const cal = (over: Partial<MediumCalibration> = {}): MediumCalibration => ({
    medium: 'movie', n: 939, withinOne: 413, withinTwo: 714, bins: [], bands: { high: [0, 0], usual: [0, 0], low: [0, 0] },
    rungs: [{ lo: 0, hi: 50, n: 18, mean: 4.5 }, { lo: 50, hi: 60, n: 90, mean: 5.6 }, { lo: 60, hi: 65, n: 230, mean: 6.1 }, { lo: 65, hi: 70, n: 505, mean: 6.6 }, { lo: 70, hi: 75, n: 92, mean: 7.4 }, { lo: 75, hi: 80, n: 4, mean: 7.5 }, { lo: 80, hi: 101, n: 0, mean: 0 }],
    ...over,
  });
  it('quotes the device\'s own measurement, per medium', () => {
    expect(calibrationLine(cal())).toBe('On the 939 films you rated, it was within one point of your rating 44% of the time, and within two 76%.');
    expect(calibrationLine(cal({ medium: 'all', n: 1696, withinOne: 695, withinTwo: 1290 }))).toBe('On the 1696 titles you rated, it was within one point of your rating 41% of the time, and within two 76%.');
  });
  it('says nothing on too few titles', () => {
    expect(calibrationLine(cal({ n: 14, withinOne: 6, withinTwo: 10 }))).toBeNull();
    expect(calibrationLine(null)).toBeNull();
  });
  it('names the rung the score sits on, with what you gave there', () => {
    expect(rungLine(cal(), 72)).toBe('When it said 70 to 75, you gave 7.4 on average (92 films).');
    expect(rungLine(cal(), 45)).toBe('When it said under 50, you gave 4.5 on average (18 films).');
    // Four titles on the rung: not enough to quote.
    expect(rungLine(cal(), 77)).toBeNull();
    expect(rungLine(cal({ rungs: [{ lo: 80, hi: 101, n: 90, mean: 8.4 }] }), 85)).toBe('When it said 80 or more, you gave 8.4 on average (90 films).');
  });
});

describe('the rows', () => {
  it('puts counted rows first by what they add, and rows left out last', () => {
    const rows = [reason('left out', 0, { capped: true, impact: 9 }), reason('minus', -3), reason('plus', 4), reason('small', 1)];
    expect(sortReasons(rows).map((r) => r.label)).toEqual(['plus', 'small', 'minus', 'left out']);
  });
  it('splits by axis, orders pull rows by their own points, and keeps the left-out rows apart', () => {
    // A pull row adds nothing to the score (contribution 0); its order is its own points (`impact`).
    const rows = [reason('a', 2), reason('b', 0, { axis: 'pull', impact: 2, times: 3, titles: 4 }), reason('c', 0, { capped: true, impact: -3 }), reason('d', 0, { axis: 'pull', impact: 5 })];
    expect(axisRows(rows, 'taste').map((r) => r.label)).toEqual(['a']);
    expect(axisRows(rows, 'pull').map((r) => r.label)).toEqual(['d', 'b']);
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
