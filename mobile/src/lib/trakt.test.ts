import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({}));
vi.mock('~/lib/storage', () => ({ secretGet: vi.fn(), secretSet: vi.fn(), secretDelete: vi.fn() }));

import { activationUrl, codeFromRedirect } from './trakt';

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
