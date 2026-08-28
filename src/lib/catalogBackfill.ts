import { query, get, run } from "@/lib/db";
import { log, errorFields } from "@/lib/logger";
import { DEFAULT_COUNTRY } from "@/lib/countries";
import { fetchMoviePage, fetchShowPage, fetchGamePageAllSources, type Direction, type FeedCandidate } from "@/lib/discoverFeed";
import { persistDiscoverItems } from "@/lib/discoverPersist";
import type { MediaType } from "@/types";

// The seeded backfill — phase 4 of docs/catalog-growth.md.
//
// ── What it is for ──────────────────────────────────────────────────────────
// A useful anonymous Discover wants 30–50k titles. We hold ~2,800, and the ones
// in the browse window are mostly rows the provider feed itself wrote while
// somebody scrolled past (measured 2026-08-28: 153 items in the future window,
// 128 of them `browsed = 1`). So serving browse from our own database is not
// blocked on code, it is blocked on breadth. This is what earns the breadth.
//
// ── Why it is a paced job and not a script you run once ─────────────────────
// 30–50k titles is roughly 60–120k provider calls. Doing that in an afternoon
// would exhaust RAWG's monthly quota many times over, and every row written is
// WAL that Litestream ships to S3 — the exact combination that blew the Railway
// spend cap on 2026-07-22 (PR16: 546,754 rows, 12.8 GB of WAL, site down).
// So it walks, on a timer, in bounded batches, and it is designed to be
// UNINTERESTING: a few hundred titles a day for weeks.
//
// ⚠️ THE PACING IS THE SAFETY FEATURE. Turning `BACKFILL_PAGES` up to "just get
// it done" is how this becomes an incident. If it needs to go faster, re-derive
// the numbers against docs/scalability.md and the Railway usage page first —
// checking spend is an explicit precondition for any bulk operation.
//
// ── Why it reuses the browse fetchers ───────────────────────────────────────
// `fetchMoviePage`/`fetchShowPage`/`fetchGamePageAllSources` are the SAME
// functions the Discover feed calls, which means: one definition of what a
// candidate is, the existing per-host circuit breaker and budget, the existing
// 15-minute page cache (so a lane re-reading a page it just read costs nothing),
// and games stay dual-source. A second fetch path would drift from the first.
//
// ⚠️ IGDB participates through `fetchGamePageAllSources`, so the IGDB kill
// switch (`IGDB_ENABLED=0`) applies here automatically. See sources/igdb.ts.

/** Pages pulled per pass, across all lanes. Each page is ~20-40 candidates. */
export const BACKFILL_PAGES = Number(process.env.BACKFILL_PAGES) || 2;
/** How often a pass runs. */
export const BACKFILL_INTERVAL_MS = Number(process.env.BACKFILL_INTERVAL_MS) || 30 * 60 * 1000;
/** Wall-clock ceiling for one pass, so a slow provider cannot run into the next. */
export const BACKFILL_BUDGET_MS = Number(process.env.BACKFILL_BUDGET_MS) || 120_000;
/**
 * Stop growing at this many catalog rows.
 *
 * ⚠️ A REAL ceiling, not a formality. At the measured 24.2 KB per item a 50k
 * catalog is ~1.2 GB, against the 2 GB tripwire in §3 — and pool memory, not
 * disk, is what actually binds (railway-cost-shape). Raising this is a sizing
 * decision, so `docs/catalog-growth.md` §3 gets re-read first.
 */
// Read at CALL time, not module load, for the same reason the kill switch is:
// a safety ceiling you cannot exercise without reloading the module is a safety
// ceiling nothing tests.
export function backfillMaxItems(): number {
  return Number(process.env.BACKFILL_MAX_ITEMS) || 50_000;
}
/** Unset = OFF. The backfill only runs when it is deliberately switched on. */
export function backfillEnabled(): boolean {
  const v = (process.env.BACKFILL_ENABLED ?? "").trim().toLowerCase();
  return v === "1" || v === "true";
}

/**
 * A lane is one (type, direction) pair, walked page by page.
 *
 * Both directions on purpose: `future` is what Discover's default browse shows,
 * `past` is what a facet or a year filter reaches for. Seeding only the future
 * would leave every catalogue surface except the timeline as thin as it is now.
 */
const LANES: { type: MediaType; direction: Direction }[] = [
  { type: "movie", direction: "future" },
  { type: "show", direction: "future" },
  { type: "game", direction: "future" },
  { type: "movie", direction: "past" },
  { type: "show", direction: "past" },
  { type: "game", direction: "past" },
];

const laneKey = (l: { type: MediaType; direction: Direction }) => `${l.type}:${l.direction}`;

export interface LaneState { lane: string; page: number; exhausted: number; strikes: number; added: number; seen: number; last_run: number }

export function laneStates(): LaneState[] {
  const rows = query<LaneState>(`SELECT lane, page, exhausted, strikes, added, seen, last_run FROM backfill_cursor`);
  const byLane = new Map(rows.map((r) => [r.lane, r]));
  return LANES.map((l) => byLane.get(laneKey(l)) ?? { lane: laneKey(l), page: 1, exhausted: 0, strikes: 0, added: 0, seen: 0, last_run: 0 });
}

/**
 * Consecutive empty pages before a lane is called finished.
 *
 * ⚠️ NOT ONE, and the reason was measured rather than imagined. The first live
 * run marked `game:past` exhausted on page 1 with nothing seen — because RAWG
 * was quota-latched and `fetchGamePageAllSources` SWALLOWS a provider failure
 * and answers `[]`. So an empty page cannot tell "this window is finished"
 * apart from "this provider is down", which is the same `undefined` vs `[]`
 * confusion the prune invariant exists to prevent, in a place where the cost is
 * a lane that silently never runs again.
 *
 * Three strikes: a transient outage costs three cheap empty pages spread across
 * three passes, and a genuinely finished lane still stops promptly. Any
 * non-empty page resets the count.
 */
const EMPTY_STRIKES = 3;

function fetchLane(l: { type: MediaType; direction: Direction }, page: number): Promise<FeedCandidate[]> {
  if (l.type === "movie") return fetchMoviePage(page, l.direction, DEFAULT_COUNTRY);
  if (l.type === "show") return fetchShowPage(page, l.direction);
  return fetchGamePageAllSources(page, l.direction);
}

export interface BackfillResult {
  ran: boolean;
  reason?: "disabled" | "at-cap";
  items: number;          // catalog size after the pass
  pages: number;          // pages actually pulled
  seen: number;           // candidates looked at
  added: number;          // NEW catalog rows created
  lanes: string[];        // which lanes moved
}

/**
 * One pass. Picks the least-recently-run lane that is not exhausted, pulls its
 * next page, persists what is new, and advances its cursor.
 *
 * ⚠️ It persists through `persistDiscoverItems`, the same writer the discover
 * path uses, so a backfilled row is indistinguishable from a browsed one and
 * inherits the thin-write rule: insert-only, `browsed = 1`, projection version
 * 0. The fill job (`catalogFill.ts`) enriches it afterwards, on its own clock.
 * That ordering is deliberate — ingesting thin and enriching later is what keeps
 * a page pull at ~1 provider call per page instead of one per title.
 */
export async function backfillBatch(pages = BACKFILL_PAGES): Promise<BackfillResult> {
  const size = () => get<{ n: number }>(`SELECT COUNT(*) n FROM media_items`)?.n ?? 0;
  const items = size();
  if (!backfillEnabled()) return { ran: false, reason: "disabled", items, pages: 0, seen: 0, added: 0, lanes: [] };
  if (items >= backfillMaxItems()) return { ran: false, reason: "at-cap", items, pages: 0, seen: 0, added: 0, lanes: [] };

  const deadline = Date.now() + BACKFILL_BUDGET_MS;
  let seen = 0, added = 0, pulled = 0;
  const moved: string[] = [];
  // ⚠️ Visited WITHIN this pass, and it is load-bearing. `last_run` is
  // strftime('%s','now'), so every lane a pass touches ends up with the same
  // second — the "least recently run" sort then cannot tell them apart and hands
  // back the same lane every iteration. A multi-page pass would hammer one lane
  // and starve the other five, which showed up as three strikes on one lane
  // while the rest had none. Prefer a lane this pass has not used yet.
  const visited = new Set<string>();

  for (let i = 0; i < pages; i++) {
    if (Date.now() > deadline) break;
    // Least-recently-run live lane, so every lane advances rather than the first
    // one racing ahead, and never the same lane twice in one pass while another
    // is still waiting.
    const live = laneStates().filter((s) => !s.exhausted);
    const pool = live.filter((s) => !visited.has(s.lane));
    // Tie-broken by DECLARATION order, not alphabetically: LANES is already
    // written in the order that matters (both future windows before the past
    // ones), and an alphabetical tiebreak would quietly re-prioritise it.
    const order = (l: string) => LANES.findIndex((x) => laneKey(x) === l);
    const next = (pool.length ? pool : live).sort((a, b) => a.last_run - b.last_run || order(a.lane) - order(b.lane))[0];
    if (!next) break;
    visited.add(next.lane);
    const [type, direction] = next.lane.split(":") as [MediaType, Direction];

    let candidates: FeedCandidate[] = [];
    try {
      candidates = await fetchLane({ type, direction }, next.page);
    } catch (e) {
      // A provider failure is not a reason to stop the whole pass or to advance
      // the cursor past a page we never read. Stamp it so another lane gets a
      // turn, and try this page again next time.
      log.warn("backfill_fetch_failed", { lane: next.lane, page: next.page, ...errorFields(e) });
      run(`INSERT INTO backfill_cursor (lane, page, last_run) VALUES (?, ?, strftime('%s','now'))
           ON CONFLICT(lane) DO UPDATE SET last_run = strftime('%s','now')`, [next.lane, next.page]);
      continue;
    }

    pulled++;
    moved.push(next.lane);
    const before = size();
    if (candidates.length) {
      // `raw` is what makes a row real rather than a dangling id, so anything
      // without one is not worth writing.
      persistDiscoverItems(candidates.filter((c) => c.raw) as any);
    }
    const grew = size() - before;
    seen += candidates.length;
    added += grew;

    // ⚠️ A SHORT page is a real answer and never ends a lane: a window that
    // genuinely holds few releases would stop the backfill early. An EMPTY one
    // is a strike, not an ending — see EMPTY_STRIKES for why one is not enough.
    const empty = candidates.length === 0;
    const strikes = empty ? next.strikes + 1 : 0;
    const exhausted = strikes >= EMPTY_STRIKES ? 1 : 0;
    run(
      `INSERT INTO backfill_cursor (lane, page, exhausted, strikes, added, seen, last_run)
       VALUES (?, ?, ?, ?, ?, ?, strftime('%s','now'))
       ON CONFLICT(lane) DO UPDATE SET
         page = excluded.page, exhausted = excluded.exhausted, strikes = excluded.strikes,
         added = backfill_cursor.added + ?, seen = backfill_cursor.seen + ?,
         last_run = strftime('%s','now')`,
      [next.lane, next.page + (empty ? 0 : 1), exhausted, strikes, grew, candidates.length, grew, candidates.length]
    );
  }

  return { ran: true, items: size(), pages: pulled, seen, added, lanes: [...new Set(moved)] };
}

/**
 * Put every lane back to page 1 and clear the exhausted flags.
 *
 * The windows slide (they are relative to today), so a lane that ran out of
 * future releases in March has more of them by June. Nothing calls this on a
 * timer yet: restarting a finished backfill is a deliberate act, because it
 * re-reads pages whose titles we already hold to find the few that are new.
 */
export function resetBackfill(): number {
  return run(`UPDATE backfill_cursor SET page = 1, exhausted = 0, strikes = 0`).changes;
}
