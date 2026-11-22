// Usage counters: totals per UTC day and nothing else (migration 0010).
//
// What this answers: how many accounts were active, whether they come back,
// which routes are asked, what failed, and what the app says its screens were
// opened for. What it never holds: a user id, a device id, a time finer than
// the day, or a single event. A row is "key K happened N times on day D".
//
// OFF until `USAGE_COUNTERS` is "1". The privacy policy describes what is
// counted, and that text is approved before the switch is set (2026-11-22).
//
// A count costs no row write when it happens. Counts gather in the isolate and
// are written together, at most once every FLUSH_MS, against a daily budget of
// their own: D1 Free stops for the day at 100,000 row writes, and a metric must
// never be what spends them. An isolate that is evicted loses what it had not
// written yet, which is at most FLUSH_MS of counts. These are statistics.

import { all, batch, stmt, utcDay } from "./d1";
import { capFrom, spend } from "./budget";
import type { Env } from "./env";

/** Row writes the counters may spend per UTC day. */
export const DEFAULT_DAILY_USAGE_CAP = 3_000;
const FLUSH_MS = 30_000;
/** Written early when this many counts are waiting, so a burst cannot grow the map without end. */
const FLUSH_AT = 2_000;
const MAX_PENDING_KEYS = 400;

export function usageOn(env: Pick<Env, "USAGE_COUNTERS">): boolean {
  return env.USAGE_COUNTERS === "1";
}

/** `day|key` to count, waiting to be written. */
const pending = new Map<string, number>();
let waiting = 0;
let lastFlush = 0;

/** For tests: a fresh isolate's view. */
export function forgetUsage(): void {
  pending.clear();
  waiting = 0;
  lastFlush = 0;
}

/**
 * Count `key` once (or `n` times) for today. Never throws, never awaits a
 * write: with `defer` (ctx.waitUntil) the write happens after the response,
 * when one is due; without it the count waits for the next `flushUsage`.
 */
export function bump(env: Env, key: string, n = 1, defer?: (p: Promise<unknown>) => void): void {
  if (!usageOn(env) || n <= 0) return;
  const k = `${utcDay()}|${key}`;
  if (!pending.has(k) && pending.size >= MAX_PENDING_KEYS) return;
  pending.set(k, (pending.get(k) ?? 0) + n);
  waiting += n;
  if (defer && (Date.now() - lastFlush >= FLUSH_MS || waiting >= FLUSH_AT)) defer(flushUsage(env));
}

/** Write what is waiting. Returns the number of rows written. Never throws. */
export async function flushUsage(env: Env): Promise<number> {
  if (!pending.size) return 0;
  const rows = [...pending.entries()];
  pending.clear();
  waiting = 0;
  lastFlush = Date.now();
  try {
    if (!usageOn(env)) return 0;
    const cap = capFrom(env.DAILY_USAGE_CAP, DEFAULT_DAILY_USAGE_CAP);
    // One budget row, then the counts. Over the cap the counts are dropped:
    // a day's statistics going thin is the right price for staying writable.
    if (!(await spend(env.DB, "usage", cap, rows.length + 1))) return 0;
    await batch(env.DB, rows.map(([k, n]) => {
      const cut = k.indexOf("|");
      return stmt(
        env.DB,
        `INSERT INTO usage_daily (day, key, n) VALUES (?, ?, ?)
         ON CONFLICT(day, key) DO UPDATE SET n = n + excluded.n`,
        [k.slice(0, cut), k.slice(cut + 1), n],
      );
    }));
    return rows.length;
  } catch (e) {
    console.warn("usage_flush_failed", { error: e instanceof Error ? e.message : String(e) });
    return 0;
  }
}

// ── What the server counts by itself ─────────────────────────────────────────

/** The ISO week a moment falls in, as `2027-W07`. Weeks start on Monday (UTC). */
export function isoWeek(seconds: number): string {
  const d = new Date(seconds * 1000);
  const day = (d.getUTCDay() + 6) % 7; // Monday is 0
  // The Thursday of this week decides the year the week belongs to.
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 3));
  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime() + (firstDay - 3) * 86_400_000) / (7 * 86_400_000));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * An account's first request of a UTC day (auth/session.ts calls this when it
 * stamps `last_seen_at`). `active` is the day's distinct accounts. The first
 * request of an ISO week also counts under `wactive` and under the account's
 * signup week (`ret:<week>`), so summing a week's days gives the distinct
 * accounts of that week, and of each signup week within it. The signup week
 * is a week, shared by everyone who joined in it: it identifies nobody.
 */
export function countActive(
  env: Env,
  createdAt: number,
  previousSeenAt: number,
  now: number,
  defer?: (p: Promise<unknown>) => void,
): void {
  bump(env, "active", 1, defer);
  if (isoWeek(previousSeenAt) !== isoWeek(now)) {
    bump(env, "wactive", 1, defer);
    bump(env, `ret:${isoWeek(createdAt)}`, 1, defer);
  }
}

/** A new account: it is active today and this week, in its own signup week. */
export function countSignup(env: Env, provider: string, now: number, defer?: (p: Promise<unknown>) => void): void {
  bump(env, `signup:${provider}`, 1, defer);
  bump(env, "active", 1, defer);
  bump(env, "wactive", 1, defer);
  bump(env, `ret:${isoWeek(now)}`, 1, defer);
}

/**
 * Which kind of request this was, for `req:<kind>`. null for what is not worth
 * a count (health checks, the counters' own routes, the admin pages).
 */
export function routeKind(method: string, parts: string[]): string | null {
  const [, a, b] = parts;
  switch (a) {
    case "catalog": return b === "delta" ? "catalog" : "catalog-other";
    case "items": return "item";
    case "search": return "search";
    case "browse": return "browse";
    case "facet": return "facet";
    case "calendar": return "calendar";
    case "lookup": return "lookup";
    case "resolve": return "resolve";
    case "shows": return "episodes";
    case "taxonomy": return "taxonomy";
    case "cover": return "cover";
    case "auth": return "auth";
    case "me": return method === "GET" || method === "HEAD" ? "me-read" : "me-write";
    case "health":
    case "t":
    case "admin":
    case "dev":
    case "features":
      return null;
    default: return a ? "other" : null;
  }
}

/** One finished request: its kind, and its failure if it failed. */
export function countRequest(env: Env, method: string, parts: string[], status: number, defer: (p: Promise<unknown>) => void): void {
  if (!usageOn(env) || parts[0] !== "v1") return;
  const kind = routeKind(method, parts);
  if (kind) bump(env, `req:${kind}`, 1, defer);
  if (status >= 500 || status === 429) bump(env, `err:${status}`, 1, defer);
}

// ── What the app sends ───────────────────────────────────────────────────────

/**
 * The counts an app may send, and nothing else is kept. A new count is added
 * HERE and in the privacy policy in the same change: the policy lists them.
 * `day*` are once-a-day flags a device raises (it used the app today, it has a
 * reminder set, it opened a "Why?"), which is how a share of devices is known
 * without knowing any device.
 */
export const APP_COUNT_KEYS: ReadonlySet<string> = new Set([
  "screen:home", "screen:search", "screen:calendar", "screen:wishlist", "screen:library",
  "screen:title", "screen:insights", "screen:settings", "screen:facet", "screen:discover",
  "why",
  "rec:movie", "rec:show", "rec:game", "rec:book",
  "reminder:set", "reminder:arrived", "reminder:tapped",
  "first:picker", "first:rated5", "first:skipped",
  "import",
  "session:under1", "session:1to5", "session:5to15", "session:over15",
  "day", "day:reminder", "day:why",
]);
/** The most one batch may add to one count. A session does not open 500 screens. */
export const APP_COUNT_MAX = 200;

/**
 * Take one batch from an app: `{ counts: { key: n } }`. Unknown keys and bad
 * numbers are dropped without a word. Reads no session and stores no address.
 * Returns how many counts were taken.
 */
export function countAppBatch(env: Env, body: unknown, defer?: (p: Promise<unknown>) => void): number {
  if (!usageOn(env)) return 0;
  const counts = (body as { counts?: unknown } | null)?.counts;
  if (!counts || typeof counts !== "object" || Array.isArray(counts)) return 0;
  let taken = 0;
  for (const [key, raw] of Object.entries(counts as Record<string, unknown>)) {
    if (!APP_COUNT_KEYS.has(key)) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 1) continue;
    bump(env, `app:${key}`, Math.min(Math.floor(raw), APP_COUNT_MAX), defer);
    taken += 1;
  }
  return taken;
}

// ── The admin page ───────────────────────────────────────────────────────────

export type UsageSnapshot = {
  on: boolean;
  days: number;
  /** Every counter of the range, oldest day first. */
  counters: { day: string; key: string; n: number }[];
  /** Accounts by how many media types they have rated in (1 to 4). */
  mediaMix: { types: number; accounts: number }[];
  /** Per signup week: accounts created, and how many of them saved 5 ratings within 7 days. */
  firstWeek: { week: string; created: number; rated5: number }[];
  /** First entry in a media type the account had nothing in, per type, within the range. */
  newMediaType: { type: string; accounts: number }[];
};

const SECONDS_PER_DAY = 86_400;

/**
 * The Usage page's numbers. The counters are read as they are; the other three
 * come straight from the rows the accounts already have, so they need no
 * counter and are right even for days before the counters were switched on.
 */
export async function usageSnapshot(env: Env, days: number, now = Math.floor(Date.now() / 1000)): Promise<UsageSnapshot> {
  const db = env.DB;
  const range = Math.min(Math.max(days, 7), 90);
  const since = utcDay((now - range * SECONDS_PER_DAY) * 1000);
  const sinceSeconds = now - range * SECONDS_PER_DAY;
  const [counters, mediaMix, signups, newTypes] = await Promise.all([
    all<{ day: string; key: string; n: number }>(db, "SELECT day, key, n FROM usage_daily WHERE day >= ? ORDER BY day, key", [since]),
    all<{ types: number; accounts: number }>(
      db,
      `SELECT types, COUNT(*) AS accounts FROM (
         SELECT s.user_id, COUNT(DISTINCT m.type) AS types
         FROM user_item_state s JOIN media_items m ON m.id = s.media_item_id
         WHERE s.rating IS NOT NULL GROUP BY s.user_id
       ) GROUP BY types ORDER BY types`,
    ),
    // 13 weeks back whatever the range: a signup week needs its seven days to be over.
    all<{ created_at: number; rated5: number }>(
      db,
      `SELECT u.created_at AS created_at,
              (SELECT COUNT(*) FROM user_item_state s
                 WHERE s.user_id = u.id AND s.rating IS NOT NULL
                   AND s.reviewed_at IS NOT NULL AND s.reviewed_at <= u.created_at + ?) >= 5 AS rated5
       FROM users u WHERE u.created_at >= ?`,
      [7 * SECONDS_PER_DAY, now - 13 * 7 * SECONDS_PER_DAY],
    ),
    all<{ type: string; accounts: number }>(
      db,
      `SELECT t.type AS type, COUNT(*) AS accounts FROM (
         SELECT s.user_id, m.type AS type, MIN(s.added_at) AS first_at
         FROM user_item_state s JOIN media_items m ON m.id = s.media_item_id
         GROUP BY s.user_id, m.type
       ) t JOIN users u ON u.id = t.user_id
       WHERE t.first_at >= ? AND t.first_at > u.created_at + ?
       GROUP BY t.type ORDER BY accounts DESC`,
      [sinceSeconds, SECONDS_PER_DAY],
    ),
  ]);
  const weeks = new Map<string, { created: number; rated5: number }>();
  for (const row of signups) {
    const week = isoWeek(row.created_at);
    const w = weeks.get(week) ?? { created: 0, rated5: 0 };
    w.created += 1;
    if (row.rated5) w.rated5 += 1;
    weeks.set(week, w);
  }
  return {
    on: usageOn(env),
    days: range,
    counters,
    mediaMix,
    firstWeek: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, w]) => ({ week, ...w })),
    newMediaType: newTypes,
  };
}
