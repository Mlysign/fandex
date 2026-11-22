import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(n).fill(7),
  digestStringAsync: async () => 'ab+/cd==',
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  CryptoEncoding: { BASE64: 'base64' },
}));
vi.mock('react-native', () => ({ Platform: { OS: 'web' } }));
vi.mock('~/lib/config', () => ({ DISCORD_CLIENT_ID: '', GOOGLE_CLIENT_ID: '' }));

const { appReturnUrl, newSteamConnect, readSteamReturn, steamOpenIdUrl } = await import('./steam');

const pending = { state: 'abc', secret: 'kept-here', returnTo: '/settings' };
const ID = 'https://steamcommunity.com/openid/id/76561197960287930';

/** What Steam puts on the return page for a sign-in started with `state`. */
function answer(state: string, over: Record<string, string> = {}): string {
  return new URLSearchParams({
    state,
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': ID,
    'openid.identity': ID,
    'openid.return_to': `https://fandex.org/auth/steam?state=${state}`,
    'openid.response_nonce': '2026-11-22T17:00:00Zx',
    'openid.assoc_handle': '1',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2ln',
    ...over,
  }).toString();
}

describe('the address to leave for', () => {
  it("asks Steam for whoever signs in, and to come back to this site's return page with the state", () => {
    const url = new URL(steamOpenIdUrl({ origin: 'https://fandex.org', state: 'app.s1' }));
    expect(url.origin + url.pathname).toBe('https://steamcommunity.com/openid/login');
    expect(url.searchParams.get('openid.mode')).toBe('checkid_setup');
    expect(url.searchParams.get('openid.realm')).toBe('https://fandex.org');
    expect(url.searchParams.get('openid.return_to')).toBe('https://fandex.org/auth/steam?state=app.s1');
    expect(url.searchParams.get('openid.claimed_id')).toBe('http://specs.openid.net/auth/2.0/identifier_select');
  });

  it('makes a secret that stays here and a state that is its hash, safe to put in an address', async () => {
    const made = await newSteamConnect('/settings', 'app.');
    expect(made.secret).toMatch(/^[0-9a-f]{64}$/);
    expect(made.state).toBe('app.ab-_cd');
    expect(made.state).not.toContain(made.secret);
    expect(made.returnTo).toBe('/settings');
  });
});

describe('reading what Steam sent back', () => {
  it('passes on every openid value, and only those, when the state is this window\'s', () => {
    const back = readSteamReturn(`?${answer('abc')}&utm=x`, pending);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.returnTo).toBe('/settings');
    expect(Object.keys(back.params).every((k) => k.startsWith('openid.'))).toBe(true);
    expect(back.params['openid.claimed_id']).toBe(ID);
    expect(back.params['openid.sig']).toBe('c2ln');
    expect(back.params.state).toBeUndefined();
    // The secret comes from this window's own keeping, never from the address.
    expect(back.secret).toBe('kept-here');
  });

  it('refuses an answer with another state, or one that reaches a tab that started nothing', () => {
    expect(readSteamReturn(answer('evil'), pending)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(readSteamReturn(answer('abc'), null)).toMatchObject({ ok: false, reason: 'unknown', returnTo: '/profile' });
  });

  it("refuses somebody else's answer pasted behind this window's state", () => {
    // The state beside the answer is right; the one inside what Steam signed is not.
    const planted = answer('abc', { 'openid.return_to': 'https://fandex.org/auth/steam?state=theirs' });
    expect(readSteamReturn(planted, pending)).toMatchObject({ ok: false, reason: 'unknown' });
    expect(readSteamReturn(answer('abc', { 'openid.return_to': 'not an address' }), pending)).toMatchObject({ ok: false, reason: 'unknown' });
  });

  it('reads "no" at Steam as a decision, not a failure', () => {
    expect(readSteamReturn('state=abc&openid.mode=cancel&openid.ns=x', pending)).toEqual({ ok: false, reason: 'declined', returnTo: '/settings' });
  });

  it('never returns to a return screen or another site', () => {
    expect(readSteamReturn(answer('abc'), { state: 'abc', secret: 's', returnTo: '/auth/steam' }).returnTo).toBe('/profile');
    expect(readSteamReturn(answer('abc'), { state: 'abc', secret: 's', returnTo: '//evil.example' }).returnTo).toBe('/profile');
  });
});

describe("a phone's answer arriving at the site", () => {
  it('is handed on to the app with everything Steam sent', () => {
    const q = answer('app.s1');
    expect(appReturnUrl(`?${q}`)).toBe(`fandex://auth/steam?${q}`);
  });

  it("stays on the site when it is the site's own", () => {
    expect(appReturnUrl(`?${answer('abc')}`)).toBeNull();
    expect(appReturnUrl('')).toBeNull();
  });
});
