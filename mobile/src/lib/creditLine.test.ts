import { describe, expect, it } from 'vitest';
import { creditLine, creditWithParts, tmdbRole } from '~/lib/creditLine';

describe("a title's credit line on a person's or a studio's page", () => {
  it('names the roles once each, makers before cast', () => {
    expect(creditLine('movie', ['cast', 'writer', 'director', 'writer'])).toBe('Director · Writer · Cast');
    expect(creditLine('game', ['publisher', 'developer'])).toBe('Developer · Publisher');
  });

  it('calls the one shared role by what it means for the medium', () => {
    expect(creditLine('book', ['creator'])).toBe('Author');
    expect(creditLine('boardgame', ['creator'])).toBe('Designer');
    expect(creditLine('show', ['creator'])).toBe('Creator');
  });

  it('says nothing for a title with no role, as on a tag page', () => {
    expect(creditLine('movie', [])).toBeNull();
    expect(creditLine('movie', [undefined, null])).toBeNull();
  });

  it('adds the parts played after the roles, each once', () => {
    expect(creditWithParts('movie', ['director'], ['Tony Stark', 'Tony Stark '])).toBe('Director · as Tony Stark');
    expect(creditWithParts('show', [], ['Rachel', 'Dr. Grey'])).toBe('as Rachel, Dr. Grey');
    expect(creditWithParts('movie', [], [''])).toBeNull();
  });

  it('files every TMDB author job but Director and Creator as a writer', () => {
    expect(tmdbRole('Director')).toBe('director');
    expect(tmdbRole('Creator')).toBe('creator');
    expect(tmdbRole('Screenplay')).toBe('writer');
    expect(tmdbRole('Novel')).toBe('writer');
  });
});
