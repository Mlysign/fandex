import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetRegionalDates, ownWindow, placeInMonth, regionalDates } from './regionalDates';

vi.mock('~/lib/api', () => ({ api: {} }));

beforeEach(forgetRegionalDates);

const answer = (dates: Record<string, string>) => vi.fn(async (_region: string, _ids: string[]) => ({ dates }));

describe('the dates of your films where you live', () => {
  it('asks once per film and country, and not again for an answer it has', async () => {
    const ask = answer({ a: '2026-10-01' });
    expect(await regionalDates('DE', ['a', 'b', 'a'], ask)).toEqual(new Map([['a', '2026-10-01']]));
    expect(ask).toHaveBeenCalledWith('DE', ['a', 'b']);

    // "b" was answered too: no date of its own there. Only "c" is new.
    await regionalDates('DE', ['a', 'b', 'c'], ask);
    expect(ask).toHaveBeenLastCalledWith('DE', ['c']);
    await regionalDates('DE', ['a', 'b', 'c'], ask);
    expect(ask).toHaveBeenCalledTimes(2);

    // Another country is another answer.
    await regionalDates('FR', ['a'], ask);
    expect(ask).toHaveBeenLastCalledWith('FR', ['a']);
  });

  it('splits a long list at the cap on ids per request', async () => {
    const ask = answer({});
    await regionalDates('DE', Array.from({ length: 450 }, (_, i) => `id-${i}`), ask);
    expect(ask.mock.calls.map((c) => c[1].length)).toEqual([200, 200, 50]);
  });

  it('remembers nothing from a call that failed, so the next look asks again', async () => {
    const down = vi.fn(async () => { throw new Error('offline'); });
    await expect(regionalDates('DE', ['a'], down)).rejects.toThrow('offline');
    const ask = answer({ a: '2026-10-01' });
    expect((await regionalDates('DE', ['a'], ask)).get('a')).toBe('2026-10-01');
    expect(ask).toHaveBeenCalledTimes(1);
  });
});

describe('placing your titles in a month', () => {
  const rows = [
    { id: 'digger', release_date: '2026-09-28' },
    { id: 'verity', release_date: '2026-09-30' },
    { id: 'show', release_date: '2026-10-04' },
    { id: 'undated', release_date: null },
  ];
  const dates = new Map([['digger', '2026-10-01']]);

  it('moves a film to the month it opens in where you live, and out of the one it left', () => {
    expect(placeInMonth(rows, dates, '2026-10')).toEqual([
      { id: 'digger', release_date: '2026-10-01' },
      { id: 'show', release_date: '2026-10-04' },
    ]);
    expect(placeInMonth(rows, dates, '2026-09').map((r) => r.id)).toEqual(['verity']);
  });

  it('keeps the device date for everything when there is no answer', () => {
    expect(placeInMonth(rows, new Map(), '2026-09').map((r) => r.id)).toEqual(['digger', 'verity']);
  });

  it('reads a year back and a month ahead of the month shown', () => {
    expect(ownWindow('2026-10')).toEqual({ from: '2025-10-01', to: '2026-12-01' });
    expect(ownWindow('2026-01')).toEqual({ from: '2025-01-01', to: '2026-03-01' });
  });
});
