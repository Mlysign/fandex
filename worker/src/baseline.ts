// The baseline: ordinary titles the score's pull axis compares a person's
// picks against (migration 0008, docs/fandex-score.md §3.7, 2026-10-26).
//
// scripts/baseline-draw.mjs draws them at random, per medium, from everything a
// provider knows above a vote floor, and writes them into `baseline_items` as
// pending. This walk puts each one into the pool through the same resolve a
// device's sync uses, so it is stored, merged and tagged exactly like every
// other title, and the Steam and Wikidata walks reach it afterwards. A device
// learns which pool titles are the baseline from GET /v1/catalog/baseline.
//
// The cost, priced before it ran: a title new to the catalog is about twelve
// row writes and a dozen queries (the resolve), plus one batch here. A run may
// make 50 queries on the free plan, so a run takes three; the every-minute
// trigger (`FAST_CRON`) carries it, and `DAILY_BASELINE_CAP` titles a day keep
// it to about a third of D1's 100,000 daily row writes. It waits for a word:
// the kv key `baseline_go` set to the draw to walk, like the re-derive.

import { capFrom, kvGet, kvSet, spend } from "./budget";
import { all, first, stmt } from "./d1";
import type { Env } from "./env";
import { DROP_POOL_COUNT_SQL } from "./keptCounts";
import { resolveItem } from "./catalog/resolve";
import { weakEtag } from "./catalog/read";

/** The second cron trigger (wrangler.jsonc). It skips the minutes the ten-minute one runs in. */
export const FAST_CRON = "* * * * *";
/** Titles a run resolves. About a dozen queries each, against 50 a run. */
export const BASELINE_PER_RUN = 3;
export const BASELINE_GO_KEY = "baseline_go";
const BASELINE_CURSOR_KEY = "baseline_cursor";
/** Titles the walk may fetch a day, its own budget: the users' resolves keep all of theirs. */
export const DEFAULT_DAILY_BASELINE_CAP = 2500;
/** How many times the walk goes round for titles a provider failed on, before it stops asking. */
const BASELINE_PASSES = 3;
/** The kept answer of GET /v1/catalog/baseline, and how long it is kept. */
export const BASELINE_JSON_KEY = "baseline_json";
const BASELINE_JSON_SECONDS = 6 * 3600;
/** The walks that tag pool games, started again when the walk is through (src/cron.ts). */
const RESTART_WHEN_DONE = ["steam_tags_cursor", "wikidata_people_cursor"];

type Cursor = { draw: number; pass: number; after: [string, string, string] } | { draw: number; done: true };

function readCursor(raw: string | null, draw: number): Cursor {
  try {
    const c = raw ? (JSON.parse(raw) as Cursor) : null;
    if (c && c.draw === draw) return c;
  } catch { /* from the start */ }
  return { draw, pass: 1, after: ["", "", ""] };
}

export interface BaselineRun {
  in: number;
  missing: number;
  failed: number;
  /** True once every drawn title has been walked (or given up on). */
  done: boolean;
  /** The day's budget is spent: the rest waits for tomorrow (UTC). */
  budget?: boolean;
}

/** Null when no draw is asked for; else what the run did. */
export async function runBaselineStep(env: Env, batch = BASELINE_PER_RUN): Promise<BaselineRun | null> {
  const go = Number(await kvGet(env.DB, BASELINE_GO_KEY));
  if (!(go > 0)) return null;
  const cursor = readCursor(await kvGet(env.DB, BASELINE_CURSOR_KEY), go);
  const out: BaselineRun = { in: 0, missing: 0, failed: 0, done: false };
  if ("done" in cursor) return { ...out, done: true };

  // Primary-key order from the cursor: the rows behind it are walked, so a run
  // reads only as far as its batch.
  const due = await all<{ source: string; source_id: string; media_type: string }>(
    env.DB,
    `SELECT source, source_id, media_type FROM baseline_items
      WHERE draw = ?1 AND state = 'pending' AND (source, source_id, media_type) > (?2, ?3, ?4)
      ORDER BY source, source_id, media_type LIMIT ?5`,
    [go, ...cursor.after, batch],
  );
  if (!due.length) {
    // A pass is through. Titles a provider failed on are still pending: go
    // round again for them, a few times, then stop asking.
    const left = await first<{ n: number }>(env.DB, "SELECT COUNT(*) n FROM baseline_items WHERE draw = ? AND state = 'pending'", [go]);
    if ((left?.n ?? 0) > 0 && cursor.pass < BASELINE_PASSES) {
      await kvSet(env.DB, BASELINE_CURSOR_KEY, JSON.stringify({ draw: go, pass: cursor.pass + 1, after: ["", "", ""] }));
      return out;
    }
    await kvSet(env.DB, BASELINE_CURSOR_KEY, JSON.stringify({ draw: go, done: true }));
    // The games the walk added get Steam's tags and Wikidata's people: those
    // walks parked once they were through the pool, so they start again.
    for (const key of RESTART_WHEN_DONE) await kvSet(env.DB, key, "");
    await env.DB.prepare("DELETE FROM kv WHERE key = ?").bind(BASELINE_JSON_KEY).run();
    return { ...out, done: true };
  }

  const budget = { kind: "baseline", cap: capFrom(env.DAILY_BASELINE_CAP, DEFAULT_DAILY_BASELINE_CAP) };
  let last: [string, string, string] | null = null;
  for (const row of due) {
    const res = await resolveItem(env, row.source, row.media_type, row.source_id, undefined, budget);
    if (!res.ok && res.reason === "budget") {
      // Not walked: the cursor stays before it, and tomorrow starts here.
      out.budget = true;
      break;
    }
    const key = [row.source, row.source_id, row.media_type] as [string, string, string];
    last = key;
    if (!res.ok) {
      if (res.reason === "not-found" || res.reason === "bad-request") {
        await env.DB.prepare("UPDATE baseline_items SET state = 'missing' WHERE source = ? AND source_id = ? AND media_type = ?").bind(...key).run();
        out.missing++;
      } else {
        // The provider failed: left pending for the next pass.
        out.failed++;
      }
      continue;
    }
    // One batch, in this order: the row first, so `added` reads whether the
    // title was in the pool before this walk; then the pool's kept size, dropped
    // only when this promotion changes it; then the promotion itself.
    await env.DB.batch([
      stmt(env.DB,
        `UPDATE baseline_items SET state = 'in', media_item_id = ?4,
                added = COALESCE((SELECT browsed FROM media_items WHERE id = ?4), 1)
          WHERE source = ?1 AND source_id = ?2 AND media_type = ?3`,
        [...key, res.id]),
      stmt(env.DB, `${DROP_POOL_COUNT_SQL} AND EXISTS (SELECT 1 FROM media_items WHERE id = ?1 AND browsed = 1)`, [res.id]),
      stmt(env.DB, "UPDATE media_items SET browsed = 0, updated_at = unixepoch() WHERE id = ? AND browsed = 1", [res.id]),
    ]);
    out.in++;
  }
  if (last) await kvSet(env.DB, BASELINE_CURSOR_KEY, JSON.stringify({ draw: go, pass: cursor.pass, after: last }));
  return out;
}

/**
 * GET /v1/catalog/baseline: which pool titles are the baseline, as
 * `{"draw":1,"items":[[id, type, added], …]}`. `added` is 1 for a title only
 * the draw put in the pool, which the website gives no page (build.mjs).
 *
 * Kept in kv for six hours: building it reads every baseline row and its item
 * (about 15,000 rows), and every device asks once a day. An answer with no
 * draw walked yet is `{"draw":0,"items":[]}`.
 */
export async function baselineJson(db: D1Database, mayBuild: () => Promise<boolean>): Promise<{ body: string; etag: string } | null> {
  // Kept as "etag\nbody", so a read splits a string and parses nothing.
  const kept = await kvGet(db, BASELINE_JSON_KEY);
  if (kept) {
    const cut = kept.indexOf("\n");
    return { etag: kept.slice(0, cut), body: kept.slice(cut + 1) };
  }
  if (!(await mayBuild())) return null;
  // One row per pool title: two drawn ids can name the same title (a port and
  // its main game), and the walk marks the second as already in the pool, so
  // `added` is the highest any of its rows says.
  const row = await first<{ body: string | null }>(
    db,
    `SELECT json_object('draw', COALESCE(MAX(draw), 0), 'items', json_group_array(json_array(id, type, added))) body
       FROM (SELECT b.media_item_id id, m.type type, MAX(b.added) added, MAX(b.draw) draw
               FROM baseline_items b JOIN media_items m ON m.id = b.media_item_id
              WHERE b.state = 'in' AND m.browsed = 0
              GROUP BY b.media_item_id)`,
  );
  const body = row?.body ?? '{"draw":0,"items":[]}';
  const etag = await weakEtag(body);
  await kvSet(db, BASELINE_JSON_KEY, `${etag}\n${body}`, BASELINE_JSON_SECONDS);
  return { body, etag };
}
