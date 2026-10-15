import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({}));
vi.mock('~/lib/storage', () => ({ secretGet: vi.fn(), secretSet: vi.fn(), secretDelete: vi.fn() }));

import { secretGet } from '~/lib/storage';
import { activationUrl, codeFromRedirect, traktAccessToken, TraktAuthError, traktSignInMessage } from './trakt';

describe('the address Trakt sends the person back to', () => {
  it('gives up the code when the state is the one this sign-in sent', () => {
    expect(codeFromRedirect('fandex://auth/trakt?code=abc123&state=s1', 's1')).toBe('abc123');
  });

  it('refuses a redirect carrying a different state, or none', () => {
    expect(codeFromRedirect('fandex://auth/trakt?code=abc123&state=other', 's1')).toBeNull();
    expect(codeFromRedirect('fandex://auth/trakt?code=abc123', 's1')).toBeNull();
  });

  it('has nothing to exchange when Trakt sent an error instead of a code', () => {
    expect(codeFromRedirect('fandex://auth/trakt?error=access_denied&state=s1', 's1')).toBeNull();
    expect(codeFromRedirect('fandex://auth/trakt', 's1')).toBeNull();
  });
});

describe('the activation page', () => {
  it('carries the code, so nobody types it', () => {
    expect(activationUrl({ verificationUrl: 'https://trakt.tv/activate', userCode: 'AB12CD34' }))
      .toBe('https://trakt.tv/activate/AB12CD34');
    expect(activationUrl({ verificationUrl: 'https://auth.trakt.tv/activate/', userCode: 'AB12CD34' }))
      .toBe('https://auth.trakt.tv/activate/AB12CD34');
  });
});

describe('telling a device with no Trakt sign-in from one Trakt dropped', () => {
  it('says "not signed in yet", not "again", when the device never held one', async () => {
    vi.mocked(secretGet).mockResolvedValueOnce(null);
    const e = await traktAccessToken().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(TraktAuthError);
    expect((e as TraktAuthError).hadSignIn).toBe(false);
    const msg = traktSignInMessage(e as TraktAuthError, 'You can do that under You.');
    expect(msg).toMatch(/is not signed in to Trakt yet\. You can do that under You\.$/);
    expect(msg).not.toMatch(/again/);
  });

  it('says "again" when Trakt dropped a sign-in this device had', () => {
    expect(traktSignInMessage(new TraktAuthError(), '')).toBe('Trakt needs you to sign in again.');
  });
});
