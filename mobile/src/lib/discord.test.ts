import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({ getRandomBytes: (n: number) => new Uint8Array(n).fill(7) }));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('~/lib/config', () => ({ DISCORD_CLIENT_ID: '1200000000000000001', GOOGLE_CLIENT_ID: '' }));

const { discordAuthorizeUrl, readDiscordReturn } = await import('./discord');

const pending = { state: 'abc', returnTo: '/calendar' };

describe('reading what Discord sent back', () => {
  it('takes the token when the state is the one this sign-in made', () => {
    expect(readDiscordReturn('#token_type=Bearer&access_token=tok&expires_in=604800&scope=identify&state=abc', pending))
      .toEqual({ ok: true, accessToken: 'tok', returnTo: '/calendar' });
  });

  it('refuses a token that comes back with another state, or to a tab that started nothing', () => {
    // A token planted in this browser to sign it in to somebody else's account.
    expect(readDiscordReturn('#access_token=tok&state=evil', pending)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(readDiscordReturn('#access_token=tok&state=abc', null)).toMatchObject({ ok: false, reason: 'unknown', returnTo: '/profile' });
  });

  it('reads "no" at Discord as a decision, not a failure', () => {
    expect(readDiscordReturn('#error=access_denied&state=abc', pending)).toEqual({ ok: false, reason: 'declined', returnTo: '/calendar' });
  });

  it('never returns to a return screen or another site', () => {
    expect(readDiscordReturn('#access_token=t&state=abc', { state: 'abc', returnTo: '/auth/discord' }).returnTo).toBe('/profile');
    expect(readDiscordReturn('#access_token=t&state=abc', { state: 'abc', returnTo: '//evil.example' }).returnTo).toBe('/profile');
  });
});

describe("Discord's sign-in address", () => {
  it('asks for who you are and nothing else, as a token', () => {
    const url = new URL(discordAuthorizeUrl({ clientId: '1200000000000000001', redirectUri: 'https://fandex.org/auth/discord', state: 's' }));
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: '1200000000000000001', redirect_uri: 'https://fandex.org/auth/discord', response_type: 'token', scope: 'identify', state: 's',
    });
  });
});

describe("a phone's sign-in, returned through the site (2026-10-24)", () => {
  it('is handed on to the app only when its state is an app state', async () => {
    const { appReturnUrl, DISCORD_APP_STATE_PREFIX } = await import('~/lib/discord');
    expect(appReturnUrl(`#access_token=t&state=${DISCORD_APP_STATE_PREFIX}abc`)).toBe(`fandex://auth/discord#access_token=t&state=${DISCORD_APP_STATE_PREFIX}abc`);
    expect(appReturnUrl('#access_token=t&state=abc')).toBeNull();
    expect(appReturnUrl('#error=access_denied')).toBeNull();
  });
});
