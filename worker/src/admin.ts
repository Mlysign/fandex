/**
 * The admin pages' reads. Ports of the site's src/lib/userAnalytics.ts and its
 * dev routes, over D1's tables.
 *
 * An admin is a user id listed in ADMIN_USER_IDS (the site's
 * SCORING_ADMIN_USER_IDS). Everybody else is answered 404, never 403: the
 * routes do not say they exist.
 *
 * These routes are called by one person a few times a day, so they aggregate
 * in JavaScript where that is clearer. The "nothing is parsed on a read" rule
 * is about the paths a stranger can call.
 */

import { all } from "./d1";
import type { Env } from "./env";

export function isAdmin(env: Env, userId: string): boolean {
  return (env.ADMIN_USER_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean).includes(userId);
}

export interface UsersSnapshot {
  days: number;
  totals: { users: number; library: number; wishlist: number; ignored: number; rated: number; meanRating: number | null };
  perUserAverages: { library: number; wishlist: number; rated: number };
  byType: { type: string; library: number; wishlist: number; rated: number }[];
  byStatus: { status: string; count: number }[];
  bySource: { source: string; count: number }[];
  providers: { provider: string; users: number }[];
  countries: { country: string; users: number }[];
  engagement: {
    active1: number; active7: number; active30: number; active90: number; activeInRange: number;
    neverSeen: number; stickiness: number | null;
  };
  collectionSizes: { bucket: string; users: number }[];
  signups: { day: string; count: number }[];
  writeActivity: { day: string; count: number }[];
  signedInPageviews: { day: string; count: number }[];
  users: { id: string; createdAt: number; lastSeenAt: number | null; library: number; wishlist: number; rated: number; providers: string[] }[];
  generatedAt: string;
}

const SIZE_BUCKETS: { bucket: string; min: number; max: number }[] = [
  { bucket: "0", min: 0, max: 0 },
  { bucket: "1–10", min: 1, max: 10 },
  { bucket: "11–50", min: 11, max: 50 },
  { bucket: "51–200", min: 51, max: 200 },
  { bucket: "201–1000", min: 201, max: 1000 },
  { bucket: "1000+", min: 1001, max: Number.MAX_SAFE_INTEGER },
];

const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** A day series with every day present, so a quiet day is a zero and not a gap. */
function zeroFilled(rows: { day: string; count: number }[], days: number, now: Date): { day: string; count: number }[] {
  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  const out: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = utcDay(new Date(now.getTime() - i * 86_400_000));
    out.push({ day, count: byDay.get(day) ?? 0 });
  }
  return out;
}

export function parseDays(raw: string | null): number {
  const n = Number(raw ?? 30);
  return Number.isFinite(n) ? Math.min(365, Math.max(7, Math.trunc(n))) : 30;
}

/**
 * One (user, item) pair per relation, whatever number of sources brought it:
 * what the site's user_library and user_watchlist views were for.
 */
const PAIRS = `
  SELECT user_id, media_item_id, relation,
         AVG(CASE WHEN rating > 0 THEN rating END) AS rating,
         MAX(status) AS status
    FROM user_item_state
   GROUP BY user_id, media_item_id, relation`;

export async function usersSnapshot(db: D1Database, days = 30, now: Date = new Date()): Promise<UsersSnapshot> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const since = (d: number) => nowSec - d * 86_400;

  const [userRows, identities, byType, byStatus, bySource, countries, signups, writes, views] = await Promise.all([
    all<{ id: string; createdAt: number; lastSeenAt: number | null; library: number; wishlist: number; ignored: number; rated: number; ratingSum: number | null }>(
      db,
      `SELECT u.id, u.created_at AS createdAt, u.last_seen_at AS lastSeenAt,
              COALESCE(p.library, 0) AS library, COALESCE(p.wishlist, 0) AS wishlist,
              COALESCE(p.ignored, 0) AS ignored, COALESCE(p.rated, 0) AS rated, p.ratingSum
         FROM users u LEFT JOIN (
           SELECT user_id,
                  SUM(relation = 'library') AS library, SUM(relation = 'wishlist') AS wishlist,
                  SUM(relation = 'ignored') AS ignored,
                  SUM(relation = 'library' AND rating IS NOT NULL) AS rated,
                  SUM(CASE WHEN relation = 'library' THEN rating END) AS ratingSum
             FROM (${PAIRS}) GROUP BY user_id
         ) p ON p.user_id = u.id
        ORDER BY library DESC, u.id`,
    ),
    all<{ user_id: string; provider: string }>(db, "SELECT user_id, provider FROM user_identities"),
    all<{ type: string; library: number; wishlist: number; rated: number }>(
      db,
      `SELECT mi.type AS type,
              SUM(s.relation = 'library') AS library, SUM(s.relation = 'wishlist') AS wishlist,
              SUM(s.relation = 'library' AND s.rating IS NOT NULL) AS rated
         FROM (${PAIRS}) s JOIN media_items mi ON mi.id = s.media_item_id
        WHERE s.relation IN ('library', 'wishlist')
        GROUP BY mi.type ORDER BY library DESC`,
    ),
    all<{ status: string; count: number }>(
      db,
      `SELECT COALESCE(status, '(none)') AS status, COUNT(*) AS count
         FROM (${PAIRS}) WHERE relation = 'library' GROUP BY status ORDER BY count DESC`,
    ),
    all<{ source: string; count: number }>(db, "SELECT source, COUNT(*) AS count FROM user_item_state GROUP BY source ORDER BY count DESC"),
    all<{ country: string; users: number }>(
      db,
      "SELECT COALESCE(NULLIF(country, ''), '(unset)') AS country, COUNT(*) AS users FROM users GROUP BY 1 ORDER BY users DESC",
    ),
    all<{ day: string; count: number }>(
      db,
      "SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day, COUNT(*) AS count FROM users WHERE created_at >= ? GROUP BY day",
      [since(days)],
    ),
    all<{ day: string; count: number }>(
      db,
      `SELECT day, COUNT(*) AS count FROM (
         SELECT strftime('%Y-%m-%d', added_at, 'unixepoch') AS day FROM user_item_state WHERE added_at >= ?1
         UNION ALL
         SELECT strftime('%Y-%m-%d', reviewed_at, 'unixepoch') AS day FROM user_item_state WHERE reviewed_at >= ?1
       ) GROUP BY day`,
      [since(days)],
    ),
    all<{ day: string; count: number }>(
      db,
      "SELECT day, SUM(count) AS count FROM page_view_daily WHERE authed = 1 AND day >= ? GROUP BY day",
      [utcDay(new Date((since(days) + 86_400) * 1000))],
    ),
  ]);

  const provByUser = new Map<string, string[]>();
  const provCount = new Map<string, number>();
  for (const r of identities) {
    provByUser.set(r.user_id, [...(provByUser.get(r.user_id) ?? []), r.provider]);
    provCount.set(r.provider, (provCount.get(r.provider) ?? 0) + 1);
  }

  const users = userRows.length;
  const sum = (pick: (u: (typeof userRows)[number]) => number) => userRows.reduce((a, u) => a + pick(u), 0);
  const library = sum((u) => u.library);
  const wishlist = sum((u) => u.wishlist);
  const rated = sum((u) => u.rated);
  const ratingSum = sum((u) => u.ratingSum ?? 0);
  const active = (d: number) => userRows.filter((u) => (u.lastSeenAt ?? 0) >= since(d)).length;
  const active1 = active(1);
  const active30 = active(30);
  const per = (n: number) => (users ? Math.round((n / users) * 10) / 10 : 0);

  return {
    days,
    totals: {
      users, library, wishlist, ignored: sum((u) => u.ignored), rated,
      meanRating: rated ? Math.round((ratingSum / rated) * 100) / 100 : null,
    },
    perUserAverages: { library: per(library), wishlist: per(wishlist), rated: per(rated) },
    byType,
    byStatus,
    bySource,
    providers: [...provCount].map(([provider, n]) => ({ provider, users: n })).sort((a, b) => b.users - a.users || a.provider.localeCompare(b.provider)),
    countries,
    engagement: {
      active1, active7: active(7), active30, active90: active(90), activeInRange: active(days),
      neverSeen: userRows.filter((u) => !u.lastSeenAt).length,
      // A dash, not 0%, when nobody was active at all: those are different facts.
      stickiness: active30 > 0 ? (active1 / active30) * 100 : null,
    },
    collectionSizes: SIZE_BUCKETS.map((b) => ({ bucket: b.bucket, users: userRows.filter((u) => u.library >= b.min && u.library <= b.max).length })),
    signups: zeroFilled(signups, days, now),
    writeActivity: zeroFilled(writes, days, now),
    signedInPageviews: zeroFilled(views, days, now),
    users: userRows.map((u) => ({
      id: u.id, createdAt: u.createdAt, lastSeenAt: u.lastSeenAt || null,
      library: u.library, wishlist: u.wishlist, rated: u.rated,
      providers: (provByUser.get(u.id) ?? []).sort(),
    })),
    generatedAt: now.toISOString(),
  };
}
