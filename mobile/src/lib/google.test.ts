import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({}));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));

import { googleAuthorizeUrl, readGoogleReturn, safeReturnPath, type PendingGoogleSignIn } from './google';

const pending: PendingGoogleSignIn = { state: 's1', secret: 'x'.repeat(64), returnTo: '/wishlist?tab=progress' };

describe("the address of Google's sign-in page", () => {
  const url = new URL(googleAuthorizeUrl({ clientId: 'abc.apps.googleusercontent.com', origin: 'https://fandex.org', state: 's1', nonce: 'hash-of-the-secret' }));

  it('asks for an ID token and nothing that can call a Google API', () => {
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('id_token');
    expect(url.searchParams.get('client_id')).toBe('abc.apps.googleusercontent.com');
  });

  it('does not ask for the email address', () => {
    expect(url.searchParams.get('scope')).toBe('openid profile');
  });

  it('comes back to this site, on the address the OAuth client lists', () => {
    expect(url.searchParams.get('redirect_uri')).toBe('https://fandex.org/auth/google');
  });

  it('carries the hash and never the secret', () => {
    expect(url.searchParams.get('nonce')).toBe('hash-of-the-secret');
    expect(url.toString()).not.toContain(pending.secret);
  });
});

describe('what Google sent back', () => {
  it('gives up the token and the secret when the state is the one this tab sent', () => {
    expect(readGoogleReturn('#state=s1&id_token=aaa.bbb.ccc&authuser=0', pending)).toEqual({
      ok: true, idToken: 'aaa.bbb.ccc', secret: pending.secret, returnTo: '/wishlist?tab=progress',
    });
  });

  it('refuses a return this tab did not start', () => {
    // A link somebody was sent, with a token for the SENDER's account in it.
    expect(readGoogleReturn('#state=s1&id_token=aaa.bbb.ccc', null)).toMatchObject({ ok: false, reason: 'unknown', returnTo: '/profile' });
    expect(readGoogleReturn('#state=other&id_token=aaa.bbb.ccc', pending)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(readGoogleReturn('#id_token=aaa.bbb.ccc', pending)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(readGoogleReturn('#id_token=aaa.bbb.ccc', { ...pending, state: '' })).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('tells "said no at Google" apart from a failure', () => {
    expect(readGoogleReturn('#error=access_denied&state=s1', pending)).toEqual({ ok: false, reason: 'declined', returnTo: '/wishlist?tab=progress' });
    expect(readGoogleReturn('#error=server_error&state=s1', pending)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(readGoogleReturn('#state=s1', pending)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(readGoogleReturn('', pending)).toMatchObject({ ok: false, reason: 'unknown' });
  });
});

describe('the page to go back to', () => {
  it('keeps a page of this site', () => {
    expect(safeReturnPath('/settings')).toBe('/settings');
    expect(safeReturnPath('/movie/alien?x=1')).toBe('/movie/alien?x=1');
  });

  it('sends anything that could leave the site to You', () => {
    for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '', 'settings', '/a\\b', null, undefined, 7]) {
      expect(safeReturnPath(bad)).toBe('/profile');
    }
  });

  it('never goes back to the return screen itself', () => {
    expect(safeReturnPath('/auth/google')).toBe('/profile');
    expect(safeReturnPath('/auth/google?x=1')).toBe('/profile');
    expect(safeReturnPath('/auth/google#id_token=a')).toBe('/profile');
  });
});
