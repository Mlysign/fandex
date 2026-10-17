import { describe, expect, it } from 'vitest';
import { nextBarState } from './barScroll';

describe('the list header on a phone', () => {
  it('always shows near the top', () => {
    expect(nextBarState(40, 400)).toEqual({ anchor: 40, hidden: false });
  });
  it('hides on a step down, and is back on the first step up, wherever the list is', () => {
    expect(nextBarState(300, 290)).toEqual({ anchor: 300, hidden: true });
    expect(nextBarState(1500, 1505)).toEqual({ anchor: 1500, hidden: false });
  });
  it('ignores a jitter of a few pixels', () => {
    expect(nextBarState(300, 296)).toBeNull();
    expect(nextBarState(300, 303)).toBeNull();
  });
});
