import { describe, expect, it, vi } from 'vitest';

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));

import { setReturnTo, signInLanding, takeReturnTo } from './returnTo';

describe('coming back to a title after signing in', () => {
  it('gives the address back once', () => {
    setReturnTo('/movie/alien');
    expect(takeReturnTo()).toBe('/movie/alien');
    expect(takeReturnTo()).toBeNull();
  });

  it('never leaves the app: an outside address is not kept', () => {
    setReturnTo('https://example.com/');
    expect(takeReturnTo()).toBeNull();
    setReturnTo('//example.com/x');
    expect(takeReturnTo()).toBeNull();
  });

  it('lapses after fifteen minutes', () => {
    setReturnTo('/show/severance');
    expect(takeReturnTo(Date.now() + 16 * 60 * 1000)).toBeNull();
  });
});

describe('an address a browser would read as another host', () => {
  it('is not kept: a slash and a backslash is two slashes to a browser', () => {
    setReturnTo('/\\evil.example');
    expect(takeReturnTo()).toBeNull();
    setReturnTo('/movie/alien\\..');
    expect(takeReturnTo()).toBeNull();
  });
});

describe('signInLanding', () => {
  it('lands a new account on Home, wherever it signed in', () => {
    expect(signInLanding('created', '/profile')).toBe('/');
    expect(signInLanding('created', '/wishlist')).toBe('/');
  });

  it('lands a sign-in made on You on Home', () => {
    expect(signInLanding('signed-in', '/profile')).toBe('/');
    expect(signInLanding('signed-in', '/profile?return=/movie/x')).toBe('/');
  });

  it('keeps a sign-in made on another page there', () => {
    expect(signInLanding('signed-in', '/wishlist')).toBeNull();
  });

  it('keeps adding a way in from Settings where it is', () => {
    expect(signInLanding('linked', '/profile')).toBeNull();
    expect(signInLanding('merged', '/settings')).toBeNull();
    expect(signInLanding(null, '/settings')).toBeNull();
  });
});
