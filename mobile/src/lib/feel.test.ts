import { describe, expect, it, vi } from 'vitest';

vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));

const { FEEL, ratingPulses, ratingTier } = await import('./feel');

describe('rating feel', () => {
  it('celebrates more as the number climbs', () => {
    expect([1, 4, 5, 7, 8, 9, 10, null].map(ratingTier)).toEqual(['low', 'low', 'mid', 'mid', 'high', 'high', 'top', 'clear']);
    expect(FEEL.sparks.low).toBeLessThan(FEEL.sparks.mid);
    expect(FEEL.sparks.mid).toBeLessThan(FEEL.sparks.high);
    expect(FEEL.sparks.high).toBeLessThan(FEEL.sparks.top);
  });

  it('every pick ends in a click with a softer tick behind it (the Bubblewrap pop)', () => {
    for (let n = 1; n <= 10; n++) {
      const pulses = ratingPulses(n);
      const tail = pulses[pulses.length - 1];
      const click = pulses[pulses.length - 2];
      expect(click[0]).toBe(0);
      expect(tail[0]).toBe(1);
      expect(tail[2]).toBe(FEEL.tailDelayMs);
      expect(tail[1]).toBeLessThanOrEqual(click[1]);
    }
  });

  it('a higher rating never hits softer, and every strength is within 0 to 1', () => {
    const peak = (n: number) => Math.max(...ratingPulses(n).map((p) => p[1]));
    for (let n = 2; n <= 10; n++) expect(peak(n)).toBeGreaterThanOrEqual(peak(n - 1));
    for (let n = 1; n <= 10; n++) for (const p of ratingPulses(n)) { expect(p[1]).toBeGreaterThan(0); expect(p[1]).toBeLessThanOrEqual(1); }
  });

  it('taking a rating away is one soft tick, not a celebration', () => {
    expect(ratingPulses(null)).toEqual([[1, 0.5, 0]]);
  });
});
