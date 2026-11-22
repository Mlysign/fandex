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
  // Once a kind is over its cap it stays over until the day turns, because the
  // counter only grows. Remembering that in the isolate saves the row write a
  // refusal would otherwise cost, which is what a burst past the cap is made of.
  const day = utcDay();
  if (exhausted.get(kind) === day) return false;
  const row = await first<{ n: number }>(
    db,
    `INSERT INTO daily_budget (day, kind, n) VALUES (?, ?, ?)
     ON CONFLICT(day, kind) DO UPDATE SET n = n + excluded.n
     RETURNING n`,
    [day, kind, units],
  );
  const ok = (row?.n ?? units) <= cap;
  if (!ok) exhausted.set(kind, day);
  return ok;
}

/** Kinds this isolate has seen refused, and the UTC day it saw it. */
const exhausted = new Map<string, string>();

/** For tests: a fresh isolate's view. */
export function forgetExhausted(): void {
  exhausted.clear();
  soft.clear();
}

// ── Read caps: counted here, written now and then ────────────────────────────

/**
 * `spend` for a cap on READS, where one row write per call was the larger cost.
 *
 * A catalog page, a lookup and a release-dates call each read rows and wrote
 * one: the counter. In the rehearsal of a launch hour (2026-11-22) those
 * counters were a fifth of everything written. Here the count gathers in the
 * isolate and is written at most every SOFT_FLUSH_MS, one row for however many
 * calls came in between, the way the usage counters do it (usage.ts).
 *
 * What that costs: the cap becomes approximate. An isolate knows the day's
 * total as of its own last write, so the total can pass the cap by what all
 * isolates took in since. For a cap on reads that is fine: it is a budget, and
 * running thirty seconds over is far from the limit it protects. It is NOT
 * for anything that writes rows or calls a provider; those stay on `spend`.
 *
 * Answers at once and never throws. The write rides on `defer` (ctx.waitUntil).
 */
export function spendSoft(db: D1Database, kind: string, cap: number, units: number, defer: (p: Promise<unknown>) => void): boolean {
  const day = utcDay();
  if (exhausted.get(kind) === day) return false;
  let s = soft.get(kind);
  if (!s || s.day !== day) {
    s = { day, known: 0, pending: 0, inFlight: 0, lastFlush: 0, flushing: false, cap };
    soft.set(kind, s);
  }
  s.cap = cap;
  s.pending += units;
  // Counted first and checked after, as `spend` does.
  // `inFlight` is what is being written right now: counted, though the day's
  // total has not come back with it yet.
  const ok = s.known + s.inFlight + s.pending <= cap;
  if (!ok) exhausted.set(kind, day);
  if (!ok || Date.now() - s.lastFlush >= SOFT_FLUSH_MS) defer(flushSoft(db, kind));
  return ok;
}

const SOFT_FLUSH_MS = 30_000;
interface SoftCount { day: string; known: number; pending: number; inFlight: number; lastFlush: number; flushing: boolean; cap: number }
const soft = new Map<string, SoftCount>();

/** Write what one kind has gathered, and learn the day's total from the answer. */
async function flushSoft(db: D1Database, kind: string): Promise<void> {
  const s = soft.get(kind);
  if (!s || s.flushing || s.pending <= 0) return;
  s.flushing = true;
  const units = s.pending;
  s.pending = 0;
  s.inFlight = units;
  s.lastFlush = Date.now();
  try {
    const row = await first<{ n: number }>(
      db,
      `INSERT INTO daily_budget (day, kind, n) VALUES (?, ?, ?)
       ON CONFLICT(day, kind) DO UPDATE SET n = n + excluded.n
       RETURNING n`,
      [s.day, kind, units],
    );
    // What every isolate has written today, this one's share included.
    s.known = row?.n ?? s.known + units;
    if (s.known > s.cap) exhausted.set(kind, s.day);
  } catch {
    // Not written: it stays counted here and goes out with the next write.
    s.pending += units;
  } finally {
    s.inFlight = 0;
    s.flushing = false;
  }
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
