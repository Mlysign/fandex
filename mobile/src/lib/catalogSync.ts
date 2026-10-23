// Keeping the device's copy of the scoring pool in step with the Worker's.
//
// The Worker serves the pool as a delta: pages of items changed since a cursor,
// oldest change first (worker/src/catalog/read.ts). The cursor is stored beside
// the rows and advanced in the SAME transaction that writes a page, so a sync
// killed half way resumes from the last page that fully landed and never from
// one that half did.
//
// A first sync is the whole pool. It is read from files the website's build
// wrote (mobile/web/build.mjs, `/catalog/`), which cost the Worker nothing, and
// then the Worker is asked only for what changed since those were written.
// Without the files it is about thirty requests to the Worker. After that a
// sync is one request that usually returns nothing.

import type { SQLiteDatabase } from 'expo-sqlite';
import { normalizeName } from '@/lib/normalize';
import { api, type DeltaCursor, type DeltaPage } from '~/lib/api';
import { CATALOG_FILES_URL } from '~/lib/config';
import { catalogCount, getMeta, setMeta, inTransaction } from '~/lib/db';
import { DATE_REGION_KEY } from '~/lib/localDates';

const CURSOR_KEY = 'catalog_cursor';
const LAST_SYNC_KEY = 'catalog_synced_at';
/** When a start-over last fixed nothing. See the end of syncCatalog. */
const FUTILE_RESET_KEY = 'catalog_reset_futile_at';
const FUTILE_RESET_PAUSE_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 150;
/** A runaway loop guard: no pool is this many pages. */
const MAX_PAGES = 400;

export interface SyncProgress {
  pages: number;
  written: number;
  total: number;
  /** This sync is filling an empty copy (the first one, or a start-over), so the device holds part of the pool. */
  refill: boolean;
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

/** One page's rows and the cursor after them, in ONE transaction: a page that half wrote must not move the cursor. */
export async function storePage(db: SQLiteDatabase, items: DeltaPage['items'], next: DeltaCursor): Promise<void> {
  if (!items.length) {
    await setMeta(db, CURSOR_KEY, JSON.stringify(next));
    return;
  }
  await inTransaction(db, async () => {
    const insert = await db.prepareAsync(
      // `release_date` is the date in this device's country where one is known
      // (lib/localDates.ts), `world_date` the catalog's own. Written together, so
      // a re-synced film does not fall back to the worldwide day.
      `INSERT INTO catalog (id, type, title, norm_title, slug, poster_url, release_date, world_date, year,
                            community_score, community_votes, updated_at, vector, facets)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6,
               COALESCE((SELECT r.date FROM regional_date r
                          WHERE ?2 = 'movie'
                            AND r.region = (SELECT value FROM meta WHERE key = '${DATE_REGION_KEY}')
                            AND r.media_item_id = ?1), ?7),
               ?7, ?8, ?9, ?10, ?11, ?12, ?13)
       ON CONFLICT(id) DO UPDATE SET
         type = excluded.type, title = excluded.title, norm_title = excluded.norm_title, slug = excluded.slug,
         poster_url = excluded.poster_url, release_date = excluded.release_date, world_date = excluded.world_date, year = excluded.year,
         community_score = excluded.community_score, community_votes = excluded.community_votes,
         updated_at = excluded.updated_at, vector = excluded.vector, facets = excluded.facets`,
    );
    try {
      for (const item of items) {
        const v = item.vector;
        await insert.executeAsync([
          v.id, v.type, v.title, normalizeName(v.title), v.slug, v.posterUrl, v.releaseDate, v.year,
          v.communityScore, v.communityVotes ?? 0, item.updatedAt, JSON.stringify(v), JSON.stringify(item.facets),
        ]);
      }
    } finally {
      await insert.finalizeAsync();
    }
    await setMeta(db, CURSOR_KEY, JSON.stringify(next));
  });
}

const isCursor = (c: unknown): c is DeltaCursor =>
  !!c && typeof (c as DeltaCursor).since === 'number' && typeof (c as DeltaCursor).after === 'string';

/**
 * Start an empty device from the catalog files. Returns how many rows it wrote.
 * The cursor is stored page by page, so whatever happens next the Worker is
 * asked from exactly where the files stopped.
 *
 * It never throws. No files, a file that will not load, a shape that is not a
 * page: each ends the attempt, and the Worker's delta carries on from the last
 * page that did land. The files are a shortcut, never the only way.
 */
async function startFromFiles(
  db: SQLiteDatabase, base: string, onProgress?: (p: SyncProgress) => void, signal?: { cancelled: boolean },
): Promise<number> {
  let written = 0;
  try {
    const index = (await (await fetch(`${base}/catalog/index.json`)).json()) as { version?: number; pages?: unknown };
    if (index?.version !== 1 || !Array.isArray(index.pages)) return 0;
    let n = 0;
    for (const name of index.pages) {
      if (signal?.cancelled) break;
      if (typeof name !== 'string' || !/^[a-z0-9]+\.json$/.test(name)) break;
      const res = await fetch(`${base}/catalog/${name}`);
      if (!res.ok) break;
      const page = (await res.json()) as { items?: DeltaPage['items']; next?: unknown };
      if (!Array.isArray(page?.items) || !isCursor(page.next)) break;
      await storePage(db, page.items, page.next);
      written += page.items.length;
      onProgress?.({ pages: ++n, written, total: await catalogCount(db), refill: true });
    }
  } catch (e) {
    console.warn('catalog_files_failed', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  }
  return written;
}

export async function syncCatalog(
  db: SQLiteDatabase,
  onProgress?: (p: SyncProgress) => void,
  signal?: { cancelled: boolean },
  afterReset = false,
): Promise<SyncResult> {
  let cursor = await readCursor(db);
  let written = 0;
  let poolCount: number | null = null;
  const refill = afterReset || (cursor.since === 0 && cursor.after === '');

  // An empty device starts from the files. ⚠️ Not after a start-over: that one
  // happened because the device held a title the pool no longer has, and the
  // files, written before it left, would bring it straight back.
  if (!afterReset && CATALOG_FILES_URL !== null && cursor.since === 0 && cursor.after === '') {
    written += await startFromFiles(db, CATALOG_FILES_URL, onProgress, signal);
    cursor = await readCursor(db);
  }

  for (let page = 1; page <= MAX_PAGES; page++) {
    if (signal?.cancelled) break;
    // A network failure throws out of here with every earlier page committed.
    const res = await api.catalogDelta(cursor, PAGE_SIZE, true);

    await storePage(db, res.items, res.next);
    written += res.items.length;

    cursor = res.next;
    onProgress?.({ pages: page, written, total: await catalogCount(db), refill });
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
  //
  // One-time is enforced, not assumed. If the fresh download is STILL more than
  // the count, the count is what is wrong (the Worker keeps it, and a kept count
  // can be low), and starting over again downloads the same rows. So a start-over
  // happens once per sync, and one that fixed nothing is not tried again for a
  // day, which is how long the Worker keeps a count before counting again. The
  // number itself is no use as the marker: a low count and a real removal a week
  // later can be the same number.
  if (poolCount !== null && total > poolCount && !signal?.cancelled) {
    if (afterReset) {
      await setMeta(db, FUTILE_RESET_KEY, String(Date.now()));
    } else if (Date.now() - Number((await getMeta(db, FUTILE_RESET_KEY)) ?? 0) >= FUTILE_RESET_PAUSE_MS) {
      await resetCatalog(db);
      return syncCatalog(db, onProgress, signal, true);
    }
  }
  return { written, total, poolCount };
}
