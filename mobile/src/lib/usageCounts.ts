// Anonymous usage counts from the Android app: totals, never events
// (worker/src/usage.ts is the other side, and its APP_COUNT_KEYS the list of
// what may be sent).
//
// A count is a Map increment in memory and nothing else: nothing per event is
// written to disk. When the app goes to the background the map goes out as ONE
// batch and is cleared, with the length of the visit that just ended as a
// bucket. At most MAX_BATCHES_PER_DAY batches a UTC day. A send that fails is
// dropped: no retry, no queue.
//
// The batch carries no session token, no install id and no device id. The
// share of devices that did something today comes from once-a-day flags
// (`day`, `day:why`, `day:reminder`): each is sent at most once per UTC day,
// so `day:why` over `day` is the share of device-days with a "Why?" opened.
//
// ⚠️ OFF until USAGE_COUNTS_LIVE is true. The privacy policy says the Android
// app sends no counts; its new text is approved first, then this flips. While
// it is false nothing is counted or sent and the Settings switch is not shown.
// The website never counts here (it has its pageview beacon, lib/pageview.ts).

import type { SQLiteDatabase } from 'expo-sqlite';
import { Platform } from 'react-native';
import { api } from '~/lib/api';
import { getMeta, setMeta } from '~/lib/db';

export const USAGE_COUNTS_LIVE = false;

/** The user's switch in Settings. On unless switched off; '0' is off. */
export const USAGE_PREF_KEY = 'usage_counts';
/** `<UTC day>|<batches sent that day>`. */
const BATCHES_KEY = 'usage_batches';
/** The last UTC day each once-a-day flag was sent: `usage_flag:day`, `usage_flag:day:why`, … */
const FLAG_KEY = (flag: string) => `usage_flag:${flag}`;
export const MAX_BATCHES_PER_DAY = 20;

const DAY_FLAGS = ['day', 'day:why', 'day:reminder'] as const;
type DayFlag = (typeof DAY_FLAGS)[number];

/** The UTC day of a moment, `2026-11-22`. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** The visit's length as the bucket the server takes. */
export function sessionBucket(ms: number): string {
  const min = ms / 60_000;
  if (min < 1) return 'session:under1';
  if (min < 5) return 'session:1to5';
  if (min < 15) return 'session:5to15';
  return 'session:over15';
}

/** The screen a path is, for `screen:<key>`. Null for anything not counted (profile, import, the admin pages). */
export function screenKey(pathname: string): string | null {
  const p = pathname.replace(/\/+$/, '') || '/';
  if (p === '/') return 'screen:home';
  const [first] = p.slice(1).split('/');
  switch (first) {
    // The Search tab is /discover (components/AppNav.tsx); there is no other search screen.
    case 'discover': return 'screen:search';
    case 'calendar': return 'screen:calendar';
    case 'wishlist': return 'screen:wishlist';
    case 'library': return 'screen:library';
    case 'insights': return 'screen:insights';
    case 'settings': return 'screen:settings';
    case 'item': case 'movie': case 'show': case 'game': case 'book': case 'boardgame':
      return 'screen:title';
    case 'person': case 'tag': case 'studio': case 'franchise':
      return 'screen:facet';
    default: return null;
  }
}

const REC_TYPES = new Set(['movie', 'show', 'game', 'book']);
/** `rec:<type>` for a title opened from "Recommended for you"; null for a type the server does not take. */
export function recKey(mediaType: string): string | null {
  return REC_TYPES.has(mediaType) ? `rec:${mediaType}` : null;
}

export interface UsageDeps {
  /** Counting at all: the master switch, on a phone. */
  live: boolean;
  getMeta: (key: string) => Promise<string | null>;
  setMeta: (key: string, value: string) => Promise<void>;
  send: (counts: Record<string, number>) => Promise<unknown>;
  /** Whether the device has a release reminder set right now. */
  hasReminder: () => Promise<boolean>;
}

/**
 * The counter. Pure apart from what `deps` gives it, so the tests drive it
 * with the master switch on.
 */
export function createUsageCounter(deps: UsageDeps) {
  const counts = new Map<string, number>();
  /** null until the switch has been read: counted meanwhile, thrown away if it turns out off. */
  let enabled: boolean | null = null;
  let activeSince: number | null = null;
  let queue: Promise<void> = Promise.resolve();

  const readEnabled = async (): Promise<boolean> => {
    if (enabled === null) {
      let stored: boolean;
      try { stored = (await deps.getMeta(USAGE_PREF_KEY)) !== '0'; } catch { stored = false; }
      // The switch may have been set while the read was out: that answer wins.
      if (enabled === null) enabled = stored;
      if (!enabled) counts.clear();
    }
    return enabled;
  };

  function count(key: string, n = 1): void {
    if (!deps.live || enabled === false || !(n > 0)) return;
    counts.set(key, (counts.get(key) ?? 0) + n);
  }

  /** The app came to the front: a visit starts. */
  function active(now = Date.now()): void {
    if (!deps.live || enabled === false) return;
    if (activeSince === null) activeSince = now;
    void readEnabled();
  }

  async function flushNow(now: number): Promise<number> {
    // Taken at once, before anything awaits: what is counted from here on is the next batch's.
    const batch: Record<string, number> = Object.fromEntries(counts);
    counts.clear();
    const started = activeSince;
    activeSince = null;
    if (!(await readEnabled())) return 0;
    if (started !== null) batch[sessionBucket(now - started)] = 1;

    const day = utcDay(now);
    const raised: DayFlag[] = [];
    for (const flag of DAY_FLAGS) {
      if ((await deps.getMeta(FLAG_KEY(flag))) === day) continue;
      const wanted = flag === 'day' || (flag === 'day:why' ? (batch.why ?? 0) > 0 : await deps.hasReminder().catch(() => false));
      if (wanted) { batch[flag] = 1; raised.push(flag); }
    }
    if (!Object.keys(batch).length) return 0;

    const [capDay, capN] = ((await deps.getMeta(BATCHES_KEY)) ?? '').split('|');
    const sent = capDay === day ? Number(capN) || 0 : 0;
    if (sent >= MAX_BATCHES_PER_DAY) return 0;
    await deps.setMeta(BATCHES_KEY, `${day}|${sent + 1}`);
    try {
      await deps.send(batch);
    } catch {
      return 0; // dropped: no retry, no queue
    }
    // A flag is spent only once it has arrived: a failed batch leaves it for the next one today.
    for (const flag of raised) await deps.setMeta(FLAG_KEY(flag), day);
    return Object.keys(batch).length;
  }

  /** The app went to the background: send the visit's counts as one batch. Never throws. Returns the keys sent. */
  function flush(now = Date.now()): Promise<number> {
    if (!deps.live) return Promise.resolve(0);
    const run = queue.then(() => flushNow(now)).catch(() => 0);
    queue = run.then(() => undefined);
    return run;
  }

  /** The Settings switch. Off throws away what is in memory and counts nothing more. */
  async function setEnabled(on: boolean, now = Date.now()): Promise<void> {
    enabled = on;
    if (on) { activeSince = now; } else { counts.clear(); activeSince = null; }
    await deps.setMeta(USAGE_PREF_KEY, on ? '1' : '0');
  }

  return {
    count, active, flush, setEnabled,
    isEnabled: readEnabled,
    /** For tests. */
    pending: () => Object.fromEntries(counts) as Record<string, number>,
  };
}

// ── The app's one counter ────────────────────────────────────────────────────

/** Counting happens on a phone only, and only once the master switch is on. */
export const usageCountsOn = USAGE_COUNTS_LIVE && Platform.OS !== 'web';

let db: SQLiteDatabase | null = null;
let reminderCheck: () => Promise<boolean> = async () => false;

const counter = createUsageCounter({
  live: usageCountsOn,
  getMeta: async (key) => (db ? getMeta(db, key) : null),
  setMeta: async (key, value) => { if (db) await setMeta(db, key, value); },
  send: (counts) => api.usageCounts(counts),
  hasReminder: () => reminderCheck(),
});

/** Called once by components/UsageCounts.tsx with the database and the reminder check. */
export function attachUsage(database: SQLiteDatabase, hasReminder: () => Promise<boolean>): void {
  db = database;
  reminderCheck = hasReminder;
}

export const count = counter.count;
export const usageActive = counter.active;
export const flushUsage = counter.flush;

/** Count the screen a path is, when it is one. */
export function countScreen(pathname: string): void {
  const key = screenKey(pathname);
  if (key) count(key);
}

export async function readUsagePref(database: SQLiteDatabase): Promise<boolean> {
  return (await getMeta(database, USAGE_PREF_KEY)) !== '0';
}

export async function writeUsagePref(database: SQLiteDatabase, on: boolean): Promise<void> {
  db ??= database;
  await counter.setEnabled(on);
}
