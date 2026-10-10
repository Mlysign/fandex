// Two counts that are kept instead of being counted on every request.
//
// D1 bills every row a query touches and, on the free plan, stops ALL queries
// for the rest of the UTC day past 5 million. A COUNT reads every row it counts.
// Both of these are asked when nothing has happened, which is nearly always:
//
//   • a user's state counts, before every pull: 14,899 rows a call for the one
//     real account, 1.33 million in a day (2026-10-10);
//   • the size of the pool, at the end of every catalog sync: 4,561 rows a
//     sync, 611,000 in the same day.
//
// So each is counted once, kept, and DROPPED BY THE STATEMENT THAT CHANGES WHAT
// IT COUNTS, in the same batch. The next ask counts again, with the same COUNT
// as before, so a client is only ever given a number a real count produced.
//
// ⚠️ THE RULE THIS FILE DEPENDS ON: whatever writes to user_item_state,
// user_episode_state or user_hidden_items drops that user's kept count, and
// whatever adds a title to the pool or takes one out drops the pool's. A writer
// that forgets leaves a device believing it is up to date, or worse (see
// poolSize). test/keptCounts.test.ts lists every statement that writes those
// tables and fails when one appears that it does not know.
//
// Not triggers, though a trigger could not be forgotten: D1 reports a trigger's
// row changes as the changes of the statement that fired it (measured: an
// upsert of two rows reported three), and the state write tells the client how
// many rows it applied and skipped from that number.
//
// Not a counter that is added to and subtracted from: an upsert does not say
// whether it inserted or updated, so the write path would have to read every
// row first to know, and a counter that drifted would stay wrong for good.

import { kvGet } from "./budget";
import { first, nowSeconds } from "./d1";

// ── A user's state ───────────────────────────────────────────────────────────

export type StateKind = "items" | "episodes" | "hidden";

/** Where each kept count lives on `users`, and what it counts. Stored as `count:newest`; NULL is "count again". */
const STATE: Record<StateKind, { column: string; table: string; stamp: string }> = {
  items: { column: "counted_items", table: "user_item_state", stamp: "updated_at" },
  episodes: { column: "counted_episodes", table: "user_episode_state", stamp: "updated_at" },
  hidden: { column: "counted_hidden", table: "user_hidden_items", stamp: "hidden_at" },
};
const KINDS = Object.keys(STATE) as StateKind[];
const KEPT_COLUMNS = KINDS.map((k) => `${STATE[k].column} ${k}`).join(", ");

export const STATE_COUNTED_SQL = `SELECT ${KEPT_COLUMNS} FROM users WHERE id = ?1`;

/**
 * Count again whichever of the three was dropped, and keep the answer. One
 * statement, so no write can land between the count and its being kept. A CASE
 * only runs the branch it takes, so a table nobody wrote to is not read.
 */
export const STATE_RECOUNT_SQL = `
  UPDATE users SET ${KINDS.map((k) => {
    const { column, table, stamp } = STATE[k];
    return `${column} = CASE WHEN ${column} IS NULL
      THEN (SELECT COUNT(*) || ':' || COALESCE(MAX(${stamp}), 0) FROM ${table} WHERE user_id = ?1)
      ELSE ${column} END`;
  }).join(",\n    ")}
   WHERE id = ?1
  RETURNING ${KEPT_COLUMNS}`;

/**
 * The statement a writer adds to its batch: this user's rows of these kinds are
 * about to differ from what was counted. It writes a row only if a count is
 * actually kept, so five writes in a row with no read between them cost one.
 */
export function dropStateCounts(db: D1Database, userId: string, kinds: readonly StateKind[]): D1PreparedStatement {
  const columns = kinds.map((k) => STATE[k].column);
  return db.prepare(
    `UPDATE users SET ${columns.map((c) => `${c} = NULL`).join(", ")}
      WHERE id = ?1 AND (${columns.map((c) => `${c} IS NOT NULL`).join(" OR ")})`,
  ).bind(userId);
}

/**
 * How many rows of each kind a user holds, and when the newest changed. The
 * client asks this before every pull and pulls only if the answer moved.
 *
 * One row read when nothing changed. The first ask after a write counts the
 * tables that write touched, as every ask used to count all three.
 */
export async function stateCounts(db: D1Database, userId: string): Promise<Record<string, number>> {
  let row = await first<Record<StateKind, string | null>>(db, STATE_COUNTED_SQL, [userId]);
  if (row && KINDS.some((k) => row![k] === null)) {
    row = await first<Record<StateKind, string | null>>(db, STATE_RECOUNT_SQL, [userId]);
  }
  const out: Record<string, number> = {};
  for (const k of KINDS) {
    // No user row is an account with no rows, which is what a COUNT answered.
    const [n, newest] = (row?.[k] ?? "0:0").split(":").map(Number);
    out[k] = n;
    out[`${k}UpdatedAt`] = newest;
  }
  return out;
}

// ── The pool ─────────────────────────────────────────────────────────────────

export const POOL_COUNT_KEY = "pool_count";
/**
 * A day. Every known change to the pool drops the kept count itself. This is
 * the bound on a change nobody knows about, such as a row deleted by hand, at
 * the price of one count a day.
 */
const POOL_COUNT_TTL_SECONDS = 86_400;

/**
 * The statement that forgets the pool's size. A writer that puts a title in the
 * pool or takes one out adds it to its batch, as it is or with a condition
 * appended. A refresh of a title already in the pool does not change the count
 * and must not drop it: the cron refreshes titles all day.
 */
export const DROP_POOL_COUNT_SQL = `DELETE FROM kv WHERE key = '${POOL_COUNT_KEY}'`;

/** Count the pool and keep the answer, in one statement, so no change can land between the two. */
export const POOL_RECOUNT_SQL = `
  INSERT INTO kv (key, value, expires_at)
  SELECT ?1, COUNT(*), ?2 FROM media_items WHERE browsed = 0
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at
  RETURNING value`;

/**
 * How many titles the pool holds. One row read while the pool is the size it
 * was; the first sync after a title enters or leaves counts again.
 *
 * ⚠️ This must never answer LOWER than the truth. A device that holds more
 * titles than the number it is given throws its catalog away and downloads it
 * again (mobile/src/lib/catalogSync.ts), and would do that on every sync for as
 * long as the number stayed low, at about thirty requests a round. So a
 * statement that ADDS to the pool without DROP_POOL_COUNT_SQL in its batch is
 * the dangerous kind of forgetting. Too high only delays a device noticing a
 * deletion, and the day's expiry bounds that.
 *
 * It writes one row on a route anybody can call, and is not behind `spend()`:
 * that happens at most once per change to the pool and once a day, however
 * often it is asked.
 */
export async function poolSize(db: D1Database): Promise<number | null> {
  const kept = await kvGet(db, POOL_COUNT_KEY);
  if (kept !== null) return Number(kept);
  const row = await first<{ value: string }>(db, POOL_RECOUNT_SQL, [POOL_COUNT_KEY, nowSeconds() + POOL_COUNT_TTL_SECONDS]);
  return row ? Number(row.value) : null;
}
