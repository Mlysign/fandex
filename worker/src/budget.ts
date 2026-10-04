// Daily spending gates, and the one small key-value table.
//
// D1 Free refuses every query for the rest of the UTC day once 100,000 rows have
// been written, so anything a stranger can trigger that writes rows needs a
// ceiling of its own that trips long before that one does. These counters are
// that ceiling. A counter is itself one row write per call, which is the price
// of being able to say no.

import { first, nowSeconds, run, utcDay } from "./d1";

/**
 * Count one unit against today's budget for `kind` and say whether it fit.
 *
 * One statement, so two concurrent callers cannot both read "one left". It
 * counts FIRST and checks after, which means the counter can run a little past
 * the cap under a burst; the cap is a budget, not a seat count, and overshooting
 * by the number of in-flight requests is fine.
 */
export async function spend(db: D1Database, kind: string, cap: number, units = 1): Promise<boolean> {
  const row = await first<{ n: number }>(
    db,
    `INSERT INTO daily_budget (day, kind, n) VALUES (?, ?, ?)
     ON CONFLICT(day, kind) DO UPDATE SET n = n + excluded.n
     RETURNING n`,
    [utcDay(), kind, units],
  );
  return (row?.n ?? units) <= cap;
}

/** Today's count for `kind`, without spending. */
export async function spent(db: D1Database, kind: string): Promise<number> {
  const row = await first<{ n: number }>(db, "SELECT n FROM daily_budget WHERE day = ? AND kind = ?", [utcDay(), kind]);
  return row?.n ?? 0;
}

/** Read at CALL time, never at module load: a gate read once is a gate nothing tests. */
export function capFrom(raw: string | undefined, fallback: number): number {
  const n = raw === undefined || raw === "" ? fallback : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

// ── kv ───────────────────────────────────────────────────────────────────────

export async function kvGet(db: D1Database, key: string): Promise<string | null> {
  const row = await first<{ value: string; expires_at: number | null }>(
    db,
    "SELECT value, expires_at FROM kv WHERE key = ?",
    [key],
  );
  if (!row) return null;
  if (row.expires_at != null && row.expires_at <= nowSeconds()) return null;
  return row.value;
}

export async function kvSet(db: D1Database, key: string, value: string, ttlSeconds?: number): Promise<void> {
  await run(
    db,
    `INSERT INTO kv (key, value, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
    [key, value, ttlSeconds == null ? null : nowSeconds() + ttlSeconds],
  );
}
