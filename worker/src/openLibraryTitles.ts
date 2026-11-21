// The Open Library books stored before a book's titles per language were taken
// (2026-11-21). A book resolved since carries them (getOpenLibraryWork reads
// its editions); each one stored before is asked for its editions once, in key
// order behind a cursor, and its titles merged onto the stored record, which
// re-derives the item. "Der Weg der Könige" is how The Way of Kings reads to a
// German account, and Hardcover has no German edition of it: Open Library does.
//
// A record that was asked carries `titles`, {} when no edition names a language
// an account reads, so it leaves the query. A book whose editions would not
// load is moved past and asked again on the next pass. Parks once a pass finds
// nothing left. No key and no quota at Open Library; two books a run is polite.

import { getOpenLibraryTitles } from "@/lib/sources/openlibrary";
import { kvGet, kvSet } from "./budget";
import { all } from "./d1";
import type { Env } from "./env";
import { upsertMediaItem } from "./catalog/ingest";

export const OPEN_LIBRARY_TITLES_PER_RUN = 2;
const CURSOR_KEY = "ol_titles_cursor";
const DONE = "done";

/** Open Library links from the cursor on whose record has no titles. By the primary key: (source, source_id, media_type). */
export const OPEN_LIBRARY_TITLES_DUE_SQL =
  `SELECT source_id, title, release_date, json_extract(raw_data, '$.title') AS work_title
     FROM media_links
    WHERE source = 'openlibrary' AND source_id > ? AND media_type = 'book' AND raw_data NOT LIKE '%"titles":%'
    ORDER BY source_id LIMIT ?`;

export async function runOpenLibraryTitlesStep(env: Env, batch = OPEN_LIBRARY_TITLES_PER_RUN): Promise<{ titled: number; failed: number } | null> {
  const cursor = (await kvGet(env.DB, CURSOR_KEY)) ?? "";
  if (cursor === DONE) return null;
  const due = await all<{ source_id: string; title: string; release_date: string | null; work_title: string | null }>(
    env.DB, OPEN_LIBRARY_TITLES_DUE_SQL, [cursor, batch],
  );
  if (!due.length) {
    await kvSet(env.DB, CURSOR_KEY, DONE);
    return { titled: 0, failed: 0 };
  }
  let titled = 0;
  let failed = 0;
  for (const link of due) {
    let titles: Record<string, string> | null = null;
    try {
      titles = await getOpenLibraryTitles(link.source_id, link.work_title ?? link.title);
    } catch (e) {
      console.warn("ol_titles_failed", { id: link.source_id, error: e instanceof Error ? e.message : String(e) });
    }
    if (titles) {
      // Merged over the stored record (mergeRawData): only `titles` is new.
      await upsertMediaItem(env.DB, {
        source: "openlibrary", sourceId: link.source_id, type: "book", title: link.title, releaseDate: link.release_date,
        rawData: { titles },
      }, { browsed: 1 });
      titled++;
    } else failed++;
  }
  await kvSet(env.DB, CURSOR_KEY, due[due.length - 1].source_id);
  return { titled, failed };
}
