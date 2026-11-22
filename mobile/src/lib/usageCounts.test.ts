import { beforeEach, describe, expect, it, vi } from 'vitest';

// The app's usage counts: totals in memory, one batch when the app goes to the
// background, at most 20 a day, once-a-day flags, and nothing at all when the
// switch is off. The counter is driven with the master switch on here; the
// app's own stays off until the privacy policy says otherwise.

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('~/lib/api', () => ({ api: { usageCounts: vi.fn() } }));
vi.mock('~/lib/db', () => ({ getMeta: vi.fn(), setMeta: vi.fn() }));

const {
  createUsageCounter, MAX_BATCHES_PER_DAY, recKey, screenKey, sessionBucket, USAGE_COUNTS_LIVE, usageCountsOn, USAGE_PREF_KEY,
} = await import('./usageCounts');

const meta = new Map<string, string>();
const sent: Record<string, number>[] = [];
let failSend = false;
let reminder = false;

const make = (live = true) => createUsageCounter({
  live,
  getMeta: async (k) => meta.get(k) ?? null,
  setMeta: async (k, v) => { meta.set(k, v); },
  send: async (c) => { if (failSend) throw new Error('offline'); sent.push(c); },
  hasReminder: async () => reminder,
});

const T0 = Date.UTC(2026, 10, 22, 10, 0, 0);
const MIN = 60_000;

beforeEach(() => {
  meta.clear();
  sent.length = 0;
  failSend = false;
  reminder = false;
});

describe('the master switch', () => {
  it('is off, and so is the app counter', () => {
    expect(USAGE_COUNTS_LIVE).toBe(false);
    expect(usageCountsOn).toBe(false);
  });

  it('counts and sends nothing while off', async () => {
    const u = make(false);
    u.active(T0);
    u.count('why');
    expect(u.pending()).toEqual({});
    expect(await u.flush(T0 + MIN)).toBe(0);
    expect(sent).toEqual([]);
  });
});

describe('buckets and keys', () => {
  it('puts a visit in its length bucket', () => {
    expect(sessionBucket(59_000)).toBe('session:under1');
    expect(sessionBucket(MIN)).toBe('session:1to5');
    expect(sessionBucket(5 * MIN - 1)).toBe('session:1to5');
    expect(sessionBucket(5 * MIN)).toBe('session:5to15');
    expect(sessionBucket(15 * MIN)).toBe('session:over15');
  });

  it('maps the app routes to screens and skips the rest', () => {
    expect(screenKey('/')).toBe('screen:home');
    expect(screenKey('/discover')).toBe('screen:search');
    expect(screenKey('/calendar')).toBe('screen:calendar');
    expect(screenKey('/movie/dune')).toBe('screen:title');
    expect(screenKey('/item/abc')).toBe('screen:title');
    expect(screenKey('/person/denis-villeneuve')).toBe('screen:facet');
    expect(screenKey('/tag/time-loop')).toBe('screen:facet');
    expect(screenKey('/profile')).toBeNull();
    expect(screenKey('/dev/usage')).toBeNull();
    expect(screenKey('/import')).toBeNull();
  });

  it('counts a recommendation by the types the server takes', () => {
    expect(recKey('movie')).toBe('rec:movie');
    expect(recKey('book')).toBe('rec:book');
    expect(recKey('boardgame')).toBeNull();
  });
});

describe('a batch', () => {
  it('sends the visit as one batch with its length, then starts empty', async () => {
    const u = make();
    u.active(T0);
    u.count('screen:home');
    u.count('screen:home');
    u.count('import');
    expect(await u.flush(T0 + 3 * MIN)).toBeGreaterThan(0);
    expect(sent).toEqual([{ 'screen:home': 2, import: 1, 'session:1to5': 1, day: 1 }]);
    expect(u.pending()).toEqual({});
  });

  it('drops a batch that fails to send, and keeps nothing for later', async () => {
    const u = make();
    u.active(T0);
    u.count('why');
    failSend = true;
    expect(await u.flush(T0 + MIN)).toBe(0);
    expect(u.pending()).toEqual({});
    failSend = false;
    u.active(T0 + 2 * MIN);
    u.count('screen:calendar');
    await u.flush(T0 + 2 * MIN + 1000);
    // The flags were not spent by the failed batch; the why count is gone.
    expect(sent).toEqual([{ 'screen:calendar': 1, 'session:under1': 1, day: 1 }]);
  });

  it('sends at most 20 batches a UTC day, and starts again the next day', async () => {
    const u = make();
    for (let i = 0; i < MAX_BATCHES_PER_DAY + 3; i++) {
      u.active(T0 + i * 1000);
      u.count('screen:home');
      await u.flush(T0 + i * 1000 + 500);
    }
    expect(sent).toHaveLength(MAX_BATCHES_PER_DAY);
    u.active(T0 + 86_400_000);
    u.count('screen:home');
    await u.flush(T0 + 86_400_000 + 500);
    expect(sent).toHaveLength(MAX_BATCHES_PER_DAY + 1);
  });
});

describe('the once-a-day flags', () => {
  it('sends each flag at most once a UTC day', async () => {
    reminder = true;
    const u = make();
    u.active(T0);
    u.count('why');
    await u.flush(T0 + 1000);
    u.active(T0 + MIN);
    u.count('why');
    await u.flush(T0 + MIN + 1000);
    expect(sent[0]).toMatchObject({ why: 1, day: 1, 'day:why': 1, 'day:reminder': 1 });
    expect(sent[1]).toEqual({ why: 1, 'session:under1': 1 });

    u.active(T0 + 86_400_000);
    await u.flush(T0 + 86_400_000 + 1000);
    expect(sent[2]).toEqual({ 'session:under1': 1, day: 1, 'day:reminder': 1 });
  });

  it('raises day:why only on a day a Why was opened, and day:reminder only with a reminder set', async () => {
    const u = make();
    u.active(T0);
    await u.flush(T0 + 1000);
    expect(sent[0]).toEqual({ 'session:under1': 1, day: 1 });
  });
});

describe('the switch in Settings', () => {
  it('is on by default', async () => {
    expect(await make().isEnabled()).toBe(true);
  });

  it('off throws away what is held and counts nothing more', async () => {
    const u = make();
    u.active(T0);
    u.count('why');
    await u.setEnabled(false, T0 + 1000);
    expect(meta.get(USAGE_PREF_KEY)).toBe('0');
    expect(u.pending()).toEqual({});
    u.count('screen:home');
    expect(u.pending()).toEqual({});
    expect(await u.flush(T0 + 2000)).toBe(0);
    expect(sent).toEqual([]);
  });

  it('a stored off is honoured on the next start, and anything counted before it was read is dropped', async () => {
    meta.set(USAGE_PREF_KEY, '0');
    const u = make();
    u.count('screen:home');
    u.active(T0);
    expect(await u.flush(T0 + 1000)).toBe(0);
    expect(sent).toEqual([]);
    expect(u.pending()).toEqual({});
  });
});
