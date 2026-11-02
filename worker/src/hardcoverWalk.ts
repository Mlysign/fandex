// Hardcover onto the books Fandex holds from Open Library (2026-11-02).
//
// Until this, a book carried a Hardcover link only when somebody opened it
// from a Hardcover card, so a book that came in through Open Library (nearly
// all of them) showed none of Hardcover's genres, tags or moods. Nils, on Dune
// Messiah's page: "This has missing all the mood tags from hardcover."
//
// Two walks, run by the every-minute trigger, a few books a run:
//
//   1. HARDCOVER LINKS STORED WITHOUT MOODS. Moods were dropped at parsing
//      until 2026-11-02. Each such link is asked again and its moods merged
//      onto the stored record. Parks for a day once none are left.
//   2. OPEN LIBRARY BOOKS WITH NO HARDCOVER LINK. Each is looked up by its
//      ISBNs, then by title and first author (`findHardcoverBook`), and a hit
//      that is the same book is attached as a second link, the way a
//      Hardcover-first resolve attaches one (catalog/resolve.ts). Open
//      Library's work stays the book's identity. A book Hardcover does not
//      have is stamped `hardcoverChecked` on its Open Library record and asked
//      again after HARDCOVER_RECHECK_DAYS. In key order behind a cursor; at
//      the end of a pass it parks for a day and starts over, which is how a
//      book stored since is picked up.
//
// Not in the resolve path on purpose: a tap would wait on a second provider
// and pay a second re-derive, and the site is rebuilt nightly anyway.
//
// Every request is counted twice before it is made: against the walk's own
// day (`HARDCOVER_WALK_DAILY_CAP`, so the walk can never spend what search and
// the calendar need) and against Hardcover's shared one (`spendHardcover`).
// Facts only, as everywhere (src/lib/sources/hardcoverPure.ts).

import { ProviderUnavailableError } from "@/lib/http";
import { findHardcoverBook, getHardcoverBook, hardcoverConfigured } from "@/lib/sources/hardcover";
import { capFrom, kvGet, kvSet, spend } from "./budget";
import { all, nowSeconds } from "./d1";
import type { Env } from "./env";
import { linkSourceToItem, upsertMediaItem } from "./catalog/ingest";
import { findByProviderId } from "./catalog/resolve";
import { spendHardcover, useHardcover } from "./hardcover";

/** Books a run looks at. At most two Hardcover requests and one re-derive each. */
export const HARDCOVER_WALK_PER_RUN = 3;
/** Requests the walk may make a UTC day, of the 4,000 the Worker allows itself. */
export const DEFAULT_HARDCOVER_WALK_DAILY_CAP = 600;
/** A book Hardcover did not have is asked again after this long. */
export const HARDCOVER_RECHECK_DAYS = 180;

const CURSOR_KEY = "hardcover_walk_cursor";
const IDLE_KEY = "hardcover_walk_idle";
const MOODS_IDLE_KEY = "hardcover_moods_idle";
const IDLE_SECONDS = 86_400;

/**
 * Open Library books from the cursor on with no Hardcover link, not asked
 * about inside the recheck window. The primary key is (source, source_id,
 * media_type), so this reads from the cursor on; each candidate costs one
 * probe of idx_links_item. Only the fields a lookup needs leave the database.
 */
export const HARDCOVER_WALK_DUE_SQL =
  `SELECT l.source_id, l.media_item_id,
          json_extract(l.raw_data, '$.title') AS title,
          json_extract(l.raw_data, '$.author_name') AS authors,
          json_extract(l.raw_data, '$.isbn') AS isbns
     FROM media_links l
    WHERE l.source = 'openlibrary' AND l.source_id > ? AND l.media_type = 'book'
      AND json_extract(l.raw_data, '$.title') IS NOT NULL
      AND COALESCE(json_extract(l.raw_data, '$.hardcoverChecked'), 0) < ?
      AND NOT EXISTS (SELECT 1 FROM media_links h WHERE h.media_item_id = l.media_item_id AND h.source = 'hardcover')
    ORDER BY l.source_id LIMIT ?`;

/** Hardcover links whose record predates moods. Few: only books opened from a Hardcover card. */
export const HARDCOVER_MOODS_DUE_SQL =
  `SELECT source_id, title, release_date FROM media_links
    WHERE source = 'hardcover' AND media_type = 'book' AND raw_data NOT LIKE '%"moods":%'
    ORDER BY source_id LIMIT ?`;

export interface HardcoverWalkResult {
  moods: number;
  linked: number;
  absent: number;
  failed: number;
  /** The day's budget ran out part way. */
  budget: boolean;
}

/** One request's worth of both budgets. */
function walkSpender(env: Env): () => Promise<boolean> {
  const cap = capFrom(env.HARDCOVER_WALK_DAILY_CAP, DEFAULT_HARDCOVER_WALK_DAILY_CAP);
  return async () => (await spend(env.DB, "hardcover_walk", cap)) && (await spendHardcover(env));
}

const jsonList = (v: unknown): string[] => {
  if (typeof v !== "string") return [];
  try {
    const a = JSON.parse(v);
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
};

export async function runHardcoverWalkStep(env: Env, batch = HARDCOVER_WALK_PER_RUN, now = nowSeconds()): Promise<HardcoverWalkResult> {
  const out: HardcoverWalkResult = { moods: 0, linked: 0, absent: 0, failed: 0, budget: false };
  useHardcover(env);
  // Off or without a token, nothing moves and nothing is stamped: the walk waits.
  if (!hardcoverConfigured()) return out;
  const mayAsk = walkSpender(env);
  let left = batch;

  // ── 1. Hardcover links stored before moods were taken ──
  if (!(await kvGet(env.DB, MOODS_IDLE_KEY))) {
    const due = await all<{ source_id: string; title: string; release_date: string | null }>(env.DB, HARDCOVER_MOODS_DUE_SQL, [left]);
    if (!due.length) await kvSet(env.DB, MOODS_IDLE_KEY, "1", IDLE_SECONDS);
    for (const link of due) {
      if (!(await mayAsk())) { out.budget = true; return out; }
      let moods: string[];
      try {
        const book = await getHardcoverBook(link.source_id);
        // A book Hardcover deleted keeps what it had, with no moods, and leaves the walk.
        moods = book?.moods ?? [];
      } catch (e) {
        if (e instanceof ProviderUnavailableError) return out;
        out.failed++;
        console.warn("hardcover_moods_failed", { id: link.source_id, error: e instanceof Error ? e.message : String(e) });
        moods = [];
      }
      // Merged over the stored record (mergeRawData): only `moods` is new.
      await upsertMediaItem(env.DB, {
        source: "hardcover", sourceId: link.source_id, type: "book", title: link.title, releaseDate: link.release_date,
        rawData: { moods },
      }, { browsed: 1 });
      out.moods++;
      left--;
    }
  }
  if (left <= 0) return out;

  // ── 2. Open Library books with no Hardcover link ──
  if (await kvGet(env.DB, IDLE_KEY)) return out;
  const cursor = (await kvGet(env.DB, CURSOR_KEY)) ?? "";
  const due = await all<{ source_id: string; media_item_id: string; title: string; authors: string | null; isbns: string | null }>(
    env.DB, HARDCOVER_WALK_DUE_SQL, [cursor, now - HARDCOVER_RECHECK_DAYS * 86_400, left],
  );
  if (!due.length) {
    // The pass is through. Start over tomorrow, for the books stored since.
    await kvSet(env.DB, CURSOR_KEY, "");
    await kvSet(env.DB, IDLE_KEY, "1", IDLE_SECONDS);
    return out;
  }

  let last: string | null = null;
  for (const link of due) {
    let book;
    try {
      book = await findHardcoverBook({ title: link.title, authors: jsonList(link.authors), isbns: jsonList(link.isbns) }, mayAsk);
    } catch (e) {
      // Hardcover looks down: stop, and this book is asked again next run.
      if (e instanceof ProviderUnavailableError) break;
      // Anything else is about this one book. Moved past, not stamped: the next pass asks again.
      out.failed++;
      last = link.source_id;
      console.warn("hardcover_walk_failed", { id: link.source_id, error: e instanceof Error ? e.message : String(e) });
      continue;
    }
    // The day's budget is gone before an answer: this book is asked first tomorrow.
    if (book === undefined) { out.budget = true; break; }
    // Attached only when the Hardcover book is on no other item: a link never moves between items.
    const elsewhere = book ? await findByProviderId(env.DB, "hardcover", "book", String(book.id)) : null;
    if (book && !elsewhere) {
      await linkSourceToItem(env.DB, link.media_item_id, {
        source: "hardcover", sourceId: String(book.id), type: "book", title: book.title, releaseDate: book.releaseDate, rawData: book,
      });
      out.linked++;
    } else {
      await env.DB.prepare(
        "UPDATE media_links SET raw_data = json_set(raw_data, '$.hardcoverChecked', ?) WHERE source = 'openlibrary' AND source_id = ? AND media_type = 'book'",
      ).bind(now, link.source_id).run();
      out.absent++;
    }
    last = link.source_id;
  }
  if (last !== null) await kvSet(env.DB, CURSOR_KEY, last);
  return out;
}
