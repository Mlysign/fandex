// The titles a new account is asked to rate (components/Onboarding.tsx): the
// most popular titles on the device, of the types the person follows.
//
// Popularity is the crowd's vote count, which is not comparable across types
// (IGDB, TMDB and Hardcover count very different crowds). So each type is read
// in its own order and the types take turns, as Home's rails do.
//
// Each type is paged by a key (votes, then id), never an OFFSET: a rating
// takes a title out of what the query returns, and an offset would then skip
// the title after it.

import type { SQLiteDatabase } from 'expo-sqlite';
import type { MediaType } from '~/lib/api';
import type { CatalogRow } from '~/lib/db';

/** Where one type's list stopped: the last row's votes and id. Null before the first page. */
export type PickCursor = { votes: number; id: string } | null;

const COLUMNS = "id, type, title, slug, poster_url, release_date, world_date, year, community_score, community_votes";

/**
 * One page of one type: released, with a poster, not an add-on, not hidden,
 * and not already rated.
 */
export async function ratingPicksPage(db: SQLiteDatabase, type: MediaType, after: PickCursor, limit: number, today: string): Promise<CatalogRow[]> {
  const keyset = after ? 'AND (c.community_votes < ? OR (c.community_votes = ? AND c.id > ?))' : '';
  const params: (string | number)[] = [type, today, ...(after ? [after.votes, after.votes, after.id] : []), limit];
  return db.getAllAsync<CatalogRow>(
    `SELECT ${COLUMNS} FROM catalog c
      WHERE c.type = ?
        AND c.poster_url IS NOT NULL
        AND c.release_date IS NOT NULL AND c.release_date <= ?
        AND json_extract(c.vector, '$.addon') IS NULL
        AND NOT EXISTS (SELECT 1 FROM hidden_item h WHERE h.media_item_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM item_state s WHERE s.media_item_id = c.id AND s.rating > 0)
        ${keyset}
      ORDER BY c.community_votes DESC, c.id
      LIMIT ?`,
    params,
  );
}

/** The types take turns: the first of each, then the second of each. A type that runs out drops out. */
export function interleave<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const longest = Math.max(0, ...lists.map((l) => l.length));
  for (let i = 0; i < longest; i++) for (const l of lists) if (i < l.length) out.push(l[i]);
  return out;
}

/** The cursor after a page, or the old one when the page was empty. */
export function cursorAfter(page: CatalogRow[], was: PickCursor): PickCursor {
  const last = page[page.length - 1];
  return last ? { votes: last.community_votes, id: last.id } : was;
}

/** How many titles the account has rated, on this device. */
export async function ratedCount(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>("SELECT COUNT(DISTINCT media_item_id) n FROM item_state WHERE relation = 'library' AND rating > 0");
  return row?.n ?? 0;
}
