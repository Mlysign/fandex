import { describe, expect, it } from 'vitest';
import { fuzzyMatches, withinOneEdit } from './fuzzySearch';

describe('one slip per word (RV9)', () => {
  it('forgives one missing, extra, wrong or swapped letter', () => {
    expect(withinOneEdit('witchr', 'witcher')).toBe(true);
    expect(withinOneEdit('cyberpnk', 'cyberpunk')).toBe(true);
    expect(withinOneEdit('zeldaa', 'zelda')).toBe(true);
    expect(withinOneEdit('zelfa', 'zelda')).toBe(true);
    expect(withinOneEdit('zedla', 'zelda')).toBe(true);
    expect(withinOneEdit('wtchrr', 'witcher')).toBe(false);
  });

  it('finds the titles the review searched for', () => {
    expect(fuzzyMatches('the witcher 3 wild hunt', 'witchr')).toBe(true);
    expect(fuzzyMatches('cyberpunk 2077', 'cyberpnk')).toBe(true);
    expect(fuzzyMatches('cyberpunk 2077', 'cyberpn')).toBe(true);
    expect(fuzzyMatches('the lord of the rings', 'lord of the rigns')).toBe(true);
  });

  it('keeps short words exact and needs every word', () => {
    expect(fuzzyMatches('star wars', 'star wsr')).toBe(false);
    expect(fuzzyMatches('the witcher 3 wild hunt', 'witchr zelda')).toBe(false);
    expect(fuzzyMatches('witchright hall', 'witcher')).toBe(false);
  });
});
