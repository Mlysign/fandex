// Keeping the device's copy of the scoring pool in step with the Worker's.
//
// The Worker serves the pool as a delta: pages of items changed since a cursor,
// oldest change first (worker/src/catalog/read.ts). The cursor is stored beside
// the rows and advanced in the SAME transaction that writes a page, so a sync
// killed half way resumes from the last page that fully landed and never from
// one that half did.
//
// A first sync is the whole pool, about thirty requests. After that a sync is
// one request that usually returns nothing.

import type { SQLiteDatabase } from 'expo-sqlite';
import { normalizeName } from '@/lib/normalize';
import { api, type DeltaCursor } from '~/lib/api';
import { catalogCount, getMeta, setMeta, inTransaction } from '~/lib/db';

const CURSOR_KEY = 'catalog_cursor';
const LAST_SYNC_KEY = 'catalog_synced_at';
const PAGE_SIZE = 150;
/** A runaway loop guard: no pool is this many pages. */
const MAX_PAGES = 400;

export interface SyncProgress {
  pages: number;
  written: number;
  total: number;
}

export interface SyncResult {
  written: number;
  total: number;
  /** The Worker's pool size, when asked for. Lower than `total` means a title was removed upstream. */
  poolCount: number | null;
}

async function readCursor(db: SQLiteDatabase): Promise<DeltaCursor> {
  const raw = await getMeta(db, CURSOR_KEY);
  if (!raw) return { since: 0, after: '' };
  try {
    const c = JSON.parse(raw) as DeltaCursor;
    return typeof c.since === 'number' && typeof c.after === 'string' ? c : { since: 0, after: '' };
  } catch {
    return { since: 0, after: '' };
  }
}

export async function lastSyncedAt(db: SQLiteDatabase): Promise<number | null> {
  const raw = await getMeta(db, LAST_SYNC_KEY);
  return raw ? Number(raw) : null;
}

/** Forget everything and start again from zero on the next sync. */
export async function resetCatalog(db: SQLiteDatabase): Promise<void> {
  await inTransaction(db, async () => {
    await db.runAsync('DELETE FROM catalog');
    await db.runAsync('DELETE FROM meta WHERE key IN (?, ?)', [CURSOR_KEY, LAST_SYNC_KEY]);
  });
}

export async function syncCatalog(
  db: SQLiteDatabase,
  onProgress?: (p: SyncProgress) => void,
  signal?: { cancelled: boolean },
): Promise<SyncResult> {
  let cursor = await readCursor(db);
  let written = 0;
  let poolCount: number | null = null;

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (signal?.cancelled) break;
    // A network failure throws out of here with every earlier page committed.
    const res = await api.catalogDelta(cursor, PAGE_SIZE, true);

    if (res.items.length) {
      await inTransaction(db, async () => {
        const insert = await db.prepareAsync(
          `INSERT INTO catalog (id, type, title, norm_title, slug, poster_url, release_date, year,
                                community_score, community_votes, updated_at, vector, facets)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             type = excluded.type, title = excluded.title, norm_title = excluded.norm_title, slug = excluded.slug,
             poster_url = excluded.poster_url, release_date = excluded.release_date, year = excluded.year,
             community_score = excluded.community_score, community_votes = excluded.community_votes,
             updated_at = excluded.updated_at, vector = excluded.vector, facets = excluded.facets`,
        );
        try {
          for (const item of res.items) {
            const v = item.vector;
            await insert.executeAsync([
              v.id, v.type, v.title, normalizeName(v.title), v.slug, v.posterUrl, v.releaseDate, v.year,
              v.communityScore, v.communityVotes ?? 0, item.updatedAt, JSON.stringify(v), JSON.stringify(item.facets),
            ]);
          }
        } finally {
          await insert.finalizeAsync();
        }
        await setMeta(db, CURSOR_KEY, JSON.stringify(res.next));
      });
      written += res.items.length;
    } else {
      await setMeta(db, CURSOR_KEY, JSON.stringify(res.next));
    }

    cursor = res.next;
    onProgress?.({ pages: page, written, total: await catalogCount(db) });
    if (res.done) {
      poolCount = res.poolCount;
      break;
    }
  }

  const total = await catalogCount(db);
  await setMeta(db, LAST_SYNC_KEY, String(Date.now()));

  // A delta cannot say "this title is gone". If the device holds MORE than the
  // Worker's pool once it is caught up, something was removed upstream, and the
  // only way to find out which is to start over. Rare, and one-time when it happens.
  if (poolCount !== null && total > poolCount && !signal?.cancelled) {
    await resetCatalog(db);
    return syncCatalog(db, onProgress, signal);
  }
  return { written, total, poolCount };
}
