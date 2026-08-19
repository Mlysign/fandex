import { getDb } from "@/lib/db";
import { pageViewSeries } from "@/lib/telemetry";

// Audience analytics for /dev/users (2026-08-19). Sibling of telemetry.ts, and
// deliberately a separate module: that one measures ANONYMOUS traffic from
// counters it writes itself, this one measures REGISTERED users by reading rows
// that already exist. Nothing here stores anything.
//
// ── What "how often do they use the app" can and cannot mean here ────────────
//
// `users.last_seen_at` is a single timestamp, not a history, so there is no way
// to ask "how many days did this person visit last month" from it. Three honest
// proxies are reported instead, and none of them is relabelled as something it
// is not:
//   * RECENCY buckets (active in 1 / 7 / 30 / 90 days) plus the DAU/MAU ratio,
//     the standard stickiness measure;
//   * WRITE ACTIVITY per day, derived from added_at/reviewed_at, which is the
//     only per-event history the schema actually keeps;
//   * SIGNED-IN PAGEVIEWS per day from telemetry.ts, which starts at the deploy
//     that added it and is therefore blank for any earlier window.
// A pure browser who reads and never writes shows up only in the third.
//
// ── Personal data ───────────────────────────────────────────────────────────
//
// The per-user table shows a truncated user id, never a display name or avatar,
// even though user_identities carries both. This page exists to size an
// audience, and the ids are enough to tell rows apart. Provider display names
// are other people's personal data and nothing here needs them.

export interface TypeBreakdown {
  type: string;
  library: number;
  wishlist: number;
  rated: number;
}

export interface UserRow {
  id: string;
  createdAt: number;
  lastSeenAt: number | null;
  library: number;
  wishlist: number;
  rated: number;
  providers: string[];
}

export interface UserAnalyticsSnapshot {
  days: number;
  totals: {
    users: number;
    library: number;
    wishlist: number;
    ignored: number;
    rated: number;
    meanRating: number | null;
  };
  perUserAverages: { library: number; wishlist: number; rated: number };
  byType: TypeBreakdown[];
  byStatus: { status: string; count: number }[];
  bySource: { source: string; count: number }[];
  providers: { provider: string; users: number }[];
  countries: { country: string; users: number }[];
  engagement: {
    active1: number;
    active7: number;
    active30: number;
    active90: number;
    activeInRange: number;
    neverSeen: number;
    stickiness: number | null;
  };
  collectionSizes: { bucket: string; users: number }[];
  signups: { day: string; count: number }[];
  writeActivity: { day: string; count: number }[];
  signedInPageviews: { day: string; count: number }[];
  users: UserRow[];
  generatedAt: string;
}

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function zeroFilled(
  rows: { day: string; count: number }[],
  days: number,
  now: Date,
): { day: string; count: number }[] {
  const byDay = new Map(rows.map((r) => [r.day, r.count]));
  const out: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = utcDay(new Date(now.getTime() - i * 86_400_000));
    out.push({ day, count: byDay.get(day) ?? 0 });
  }
  return out;
}

const SIZE_BUCKETS: { bucket: string; min: number; max: number }[] = [
  { bucket: "0", min: 0, max: 0 },
  { bucket: "1–10", min: 1, max: 10 },
  { bucket: "11–50", min: 11, max: 50 },
  { bucket: "51–200", min: 51, max: 200 },
  { bucket: "201–1000", min: 201, max: 1000 },
  { bucket: "1000+", min: 1001, max: Number.MAX_SAFE_INTEGER },
];

export function userAnalyticsSnapshot(days = 30, now: Date = new Date()): UserAnalyticsSnapshot {
  const db = getDb();
  const nowSec = Math.floor(now.getTime() / 1000);
  const since = (d: number) => nowSec - d * 86_400;
  const one = <T>(sql: string, ...args: unknown[]) => db.prepare(sql).get(...args) as T;

  const totalUsers = one<{ n: number }>(`SELECT COUNT(*) AS n FROM users`).n;

  // relation counts come from user_item_state, the canonical table. The
  // user_library / user_watchlist VIEWS are per (user, item); the state table is
  // per (user, item, source), so a title synced from both Steam and RAWG counts
  // once in the former and twice in the latter. Totals use the views so "items"
  // means what a person would mean by it.
  const library = one<{ n: number }>(`SELECT COUNT(*) AS n FROM user_library`).n;
  const wishlist = one<{ n: number }>(`SELECT COUNT(*) AS n FROM user_watchlist`).n;
  const ignored = one<{ n: number }>(
    `SELECT COUNT(DISTINCT user_id || '|' || media_item_id) AS n FROM user_item_state WHERE relation = 'ignored'`,
  ).n;
  const ratedAgg = one<{ n: number; avg: number | null }>(
    `SELECT COUNT(*) AS n, AVG(rating) AS avg FROM user_library WHERE rating IS NOT NULL`,
  );

  const byType = db
    .prepare(
      `SELECT mi.type AS type,
              SUM(CASE WHEN src.rel = 'library'  THEN 1 ELSE 0 END) AS library,
              SUM(CASE WHEN src.rel = 'wishlist' THEN 1 ELSE 0 END) AS wishlist,
              SUM(CASE WHEN src.rel = 'library' AND src.rating IS NOT NULL THEN 1 ELSE 0 END) AS rated
       FROM (
         SELECT media_item_id, 'library'  AS rel, rating FROM user_library
         UNION ALL
         SELECT media_item_id, 'wishlist' AS rel, NULL   FROM user_watchlist
       ) src
       JOIN media_items mi ON mi.id = src.media_item_id
       GROUP BY mi.type ORDER BY library DESC`,
    )
    .all() as TypeBreakdown[];

  const byStatus = db
    .prepare(
      `SELECT COALESCE(status, '(none)') AS status, COUNT(*) AS count
       FROM user_library GROUP BY status ORDER BY count DESC`,
    )
    .all() as { status: string; count: number }[];

  // Provenance of the underlying state rows: which connected service the item
  // arrived from. 'local' means added in Fandex itself rather than synced.
  const bySource = db
    .prepare(
      `SELECT source, COUNT(*) AS count FROM user_item_state GROUP BY source ORDER BY count DESC`,
    )
    .all() as { source: string; count: number }[];

  const providers = db
    .prepare(
      `SELECT provider, COUNT(DISTINCT user_id) AS users FROM user_identities
       GROUP BY provider ORDER BY users DESC, provider`,
    )
    .all() as { provider: string; users: number }[];

  const countries = db
    .prepare(
      `SELECT COALESCE(NULLIF(country, ''), '(unset)') AS country, COUNT(*) AS users
       FROM users GROUP BY country ORDER BY users DESC`,
    )
    .all() as { country: string; users: number }[];

  const active = (d: number) =>
    one<{ n: number }>(`SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= ?`, since(d)).n;
  const active1 = active(1);
  const active30 = active(30);

  const engagement = {
    active1,
    active7: active(7),
    active30,
    active90: active(90),
    activeInRange: active(days),
    neverSeen: one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM users WHERE last_seen_at IS NULL OR last_seen_at = 0`,
    ).n,
    // DAU/MAU, the standard stickiness ratio. Null rather than a divide-by-zero
    // dressed up as 0%: "nobody was active this month" is not "0% sticky".
    stickiness: active30 > 0 ? (active1 / active30) * 100 : null,
  };

  const sizes = db
    .prepare(
      `SELECT u.id, (SELECT COUNT(*) FROM user_library l WHERE l.user_id = u.id) AS n FROM users u`,
    )
    .all() as { id: string; n: number }[];
  const collectionSizes = SIZE_BUCKETS.map((b) => ({
    bucket: b.bucket,
    users: sizes.filter((s) => s.n >= b.min && s.n <= b.max).length,
  }));

  const signups = zeroFilled(
    db
      .prepare(
        `SELECT strftime('%Y-%m-%d', created_at, 'unixepoch') AS day, COUNT(*) AS count
         FROM users WHERE created_at >= ? GROUP BY day`,
      )
      .all(since(days)) as { day: string; count: number }[],
    days,
    now,
  );

  // Every write action with a timestamp: adding something, and rating/reviewing
  // it. UNION ALL rather than DISTINCT on purpose. Two actions on one item on
  // one day are two uses of the app, which is what this series is measuring.
  const writeActivity = zeroFilled(
    db
      .prepare(
        `SELECT day, COUNT(*) AS count FROM (
           SELECT strftime('%Y-%m-%d', added_at, 'unixepoch') AS day
             FROM user_item_state WHERE added_at >= ?
           UNION ALL
           SELECT strftime('%Y-%m-%d', reviewed_at, 'unixepoch') AS day
             FROM user_item_state WHERE reviewed_at >= ?
         ) GROUP BY day`,
      )
      .all(since(days), since(days)) as { day: string; count: number }[],
    days,
    now,
  );

  const signedInPageviews = pageViewSeries(days, now).map((p) => ({ day: p.day, count: p.authed }));

  const userRows = db
    .prepare(
      `SELECT u.id, u.created_at AS createdAt, u.last_seen_at AS lastSeenAt,
              (SELECT COUNT(*) FROM user_library   l WHERE l.user_id = u.id) AS library,
              (SELECT COUNT(*) FROM user_watchlist w WHERE w.user_id = u.id) AS wishlist,
              (SELECT COUNT(*) FROM user_library   r WHERE r.user_id = u.id AND r.rating IS NOT NULL) AS rated
       FROM users u ORDER BY library DESC`,
    )
    .all() as Omit<UserRow, "providers">[];

  const provByUser = new Map<string, string[]>();
  for (const r of db.prepare(`SELECT user_id, provider FROM user_identities`).all() as {
    user_id: string;
    provider: string;
  }[]) {
    provByUser.set(r.user_id, [...(provByUser.get(r.user_id) ?? []), r.provider]);
  }

  return {
    days,
    totals: {
      users: totalUsers,
      library,
      wishlist,
      ignored,
      rated: ratedAgg.n,
      meanRating: ratedAgg.avg != null ? Math.round(ratedAgg.avg * 100) / 100 : null,
    },
    perUserAverages: {
      library: totalUsers ? Math.round((library / totalUsers) * 10) / 10 : 0,
      wishlist: totalUsers ? Math.round((wishlist / totalUsers) * 10) / 10 : 0,
      rated: totalUsers ? Math.round((ratedAgg.n / totalUsers) * 10) / 10 : 0,
    },
    byType,
    byStatus,
    bySource,
    providers,
    countries,
    engagement,
    collectionSizes,
    signups,
    writeActivity,
    signedInPageviews,
    users: userRows.map((u) => ({ ...u, providers: (provByUser.get(u.id) ?? []).sort() })),
    generatedAt: now.toISOString(),
  };
}
