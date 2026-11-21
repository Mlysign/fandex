import type { SQLiteDatabase } from 'expo-sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// The phone's side of the reminders: only this feature's own are touched, a
// moved date replaces its reminder, and a failed season request cancels
// nothing (a failure is never "no new seasons").

const n = vi.hoisted(() => {
  const set = new Map<string, { identifier: string; content: { title: string; body: string } }>();
  return {
    set,
    api: {
      getPermissionsAsync: vi.fn(async () => ({ granted: true, canAskAgain: true })),
      requestPermissionsAsync: vi.fn(async () => ({ granted: true, canAskAgain: true })),
      setNotificationHandler: vi.fn(),
      setNotificationChannelAsync: vi.fn(async () => null),
      getAllScheduledNotificationsAsync: vi.fn(async () => [...set.values()]),
      cancelScheduledNotificationAsync: vi.fn(async (id: string) => { set.delete(id); }),
      scheduleNotificationAsync: vi.fn(async (r: { identifier: string; content: { title: string; body: string } }) => {
        set.set(r.identifier, { identifier: r.identifier, content: r.content });
        return r.identifier;
      }),
      AndroidImportance: { DEFAULT: 3 },
      SchedulableTriggerInputTypes: { DATE: 'date' },
    },
  };
});
vi.mock('expo-notifications', () => n.api);
vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
const plan = vi.hoisted(() => ({ releases: vi.fn(), seasons: vi.fn() }));
vi.mock('~/lib/releaseReminders', async (orig) => ({
  ...(await orig<typeof import('./releaseReminders')>()),
  wishlistReleases: plan.releases,
  seasonStarts: plan.seasons,
  readReminderPrefs: async () => ({ releases: true, seasons: true }),
}));
const meta = vi.hoisted(() => new Map<string, string>());
vi.mock('~/lib/db', () => ({
  getMeta: async (_db: unknown, k: string) => meta.get(k) ?? null,
  setMeta: async (_db: unknown, k: string, v: string) => { meta.set(k, v); },
}));

const { syncReminders } = await import('./reminderScheduler');
const db = {} as SQLiteDatabase;
const NOW = new Date(2026, 10, 21, 8, 0, 0);
const film = (date: string) => ({ id: 'film', type: 'movie', title: 'Dune: Part Three', slug: 'dune-part-three', release_date: date });
const season = { id: 'sev', title: 'Severance', slug: 'severance', season: 3, release_date: '2026-12-04' };

beforeEach(() => {
  n.set.clear();
  meta.clear();
  vi.clearAllMocks();
  n.set.set('someone-else', { identifier: 'someone-else', content: { title: 'x', body: 'y' } });
});

describe('setting the reminders on the phone', () => {
  it('sets both kinds, then replaces a moved date and leaves everything else alone', async () => {
    plan.releases.mockResolvedValue([film('2026-12-18')]);
    plan.seasons.mockResolvedValue([season]);
    expect(await syncReminders(db, true, { now: NOW })).toMatchObject({ scheduled: 2, cancelled: 0, permission: 'granted' });

    plan.releases.mockResolvedValue([film('2026-12-20')]);
    expect(await syncReminders(db, true, { now: NOW })).toMatchObject({ scheduled: 1, cancelled: 1 });
    expect([...n.set.keys()].sort()).toEqual(['fandex-release:film:2026-12-20', 'fandex-season:sev:3:2026-12-04', 'someone-else']);
  });

  it('keeps the season reminders when the season dates fail to load', async () => {
    plan.releases.mockResolvedValue([]);
    plan.seasons.mockResolvedValue([season]);
    await syncReminders(db, true, { now: NOW });
    plan.seasons.mockRejectedValue(new Error('offline'));
    expect(await syncReminders(db, true, { now: NOW })).toMatchObject({ seasonsFailed: true, cancelled: 0 });
    expect(n.set.has('fandex-season:sev:3:2026-12-04')).toBe(true);
  });

  it('cancels only its own when signed out, and asks Android once on its own', async () => {
    plan.releases.mockResolvedValue([film('2026-12-18')]);
    plan.seasons.mockResolvedValue([]);
    n.api.getPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    n.api.requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: true });
    await syncReminders(db, true, { now: NOW });
    await syncReminders(db, true, { now: NOW });
    expect(n.api.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    await syncReminders(db, true, { now: NOW, ask: true });
    expect(n.api.requestPermissionsAsync).toHaveBeenCalledTimes(2);

    n.api.getPermissionsAsync.mockResolvedValue({ granted: true, canAskAgain: true });
    await syncReminders(db, true, { now: NOW });
    expect(n.set.has('fandex-release:film:2026-12-18')).toBe(true);
    await syncReminders(db, false, { now: NOW });
    expect([...n.set.keys()]).toEqual(['someone-else']);
  });
});
