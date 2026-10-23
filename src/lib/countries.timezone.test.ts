import { describe, expect, it } from "vitest";
import { countryOfTimeZone } from './countries';

describe('the country a time zone names (2026-10-23)', () => {
  it('reads Berlin as Germany and New York as the US, and names nothing it holds no data for', () => {
    expect(countryOfTimeZone('Europe/Berlin')).toBe('DE');
    expect(countryOfTimeZone('America/New_York')).toBe('US');
    expect(countryOfTimeZone('America/Los_Angeles')).toBe('US');
    expect(countryOfTimeZone('America/Toronto')).toBe('CA');
    expect(countryOfTimeZone('Asia/Dubai')).toBeNull();
    expect(countryOfTimeZone(undefined)).toBeNull();
  });
});
