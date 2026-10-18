import { describe, expect, it } from 'vitest';
import type { ScoreReason } from '~/lib/fandexScore';
import { reasonHref, scoreBand, scoreReasonLine, signed, sortReasons } from '~/lib/scoreReasons';

const reason = (label: string, contribution: number, over: Partial<ScoreReason> = {}): ScoreReason => ({
  kind: 'tag', label, contribution, impact: contribution, BA: 7, n: 4, ...over,
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

describe('the one line under the number', () => {
  it('names the band and the strongest counted reason', () => {
    expect(scoreReasonLine(92, 75, reason('Thriller', 6))).toBe('Strong match. You rate Thriller highly.');
    expect(scoreReasonLine(60, 75, reason('Musical', -5))).toBe('Weak match. You rate Musical lower than most.');
  });
  it('says so plainly when nothing counted', () => {
    expect(scoreReasonLine(75, 75, undefined)).toBe('Typical match for your taste.');
  });
});

describe('the order of the breakdown', () => {
  it('puts counted rows first by what they add, and rows left out last', () => {
    const rows = [reason('left out', 0, { capped: true, impact: 9 }), reason('minus', -3), reason('plus', 4), reason('small', 1)];
    expect(sortReasons(rows).map((r) => r.label)).toEqual(['plus', 'small', 'minus', 'left out']);
  });
});

describe('where a reason leads', () => {
  it('goes to the page the item page links the same thing to', () => {
    expect(reasonHref(reason('Science Fiction', 1))).toBe('/tag/science-fiction');
    expect(reasonHref(reason('Christopher Nolan', 1, { kind: 'person', role: 'director' }))).toBe('/person/christopher-nolan');
    expect(reasonHref(reason('Warner Bros. Pictures', 1, { kind: 'company', role: 'studio' }))).toMatch(/^\/studio\/warner/);
  });
  it('has nowhere to go for a franchise', () => {
    // A franchise has a page since 2026-10-18, under the key every spelling of its name shares.
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
